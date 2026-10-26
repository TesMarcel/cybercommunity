const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, createUser } = require("./helpers");

let admin;
let modo;
let bob;

before(async () => {
  await setup();
  admin = await createUser("admin", "ADMIN");
  modo = await createUser("modo", "MODERATOR");
  bob = await createUser("bob");
});

after(teardown);

test("signalements : création, validation, traitement par la modération", async () => {
  const report = await api("POST", "/api/reports", {
    token: bob.token,
    body: { target_type: "USER", target_id: admin.id, reason: "spam", details: "x" },
  });
  assert.equal(report.status, 201);
  assert.equal(report.body.report.details, "x");

  const invalid = await api("POST", "/api/reports", {
    token: bob.token,
    body: { target_type: "FOO", target_id: 1, reason: "spam" },
  });
  assert.equal(invalid.status, 400);

  assert.equal((await api("GET", "/api/reports", { token: bob.token })).status, 403);

  const list = await api("GET", "/api/reports", { token: modo.token });
  assert.equal(list.body.length, 1);

  const reviewed = await api("PUT", `/api/reports/${report.body.report.id}`, {
    token: modo.token,
    body: { status: "REVIEWED" },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.handled_by, modo.id);

  const badStatus = await api("PUT", `/api/reports/${report.body.report.id}`, {
    token: modo.token,
    body: { status: "REVIEWING" },
  });
  assert.equal(badStatus.status, 400);
});

test("suspension et réactivation", async () => {
  assert.equal((await api("PUT", `/api/moderation/users/${bob.id}/suspend`, { token: bob.token })).status, 403);

  const suspended = await api("PUT", `/api/moderation/users/${bob.id}/suspend`, { token: modo.token });
  assert.equal(suspended.body.user.is_active, false);

  // Le token existant est refusé immédiatement
  assert.equal((await api("GET", "/api/auth/me", { token: bob.token })).status, 403);

  const activated = await api("PUT", `/api/moderation/users/${bob.id}/activate`, { token: modo.token });
  assert.equal(activated.body.user.is_active, true);
  assert.equal((await api("GET", "/api/auth/me", { token: bob.token })).status, 200);
});

test("rôles : réservé aux admins", async () => {
  const forbidden = await api("PUT", `/api/admin/users/${bob.id}/role`, {
    token: modo.token,
    body: { role: "ADMIN" },
  });
  assert.equal(forbidden.status, 403);

  const invalid = await api("PUT", `/api/admin/users/${bob.id}/role`, {
    token: admin.token,
    body: { role: "ROOT" },
  });
  assert.equal(invalid.status, 400);

  const ok = await api("PUT", `/api/admin/users/${bob.id}/role`, {
    token: admin.token,
    body: { role: "MODERATOR" },
  });
  assert.equal(ok.body.role, "MODERATOR");

  // Le nouveau rôle s'applique sans reconnexion
  assert.equal((await api("GET", "/api/reports", { token: bob.token })).status, 200);
});

test("notifications : lecture limitée à ses propres notifications", async () => {
  const group = await api("POST", "/api/groups", { token: admin.token, body: { name: "G" } });
  await api("POST", `/api/groups/${group.body.id}/members`, {
    token: admin.token,
    body: { user_id: bob.id },
  });

  const list = await api("GET", "/api/notifications", { token: bob.token });
  assert.equal(list.body.length, 1);
  assert.equal(list.body[0].type, "GROUP_ADDED");

  const id = list.body[0].id;

  const byOther = await api("PUT", `/api/notifications/${id}/read`, { token: modo.token });
  assert.equal(byOther.body, "");

  const read = await api("PUT", `/api/notifications/${id}/read`, { token: bob.token });
  assert.equal(read.body.is_read, true);
});

test("fichiers : téléversement", async () => {
  const form = new FormData();
  form.append("file", new Blob(["bonjour"], { type: "text/plain" }), "note.txt");

  const res = await api("POST", "/api/files", { token: bob.token, form });
  assert.equal(res.status, 201);
  assert.equal(res.body.original_name, "note.txt");
  assert.equal(res.body.size_bytes, 7);
});

test("route inconnue", async () => {
  assert.equal((await api("GET", "/api/inexistant")).status, 404);
});
