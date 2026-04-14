const express = require('express');
const { run, get, all } = require('../database/db');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(authenticate);

// GET /api/analytics/summary
router.get('/summary', async (req, res) => {
  try {
    const chapters = await get(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN status='active'    THEN 1 ELSE 0 END)::int AS active,
        SUM(CASE WHEN status='probation' THEN 1 ELSE 0 END)::int AS probation,
        SUM(CASE WHEN status='suspended' THEN 1 ELSE 0 END)::int AS suspended
      FROM organizations
    `);
    const { rate: compliance_rate } = await get(`
      SELECT ROUND(100.0 * SUM(CASE WHEN status='compliant' THEN 1 ELSE 0 END) / NULLIF(COUNT(*),0), 1) AS rate
      FROM compliance_status
    `);
    const { count: pending_reviews } = await get(`
      SELECT COUNT(*)::int AS count FROM compliance_status WHERE status='pending'
    `);
    const { count: open_incidents } = await get(`
      SELECT COUNT(*)::int AS count FROM incidents WHERE status IN ('open','investigating')
    `);
    const { count: pending_documents } = await get(`
      SELECT COUNT(*)::int AS count FROM documents WHERE status='pending_review'
    `);
    const { count: pending_events } = await get(`
      SELECT COUNT(*)::int AS count FROM events WHERE approval_status='pending'
    `);
    const { avg: overall_gpa } = await get(`
      SELECT ROUND(AVG(gpa)::numeric, 2) AS avg FROM organizations WHERE gpa > 0
    `);
    res.json({
      ...chapters, compliance_rate, pending_reviews, open_incidents,
      pending_documents, pending_events, overall_gpa,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/compliance-by-council
router.get('/compliance-by-council', async (req, res) => {
  try {
    const rows = await all(`
      SELECT o.council,
        COUNT(cs.id)::int AS total,
        SUM(CASE WHEN cs.status='compliant' THEN 1 ELSE 0 END)::int AS compliant,
        ROUND(100.0 * SUM(CASE WHEN cs.status='compliant' THEN 1 ELSE 0 END) / NULLIF(COUNT(cs.id),0), 1) AS rate
      FROM compliance_status cs
      JOIN organizations o ON cs.org_id = o.id
      GROUP BY o.council
      ORDER BY o.council
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/gpa-trends?org_id=
router.get('/gpa-trends', async (req, res) => {
  const { org_id } = req.query;
  try {
    let sql = `
      SELECT rs.org_id, o.name AS org_name, o.chapter_letters,
             rs.semester, rs.year, rs.avg_gpa, rs.active_count
      FROM roster_snapshots rs
      JOIN organizations o ON rs.org_id = o.id
      WHERE rs.avg_gpa IS NOT NULL
    `;
    const params = [];
    if (org_id) { sql += ` AND rs.org_id = $1`; params.push(org_id); }
    sql += ' ORDER BY rs.year, rs.semester';
    const snapshots = await all(sql, params);

    // Also include current GPA from organizations table
    const current = await all(`
      SELECT id AS org_id, name AS org_name, chapter_letters, gpa AS avg_gpa, 'Current' AS semester, 0 AS year
      FROM organizations WHERE gpa > 0 ${org_id ? 'AND id = $1' : ''}
    `, org_id ? [org_id] : []);

    res.json({ snapshots, current });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/incident-frequency
router.get('/incident-frequency', async (req, res) => {
  try {
    const monthly = await all(`
      SELECT
        TO_CHAR(reported_date, 'YYYY-MM') AS month,
        COUNT(*)::int AS total,
        SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END)::int AS critical,
        SUM(CASE WHEN type='hazing' THEN 1 ELSE 0 END)::int AS hazing,
        SUM(CASE WHEN type='alcohol' THEN 1 ELSE 0 END)::int AS alcohol
      FROM incidents
      WHERE reported_date >= NOW() - INTERVAL '12 months'
      GROUP BY TO_CHAR(reported_date, 'YYYY-MM')
      ORDER BY month
    `);
    const by_type = await all(`
      SELECT type, COUNT(*)::int AS count
      FROM incidents GROUP BY type ORDER BY count DESC
    `);
    const by_severity = await all(`
      SELECT severity, COUNT(*)::int AS count
      FROM incidents GROUP BY severity ORDER BY count DESC
    `);
    res.json({ monthly, by_type, by_severity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/gpa-thresholds
router.get('/gpa-thresholds', async (req, res) => {
  try {
    const thresholds = await all(`SELECT * FROM gpa_thresholds ORDER BY org_id NULLS LAST, council NULLS LAST`);
    const orgs = await all('SELECT id, name, chapter_letters, gpa, council FROM organizations ORDER BY council, name');
    const gpaThreshold = await get(`SELECT threshold FROM gpa_thresholds WHERE org_id IS NULL AND council IS NULL LIMIT 1`);
    res.json({ thresholds, orgs, global_threshold: gpaThreshold?.threshold || 2.5 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/analytics/gpa-thresholds/global — admin only
router.put('/gpa-thresholds/global', requireRole('admin'), async (req, res) => {
  const { threshold } = req.body;
  if (threshold == null || isNaN(threshold)) return res.status(400).json({ error: 'threshold required' });
  try {
    const existing = await get(
      'SELECT id FROM gpa_thresholds WHERE org_id IS NULL AND council IS NULL LIMIT 1'
    );
    if (existing) {
      await run('UPDATE gpa_thresholds SET threshold=$1, updated_at=NOW() WHERE id=$2',
        [threshold, existing.id]);
    } else {
      await run('INSERT INTO gpa_thresholds (threshold) VALUES ($1)', [threshold]);
    }
    res.json({ success: true, threshold });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/risk-scores
router.get('/risk-scores', async (req, res) => {
  try {
    const tRow = await get(
      `SELECT COALESCE(threshold, 2.5) AS threshold FROM gpa_thresholds
       WHERE org_id IS NULL AND council IS NULL LIMIT 1`
    );
    const gpaThreshold = parseFloat(tRow?.threshold || 2.5);

    const orgs = await all(
      `SELECT id, name, chapter_letters, council, status, gpa FROM organizations ORDER BY council, name`
    );

    const scores = await Promise.all(orgs.map(async org => {
      const inc = await get(`
        SELECT
          COALESCE(SUM(CASE WHEN severity='critical' THEN 1 ELSE 0 END), 0)::int AS critical,
          COALESCE(SUM(CASE WHEN severity='high'     THEN 1 ELSE 0 END), 0)::int AS high,
          COALESCE(SUM(CASE WHEN severity='medium'   THEN 1 ELSE 0 END), 0)::int AS medium,
          COUNT(*)::int AS total
        FROM incidents
        WHERE org_id=$1 AND status IN ('open','investigating')
      `, [org.id]);

      const comp = await get(`
        SELECT
          COALESCE(SUM(CASE WHEN status='overdue'  THEN 1 ELSE 0 END), 0)::int AS overdue,
          COALESCE(SUM(CASE WHEN status='pending'  THEN 1 ELSE 0 END), 0)::int AS pending
        FROM compliance_status WHERE org_id=$1
      `, [org.id]);

      let score = 0;
      score += (inc?.critical || 0) * 30;
      score += (inc?.high     || 0) * 15;
      score += (inc?.medium   || 0) * 5;
      score += (comp?.overdue || 0) * 10;
      score += (comp?.pending || 0) * 3;
      if (org.gpa && parseFloat(org.gpa) < gpaThreshold) score += 20;
      if (org.status === 'probation') score += 15;
      if (org.status === 'suspended') score += 30;
      score = Math.min(100, score);

      const risk_level = score >= 80 ? 'critical' : score >= 50 ? 'high' : score >= 25 ? 'medium' : 'low';

      return {
        ...org,
        risk_score: score,
        risk_level,
        open_incidents: inc?.total || 0,
        open_critical:  inc?.critical || 0,
        overdue_requirements: comp?.overdue || 0,
        pending_requirements: comp?.pending || 0,
      };
    }));

    scores.sort((a, b) => b.risk_score - a.risk_score);
    res.json(scores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/export/chapters — CSV export
router.get('/export/chapters', async (req, res) => {
  try {
    const orgs = await all(`
      SELECT o.name, o.chapter_letters, o.council, o.status, o.roster_size, o.gpa,
             o.national_affiliation, o.advisor_name, o.advisor_email,
             ROUND(100.0 * SUM(CASE WHEN cs.status='compliant' THEN 1 ELSE 0 END) /
               NULLIF(COUNT(cs.id),0), 1) AS compliance_pct
      FROM organizations o
      LEFT JOIN compliance_status cs ON cs.org_id = o.id
      GROUP BY o.id ORDER BY o.council, o.name
    `);
    const headers = ['Chapter Name','Letters','Council','Status','Roster Size','GPA','Compliance %','National Affiliation','Advisor','Advisor Email'];
    const csvRows = [headers.join(',')];
    for (const o of orgs) {
      csvRows.push([
        `"${o.name}"`, o.chapter_letters, o.council, o.status,
        o.roster_size, o.gpa, o.compliance_pct || 0,
        `"${o.national_affiliation || ''}"`,
        `"${o.advisor_name || ''}"`, `"${o.advisor_email || ''}"`,
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="chapters.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/analytics/export/incidents — CSV export
router.get('/export/incidents', async (req, res) => {
  try {
    const incidents = await all(`
      SELECT i.id, o.name AS chapter, o.council, i.type, i.severity, i.status,
             TO_CHAR(i.reported_date,'YYYY-MM-DD') AS reported_date,
             TO_CHAR(i.resolved_date,'YYYY-MM-DD') AS resolved_date,
             i.description, i.resolution
      FROM incidents i
      JOIN organizations o ON i.org_id = o.id
      ORDER BY i.reported_date DESC
    `);
    const headers = ['ID','Chapter','Council','Type','Severity','Status','Reported','Resolved','Description','Resolution'];
    const csvRows = [headers.join(',')];
    for (const i of incidents) {
      csvRows.push([
        i.id, `"${i.chapter}"`, i.council, i.type, i.severity, i.status,
        i.reported_date || '', i.resolved_date || '',
        `"${(i.description||'').replace(/"/g,'""')}"`,
        `"${(i.resolution||'').replace(/"/g,'""')}"`,
      ].join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="incidents.csv"');
    res.send(csvRows.join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
