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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

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
      approval_status TEXT NOT NULL DEFAULT 'pending' CHECK(approval_status IN ('pending','approved','denied')),
      reviewed_by INTEGER REFERENCES users(id),
      notes TEXT
    )
  `);

  console.log('Database initialized.');
}

module.exports = { pool, initializeDatabase, run, get, all };
