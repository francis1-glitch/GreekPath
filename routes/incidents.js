const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');

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
  if (org_id)   { sql += ` AND i.org_id = $${params.length + 1}`;    params.push(org_id); }
  if (type)     { sql += ` AND i.type = $${params.length + 1}`;       params.push(type); }
  if (status)   { sql += ` AND i.status = $${params.length + 1}`;     params.push(status); }
  if (severity) { sql += ` AND i.severity = $${params.length + 1}`;   params.push(severity); }
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
    res.status(201).json(await get(joinSql + ' WHERE i.id = $1', [result.lastID]));
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
    `, [type, description, status, severity, resolution || null, resolved_date || null, req.params.id]);
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

module.exports = router;
