const { run, all } = require('../database/db');

async function createNotification(userId, message, type = 'info', link = null) {
  await run(
    'INSERT INTO notifications (user_id, message, type, link) VALUES ($1, $2, $3, $4)',
    [userId, message, type, link]
  );
}

async function notifyAdmins(message, type = 'info', link = null) {
  const admins = await all(`SELECT id FROM users WHERE role = 'admin'`);
  for (const u of admins) {
    await createNotification(u.id, message, type, link);
  }
}

async function notifyRole(role, message, type = 'info', link = null) {
  const users = await all('SELECT id FROM users WHERE role = $1', [role]);
  for (const u of users) {
    await createNotification(u.id, message, type, link);
  }
}

async function notifyAdminsAndOfficers(message, type = 'info', link = null) {
  const users = await all(`SELECT id FROM users WHERE role IN ('admin','council_officer')`);
  for (const u of users) {
    await createNotification(u.id, message, type, link);
  }
}

module.exports = { createNotification, notifyAdmins, notifyRole, notifyAdminsAndOfficers };
