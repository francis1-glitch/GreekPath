const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

const joinSql = `
  SELECT e.*, o.name AS org_name, o.chapter_letters, o.council, u.name AS reviewer_name
  FROM events e
  JOIN organizations o ON e.org_id = o.id
  LEFT JOIN users u ON e.reviewed_by = u.id
`;

// GET /api/events
router.get('/', async (req, res) => {
  const { org_id, approval_status } = req.query;
  let sql = joinSql + ' WHERE 1=1';
  const params = [];
  if (org_id)          { sql += ` AND e.org_id = $${params.length + 1}`;          params.push(org_id); }
  if (approval_status) { sql += ` AND e.approval_status = $${params.length + 1}`; params.push(approval_status); }
  sql += ' ORDER BY e.date DESC';
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id
router.get('/:id', async (req, res) => {
  try {
    const ev = await get(joinSql + ' WHERE e.id = $1', [req.params.id]);
    if (!ev) return res.status(404).json({ error: 'Not found' });
    res.json(ev);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events
router.post('/', async (req, res) => {
  const { org_id, name, date, venue, expected_attendance, alcohol_present, security_plan } = req.body;
  if (!org_id || !name || !date) return res.status(400).json({ error: 'org_id, name, date required' });
  try {
    const result = await run(`
      INSERT INTO events (org_id, name, date, venue, expected_attendance, alcohol_present, security_plan)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [org_id, name, date, venue || null, expected_attendance || null, alcohol_present ? 1 : 0, security_plan || null]);
    res.status(201).json(await get(joinSql + ' WHERE e.id = $1', [result.lastID]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:id
router.put('/:id', async (req, res) => {
  const { name, date, venue, expected_attendance, alcohol_present, security_plan, notes } = req.body;
  try {
    const result = await run(`
      UPDATE events
      SET name=$1, date=$2, venue=$3, expected_attendance=$4, alcohol_present=$5, security_plan=$6, notes=$7
      WHERE id=$8
    `, [name, date, venue, expected_attendance, alcohol_present ? 1 : 0, security_plan, notes, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(await get(joinSql + ' WHERE e.id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/review
router.post('/:id/review', requireRole('admin', 'council_officer'), async (req, res) => {
  const { approval_status, notes } = req.body;
  if (!['approved', 'denied', 'pending'].includes(approval_status))
    return res.status(400).json({ error: 'approval_status must be approved, denied, or pending' });
  try {
    const result = await run(`
      UPDATE events SET approval_status=$1, reviewed_by=$2, notes=$3 WHERE id=$4
    `, [approval_status, req.user.id, notes || null, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json(await get(joinSql + ' WHERE e.id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/events/:id
router.delete('/:id', requireRole('admin', 'council_officer'), async (req, res) => {
  try {
    const result = await run('DELETE FROM events WHERE id = $1', [req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
