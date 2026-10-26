// Variables d'environnement obligatoires (fichier .env)

const PORT = process.env.PORT || 5000;

const JWT_SECRET = process.env.JWT_SECRET;

const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    "❌ JWT_SECRET doit être défini dans le fichier .env (32 caractères minimum)"
  );
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error(
    "❌ DATABASE_URL n'est pas défini dans le fichier .env"
  );
  process.exit(1);
}

module.exports = {
  PORT,
  JWT_SECRET,
  DATABASE_URL,
};
