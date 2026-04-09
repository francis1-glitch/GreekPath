const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/organizations
router.get('/', async (req, res) => {
  const { council, status } = req.query;
  let sql = 'SELECT * FROM organizations WHERE 1=1';
  const params = [];
  if (council) { sql += ` AND council = $${params.length + 1}`;  params.push(council); }
  if (status)  { sql += ` AND status = $${params.length + 1}`;   params.push(status); }
  sql += ' ORDER BY council, name';
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/organizations/summary
router.get('/summary', async (req, res) => {
  try {
    const totals = await get(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN status='active'    THEN 1 ELSE 0 END)::int AS active,
        SUM(CASE WHEN status='probation' THEN 1 ELSE 0 END)::int AS probation,
        SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END)::int AS suspended,
        SUM(CASE WHEN status='revoked'   THEN 1 ELSE 0 END)::int AS revoked
      FROM organizations
    `);
    const { count: openIncidents } = await get(`SELECT COUNT(*)::int AS count FROM incidents WHERE status IN ('open','investigating')`);
    const { count: pendingEvents } = await get(`SELECT COUNT(*)::int AS count FROM events WHERE approval_status = 'pending'`);
    const { rate: complianceRate } = await get(`
      SELECT ROUND(100.0 * SUM(CASE WHEN status='compliant' THEN 1 ELSE 0 END) / COUNT(*), 1) AS rate
      FROM compliance_status
    `);
    res.json({ ...totals, openIncidents, pendingEvents, complianceRate });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/organizations/:id
router.get('/:id', async (req, res) => {
  try {
    const org = await get('SELECT * FROM organizations WHERE id = $1', [req.params.id]);
    if (!org) return res.status(404).json({ error: 'Not found' });

    const compliance = await all(`
      SELECT cs.*, cr.name AS req_name, cr.category, cr.deadline, cr.description AS req_description
      FROM compliance_status cs
      JOIN compliance_requirements cr ON cs.requirement_id = cr.id
      WHERE cs.org_id = $1
      ORDER BY cr.category, cr.name
    `, [org.id]);

    const incidents = await all(
      'SELECT * FROM incidents WHERE org_id = $1 ORDER BY reported_date DESC',
      [org.id]
    );

    const events = await all(`
      SELECT e.*, u.name AS reviewer_name
      FROM events e
      LEFT JOIN users u ON e.reviewed_by = u.id
      WHERE e.org_id = $1
      ORDER BY e.date DESC
    `, [org.id]);

    res.json({ ...org, compliance, incidents, events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/organizations
router.post('/', requireRole('admin', 'council_officer'), async (req, res) => {
  const { name, chapter_letters, national_affiliation, council, status,
          founded_date, advisor_name, advisor_email, roster_size, gpa } = req.body;
  if (!name || !chapter_letters || !council)
    return res.status(400).json({ error: 'name, chapter_letters, and council required' });
  try {
    const result = await run(`
      INSERT INTO organizations
        (name,chapter_letters,national_affiliation,council,status,founded_date,advisor_name,advisor_email,roster_size,gpa)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id
    `, [name, chapter_letters, national_affiliation || null, council, status || 'active',
        founded_date || null, advisor_name || null, advisor_email || null,
        roster_size || 0, gpa || 0.0]);

    const reqs = await all('SELECT id FROM compliance_requirements');
    for (const r of reqs) {
      await run(
        'INSERT INTO compliance_status (org_id, requirement_id, status) VALUES ($1,$2,$3)',
        [result.lastID, r.id, 'pending']
      );
    }
    res.status(201).json(await get('SELECT * FROM organizations WHERE id = $1', [result.lastID]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/organizations/:id
router.put('/:id', requireRole('admin', 'council_officer'), async (req, res) => {
  const { name, chapter_letters, national_affiliation, council, status,
          founded_date, advisor_name, advisor_email, roster_size, gpa } = req.body;
  try {
    const result = await run(`
      UPDATE organizations
      SET name=$1, chapter_letters=$2, national_affiliation=$3, council=$4, status=$5,
          founded_date=$6, advisor_name=$7, advisor_email=$8, roster_size=$9, gpa=$10
      WHERE id=$11
    `, [name, chapter_letters, national_affiliation, council, status,
        founded_date, advisor_name, advisor_email, roster_size, gpa, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(await get('SELECT * FROM organizations WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/organizations/:id
router.delete('/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await run('DELETE FROM organizations WHERE id = $1', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
