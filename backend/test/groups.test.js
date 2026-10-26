const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, createUser, sql } = require("./helpers");

let admin;
let modo;
let bob;
let eve;
let groupId;
let publicId;

before(async () => {
  await setup();
  admin = await createUser("admin", "ADMIN");
  modo = await createUser("modo", "MODERATOR");
  bob = await createUser("bob");
  eve = await createUser("eve");
});

after(teardown);

test("création de groupe : admin du site uniquement, validation", async () => {
  assert.equal((await api("POST", "/api/groups", { token: bob.token, body: { name: "G" } })).status, 403);
  assert.equal((await api("POST", "/api/groups", { token: admin.token, body: { name: " " } })).status, 400);

  const group = await api("POST", "/api/groups", {
    token: admin.token,
    body: { name: "Red Team", description: "Exercices" },
  });
  assert.equal(group.status, 201);
  assert.equal(group.body.is_private, true);
  groupId = group.body.id;

  const pub = await api("POST", "/api/groups", {
    token: admin.token,
    body: { name: "Débutants", is_private: false },
  });
  assert.equal(pub.body.is_private, false);
  publicId = pub.body.id;
});

test("visibilité : groupes privés cachés aux non-membres", async () => {
  const forEve = await api("GET", "/api/groups", { token: eve.token });
  assert.deepEqual(forEve.body.map((g) => g.name), ["Débutants"]);

  const forModo = await api("GET", "/api/groups", { token: modo.token });
  assert.equal(forModo.body.length, 2);

  assert.equal((await api("GET", `/api/groups/${groupId}`, { token: eve.token })).status, 403);
  assert.equal((await api("GET", `/api/groups/${publicId}`, { token: eve.token })).status, 200);
  assert.equal((await api("GET", "/api/groups/9999", { token: eve.token })).status, 404);

  for (const url of ["members", "posts", "messages"]) {
    const res = await api("GET", `/api/groups/${groupId}/${url}`, { token: eve.token });
    assert.equal(res.status, 403, url);
  }
});

test("ajout de membres par un admin du groupe", async () => {
  const added = await api("POST", `/api/groups/${groupId}/members`, {
    token: admin.token,
    body: { user_id: bob.id },
  });
  assert.equal(added.status, 201);

  const again = await api("POST", `/api/groups/${groupId}/members`, {
    token: admin.token,
    body: { user_id: bob.id },
  });
  assert.equal(again.status, 409);

  // Une seule notification malgré le second ajout
  const notifs = await sql("SELECT * FROM notifications WHERE user_id = $1", [bob.id]);
  assert.equal(notifs.length, 1);

  // Simple membre : ne peut pas ajouter
  const byMember = await api("POST", `/api/groups/${groupId}/members`, {
    token: bob.token,
    body: { user_id: eve.id },
  });
  assert.equal(byMember.status, 403);

  const unknown = await api("POST", `/api/groups/${groupId}/members`, {
    token: admin.token,
    body: { user_id: 9999 },
  });
  assert.equal(unknown.status, 400);

  const members = await api("GET", `/api/groups/${groupId}/members`, { token: bob.token });
  assert.deepEqual(members.body.map((m) => [m.username, m.group_role]), [
    ["admin", "ADMIN"],
    ["bob", "MEMBER"],
  ]);
});

test("rejoindre : groupe public oui, groupe privé non", async () => {
  assert.equal((await api("POST", `/api/groups/${publicId}/join`, { token: eve.token })).status, 201);
  assert.equal((await api("POST", `/api/groups/${publicId}/join`, { token: eve.token })).status, 409);
  assert.equal((await api("POST", `/api/groups/${groupId}/join`, { token: eve.token })).status, 403);

  const list = await api("GET", "/api/groups", { token: eve.token });
  assert.equal(list.body.find((g) => g.id === publicId).my_role, "MEMBER");
});

test("rôles dans le groupe et dernier administrateur", async () => {
  const promote = await api("PUT", `/api/groups/${groupId}/members/${bob.id}`, {
    token: admin.token,
    body: { group_role: "ADMIN" },
  });
  assert.equal(promote.body.group_role, "ADMIN");

  // bob, admin du groupe, gère maintenant le groupe
  const renamed = await api("PUT", `/api/groups/${groupId}`, {
    token: bob.token,
    body: { description: "Exercices offensifs" },
  });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.name, "Red Team");

  await api("DELETE", `/api/groups/${groupId}/members/${admin.id}`, { token: admin.token });

  // bob est le dernier admin : ne peut ni se rétrograder ni partir
  const demote = await api("PUT", `/api/groups/${groupId}/members/${bob.id}`, {
    token: bob.token,
    body: { group_role: "MEMBER" },
  });
  assert.equal(demote.status, 400);

  const leave = await api("DELETE", `/api/groups/${groupId}/members/${bob.id}`, { token: bob.token });
  assert.equal(leave.status, 400);

  const invalid = await api("PUT", `/api/groups/${groupId}/members/${bob.id}`, {
    token: bob.token,
    body: { group_role: "OWNER" },
  });
  assert.equal(invalid.status, 400);
});

