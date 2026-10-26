const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, sql } = require("./helpers");

before(setup);
after(teardown);

const valid = {
  username: "alice",
  email: "Alice@Test.fr",
  password: "motdepasse1",
  country: "Bénin",
};

test("inscription : champs invalides refusés", async () => {
  const cases = [
    [{ ...valid, username: "al" }, /nom d'utilisateur/],
    [{ ...valid, username: ["alice"] }, /nom d'utilisateur/],
    [{ ...valid, email: "pas-un-email" }, /Email invalide/],
    [{ ...valid, password: "court" }, /8 caractères/],
    [{ ...valid, password: "é".repeat(40) }, /72 octets/],
    [{ ...valid, country: undefined }, /obligatoires/],
  ];

  for (const [body, message] of cases) {
    const res = await api("POST", "/api/auth/register", { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    assert.match(res.body.message, message);
  }
});

test("inscription : compte + profil créés, email en minuscules", async () => {
  const res = await api("POST", "/api/auth/register", { body: valid });

  assert.equal(res.status, 201);
  assert.ok(res.body.token);
  assert.equal(res.body.user.email, "alice@test.fr");
  assert.equal(res.body.user.password_hash, undefined);

  const profiles = await sql("SELECT * FROM profiles WHERE user_id = $1", [
    res.body.user.id,
  ]);
  assert.equal(profiles.length, 1);
});

test("inscription : doublons refusés sans tenir compte de la casse", async () => {
  for (const body of [
    { ...valid, username: "ALICE", email: "autre@test.fr" },
    { ...valid, username: "autre", email: "ALICE@test.fr" },
  ]) {
    const res = await api("POST", "/api/auth/register", { body });
    assert.equal(res.status, 409);
  }
});

test("connexion : par nom ou email, erreurs identiques", async () => {
  const byEmail = await api("POST", "/api/auth/login", {
    body: { login: "ALICE@test.FR", password: "motdepasse1" },
  });
  assert.equal(byEmail.status, 200);
  assert.ok(byEmail.body.token);

  const wrongPassword = await api("POST", "/api/auth/login", {
    body: { login: "alice", password: "mauvais123" },
  });
  const unknownUser = await api("POST", "/api/auth/login", {
    body: { login: "inconnu", password: "mauvais123" },
  });

  assert.equal(wrongPassword.status, 401);
  assert.deepEqual(wrongPassword.body, unknownUser.body);
});

test("connexion : compte suspendu (403 seulement avec le bon mot de passe)", async () => {
  await sql("UPDATE users SET is_active = FALSE WHERE username = 'alice'");

  const wrong = await api("POST", "/api/auth/login", {
    body: { login: "alice", password: "mauvais123" },
  });
  const right = await api("POST", "/api/auth/login", {
    body: { login: "alice", password: "motdepasse1" },
  });

  await sql("UPDATE users SET is_active = TRUE WHERE username = 'alice'");

  assert.equal(wrong.status, 401);
  assert.equal(right.status, 403);
});

test("tokens : absent, invalide, falsifié (alg none)", async () => {
  assert.equal((await api("GET", "/api/auth/me")).status, 401);
  assert.equal((await api("GET", "/api/auth/me", { token: "abc" })).status, 401);

  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const forged = `${b64({ alg: "none", typ: "JWT" })}.${b64({ id: 1, role: "ADMIN" })}.`;

  assert.equal((await api("GET", "/api/auth/me", { token: forged })).status, 401);
});

test("changement de mot de passe : anciens tokens invalidés", async () => {
  const login = await api("POST", "/api/auth/login", {
    body: { login: "alice", password: "motdepasse1" },
  });
  const oldToken = login.body.token;

  const wrong = await api("PUT", "/api/auth/password", {
    token: oldToken,
    body: { current_password: "faux12345", new_password: "nouveaumdp1" },
  });
  assert.equal(wrong.status, 401);

  const ok = await api("PUT", "/api/auth/password", {
    token: oldToken,
    body: { current_password: "motdepasse1", new_password: "nouveaumdp1" },
  });
  assert.equal(ok.status, 200);

  assert.equal((await api("GET", "/api/auth/me", { token: oldToken })).status, 401);

  const me = await api("GET", "/api/auth/me", { token: ok.body.token });
  assert.equal(me.status, 200);
  assert.equal(me.body.username, "alice");

  const relogin = await api("POST", "/api/auth/login", {
    body: { login: "alice", password: "nouveaumdp1" },
  });
  assert.equal(relogin.status, 200);
});
