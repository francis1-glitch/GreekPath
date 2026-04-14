const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { notifyAdminsAndOfficers } = require('../utils/notifications');

const router = express.Router();
router.use(authenticate);

// Memory storage for upload-preview (file not persisted)
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// Column aliases for auto-detection
const COLUMN_ALIASES = {
  first_name:       ['first name','firstname','first','given name','fname'],
  last_name:        ['last name','lastname','last','surname','family name','lname'],
  email:            ['email','email address','e-mail','psu email'],
  student_id:       ['student id','studentid','id','student number','penn state id','psu id'],
  pledge_class:     ['pledge class','pledgeclass','class','pledge','cohort','pledge year'],
  graduation_year:  ['graduation year','grad year','graduation','year','class year','exp. graduation'],
  major:            ['major','program','degree','field of study'],
  gpa:              ['gpa','grade point average','cumulative gpa','cum gpa','academic gpa'],
  status:           ['status','member status','active status'],
  role:             ['role','position','officer role','title','chapter role'],
};

function detectColumnMap(headers) {
  const map = {};
  headers.forEach((h, idx) => {
    const norm = String(h).toLowerCase().trim();
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
      if (!map[field] && aliases.includes(norm)) {
        map[field] = idx;
      }
    }
  });
  return map;
}

function mapRow(row, colMap) {
  const member = {};
  for (const [field, idx] of Object.entries(colMap)) {
    let val = row[idx];
    if (val === undefined || val === null || val === '') continue;
    val = String(val).trim();
    if (field === 'graduation_year') {
      const n = parseInt(val, 10);
      member[field] = isNaN(n) ? null : n;
    } else if (field === 'gpa') {
      const n = parseFloat(val);
      member[field] = isNaN(n) ? null : Math.min(4.0, Math.max(0, n));
    } else {
      member[field] = val;
    }
  }
  return member;
}

