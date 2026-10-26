// Création des notifications
const { pool } = require("../config/database");

async function notify(userId, type, message) {
  await pool.query(
    `
    INSERT INTO notifications(user_id, type, message)
    VALUES($1, $2, $3)
    `,
    [userId, type, message]
  );
}

module.exports = {
  notify,
};
