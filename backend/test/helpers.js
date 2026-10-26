// Outils communs aux tests : base de test, serveur, requêtes HTTP
const path = require("path");
const fs = require("fs");
const os = require("os");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL) {
  console.error("❌ TEST_DATABASE_URL n'est pas défini (voir .env.example)");
  process.exit(1);
}

// Sécurité : la base de test est vidée à chaque fichier de test,
// on refuse donc toute base dont le nom ne finit pas par _test
const dbName = new URL(TEST_DATABASE_URL).pathname.slice(1);

if (!dbName.endsWith("_test")) {
  console.error(`❌ Refus : la base « ${dbName} » ne se termine pas par _test`);
  process.exit(1);
}

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = "secret-de-test-uniquement-".padEnd(48, "x");
process.env.LOG_REQUESTS = "false";
process.env.LOGIN_RATE_LIMIT ??= "1000";
process.env.REGISTER_RATE_LIMIT ??= "1000";
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cybercom-test-"));

const { app, pool } = require("../server");

let server;
let baseUrl;

async function setup() {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");

  await pool.query(
    fs.readFileSync(
      path.join(__dirname, "..", "..", "database", "database.sql"),
      "utf8"
    )
  );

  await new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });

  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function teardown() {
  await new Promise((resolve) => server.close(resolve));
  await pool.end();
  fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
}

// api("POST", "/api/posts", { token, body }) -> { status, body, headers }
// form : FormData pour les envois de fichiers
// raw : corps envoyé tel quel en JSON ; headers : en-têtes supplémentaires
async function api(method, url, { token, body, form, raw, headers: extra } = {}) {
  const headers = { ...extra };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined || raw !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(baseUrl + url, {
    method,
    headers,
    body: form ?? raw ?? (body !== undefined ? JSON.stringify(body) : undefined),
  });

  const text = await response.text();

  let data = text;

  try {
    data = JSON.parse(text);
  } catch {}

  return { status: response.status, body: data, headers: response.headers };
}

// Crée un compte et renvoie { id, token } ; role : USER, MODERATOR ou ADMIN
async function createUser(username, role = "USER") {
  const res = await api("POST", "/api/auth/register", {
    body: {
      username,
      email: `${username}@test.fr`,
      password: "motdepasse1",
      country: "Bénin",
    },
  });

  if (res.status !== 201) {
    throw new Error(`Inscription de ${username} impossible : ${res.status}`);
  }

  if (role !== "USER") {
    await sql("UPDATE users SET role = $1 WHERE id = $2", [role, res.body.user.id]);
  }

  return { id: res.body.user.id, token: res.body.token };
}

async function sql(text, values) {
  return (await pool.query(text, values)).rows;
}

// PNG valide de 1x1 pixel
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
  "base64"
);

module.exports = { setup, teardown, api, createUser, sql, PNG_1PX };