// GET /api/roster?org_id=&status=&role=
router.get('/', async (req, res) => {
  const { org_id, status, role } = req.query;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });
  let sql = 'SELECT * FROM members WHERE org_id = $1';
  const params = [org_id];
  if (status) { sql += ` AND status = $${params.length + 1}`; params.push(status); }
  if (role)   { sql += ` AND role = $${params.length + 1}`;   params.push(role); }
  sql += ' ORDER BY last_name, first_name';
  try {
    res.json(await all(sql, params));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/roster/history/:org_id
router.get('/history/:org_id', async (req, res) => {
  try {
    const snapshots = await all(
      `SELECT id, org_id, semester, year, member_count, active_count, avg_gpa, created_at
       FROM roster_snapshots WHERE org_id = $1 ORDER BY year DESC, semester`,
      [req.params.org_id]
    );
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/roster/export?org_id= — CSV export (must come before /:id)
router.get('/export', async (req, res) => {
  const { org_id } = req.query;
  if (!org_id) return res.status(400).json({ error: 'org_id required' });
  try {
    const org = await get('SELECT name, chapter_letters FROM organizations WHERE id=$1', [org_id]);
    const members = await all(
      `SELECT * FROM members WHERE org_id=$1 ORDER BY last_name, first_name`, [org_id]
    );
    const headers = ['First Name','Last Name','Email','Student ID','Pledge Class',
                     'Graduation Year','Major','GPA','Status','Role','Joined Date'];
    const rows = [headers.join(','), ...members.map(m => [
      `"${m.first_name}"`, `"${m.last_name}"`,
      m.email      ? `"${m.email}"`      : '',
      m.student_id ? `"${m.student_id}"` : '',
      m.pledge_class ? `"${m.pledge_class}"` : '',
      m.graduation_year || '',
      m.major ? `"${m.major}"` : '',
      m.gpa != null ? m.gpa : '',
      m.status, m.role,
      m.joined_date ? String(m.joined_date).split('T')[0] : '',
    ].join(','))];

    const filename = `${(org?.chapter_letters || 'chapter').replace(/\s+/g,'_')}_roster.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(rows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/roster/:id
router.get('/:id', async (req, res) => {
  try {
    const member = await get('SELECT * FROM members WHERE id = $1', [req.params.id]);
    if (!member) return res.status(404).json({ error: 'Not found' });
    res.json(member);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/roster/upload — parse file, return preview (no DB write)
router.post('/upload', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (raw.length < 2) return res.status(400).json({ error: 'File has no data rows' });

    const headers = raw[0].map(h => String(h));
    const colMap = detectColumnMap(headers);
    const rows = raw.slice(1)
      .filter(r => r.some(c => c !== '' && c !== null && c !== undefined))
      .map(r => mapRow(r, colMap));

    res.json({ headers, columnMap: colMap, preview: rows.slice(0, 10), total: rows.length, rows });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse file: ' + err.message });
  }
});

// POST /api/roster/import — bulk insert confirmed roster
router.post('/import', async (req, res) => {
  const { org_id, members, semester, year, replace_existing } = req.body;
  if (!org_id || !Array.isArray(members) || members.length === 0)
    return res.status(400).json({ error: 'org_id and members array required' });

  try {
    // Optionally deactivate existing active members before import
    if (replace_existing) {
      await run(
        `UPDATE members SET status = 'inactive' WHERE org_id = $1 AND status = 'active'`,
        [org_id]
      );
    }

    let imported = 0;
    for (const m of members) {
      if (!m.first_name || !m.last_name) continue;
      await run(`
        INSERT INTO members
          (org_id, first_name, last_name, email, student_id, pledge_class,
           graduation_year, major, gpa, status, role, joined_date, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      `, [
        org_id,
        m.first_name, m.last_name,
        m.email || null, m.student_id || null, m.pledge_class || null,
        m.graduation_year || null, m.major || null,
        m.gpa != null ? m.gpa : null,
        m.status || 'active',
        m.role || 'member',
        m.joined_date || null,
      ]);
      imported++;
    }

    // Recalculate chapter GPA and roster size
    const stats = await get(`
      SELECT COUNT(*) FILTER (WHERE status='active')::int AS active_count,
             COUNT(*)::int AS total_count,
             ROUND(AVG(gpa) FILTER (WHERE status='active' AND gpa IS NOT NULL), 2) AS avg_gpa
      FROM members WHERE org_id = $1
    `, [org_id]);

    await run(
      `UPDATE organizations SET roster_size = $1, gpa = COALESCE($2, gpa) WHERE id = $3`,
      [stats.active_count, stats.avg_gpa, org_id]
    );

    // Save roster snapshot if semester/year provided
    if (semester && year) {
      const allMembers = await all('SELECT * FROM members WHERE org_id = $1', [org_id]);
      await run(`
        INSERT INTO roster_snapshots
          (org_id, semester, year, member_count, active_count, avg_gpa, snapshot_data)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (org_id, semester, year) DO UPDATE
          SET member_count   = EXCLUDED.member_count,
              active_count   = EXCLUDED.active_count,
              avg_gpa        = EXCLUDED.avg_gpa,
              snapshot_data  = EXCLUDED.snapshot_data,
              created_at     = NOW()
      `, [
        org_id, semester, year,
        stats.total_count, stats.active_count, stats.avg_gpa,
        JSON.stringify(allMembers),
      ]);
    }

    // Check GPA threshold
    if (stats.avg_gpa !== null) {
      const threshold = await get(`
        SELECT COALESCE(
          (SELECT threshold FROM gpa_thresholds WHERE org_id = $1),
          (SELECT t.threshold FROM gpa_thresholds t JOIN organizations o ON t.council = o.council WHERE o.id = $1 LIMIT 1),
          (SELECT threshold FROM gpa_thresholds WHERE org_id IS NULL AND council IS NULL LIMIT 1),
          2.5
        ) AS threshold
      `, [org_id]);
      if (stats.avg_gpa < threshold.threshold) {
        const org = await get('SELECT name FROM organizations WHERE id = $1', [org_id]);
        await notifyAdminsAndOfficers(
          `⚠ GPA Alert: ${org.name} chapter GPA (${stats.avg_gpa}) is below the ${threshold.threshold} minimum threshold.`,
          'warning',
          `/chapter.html?id=${org_id}`
        );
      }
    }

    res.json({ imported, active_count: stats.active_count, avg_gpa: stats.avg_gpa });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/roster — add single member
router.post('/', async (req, res) => {
  const { org_id, first_name, last_name, email, student_id, pledge_class,
          graduation_year, major, gpa, status, role, joined_date } = req.body;
  if (!org_id || !first_name || !last_name)
    return res.status(400).json({ error: 'org_id, first_name, last_name required' });
  try {
    const result = await run(`
      INSERT INTO members
        (org_id, first_name, last_name, email, student_id, pledge_class,
         graduation_year, major, gpa, status, role, joined_date, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW()) RETURNING id
    `, [org_id, first_name, last_name, email||null, student_id||null, pledge_class||null,
        graduation_year||null, major||null, gpa||null, status||'active', role||'member', joined_date||null]);

    // Update org GPA and roster_size
    const stats = await get(`
      SELECT COUNT(*) FILTER (WHERE status='active')::int AS active_count,
             ROUND(AVG(gpa) FILTER (WHERE status='active' AND gpa IS NOT NULL), 2) AS avg_gpa
      FROM members WHERE org_id = $1
    `, [org_id]);
    await run(
      'UPDATE organizations SET roster_size=$1, gpa=COALESCE($2, gpa) WHERE id=$3',
      [stats.active_count, stats.avg_gpa, org_id]
    );

    res.status(201).json(await get('SELECT * FROM members WHERE id = $1', [result.lastID]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/roster/:id
router.put('/:id', async (req, res) => {
  const { first_name, last_name, email, student_id, pledge_class,
          graduation_year, major, gpa, status, role, joined_date } = req.body;
  try {
    const result = await run(`
      UPDATE members
      SET first_name=$1, last_name=$2, email=$3, student_id=$4, pledge_class=$5,
          graduation_year=$6, major=$7, gpa=$8, status=$9, role=$10, joined_date=$11, updated_at=NOW()
      WHERE id=$12 RETURNING org_id
    `, [first_name, last_name, email||null, student_id||null, pledge_class||null,
        graduation_year||null, major||null, gpa||null, status||'active', role||'member',
        joined_date||null, req.params.id]);
    if (result.changes === 0) return res.status(404).json({ error: 'Not found' });

    const org_id = result.rows[0]?.org_id;
    if (org_id) {
      const stats = await get(`
        SELECT COUNT(*) FILTER (WHERE status='active')::int AS active_count,
               ROUND(AVG(gpa) FILTER (WHERE status='active' AND gpa IS NOT NULL), 2) AS avg_gpa
        FROM members WHERE org_id = $1
      `, [org_id]);
      await run(
        'UPDATE organizations SET roster_size=$1, gpa=COALESCE($2, gpa) WHERE id=$3',
        [stats.active_count, stats.avg_gpa, org_id]
      );
    }

    res.json(await get('SELECT * FROM members WHERE id = $1', [req.params.id]));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/roster/:id
router.delete('/:id', async (req, res) => {
  try {
    const member = await get('SELECT org_id FROM members WHERE id = $1', [req.params.id]);
    if (!member) return res.status(404).json({ error: 'Not found' });
    await run('DELETE FROM members WHERE id = $1', [req.params.id]);
    const stats = await get(`
      SELECT COUNT(*) FILTER (WHERE status='active')::int AS active_count,
             ROUND(AVG(gpa) FILTER (WHERE status='active' AND gpa IS NOT NULL), 2) AS avg_gpa
      FROM members WHERE org_id = $1
    `, [member.org_id]);
    await run(
      'UPDATE organizations SET roster_size=$1, gpa=COALESCE($2, gpa) WHERE id=$3',
      [stats.active_count, stats.avg_gpa, member.org_id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
