const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, createUser } = require("./helpers");

let admin;
let bob;
let eve;
let groupId;

before(async () => {
  await setup();
  admin = await createUser("admin", "ADMIN");
  bob = await createUser("bob");
  eve = await createUser("eve");
});

after(teardown);

test("création de groupe et ajout de membre (admin)", async () => {
  assert.equal((await api("POST", "/api/groups", { token: bob.token, body: { name: "G" } })).status, 403);

  const group = await api("POST", "/api/groups", {
    token: admin.token,
    body: { name: "Red Team", description: "Exercices" },
  });
  assert.equal(group.status, 201);
  groupId = group.body.id;

  const added = await api("POST", `/api/groups/${groupId}/members`, {
    token: admin.token,
    body: { user_id: bob.id },
  });
  assert.equal(added.status, 200);

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

test("accès réservé aux membres", async () => {
  for (const url of ["members", "posts", "messages"]) {
    const res = await api("GET", `/api/groups/${groupId}/${url}`, { token: eve.token });
    assert.equal(res.status, 403, url);
  }
});

test("discussions et messages de groupe", async () => {
  const post = await api("POST", `/api/groups/${groupId}/posts`, {
    token: bob.token,
    body: { title: "Plan", content: "Étapes" },
  });
  assert.equal(post.status, 201);

  const posts = await api("GET", `/api/groups/${groupId}/posts`, { token: bob.token });
  assert.equal(posts.body.length, 1);

  const message = await api("POST", `/api/groups/${groupId}/messages`, {
    token: bob.token,
    body: { content: "Salut" },
  });
  assert.equal(message.status, 201);
  assert.equal(message.body.sender_id, bob.id);

  const empty = await api("POST", `/api/groups/${groupId}/messages`, { token: bob.token, body: {} });
  assert.equal(empty.status, 400);

  const messages = await api("GET", `/api/groups/${groupId}/messages`, { token: bob.token });
  assert.deepEqual(messages.body.map((m) => m.content), ["Salut"]);

  const groups = await api("GET", "/api/groups", { token: eve.token });
  assert.equal(groups.body[0].members, 2);
});
