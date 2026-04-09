require('dotenv').config();
const bcrypt = require('bcryptjs');
const { pool, initializeDatabase, run } = require('./db');

async function seed() {
  await initializeDatabase();

  // Wipe all data and reset sequences
  await pool.query(
    'TRUNCATE TABLE events, incidents, compliance_status, compliance_requirements, organizations, users RESTART IDENTITY CASCADE'
  );
  console.log('Tables cleared.');

  // ─── Users ───────────────────────────────────────────────────────────────
  const hash = (p) => bcrypt.hashSync(p, 10);

  await run('INSERT INTO users (email, password, role, name) VALUES ($1,$2,$3,$4)', ['admin@chapterwatch.edu',    hash('admin123'),   'admin',           'Dr. Sarah Mitchell']);
  await run('INSERT INTO users (email, password, role, name) VALUES ($1,$2,$3,$4)', ['ifc.officer@psu.edu',      hash('officer123'), 'council_officer', 'James Thornton']);
  await run('INSERT INTO users (email, password, role, name) VALUES ($1,$2,$3,$4)', ['phc.officer@psu.edu',      hash('officer123'), 'council_officer', 'Emma Caldwell']);
  await run('INSERT INTO users (email, password, role, name) VALUES ($1,$2,$3,$4)', ['sigchi.officer@psu.edu',   hash('chapter123'), 'chapter_officer', 'Tyler Brooks']);
  console.log('Seeded users.');

  // ─── Organizations ────────────────────────────────────────────────────────
  const orgs = [
    // IFC (6)
    ['Sigma Chi',          'ΣΧ',  'Sigma Chi International Fraternity',       'IFC', 'active',    '1993-09-15', 'Dr. Robert Hayes',      'r.hayes@psu.edu',      68, 3.24],
    ['Beta Theta Pi',      'ΒΘΠ', 'Beta Theta Pi Fraternity',                 'IFC', 'active',    '1888-03-22', 'Prof. Linda Evans',     'l.evans@psu.edu',      54, 3.41],
    ['Kappa Sigma',        'ΚΣ',  'Kappa Sigma Fraternity',                   'IFC', 'probation', '1971-10-05', 'Dr. Mark Sullivan',     'm.sullivan@psu.edu',   47, 2.89],
    ['Lambda Chi Alpha',   'ΛΧΑ', 'Lambda Chi Alpha Fraternity',              'IFC', 'active',    '1914-04-18', 'Prof. Janet Kim',       'j.kim@psu.edu',        61, 3.15],
    ['Alpha Epsilon Pi',   'ΑΕΠ', 'Alpha Epsilon Pi Fraternity',              'IFC', 'suspended', '1956-11-30', 'Dr. Aaron Weiss',       'a.weiss@psu.edu',      38, 2.72],
    ['Delta Chi',          'ΔΧ',  'Delta Chi Fraternity',                     'IFC', 'active',    '2001-02-14', 'Prof. Carlos Rivera',   'c.rivera@psu.edu',     42, 3.08],
    // PHC (4)
    ['Alpha Chi Omega',    'ΑΧΩ', 'Alpha Chi Omega Sorority',                 'PHC', 'active',    '1969-05-10', 'Prof. Diana Clark',     'd.clark@psu.edu',      92, 3.58],
    ['Chi Omega',          'ΧΩ',  'Chi Omega Sorority',                       'PHC', 'active',    '1952-03-08', 'Dr. Patricia Moore',    'p.moore@psu.edu',      87, 3.62],
    ['Delta Gamma',        'ΔΓ',  'Delta Gamma Fraternity',                   'PHC', 'probation', '1980-01-20', 'Prof. Susan Bennett',   's.bennett@psu.edu',    74, 3.29],
    ['Kappa Alpha Theta',  'ΚΑΘ', 'Kappa Alpha Theta Sorority',               'PHC', 'active',    '1963-09-27', 'Dr. Megan Torres',      'm.torres@psu.edu',     81, 3.71],
    // MGC (2)
    ['Lambda Theta Alpha', 'ΛΘΑ', 'Lambda Theta Alpha Latin Sorority',        'MGC', 'active',    '2005-04-01', 'Prof. Maria Gutierrez', 'm.gutierrez@psu.edu',  28, 3.44],
    ['Phi Iota Alpha',     'ΦΙΑ', 'Phi Iota Alpha Fraternity',                'MGC', 'active',    '2008-10-12', 'Dr. Jorge Ramirez',     'j.ramirez@psu.edu',    22, 3.31],
    // NPHC (2)
    ['Alpha Phi Alpha',    'ΑΦΑ', 'Alpha Phi Alpha Fraternity',               'NPHC','active',    '1978-02-14', 'Dr. James Washington',  'j.washington@psu.edu', 19, 3.52],
    ['Kappa Alpha Psi',    'ΚΑΨ', 'Kappa Alpha Psi Fraternity',               'NPHC','active',    '1982-11-05', 'Prof. David Freeman',   'd.freeman@psu.edu',    16, 3.38],
  ];

  for (const o of orgs) {
    await run(
      `INSERT INTO organizations (name,chapter_letters,national_affiliation,council,status,founded_date,advisor_name,advisor_email,roster_size,gpa)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      o
    );
  }
  console.log('Seeded organizations.');

  // ─── Compliance Requirements ──────────────────────────────────────────────
  const reqs = [
    ['Hazing Prevention Training',    'All members must complete annual hazing prevention training via HazingPrevention.org', 'training',      '2026-02-01', 1, 'annual'],
    ['Alcohol Edu: Chapter Officers', 'Chapter officers must complete AlcoholEdu for Organizations certification',             'training',      '2026-01-15', 1, 'annual'],
    ['Mental Health First Aid',       'At least 25% of members must be certified Mental Health First Aid responders',          'training',      '2026-03-01', 1, 'annual'],
    ['Chapter Roster Submission',     'Submit updated chapter roster with member names, class years, and contact info',        'documentation', '2026-01-31', 1, 'semester'],
    ['Risk Management Policy Sign',   'All members must sign and return the updated Risk Management Policy acknowledgment',    'documentation', '2026-02-15', 1, 'semester'],
    ['Insurance Certificate',         'Submit proof of current chapter liability insurance from national organization',        'insurance',     '2026-01-01', 1, 'annual'],
    ['Advisor Verification Form',     'Faculty/staff advisor must complete and return the chapter advisor verification form',  'documentation', '2026-02-01', 1, 'semester'],
    ['GPA Compliance Report',         'Chapter must maintain a minimum 2.75 cumulative GPA; submit official GPA report',      'academic',      '2026-02-28', 1, 'semester'],
    ['New Member Education Plan',     'Submit new member education program plan for review prior to beginning intake',         'documentation', '2026-03-15', 1, 'semester'],
    ['Event Registration (Fall)',     'Submit all social events scheduled for Fall semester by required deadline',             'documentation', '2025-09-05', 0, 'semester'],
  ];

  for (const r of reqs) {
    await run(
      `INSERT INTO compliance_requirements (name,description,category,deadline,recurring,frequency)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      r
    );
  }
  console.log('Seeded compliance requirements.');

  // ─── Compliance Status ────────────────────────────────────────────────────
  const profiles = [
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','pending','compliant'],   // 1  Sigma Chi
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant'], // 2  Beta Theta Pi
    ['overdue','overdue','pending','compliant','overdue','compliant','pending','overdue','overdue','compliant'],               // 3  Kappa Sigma
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','pending','compliant','compliant'],   // 4  Lambda Chi Alpha
    ['overdue','overdue','overdue','overdue','overdue','overdue','pending','overdue','overdue','overdue'],                     // 5  Alpha Epsilon Pi
    ['compliant','compliant','pending','compliant','compliant','compliant','compliant','compliant','pending','compliant'],     // 6  Delta Chi
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant'], // 7  Alpha Chi Omega
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant'], // 8  Chi Omega
    ['overdue','pending','compliant','compliant','overdue','compliant','compliant','overdue','pending','compliant'],           // 9  Delta Gamma
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant'], // 10 Kappa Alpha Theta
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','pending','compliant'],   // 11 Lambda Theta Alpha
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','pending'],   // 12 Phi Iota Alpha
    ['compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant','compliant'], // 13 Alpha Phi Alpha
    ['compliant','compliant','compliant','compliant','compliant','pending','compliant','compliant','compliant','compliant'],   // 14 Kappa Alpha Psi
  ];

  function randDate(daysBack = 60) {
    const d = new Date();
    d.setDate(d.getDate() - Math.floor(Math.random() * daysBack));
    return d.toISOString();
  }

  for (let orgIdx = 0; orgIdx < 14; orgIdx++) {
    for (let reqIdx = 0; reqIdx < 10; reqIdx++) {
      const status = profiles[orgIdx][reqIdx];
      const submitted = status === 'compliant' ? randDate() : null;
      const reviewer  = status === 'compliant' ? 1 : null;
      await run(
        'INSERT INTO compliance_status (org_id,requirement_id,status,submitted_date,reviewed_by) VALUES ($1,$2,$3,$4,$5)',
        [orgIdx + 1, reqIdx + 1, status, submitted, reviewer]
      );
    }
  }
  console.log('Seeded compliance status.');

  // ─── Incidents ────────────────────────────────────────────────────────────
  const incidents = [
    [5, 'hazing',            'New member pledge process included forced physical exercise and sleep deprivation during Hell Week. Three pledges sought medical attention.',
     '2025-10-14', 'investigating', 'critical', null, null],
    [3, 'alcohol',           'Unregistered social event held off-campus with alcohol provided to underage members. Reported by a neighbor; local police were called.',
     '2025-11-02', 'investigating', 'high', null, null],
    [9, 'alcohol',           'Chapter formal exceeded venue capacity; several underage attendees reportedly consuming alcohol. Venue filed a complaint.',
     '2025-12-08', 'resolved', 'medium',
     'Chapter placed on social probation for Spring semester. Officers required to repeat AlcoholEdu.', '2026-01-10'],
    [3, 'other',             'Destruction of property at chapter house during end-of-semester celebration. Estimated $4,200 in damages.',
     '2025-12-18', 'resolved', 'medium',
     'Chapter fined $4,200. Members responsible placed on chapter probation.', '2026-01-22'],
    [5, 'sexual_misconduct', 'Formal complaint filed by a guest alleging inappropriate behavior by a member during chapter-sponsored event. Title IX referral made.',
     '2026-01-05', 'investigating', 'critical', null, null],
    [1, 'alcohol',           'Member found in possession of alcohol in university housing adjacent to chapter facility during dry period.',
     '2026-01-28', 'resolved', 'low',
     'Member received educational sanction and community service requirement.', '2026-02-15'],
    [6, 'other',             'Social media posts from chapter members contained offensive language and imagery violating university community standards.',
     '2026-02-10', 'open', 'medium', null, null],
    [4, 'other',             'Chapter treasurer reported potential financial mismanagement; discrepancy of approximately $2,100 discovered in chapter accounts.',
     '2026-03-01', 'open', 'medium', null, null],
  ];

  for (const i of incidents) {
    await run(
      `INSERT INTO incidents (org_id,type,description,reported_date,status,severity,resolution,resolved_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      i
    );
  }
  console.log('Seeded incidents.');

  // ─── Events ───────────────────────────────────────────────────────────────
  const events = [
    [1,  'Derby Days Philanthropy Week',  '2026-04-14', 'Rec Hall, Penn State',               200, 0, 'Event staff present. Bag check at entry. No alcohol served.',                  'approved', 1, 'Annual philanthropy event benefiting Huntsman Cancer Institute.'],
    [2,  'Spring Formal',                 '2026-04-19', 'The Penn Stater Conference Center',  120, 1, 'Licensed bartenders only. Wristband system for 21+. Two security personnel.',  'approved', 1, 'Catered dinner event. Vendor permits on file.'],
    [3,  'Alumni Golf Tournament',        '2026-04-25', 'Nittany Lion Golf Course',            80, 1, 'Event limited to alumni 21+. Wristbands. One security officer.',               'pending',  null, null],
    [4,  'Recruitment BBQ',               '2026-04-12', 'Chapter House, 123 Fraternity Row', 150, 0, 'Sober monitors designated. No alcohol on premises during recruitment.',         'approved', 2,    'Dry recruitment event.'],
    [5,  'Spring Concert Fundraiser',     '2026-04-18', 'Hub Robeson Center',                 250, 0, 'Event security provided by Hub. No outside food or beverage.',                 'denied',   1,    'Chapter currently suspended.'],
    [6,  'Chapter Anniversary Banquet',   '2026-04-22', 'Nittany Lion Inn',                    90, 1, 'Hotel security on site. 21+ verified at bar.',                                 'approved', 1,    null],
    [7,  'Sisterhood Retreat',            '2026-04-05', 'Stone Valley Recreation Area',        45, 0, 'Two chapter officers serve as designated drivers.',                             'approved', 3,    null],
    [8,  'Anchor Splash Philanthropy',    '2026-04-26', 'McCoy Natatorium',                   180, 0, 'Pool safety staff provided by facility.',                                      'approved', 1,    'Funds benefit Make-A-Wish Foundation.'],
    [9,  'End of Year Celebration',       '2026-04-30', 'TBD Off-Campus Venue',               100, 1, 'Pending venue confirmation. Will have licensed bar service.',                  'pending',  null, 'Chapter must provide complete security plan and venue confirmation.'],
    [10, 'Preference Night',              '2026-04-08', 'Chapter House, 456 College Ave',      60, 0, 'Closed sisterhood event. Check-in list required.',                             'approved', 3,    null],
    [11, 'Cultural Heritage Night',       '2026-04-17', 'HUB-Robeson Center, Heritage Hall',   80, 0, 'No alcohol. Event open to campus community.',                                  'approved', 2,    null],
    [12, 'Founding Day Celebration',      '2026-04-20', 'Alumni Hall',                          50, 0, 'Sober event. Chapter officers and advisor present.',                           'approved', 2,    null],
    [13, 'Scholarship Banquet',           '2026-04-23', 'Waring Commons',                       40, 0, 'Formal dinner. No alcohol. Dean of Students invited.',                        'approved', 1,    null],
    [14, 'Stroll Competition',            '2026-04-27', 'Old Main Lawn',                       300, 0, 'Outdoor public event. Campus police notified.',                               'pending',  null, null],
  ];

  for (const e of events) {
    await run(
      `INSERT INTO events (org_id,name,date,venue,expected_attendance,alcohol_present,security_plan,approval_status,reviewed_by,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      e
    );
  }
  console.log('Seeded events.');

  console.log('\nSeed complete! Login credentials:\n');
  console.log('  Admin:           admin@chapterwatch.edu  /  admin123');
  console.log('  Council Officer: ifc.officer@psu.edu     /  officer123');
  console.log('  Chapter Officer: sigchi.officer@psu.edu  /  chapter123\n');
  await pool.end();
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
