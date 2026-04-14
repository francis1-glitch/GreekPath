const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createNotification, notifyAdminsAndOfficers } = require('../utils/notifications');

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
  if (org_id)          { sql += ` AND e.org_id = $${params.length+1}`;          params.push(org_id); }
  if (approval_status) { sql += ` AND e.approval_status = $${params.length+1}`; params.push(approval_status); }
  sql += ' ORDER BY e.date DESC';
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/calendar?year=&month=
router.get('/calendar', async (req, res) => {
  const { year, month } = req.query;
  const y = parseInt(year, 10) || new Date().getFullYear();
  const m = parseInt(month, 10) || new Date().getMonth() + 1;
  const startDate = `${y}-${String(m).padStart(2,'0')}-01`;
  const endDate = m === 12 ? `${y+1}-01-01` : `${y}-${String(m+1).padStart(2,'0')}-01`;
  try {
    const events = await all(
      joinSql + ` WHERE e.date >= $1 AND e.date < $2 ORDER BY e.date`,
      [startDate, endDate]
    );
    res.json(events);
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
  const { org_id, name, date, venue, expected_attendance, alcohol_present, security_plan, risk_assessment } = req.body;
  if (!org_id || !name || !date) return res.status(400).json({ error: 'org_id, name, date required' });
  try {
    const result = await run(`
      INSERT INTO events
        (org_id, name, date, venue, expected_attendance, alcohol_present, security_plan, risk_assessment)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id
    `, [org_id, name, date, venue||null, expected_attendance||null,
        alcohol_present ? 1 : 0, security_plan||null, risk_assessment||null]);

    // Notify admins/officers of new event submission
    const org = await get('SELECT name FROM organizations WHERE id=$1', [org_id]);
    await notifyAdminsAndOfficers(
      `📅 New event submitted by ${org?.name}: "${name}" on ${new Date(date).toLocaleDateString()}`,
      'info',
      '/events.html'
    );

    res.status(201).json(await get(joinSql + ' WHERE e.id = $1', [result.lastID]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/events/:id
router.put('/:id', async (req, res) => {
  const { name, date, venue, expected_attendance, alcohol_present, security_plan, risk_assessment, notes } = req.body;
  try {
    const result = await run(`
      UPDATE events
      SET name=$1, date=$2, venue=$3, expected_attendance=$4, alcohol_present=$5,
          security_plan=$6, risk_assessment=$7, notes=$8
      WHERE id=$9
    `, [name, date, venue, expected_attendance, alcohol_present ? 1 : 0,
        security_plan, risk_assessment||null, notes, req.params.id]);
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
    const result = await run(
      `UPDATE events SET approval_status=$1, reviewed_by=$2, notes=$3 WHERE id=$4`,
      [approval_status, req.user.id, notes||null, req.params.id]
    );
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    const ev = await get(joinSql + ' WHERE e.id = $1', [req.params.id]);

    // Notify chapter officers of decision
    const chapterUsers = await all(
      `SELECT id FROM users WHERE org_id=$1 OR role='admin'`, [ev.org_id]
    );
    for (const u of chapterUsers) {
      await createNotification(
        u.id,
        `Event "${ev.name}" was ${approval_status === 'approved' ? '✅ approved' : approval_status === 'denied' ? '❌ denied' : '↩ returned to pending'}.` +
          (notes ? ` Note: ${notes}` : ''),
        approval_status === 'approved' ? 'success' : approval_status === 'denied' ? 'warning' : 'info',
        '/events.html'
      );
    }

    res.json(ev);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/events/:id/report — post-event report
router.post('/:id/report', async (req, res) => {
  const { actual_attendance, incident_notes } = req.body;
  try {
    await run(`
      INSERT INTO event_reports (event_id, actual_attendance, incident_notes, submitted_by, submitted_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (event_id) DO UPDATE
        SET actual_attendance=$2, incident_notes=$3, submitted_by=$4, submitted_at=NOW()
    `, [req.params.id, actual_attendance||null, incident_notes||null, req.user.id]);
    res.json(await get('SELECT * FROM event_reports WHERE event_id=$1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/events/:id/report
router.get('/:id/report', async (req, res) => {
  try {
    const report = await get('SELECT * FROM event_reports WHERE event_id=$1', [req.params.id]);
    res.json(report || null);
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
