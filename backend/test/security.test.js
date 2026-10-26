const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api } = require("./helpers");

before(setup);
after(teardown);

test("en-têtes de sécurité présents, X-Powered-By absent", async () => {
  const res = await api("GET", "/api/health");

  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("x-frame-options"), "DENY");
  assert.equal(res.headers.get("referrer-policy"), "no-referrer");
  assert.match(res.headers.get("content-security-policy"), /frame-ancestors 'none'/);
  assert.equal(res.headers.get("x-powered-by"), null);

  // HSTS uniquement en production
  assert.equal(res.headers.get("strict-transport-security"), null);
});

test("CORS fermé par défaut : aucune origine extérieure autorisée", async () => {
  const headers = { Origin: "https://site-malveillant.example" };

  const get = await api("GET", "/api/health", { headers });
  assert.equal(get.headers.get("access-control-allow-origin"), null);

  const preflight = await api("OPTIONS", "/api/posts", {
    headers: { ...headers, "Access-Control-Request-Method": "POST" },
  });
  assert.equal(preflight.headers.get("access-control-allow-origin"), null);
});

test("JSON invalide : 400, corps trop volumineux : 413", async () => {
  const bad = await api("POST", "/api/auth/login", { raw: "{pas du json" });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.message, "JSON invalide");

  const big = await api("POST", "/api/auth/login", {
    raw: JSON.stringify({ login: "a".repeat(200 * 1024) }),
  });
  assert.equal(big.status, 413);
});
