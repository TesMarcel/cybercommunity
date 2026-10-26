// Crée les tables à partir de database/database.sql
// en utilisant DATABASE_URL du fichier .env
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const { execFileSync } = require("child_process");
const path = require("path");

if (!process.env.DATABASE_URL) {
  console.error("❌ DATABASE_URL n'est pas défini dans le fichier .env");
  process.exit(1);
}

const sqlFile = path.join(__dirname, "..", "..", "database", "database.sql");

try {
  execFileSync(
    "psql",
    [process.env.DATABASE_URL, "-v", "ON_ERROR_STOP=1", "-q", "-f", sqlFile],
    {
      stdio: "inherit",
      // Masque les « existe déjà » quand on relance le script
      env: { ...process.env, PGOPTIONS: "-c client_min_messages=warning" },
    }
  );

  console.log("✅ Tables créées");
} catch (error) {
  console.error("❌ Échec de la création des tables");
  process.exit(1);
}
