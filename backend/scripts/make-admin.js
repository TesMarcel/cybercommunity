// Donne le rôle ADMIN à un compte existant : npm run make-admin -- <nom>
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { Pool } = require("pg");

const username = process.argv[2];

if (!username) {
  console.error("Usage : npm run make-admin -- <nom_utilisateur>");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL n'est pas défini dans le fichier .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool
  .query(
    "UPDATE users SET role = 'ADMIN', updated_at = CURRENT_TIMESTAMP WHERE LOWER(username) = LOWER($1) RETURNING username",
    [username]
  )
  .then((result) => {
    if (result.rowCount === 0) {
      console.error(`❌ Aucun compte « ${username} ». Créez-le d'abord depuis le site.`);
      process.exitCode = 1;
    } else {
      console.log(`✅ ${result.rows[0].username} est maintenant administrateur`);
    }
  })
  .catch((error) => {
    console.error("❌", error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