test("quitter et retirer un membre", async () => {
  await api("POST", `/api/groups/${groupId}/members`, { token: bob.token, body: { user_id: eve.id } });

  // eve ne peut pas retirer bob
  assert.equal((await api("DELETE", `/api/groups/${groupId}/members/${bob.id}`, { token: eve.token })).status, 403);

  assert.equal((await api("DELETE", `/api/groups/${groupId}/members/${eve.id}`, { token: eve.token })).status, 200);
  assert.equal((await api("GET", `/api/groups/${groupId}/posts`, { token: eve.token })).status, 403);

  await api("POST", `/api/groups/${groupId}/members`, { token: bob.token, body: { user_id: eve.id } });
  assert.equal((await api("DELETE", `/api/groups/${groupId}/members/${eve.id}`, { token: bob.token })).status, 200);
  assert.equal((await api("DELETE", `/api/groups/${groupId}/members/${eve.id}`, { token: bob.token })).status, 404);
});

test("discussions et commentaires de groupe", async () => {
  await api("POST", `/api/groups/${groupId}/members`, { token: bob.token, body: { user_id: eve.id } });

  const post = await api("POST", `/api/groups/${groupId}/posts`, {
    token: eve.token,
    body: { title: "Plan", content: "Étapes" },
  });
  assert.equal(post.status, 201);
  const postId = post.body.id;

  assert.equal((await api("POST", `/api/groups/${groupId}/posts`, { token: eve.token, body: { title: "" } })).status, 400);

  const comment = await api("POST", `/api/groups/${groupId}/posts/${postId}/comments`, {
    token: bob.token,
    body: { content: "Bonne idée" },
  });
  assert.equal(comment.status, 201);

  const reply = await api("POST", `/api/groups/${groupId}/posts/${postId}/comments`, {
    token: eve.token,
    body: { content: "Merci", parent_id: comment.body.id },
  });
  assert.equal(reply.status, 201);

  // Discussion d'un autre groupe via ce groupe : 404
  const other = await api("POST", `/api/groups/${publicId}/posts`, {
    token: eve.token,
    body: { title: "Public", content: "x" },
  });
  assert.equal((await api("GET", `/api/groups/${groupId}/posts/${other.body.id}`, { token: eve.token })).status, 404);

  const detail = await api("GET", `/api/groups/${groupId}/posts/${postId}`, { token: eve.token });
  assert.equal(detail.body.comments.length, 2);

  const list = await api("GET", `/api/groups/${groupId}/posts`, { token: eve.token });
  assert.equal(list.body[0].comments, 2);

  const types = await sql(
    "SELECT type FROM notifications WHERE user_id = $1 ORDER BY id",
    [eve.id]
  );
  assert.ok(types.some((n) => n.type === "GROUP_COMMENT"));

  // Modification : auteur seulement
  assert.equal((await api("PUT", `/api/groups/${groupId}/posts/${postId}`, { token: bob.token, body: { title: "x" } })).status, 403);
  const edited = await api("PUT", `/api/groups/${groupId}/posts/${postId}`, {
    token: eve.token,
    body: { title: "Plan v2" },
  });
  assert.equal(edited.body.title, "Plan v2");
  assert.equal(edited.body.content, "Étapes");

  // Suppression du commentaire de bob par eve : refusée ; par bob (admin) : ok
  assert.equal((await api("DELETE", `/api/groups/${groupId}/comments/${comment.body.id}`, { token: eve.token })).status, 403);
  assert.equal((await api("DELETE", `/api/groups/${groupId}/comments/${reply.body.id}`, { token: bob.token })).status, 200);

  // L'admin du groupe supprime la discussion d'eve
  assert.equal((await api("DELETE", `/api/groups/${groupId}/posts/${postId}`, { token: bob.token })).status, 200);
});

test("messages de groupe", async () => {
  const message = await api("POST", `/api/groups/${groupId}/messages`, {
    token: eve.token,
    body: { content: "Salut" },
  });
  assert.equal(message.status, 201);
  assert.equal(message.body.sender_id, eve.id);

  assert.equal((await api("POST", `/api/groups/${groupId}/messages`, { token: eve.token, body: {} })).status, 400);

  const messages = await api("GET", `/api/groups/${groupId}/messages`, { token: bob.token });
  assert.deepEqual(messages.body.map((m) => m.content), ["Salut"]);
});

test("suppression du groupe : administrateurs du groupe", async () => {
  assert.equal((await api("DELETE", `/api/groups/${groupId}`, { token: eve.token })).status, 403);
  assert.equal((await api("DELETE", `/api/groups/${groupId}`, { token: bob.token })).status, 200);
  assert.equal((await api("GET", `/api/groups/${groupId}`, { token: bob.token })).status, 404);

  const leftovers = await sql("SELECT COUNT(*) AS n FROM group_messages WHERE group_id = $1", [groupId]);
  assert.equal(leftovers[0].n, 0);
});
