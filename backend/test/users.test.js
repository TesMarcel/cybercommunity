const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, createUser, PNG_1PX } = require("./helpers");

let alice;
let bob;
let admin;

before(async () => {
  await setup();
  alice = await createUser("alice");
  bob = await createUser("bob");
  admin = await createUser("admin", "ADMIN");
});

after(teardown);

test("email visible seulement par soi-même et les admins", async () => {
  const other = await api("GET", `/api/users/${alice.id}`, { token: bob.token });
  assert.equal(other.status, 200);
  assert.equal(other.body.email, undefined);
  assert.equal(other.body.is_active, undefined);

  const self = await api("GET", `/api/users/${bob.id}`, { token: bob.token });
  assert.equal(self.body.email, "bob@test.fr");

  const byAdmin = await api("GET", `/api/users/${bob.id}`, { token: admin.token });
  assert.equal(byAdmin.body.email, "bob@test.fr");
  assert.equal(byAdmin.body.is_active, true);
});

test("utilisateur introuvable ou id invalide", async () => {
  assert.equal((await api("GET", "/api/users/9999", { token: bob.token })).status, 404);
  assert.equal((await api("GET", "/api/users/abc", { token: bob.token })).status, 400);
});

test("liste : recherche (jokers échappés) et pagination", async () => {
  await createUser("bo_b2");

  const search = await api("GET", "/api/users?q=_", { token: bob.token });
  assert.deepEqual(search.body.users.map((u) => u.username), ["bo_b2"]);

  const page = await api("GET", "/api/users?page=2&limit=2", { token: bob.token });
  assert.equal(page.body.total, 4);
  assert.equal(page.body.users.length, 2);
  assert.equal(page.body.page, 2);
});

test("profil : mise à jour partielle et validation", async () => {
  let res = await api("PUT", "/api/users/profile", {
    token: bob.token,
    body: { pseudonym: "Bobby", biography: "Pentester" },
  });
  assert.equal(res.status, 200);

  res = await api("PUT", "/api/users/profile", {
    token: bob.token,
    body: { skills: "Linux" },
  });
  assert.equal(res.body.pseudonym, "Bobby");
  assert.equal(res.body.skills, "Linux");

  res = await api("PUT", "/api/users/profile", { token: bob.token, body: { pseudonym: "" } });
  assert.equal(res.body.pseudonym, null);

  for (const body of [{}, { biography: 123 }, { pseudonym: "a".repeat(101) }, { role: "ADMIN" }]) {
    res = await api("PUT", "/api/users/profile", { token: bob.token, body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
});

test("photo : image valide acceptée, ancienne supprimée", async () => {
  const send = () => {
    const form = new FormData();
    form.append("photo", new Blob([PNG_1PX], { type: "image/png" }), "a.png");
    return api("POST", "/api/users/profile/photo", { token: bob.token, form });
  };

  const first = await send();
  assert.equal(first.status, 200);
  assert.match(first.body.url, /^\/uploads\/images\/[0-9a-f]{32}\.png$/);

  const served = await api("GET", first.body.url);
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("x-content-type-options"), "nosniff");

  const second = await send();
  assert.equal((await api("GET", first.body.url)).status, 404);
  assert.equal((await api("GET", second.body.url)).status, 200);
});

test("photo : faux PNG, SVG et fichier trop gros refusés", async () => {
  const files = [
    [Buffer.from("<html><script>alert(1)</script></html>"), "image/png", "x.png"],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'), "image/svg+xml", "x.svg"],
    [Buffer.concat([PNG_1PX, Buffer.alloc(3 * 1024 * 1024)]), "image/png", "big.png"],
  ];

  for (const [content, type, name] of files) {
    const form = new FormData();
    form.append("photo", new Blob([content], { type }), name);
    const res = await api("POST", "/api/users/profile/photo", { token: bob.token, form });
    assert.equal(res.status, 400, name);
  }
});
