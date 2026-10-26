// Connexion PostgreSQL
const { Pool, types } = require("pg");
const { DATABASE_URL } = require("./env");

// BIGINT (ids, COUNT) renvoyés en nombres plutôt qu'en chaînes
types.setTypeParser(20, (value) => parseInt(value, 10));

const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Le schéma est créé par database/database.sql (npm run db:init)
async function checkDatabase() {
  const result = await pool.query(`
    SELECT to_regclass('public.users') AS users_table
  `);

  if (!result.rows[0].users_table) {
    throw new Error(
      "Tables absentes : exécutez d'abord database/database.sql (npm run db:init)"
    );
  }

  console.log("✅ Base de données connectée");
}

module.exports = {
  pool,
  checkDatabase,
};
