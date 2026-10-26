// Point d'entrée : charge la configuration et démarre le serveur
require("dotenv").config();

const { PORT } = require("./src/config/env");
const { pool, checkDatabase } = require("./src/config/database");
const app = require("./src/app");

async function startServer() {
  try {
    await checkDatabase();

    app.listen(PORT, () => {
      console.log(`
========================================
🚀 CYBER COMMUNITY API
========================================

Serveur : http://localhost:${PORT}
API     : http://localhost:${PORT}/api
Status  : ONLINE

========================================
`);
    });
  } catch (error) {
    console.error(
      "❌ Impossible de démarrer le serveur :",
      error
    );

    process.exit(1);
  }
}

// Lancé directement (npm start) : démarre le serveur.
// Importé (tests) : expose seulement l'application et la connexion.
if (require.main === module) {
  startServer();
}

module.exports = { app, pool };
