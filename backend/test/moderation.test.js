const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, createUser, sql } = require("./helpers");

let admin;
let admin2;
let modo;
let modo2;
let bob;
let eve;

before(async () => {
  await setup();
  admin = await createUser("admin", "ADMIN");
  admin2 = await createUser("admin2", "ADMIN");
  modo = await createUser("modo", "MODERATOR");
  modo2 = await createUser("modo2", "MODERATOR");
  bob = await createUser("bob");
  eve = await createUser("eve");
});

after(teardown);

const report = (user, body) => api("POST", "/api/reports", { token: user.token, body });

test("signalement : validation des champs", async () => {
  const cases = [
    { target_type: "FOO", target_id: 1, reason: "spam" },
    { target_type: "USER", target_id: "abc", reason: "spam" },
    { target_type: "USER", target_id: eve.id, reason: " " },
    { target_type: "USER", target_id: eve.id, reason: "a".repeat(101) },
    { target_type: "USER", target_id: eve.id, reason: "spam", details: 42 },
    { target_type: "USER", target_id: bob.id, reason: "moi-même" },
  ];

  for (const body of cases) {
    assert.equal((await report(bob, body)).status, 400, JSON.stringify(body));
  }
});

test("signalement : cible inexistante ou invisible", async () => {
  assert.equal((await report(bob, { target_type: "POST", target_id: 9999, reason: "spam" })).status, 404);

  // Message d'un groupe privé dont bob n'est pas membre
  const group = await api("POST", "/api/groups", { token: admin.token, body: { name: "Privé" } });
  const message = await api("POST", `/api/groups/${group.body.id}/messages`, {
    token: admin.token,
    body: { content: "secret" },
  });

  assert.equal((await report(bob, { target_type: "GROUP", target_id: group.body.id, reason: "x" })).status, 404);
  assert.equal((await report(bob, { target_type: "MESSAGE", target_id: message.body.id, reason: "x" })).status, 404);

  // Visible pour un membre
  await api("POST", `/api/groups/${group.body.id}/members`, { token: admin.token, body: { user_id: eve.id } });
  assert.equal((await report(eve, { target_type: "MESSAGE", target_id: message.body.id, reason: "x" })).status, 201);
});

test("signalement : création, doublon bloqué tant qu'il est en attente", async () => {
  const post = await api("POST", "/api/posts", { token: eve.token, body: { title: "Pub", content: "achetez" } });

  const first = await report(bob, { target_type: "POST", target_id: post.body.id, reason: "spam", details: "pub" });
  assert.equal(first.status, 201);
  assert.equal(first.body.report.status, "PENDING");

  assert.equal((await report(bob, { target_type: "POST", target_id: post.body.id, reason: "spam" })).status, 409);

  // Un autre utilisateur peut signaler le même élément
  assert.equal((await report(modo, { target_type: "POST", target_id: post.body.id, reason: "spam" })).status, 201);
});

test("signalements : liste réservée à la modération, filtre et pagination", async () => {
  assert.equal((await api("GET", "/api/reports", { token: bob.token })).status, 403);

  const all = await api("GET", "/api/reports", { token: modo.token });
  assert.equal(all.body.total, 3);
  assert.ok(all.body.reports[0].reporter);

  // Aperçu et contexte de la cible
  const byType = Object.fromEntries(all.body.reports.map((r) => [r.target_type, r]));
  assert.equal(byType.POST.target_preview, "Pub");
  assert.equal(byType.POST.target_author_id, eve.id);
  assert.equal(byType.MESSAGE.target_preview, "secret");
  assert.ok(byType.MESSAGE.target_group_id);

  const pending = await api("GET", "/api/reports?status=PENDING&limit=2", { token: modo.token });
  assert.equal(pending.body.reports.length, 2);
  assert.equal(pending.body.total, 3);

  assert.equal((await api("GET", "/api/reports?status=FOO", { token: modo.token })).status, 400);
});

test("signalement : traitement et notification du signaleur", async () => {
  const [r] = await sql("SELECT id FROM reports WHERE reporter_id = $1 AND target_type = 'POST'", [bob.id]);

  // Commentaire signalé : la discussion parente est fournie
  const [post] = await sql("SELECT id FROM posts WHERE title = 'Pub'");
  const comment = await api("POST", `/api/posts/${post.id}/comments`, { token: eve.token, body: { content: "lien douteux" } });
  await report(bob, { target_type: "COMMENT", target_id: comment.body.id, reason: "spam" });
  const comments = await api("GET", "/api/reports?status=PENDING", { token: modo.token });
  const commentReport = comments.body.reports.find((x) => x.target_type === "COMMENT");
  assert.equal(commentReport.target_post_id, post.id);
  assert.equal(commentReport.target_preview, "lien douteux");

  assert.equal((await api("PUT", `/api/reports/${r.id}`, { token: modo.token, body: { status: "REVIEWING" } })).status, 400);
  assert.equal((await api("PUT", "/api/reports/9999", { token: modo.token, body: { status: "RESOLVED" } })).status, 404);

  const resolved = await api("PUT", `/api/reports/${r.id}`, { token: modo.token, body: { status: "RESOLVED" } });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.body.handled_by, modo.id);

  const notifs = await sql("SELECT type FROM notifications WHERE user_id = $1", [bob.id]);
  assert.deepEqual(notifs, [{ type: "REPORT_UPDATE" }]);

  // Plus en attente : bob peut signaler à nouveau
  assert.equal((await report(bob, { target_type: "POST", target_id: post.id, reason: "toujours là" })).status, 201);
});

