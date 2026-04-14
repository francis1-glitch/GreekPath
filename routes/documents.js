const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { createNotification, notifyAdmins } = require('../utils/notifications');

const router = express.Router();
router.use(authenticate);

// Ensure uploads/documents directory exists
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'documents');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, `${Date.now()}-${safe}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 25 * 1024 * 1024 } });

const joinSql = `
  SELECT d.*,
    o.name AS org_name, o.chapter_letters,
    cr.name AS requirement_name,
    u.name AS uploaded_by_name,
    rv.name AS reviewed_by_name
  FROM documents d
  JOIN organizations o ON d.org_id = o.id
  LEFT JOIN compliance_requirements cr ON d.requirement_id = cr.id
  LEFT JOIN users u ON d.uploaded_by = u.id
  LEFT JOIN users rv ON d.reviewed_by = rv.id
`;

// GET /api/documents
router.get('/', async (req, res) => {
  const { org_id, requirement_id, status } = req.query;
  let sql = joinSql + ' WHERE 1=1';
  const params = [];
  if (org_id)         { sql += ` AND d.org_id = $${params.length+1}`;          params.push(org_id); }
  if (requirement_id) { sql += ` AND d.requirement_id = $${params.length+1}`;  params.push(requirement_id); }
  if (status)         { sql += ` AND d.status = $${params.length+1}`;          params.push(status); }
  sql += ' ORDER BY d.uploaded_at DESC';
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id
router.get('/:id', async (req, res) => {
  try {
    const doc = await get(joinSql + ' WHERE d.id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/documents/upload — multipart form upload
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const { org_id, requirement_id, description } = req.body;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });

  try {
    const result = await run(`
      INSERT INTO documents
        (org_id, requirement_id, file_name, original_name, file_type, file_size,
         description, uploaded_by, uploaded_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING id
    `, [
      org_id,
      requirement_id || null,
      req.file.filename,
      req.file.originalname,
      req.file.mimetype,
      req.file.size,
      description || null,
      req.user.id,
    ]);

    // Notify admins of new document upload
    const org = await get('SELECT name FROM organizations WHERE id = $1', [org_id]);
    await notifyAdmins(
      `📄 New document uploaded by ${req.user.name} for ${org?.name || 'a chapter'}: "${req.file.originalname}"`,
      'info',
      '/documents.html'
    );

    res.status(201).json(await get(joinSql + ' WHERE d.id = $1', [result.lastID]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/documents/:id/review — approve or reject
router.put('/:id/review', requireRole('admin', 'council_officer'), async (req, res) => {
  const { status, review_notes } = req.body;
  if (!['approved', 'rejected', 'pending_review'].includes(status))
    return res.status(400).json({ error: 'status must be approved, rejected, or pending_review' });

  try {
    const result = await run(`
      UPDATE documents
      SET status=$1, reviewed_by=$2, reviewed_at=NOW(), review_notes=$3
      WHERE id=$4
    `, [status, req.user.id, review_notes || null, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    const doc = await get(joinSql + ' WHERE d.id = $1', [req.params.id]);

    // If approved and linked to a compliance requirement, update compliance status
    if (status === 'approved' && doc.requirement_id) {
      await run(`
        UPDATE compliance_status
        SET status='compliant', reviewed_by=$1, submitted_date=NOW(),
            notes=COALESCE($2, notes)
        WHERE org_id=$3 AND requirement_id=$4
      `, [req.user.id, review_notes || null, doc.org_id, doc.requirement_id]);
    }

    // Notify the uploader of the decision
    await createNotification(
      doc.uploaded_by,
      `Your document "${doc.original_name}" was ${status === 'approved' ? '✅ approved' : '❌ rejected'}.` +
        (review_notes ? ` Notes: ${review_notes}` : ''),
      status === 'approved' ? 'success' : 'warning',
      '/documents.html'
    );

    res.json(doc);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/documents/:id
router.delete('/:id', requireRole('admin', 'council_officer'), async (req, res) => {
  try {
    const doc = await get('SELECT file_name FROM documents WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    await run('DELETE FROM documents WHERE id = $1', [req.params.id]);
    // Remove file from disk (best effort)
    try { fs.unlinkSync(path.join(UPLOAD_DIR, doc.file_name)); } catch (_) {}
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/documents/:id/download — serve the file
router.get('/:id/download', async (req, res) => {
  try {
    const doc = await get('SELECT file_name, original_name FROM documents WHERE id = $1', [req.params.id]);
    if (!doc) return res.status(404).json({ error: 'Not found' });
    const filePath = path.join(UPLOAD_DIR, doc.file_name);
    res.download(filePath, doc.original_name);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
