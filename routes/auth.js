const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { run, get, all } = require('../database/db');
const { authenticate, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const user = await get('SELECT * FROM users WHERE email = $1', [email]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      JWT_SECRET,
      { expiresIn: '24h' }
    );
    res.json({ token, user: { id: user.id, email: user.email, role: user.role, name: user.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  const { name, email, password, role, org_id } = req.body;
  if (!name || !email || !password || !role)
    return res.status(400).json({ error: 'Name, email, password, and role are required' });
  if (!['chapter_officer', 'council_officer'].includes(role))
    return res.status(400).json({ error: 'Role must be chapter_officer or council_officer' });
  if (password.length < 8)
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  try {
    const existing = await get('SELECT id FROM users WHERE email = $1', [email.toLowerCase().trim()]);
    if (existing) return res.status(409).json({ error: 'An account with that email already exists' });

    const hashed = bcrypt.hashSync(password, 10);
    await run(
      'INSERT INTO users (email, password, role, name, org_id) VALUES ($1,$2,$3,$4,$5)',
      [email.toLowerCase().trim(), hashed, role, name.trim(), org_id || null]
    );
    res.status(201).json({ message: 'Account created successfully. You can now log in.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, async (req, res) => {
  try {
    const user = await get('SELECT id, email, role, name, created_at FROM users WHERE id = $1', [req.user.id]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/users  (admin only)
router.get('/users', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  try {
    res.json(await all('SELECT id, email, role, name, created_at FROM users ORDER BY id'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/users  (admin only)
router.post('/users', authenticate, async (req, res) => {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  const { email, password, role, name } = req.body;
  if (!email || !password || !role || !name) return res.status(400).json({ error: 'All fields required' });
  try {
    const hashed = bcrypt.hashSync(password, 10);
    const result = await run(
      'INSERT INTO users (email, password, role, name) VALUES ($1,$2,$3,$4) RETURNING id',
      [email, hashed, role, name]
    );
    res.status(201).json({ id: result.lastID, email, role, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
