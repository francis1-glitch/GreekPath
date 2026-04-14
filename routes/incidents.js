const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { notifyAdmins } = require('../utils/notifications');

const router = express.Router();
router.use(authenticate);

const joinSql = `
  SELECT i.*, o.name AS org_name, o.chapter_letters, o.council
  FROM incidents i
  JOIN organizations o ON i.org_id = o.id
`;

// GET /api/incidents
router.get('/', async (req, res) => {
  const { org_id, type, status, severity } = req.query;
  let sql = joinSql + ' WHERE 1=1';
  const params = [];
  if (org_id)   { sql += ` AND i.org_id = $${params.length+1}`;    params.push(org_id); }
  if (type)     { sql += ` AND i.type = $${params.length+1}`;       params.push(type); }
  if (status)   { sql += ` AND i.status = $${params.length+1}`;     params.push(status); }
  if (severity) { sql += ` AND i.severity = $${params.length+1}`;   params.push(severity); }
  sql += ' ORDER BY i.reported_date DESC';
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/incidents/:id
router.get('/:id', async (req, res) => {
  try {
    const inc = await get(joinSql + ' WHERE i.id = $1', [req.params.id]);
    if (!inc) return res.status(404).json({ error: 'Not found' });
    res.json(inc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/incidents
router.post('/', async (req, res) => {
  const { org_id, type, description, severity } = req.body;
  if (!org_id || !type || !description || !severity)
    return res.status(400).json({ error: 'org_id, type, description, severity required' });
  try {
    const result = await run(`
      INSERT INTO incidents (org_id, type, description, reported_date, status, severity)
      VALUES ($1, $2, $3, NOW(), 'open', $4) RETURNING id
    `, [org_id, type, description, severity]);

    const inc = await get(joinSql + ' WHERE i.id = $1', [result.lastID]);

    // Auto-add initial timeline entry
    await run(`
      INSERT INTO incident_timeline (incident_id, author_id, action_taken, notes)
      VALUES ($1, $2, 'Incident reported', $3)
    `, [result.lastID, req.user.id, description]);

    // Notify admins if critical
    if (severity === 'critical') {
      await notifyAdmins(
        `🚨 Critical incident reported for ${inc.org_name}: ${type.replace('_',' ')} — ${description.substring(0, 100)}`,
        'danger',
        `/incidents.html`
      );
    }

    res.status(201).json(inc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/incidents/:id
router.put('/:id', requireRole('admin', 'council_officer'), async (req, res) => {
  const { type, description, status, severity, resolution, resolved_date } = req.body;
  try {
    const result = await run(`
      UPDATE incidents
      SET type=$1, description=$2, status=$3, severity=$4, resolution=$5, resolved_date=$6
      WHERE id=$7
    `, [type, description, status, severity, resolution||null, resolved_date||null, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(await get(joinSql + ' WHERE i.id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/incidents/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await run('DELETE FROM incidents WHERE id = $1', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Timeline ──────────────────────────────────────────────────────────────────

// GET /api/incidents/:id/timeline
router.get('/:id/timeline', async (req, res) => {
  try {
    const entries = await all(`
      SELECT it.*, u.name AS author_name
      FROM incident_timeline it
      JOIN users u ON it.author_id = u.id
      WHERE it.incident_id = $1
      ORDER BY it.entry_date ASC
    `, [req.params.id]);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/incidents/:id/timeline
router.post('/:id/timeline', async (req, res) => {
  const { action_taken, notes } = req.body;
  if (!action_taken) return res.status(400).json({ error: 'action_taken required' });
  try {
    const result = await run(`
      INSERT INTO incident_timeline (incident_id, author_id, action_taken, notes)
      VALUES ($1, $2, $3, $4) RETURNING id
    `, [req.params.id, req.user.id, action_taken, notes||null]);
    const entry = await get(`
      SELECT it.*, u.name AS author_name
      FROM incident_timeline it
      JOIN users u ON it.author_id = u.id
      WHERE it.id = $1
    `, [result.lastID]);
    res.status(201).json(entry);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/incidents/:incidentId/timeline/:id
router.delete('/:incidentId/timeline/:id', requireRole('admin'), async (req, res) => {
  try {
    await run('DELETE FROM incident_timeline WHERE id=$1 AND incident_id=$2',
      [req.params.id, req.params.incidentId]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Sanctions ─────────────────────────────────────────────────────────────────

// GET /api/incidents/:id/sanctions
router.get('/:id/sanctions', async (req, res) => {
  try {
    const sanctions = await all(`
      SELECT s.*, o.name AS org_name, u.name AS created_by_name
      FROM sanctions s
      JOIN organizations o ON s.org_id = o.id
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.incident_id = $1
      ORDER BY s.created_at DESC
    `, [req.params.id]);
    res.json(sanctions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/incidents/:id/sanctions
router.post('/:id/sanctions', requireRole('admin', 'council_officer'), async (req, res) => {
  const { org_id, sanction_type, start_date, end_date, conditions } = req.body;
  if (!org_id || !sanction_type || !start_date)
    return res.status(400).json({ error: 'org_id, sanction_type, start_date required' });
  try {
    const result = await run(`
      INSERT INTO sanctions
        (incident_id, org_id, sanction_type, start_date, end_date, conditions, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `, [req.params.id, org_id, sanction_type, start_date, end_date||null, conditions||null, req.user.id]);

    // Update org status if sanction is probation or suspension
    if (sanction_type === 'probation') {
      await run(`UPDATE organizations SET status='probation' WHERE id=$1`, [org_id]);
    } else if (sanction_type === 'suspension') {
      await run(`UPDATE organizations SET status='suspended' WHERE id=$1`, [org_id]);
    } else if (sanction_type === 'revocation') {
      await run(`UPDATE organizations SET status='revoked' WHERE id=$1`, [org_id]);
    }

    const sanction = await get(`
      SELECT s.*, o.name AS org_name, u.name AS created_by_name
      FROM sanctions s
      JOIN organizations o ON s.org_id = o.id
      LEFT JOIN users u ON s.created_by = u.id
      WHERE s.id = $1
    `, [result.lastID]);
    res.status(201).json(sanction);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/incidents/sanctions/:id
router.put('/sanctions/:id', requireRole('admin', 'council_officer'), async (req, res) => {
  const { sanction_type, start_date, end_date, conditions, status } = req.body;
  try {
    const result = await run(`
      UPDATE sanctions
      SET sanction_type=$1, start_date=$2, end_date=$3, conditions=$4, status=$5
      WHERE id=$6
    `, [sanction_type, start_date, end_date||null, conditions||null, status||'active', req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(await get('SELECT * FROM sanctions WHERE id=$1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
