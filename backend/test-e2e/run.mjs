// Tests navigateur (Firefox) : npm run test:e2e
// Démarre l'application sur la base de TEST (vidée avant chaque scénario)
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

require("dotenv").config({ path: path.join(here, "..", ".env") });

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

if (!TEST_DATABASE_URL || !new URL(TEST_DATABASE_URL).pathname.endsWith("_test")) {
  console.error("❌ TEST_DATABASE_URL doit être défini et désigner une base dont le nom finit par _test");
  process.exit(1);
}

const FIREFOX = process.env.FIREFOX_PATH || "/usr/bin/firefox";

if (!fs.existsSync(FIREFOX)) {
  console.error(`❌ Firefox introuvable (${FIREFOX}) : définissez FIREFOX_PATH`);
  process.exit(1);
}

process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.JWT_SECRET = "secret-de-test-uniquement-".padEnd(48, "x");
process.env.LOG_REQUESTS = "false";
process.env.LOGIN_RATE_LIMIT = "1000";
process.env.REGISTER_RATE_LIMIT = "1000";
process.env.UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cybercom-e2e-"));

const { app, pool } = require("../server");
const schema = fs.readFileSync(path.join(here, "..", "..", "database", "database.sql"), "utf8");

const SHOTS = fs.mkdtempSync(path.join(os.tmpdir(), "cybercom-e2e-captures-"));
const server = await new Promise((resolve) => {
  const s = app.listen(0, "127.0.0.1", () => resolve(s));
});
const BASE = `http://127.0.0.1:${server.address().port}`;

const only = process.argv.slice(2);
const scenarios = fs
  .readdirSync(here)
  .filter((f) => f.endsWith(".scenario.mjs"))
  .filter((f) => only.length === 0 || only.some((o) => f.startsWith(o)))
  .sort();

let failures = 0;

for (const file of scenarios) {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.query(schema);

  const results = [];
  const problems = [];

  const browser = await puppeteer.launch({ browser: "firefox", executablePath: FIREFOX, headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 1200, height: 900 });

  page.on("console", (msg) => {
    if (["error", "warn"].includes(msg.type())) problems.push(`console ${msg.type()} : ${msg.text()}`);
  });
  page.on("pageerror", (err) => problems.push(`erreur JS : ${err.message}`));
  page.on("dialog", async (dialog) => {
    if (dialog.type() === "alert") problems.push(`alert() déclenchée : ${dialog.message()}`);
    await dialog.accept();
  });

  const t = {
    page,
    BASE,
    SHOTS,
    sql: async (q) => {
      const rows = (await pool.query({ text: q, rowMode: "array" })).rows;
      return rows.map((r) => r.join("|")).join("\n");
    },
    check: (label, ok, detail = "") => results.push({ label, ok: Boolean(ok), detail }),
    text: (sel) => page.$eval(sel, (n) => n.textContent.trim()).catch(() => null),
    waitText: (sel, needle, timeout = 5000) =>
      page.waitForFunction((s, x) => [...document.querySelectorAll(s)].some((n) => n.textContent.includes(x)), { timeout }, sel, needle),
    clickText: (sel, label) =>
      page.evaluate((s, l) => {
        const b = [...document.querySelectorAll(s)].find((n) => n.textContent.trim() === l);
        if (!b) throw new Error(`bouton « ${l} » introuvable dans ${s}`);
        b.click();
      }, sel, label),
    apiCall: (method, url, body, token) =>
      page.evaluate(async (m, u, b, tk) => {
        const r = await fetch(u, { method: m, headers: { "Content-Type": "application/json", ...(tk ? { Authorization: `Bearer ${tk}` } : {}) }, body: b ? JSON.stringify(b) : undefined });
        return { status: r.status, body: await r.json().catch(() => null) };
      }, method, url, body, token),
    async login(username, password = "motdepasse1") {
      await page.evaluate(() => localStorage.clear()).catch(() => {});
      await page.goto(BASE + "/pages/login.html");
      await page.type("#login", username);
      await page.type("#password", password);
      await page.click("button[type=submit]");
      await page.waitForFunction(() => location.pathname !== "/pages/login.html");
    },
    async register(username) {
      await page.goto(BASE + "/pages/login.html");
      return (await t.apiCall("POST", "/api/auth/register", { username, email: `${username}@test.fr`, password: "motdepasse1", country: "Bénin" })).body;
    },
  };

  console.log(`\n▶ ${file}`);

  try {
    const { default: scenario } = await import(path.join(here, file));
    await scenario(t);
  } catch (error) {
    t.check("scénario interrompu", false, error.message);
    await page.screenshot({ path: path.join(SHOTS, `${file}-erreur.png`), fullPage: true }).catch(() => {});
  }

  await browser.close();

  for (const r of results) {
    console.log(`  ${r.ok ? "✔" : "✖"} ${r.label}${r.ok ? "" : ` — ${r.detail}`}`);
  }

  for (const p of problems) {
    console.log(`  ✖ ${p}`);
  }

  failures += results.filter((r) => !r.ok).length + problems.length;
}

server.close();
await pool.end();
fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });

console.log(`\n${failures === 0 ? "✔ Tous les contrôles navigateur sont réussis" : `✖ ${failures} échec(s)`} — captures : ${SHOTS}`);
process.exit(failures === 0 ? 0 : 1);
