require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Helpers that mirror the old sqlite3 interface
async function run(sql, params = []) {
  const result = await pool.query(sql, params);
  return {
    lastID: result.rows[0]?.id ?? null,
    changes: result.rowCount,
    rows: result.rows,
  };
}

async function get(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows[0];
}

async function all(sql, params = []) {
  const result = await pool.query(sql, params);
  return result.rows;
}

async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin','council_officer','chapter_officer')),
      name TEXT NOT NULL,
      org_id INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add org_id column if it doesn't exist (migration for existing DBs)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS org_id INTEGER`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS organizations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      chapter_letters TEXT NOT NULL,
      national_affiliation TEXT,
      council TEXT NOT NULL CHECK(council IN ('IFC','MGC','NPHC','PHC')),
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','probation','suspended','revoked')),
      founded_date DATE,
      advisor_name TEXT,
      advisor_email TEXT,
      roster_size INTEGER DEFAULT 0,
      gpa NUMERIC(4,2) DEFAULT 0.0
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_requirements (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL CHECK(category IN ('training','documentation','academic','insurance')),
      deadline DATE,
      recurring INTEGER DEFAULT 0,
      frequency TEXT CHECK(frequency IN ('semester','annual') OR frequency IS NULL)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS compliance_status (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requirement_id INTEGER NOT NULL REFERENCES compliance_requirements(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('compliant','pending','overdue','waived')),
      submitted_date TIMESTAMP,
      reviewed_by INTEGER REFERENCES users(id),
      notes TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incidents (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK(type IN ('hazing','alcohol','sexual_misconduct','other')),
      description TEXT NOT NULL,
      reported_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','investigating','resolved','closed')),
      severity TEXT NOT NULL DEFAULT 'low' CHECK(severity IN ('low','medium','high','critical')),
      resolution TEXT,
      resolved_date TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      date TIMESTAMP NOT NULL,
      venue TEXT,
      expected_attendance INTEGER,
      alcohol_present INTEGER DEFAULT 0,
      security_plan TEXT,
      risk_assessment TEXT,
      approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','denied')),
      reviewed_by INTEGER REFERENCES users(id),
      notes TEXT
    )
  `);

  // Add risk_assessment column if it doesn't exist
  await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS risk_assessment TEXT`);

  // ── New tables ───────────────────────────────────────────────────────────────

  await pool.query(`
    CREATE TABLE IF NOT EXISTS members (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT,
      student_id TEXT,
      pledge_class TEXT,
      graduation_year INTEGER,
      major TEXT,
      gpa NUMERIC(4,2),
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','inactive','alumni','suspended')),
      role TEXT NOT NULL DEFAULT 'member'
        CHECK(role IN ('member','officer','president','treasurer','vp','secretary','other')),
      joined_date DATE,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roster_snapshots (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      semester TEXT NOT NULL CHECK(semester IN ('Fall','Spring','Summer')),
      year INTEGER NOT NULL,
      member_count INTEGER,
      active_count INTEGER,
      avg_gpa NUMERIC(4,2),
      snapshot_data JSONB,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS documents (
      id SERIAL PRIMARY KEY,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      requirement_id INTEGER REFERENCES compliance_requirements(id) ON DELETE SET NULL,
      file_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      file_type TEXT,
      file_size INTEGER,
      description TEXT,
      uploaded_by INTEGER NOT NULL REFERENCES users(id),
      uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'pending_review'
        CHECK(status IN ('pending_review','approved','rejected')),
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TIMESTAMP,
      review_notes TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS incident_timeline (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      entry_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      author_id INTEGER NOT NULL REFERENCES users(id),
      action_taken TEXT NOT NULL,
      notes TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sanctions (
      id SERIAL PRIMARY KEY,
      incident_id INTEGER NOT NULL REFERENCES incidents(id) ON DELETE CASCADE,
      org_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      sanction_type TEXT NOT NULL
        CHECK(sanction_type IN ('warning','probation','suspension','revocation')),
      start_date DATE NOT NULL,
      end_date DATE,
      conditions TEXT,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK(status IN ('active','completed','lifted')),
      created_by INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS event_reports (
      id SERIAL PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE UNIQUE,
      actual_attendance INTEGER,
      incident_notes TEXT,
      submitted_by INTEGER REFERENCES users(id),
      submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'info'
        CHECK(type IN ('info','warning','danger','success')),
      read BOOLEAN NOT NULL DEFAULT FALSE,
      link TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS gpa_thresholds (
      id SERIAL PRIMARY KEY,
      org_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
      council TEXT CHECK(council IN ('IFC','MGC','NPHC','PHC') OR council IS NULL),
      threshold NUMERIC(4,2) NOT NULL DEFAULT 2.5,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(org_id),
      UNIQUE(council)
    )
  `);

  // Unique index on roster_snapshots so ON CONFLICT upserts work
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_roster_snapshots_unique
    ON roster_snapshots(org_id, semester, year)
  `);

  // Insert global default threshold if none exists (avoids ON CONFLICT issues with NULL cols)
  const existing = await pool.query(
    'SELECT id FROM gpa_thresholds WHERE org_id IS NULL AND council IS NULL LIMIT 1'
  );
  if (existing.rows.length === 0) {
    await pool.query('INSERT INTO gpa_thresholds (threshold) VALUES (2.5)');
  }

  console.log('Database initialized.');
}

module.exports = { pool, initializeDatabase, run, get, all };
