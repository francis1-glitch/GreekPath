const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// ── Requirements ──────────────────────────────────────────────────────────────

// GET /api/compliance/requirements
router.get('/requirements', async (req, res) => {
  try {
    res.json(await all('SELECT * FROM compliance_requirements ORDER BY category, name'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/compliance/requirements
router.post('/requirements', requireRole('admin', 'council_officer'), async (req, res) => {
  const { name, description, category, deadline, recurring, frequency } = req.body;
  if (!name || !category) return res.status(400).json({ error: 'name and category required' });
  try {
    const result = await run(`
      INSERT INTO compliance_requirements (name,description,category,deadline,recurring,frequency)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id
    `, [name, description || null, category, deadline || null, recurring ? 1 : 0, frequency || null]);

    const orgs = await all('SELECT id FROM organizations');
    for (const o of orgs) {
      await run(
        'INSERT INTO compliance_status (org_id, requirement_id, status) VALUES ($1,$2,$3)',
        [o.id, result.lastID, 'pending']
      );
    }
    res.status(201).json(await get('SELECT * FROM compliance_requirements WHERE id = $1', [result.lastID]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/compliance/requirements/:id
router.put('/requirements/:id', requireRole('admin', 'council_officer'), async (req, res) => {
  const { name, description, category, deadline, recurring, frequency } = req.body;
  try {
    const result = await run(`
      UPDATE compliance_requirements
      SET name=$1, description=$2, category=$3, deadline=$4, recurring=$5, frequency=$6
      WHERE id=$7
    `, [name, description, category, deadline, recurring ? 1 : 0, frequency, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(await get('SELECT * FROM compliance_requirements WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/compliance/requirements/:id
router.delete('/requirements/:id', requireRole('admin'), async (req, res) => {
  try {
    const result = await run('DELETE FROM compliance_requirements WHERE id = $1', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Status ────────────────────────────────────────────────────────────────────

// GET /api/compliance/status
router.get('/status', async (req, res) => {
  const { org_id, requirement_id } = req.query;
  let sql = `
    SELECT cs.*, cr.name AS req_name, cr.category, cr.deadline, cr.description AS req_description,
           o.name AS org_name, u.name AS reviewer_name
    FROM compliance_status cs
    JOIN compliance_requirements cr ON cs.requirement_id = cr.id
    JOIN organizations o ON cs.org_id = o.id
    LEFT JOIN users u ON cs.reviewed_by = u.id
    WHERE 1=1
  `;
  const params = [];
  if (org_id)         { sql += ` AND cs.org_id = $${params.length + 1}`;         params.push(org_id); }
  if (requirement_id) { sql += ` AND cs.requirement_id = $${params.length + 1}`; params.push(requirement_id); }
  sql += ' ORDER BY o.name, cr.category, cr.name';
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/compliance/status/:id
router.put('/status/:id', requireRole('admin', 'council_officer'), async (req, res) => {
  const { status, notes } = req.body;
  const submitted_date = status === 'compliant' ? new Date().toISOString() : null;
  try {
    const result = await run(`
      UPDATE compliance_status
      SET status=$1, submitted_date=$2, reviewed_by=$3, notes=$4
      WHERE id=$5
    `, [status, submitted_date, req.user.id, notes || null, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(await get(`
      SELECT cs.*, cr.name AS req_name, cr.category, cr.deadline
      FROM compliance_status cs
      JOIN compliance_requirements cr ON cs.requirement_id = cr.id
      WHERE cs.id = $1
    `, [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compliance/overview
router.get('/overview', async (req, res) => {
  try {
    res.json(await all(`
      SELECT
        o.id, o.name, o.chapter_letters, o.council, o.status AS org_status, o.gpa,
        COUNT(*)::int AS total,
        SUM(CASE WHEN cs.status='compliant' THEN 1 ELSE 0 END)::int AS compliant_count,
        SUM(CASE WHEN cs.status='overdue'   THEN 1 ELSE 0 END)::int AS overdue_count,
        SUM(CASE WHEN cs.status='pending'   THEN 1 ELSE 0 END)::int AS pending_count,
        ROUND(100.0 * SUM(CASE WHEN cs.status='compliant' THEN 1 ELSE 0 END) / COUNT(*), 0)::int AS compliance_pct
      FROM organizations o
      LEFT JOIN compliance_status cs ON o.id = cs.org_id
      GROUP BY o.id
      ORDER BY o.council, o.name
    `));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/compliance/reset — bulk reset to pending for new semester
router.post('/reset', requireRole('admin', 'council_officer'), async (req, res) => {
  const { org_id } = req.body;
  try {
    const params = [];
    let where = '';
    if (org_id) { where = ' WHERE org_id=$1'; params.push(org_id); }
    const result = await run(
      `UPDATE compliance_status
       SET status='pending', submitted_date=NULL, reviewed_by=NULL, notes=NULL${where}`,
      params
    );
    res.json({
      updated: result.changes,
      message: org_id
        ? `Reset ${result.changes} requirement(s) for this chapter`
        : `Reset ${result.changes} requirement(s) across all chapters`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/compliance/export/csv — export compliance status as CSV
router.get('/export/csv', async (req, res) => {
  const { org_id } = req.query;
  try {
    const params = [];
    let where = '';
    if (org_id) { where = ' AND cs.org_id=$1'; params.push(org_id); }
    const rows = await all(`
      SELECT o.name AS chapter, o.chapter_letters, o.council,
             cr.name AS requirement, cr.category, cr.deadline,
             cs.status, cs.submitted_date, cs.notes
      FROM compliance_status cs
      JOIN organizations o ON cs.org_id = o.id
      JOIN compliance_requirements cr ON cs.requirement_id = cr.id
      WHERE 1=1${where}
      ORDER BY o.council, o.name, cr.category, cr.name
    `, params);

    const headers = ['Chapter','Letters','Council','Requirement','Category','Deadline','Status','Submitted','Notes'];
    const csv = [headers.join(','), ...rows.map(r => [
      `"${r.chapter}"`, r.chapter_letters, r.council,
      `"${r.requirement}"`, r.category,
      r.deadline ? r.deadline.split('T')[0] : '',
      r.status,
      r.submitted_date ? r.submitted_date.split('T')[0] : '',
      `"${(r.notes || '').replace(/"/g,'""')}"`,
    ].join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="compliance.csv"');
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