test("suspension : hiérarchie des rôles", async () => {
  const suspend = (actor, target) => api("PUT", `/api/moderation/users/${target.id}/suspend`, { token: actor.token });
  const activate = (actor, target) => api("PUT", `/api/moderation/users/${target.id}/activate`, { token: actor.token });

  assert.equal((await suspend(bob, eve)).status, 403);

  // Un modérateur ne touche ni aux modérateurs ni aux admins
  assert.equal((await suspend(modo, modo2)).status, 403);
  assert.equal((await suspend(modo, admin)).status, 403);

  // Personne ne se suspend soi-même
  assert.equal((await suspend(modo, modo)).status, 400);
  assert.equal((await suspend(admin, admin)).status, 400);

  assert.equal((await suspend(modo, { id: 9999 })).status, 404);
  assert.equal((await activate(modo, { id: 9999 })).status, 404);

  const suspended = await suspend(modo, eve);
  assert.equal(suspended.body.user.is_active, false);
  assert.equal((await api("GET", "/api/auth/me", { token: eve.token })).status, 403);

  const activated = await activate(modo, eve);
  assert.equal(activated.body.user.is_active, true);
  assert.equal((await api("GET", "/api/auth/me", { token: eve.token })).status, 200);

  // Un admin peut suspendre un modérateur
  assert.equal((await suspend(admin, modo2)).status, 200);
  assert.equal((await activate(admin, modo2)).status, 200);
});

test("rôles : réservé aux admins, pas sur soi-même", async () => {
  const setRole = (actor, target, role) =>
    api("PUT", `/api/admin/users/${target.id}/role`, { token: actor.token, body: { role } });

  assert.equal((await setRole(modo, bob, "ADMIN")).status, 403);
  assert.equal((await setRole(admin, bob, "ROOT")).status, 400);
  assert.equal((await setRole(admin, admin, "USER")).status, 400);
  assert.equal((await setRole(admin, { id: 9999 }, "USER")).status, 404);

  const ok = await setRole(admin, bob, "MODERATOR");
  assert.equal(ok.body.role, "MODERATOR");

  // Le nouveau rôle s'applique sans reconnexion
  assert.equal((await api("GET", "/api/reports", { token: bob.token })).status, 200);

  assert.equal((await setRole(admin, admin2, "USER")).status, 200);
  assert.equal((await setRole(admin, bob, "USER")).status, 200);
});

test("notifications : liste, compteur, lecture, suppression", async () => {
  await sql("DELETE FROM notifications");

  for (let i = 1; i <= 3; i++) {
    await sql("INSERT INTO notifications(user_id, type, message) VALUES($1, 'TEST', $2)", [eve.id, `n${i}`]);
  }
  await sql("INSERT INTO notifications(user_id, type, message) VALUES($1, 'TEST', 'autre')", [bob.id]);

  const list = await api("GET", "/api/notifications?limit=2", { token: eve.token });
  assert.deepEqual(list.body.notifications.map((n) => n.message), ["n3", "n2"]);
  assert.equal(list.body.total, 3);
  assert.equal(list.body.unread, 3);

  const count = await api("GET", "/api/notifications/unread-count", { token: eve.token });
  assert.deepEqual(count.body, { unread: 3 });

  const id = list.body.notifications[0].id;

  // Notification d'un autre utilisateur : introuvable
  assert.equal((await api("PUT", `/api/notifications/${id}/read`, { token: bob.token })).status, 404);
  assert.equal((await api("DELETE", `/api/notifications/${id}`, { token: bob.token })).status, 404);

  const read = await api("PUT", `/api/notifications/${id}/read`, { token: eve.token });
  assert.equal(read.body.is_read, true);

  const unreadOnly = await api("GET", "/api/notifications?unread=true", { token: eve.token });
  assert.deepEqual(unreadOnly.body.notifications.map((n) => n.message), ["n2", "n1"]);

  const all = await api("PUT", "/api/notifications/read-all", { token: eve.token });
  assert.equal(all.body.updated, 2);
  assert.deepEqual((await api("GET", "/api/notifications/unread-count", { token: eve.token })).body, { unread: 0 });

  assert.equal((await api("DELETE", `/api/notifications/${id}`, { token: eve.token })).status, 200);
  assert.equal((await api("GET", "/api/notifications", { token: eve.token })).body.total, 2);

  // Les notifications de bob ne sont pas touchées
  assert.deepEqual((await api("GET", "/api/notifications/unread-count", { token: bob.token })).body, { unread: 1 });
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
