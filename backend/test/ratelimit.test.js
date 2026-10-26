// Fichier séparé : chaque fichier de test tourne dans son propre processus,
// les limites basses ne gênent donc pas les autres tests
process.env.LOGIN_RATE_LIMIT = "3";
process.env.REGISTER_RATE_LIMIT = "2";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, createUser } = require("./helpers");

before(setup);
after(teardown);

test("connexion : bloquée après 3 échecs, les réussites ne comptent pas", async () => {
  await createUser("alice");

  const good = { login: "alice", password: "motdepasse1" };
  const bad = { login: "alice", password: "mauvais123" };

  for (let i = 0; i < 3; i++) {
    assert.equal((await api("POST", "/api/auth/login", { body: good })).status, 200);
  }

  const statuses = [];

  for (let i = 0; i < 4; i++) {
    statuses.push((await api("POST", "/api/auth/login", { body: bad })).status);
  }

  assert.deepEqual(statuses, [401, 401, 401, 429]);
});

test("inscription : les erreurs de saisie ne comptent pas", async () => {
  // alice a déjà consommé 1 inscription sur 2
  for (let i = 0; i < 3; i++) {
    const res = await api("POST", "/api/auth/register", {
      body: { username: "x", email: "x", password: "x", country: "x" },
    });
    assert.equal(res.status, 400);
  }

  await createUser("bob");

  const blocked = await api("POST", "/api/auth/register", {
    body: {
      username: "carol",
      email: "carol@test.fr",
      password: "motdepasse1",
      country: "Togo",
    },
  });
  assert.equal(blocked.status, 429);
});
