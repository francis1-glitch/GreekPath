const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/notifications — current user's notifications
router.get('/', async (req, res) => {
  const { limit = 50, unread_only } = req.query;
  let sql = 'SELECT * FROM notifications WHERE user_id = $1';
  const params = [req.user.id];
  if (unread_only === '1') { sql += ' AND read = FALSE'; }
  sql += ` ORDER BY created_at DESC LIMIT $${params.length + 1}`;
  params.push(parseInt(limit, 10) || 50);
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/notifications/unread-count
router.get('/unread-count', async (req, res) => {
  try {
    const row = await get(
      'SELECT COUNT(*)::int AS count FROM notifications WHERE user_id=$1 AND read=FALSE',
      [req.user.id]
    );
    res.json({ count: row.count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/:id/read
router.put('/:id/read', async (req, res) => {
  try {
    await run('UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/notifications/read-all
router.put('/read-all', async (req, res) => {
  try {
    await run('UPDATE notifications SET read=TRUE WHERE user_id=$1', [req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/notifications/:id
router.delete('/:id', async (req, res) => {
  try {
    await run('DELETE FROM notifications WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
