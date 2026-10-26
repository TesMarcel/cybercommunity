// Fichier séparé : la configuration CORS est lue au chargement du serveur
process.env.CORS_ORIGIN = "http://localhost:5500, https://cyber.example";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api } = require("./helpers");

before(setup);
after(teardown);

test("CORS : origines de CORS_ORIGIN autorisées, les autres non", async () => {
  for (const origin of ["http://localhost:5500", "https://cyber.example"]) {
    const res = await api("OPTIONS", "/api/posts", {
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
    });
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
  }

  const other = await api("GET", "/api/health", { headers: { Origin: "https://autre.example" } });
  assert.equal(other.headers.get("access-control-allow-origin"), null);
});
