const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { setup, teardown, api, createUser, sql } = require("./helpers");

let alice;
let bob;
let modo;
let admin;

before(async () => {
  await setup();
  alice = await createUser("alice");
  bob = await createUser("bob");
  modo = await createUser("modo", "MODERATOR");
  admin = await createUser("admin", "ADMIN");
});

after(teardown);

const newPost = (user, body) => api("POST", "/api/posts", { token: user.token, body });

test("création de discussion par un membre, validation", async () => {
  const ok = await newPost(bob, { title: "Question Linux", content: "grep ?", category_id: 3 });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.author_id, bob.id);

  const noCategory = await newPost(bob, { title: "Sans catégorie", content: "ok" });
  assert.equal(noCategory.status, 201);
  assert.equal(noCategory.body.category_id, null);

  assert.equal((await newPost(bob, { title: "X", content: "Y", category_id: 999 })).status, 400);
  assert.equal((await newPost(bob, { title: "   ", content: "Y" })).status, 400);
  assert.equal((await newPost(bob, { title: "a".repeat(201), content: "Y" })).status, 400);
});

test("liste : filtres, recherche, pagination", async () => {
  await newPost(alice, { title: "CTF du weekend", content: "Qui participe ?", category_id: 5 });

  const all = await api("GET", "/api/posts", { token: alice.token });
  assert.equal(all.body.total, 3);

  const byCategory = await api("GET", "/api/posts?category_id=3", { token: alice.token });
  assert.deepEqual(byCategory.body.posts.map((p) => p.title), ["Question Linux"]);

  const search = await api("GET", "/api/posts?q=ctf", { token: alice.token });
  assert.deepEqual(search.body.posts.map((p) => p.title), ["CTF du weekend"]);

  const byAuthor = await api("GET", `/api/posts?author_id=${bob.id}`, { token: alice.token });
  assert.equal(byAuthor.body.total, 2);

  const page = await api("GET", "/api/posts?page=2&limit=2", { token: alice.token });
  assert.equal(page.body.posts.length, 1);
});

test("modification : auteur seulement, champ par champ", async () => {
  const [post] = await sql("SELECT id FROM posts WHERE title = 'Question Linux'");

  for (const user of [alice, modo]) {
    const res = await api("PUT", `/api/posts/${post.id}`, { token: user.token, body: { title: "piraté" } });
    assert.equal(res.status, 403);
  }

  const res = await api("PUT", `/api/posts/${post.id}`, {
    token: bob.token,
    body: { title: "Question Linux : grep", category_id: null },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, "Question Linux : grep");
  assert.equal(res.body.content, "grep ?");
  assert.equal(res.body.category_id, null);

  assert.equal((await api("PUT", `/api/posts/${post.id}`, { token: bob.token, body: {} })).status, 400);
  assert.equal((await api("PUT", "/api/posts/9999", { token: bob.token, body: { title: "x" } })).status, 404);
});

test("commentaires, réponses et notifications", async () => {
  const post = await newPost(bob, { title: "Aide", content: "?" });
  const postId = post.body.id;

  await api("POST", `/api/posts/${postId}/comments`, { token: bob.token, body: { content: "up" } });

  const c1 = await api("POST", `/api/posts/${postId}/comments`, {
    token: alice.token,
    body: { content: "utilise grep -r" },
  });
  assert.equal(c1.status, 201);

  const reply = await api("POST", `/api/posts/${postId}/comments`, {
    token: modo.token,
    body: { content: "et -i", parent_id: c1.body.id },
  });
  assert.equal(reply.status, 201);
  assert.equal(reply.body.parent_id, c1.body.id);

  // Réponse vers un commentaire d'une autre discussion
  const other = await newPost(alice, { title: "Autre", content: "x" });
  const wrongParent = await api("POST", `/api/posts/${other.body.id}/comments`, {
    token: alice.token,
    body: { content: "x", parent_id: c1.body.id },
  });
  assert.equal(wrongParent.status, 400);

  const notifications = await sql(
    `SELECT u.username, n.type FROM notifications n
     JOIN users u ON u.id = n.user_id ORDER BY n.id`
  );
  assert.deepEqual(notifications, [
    { username: "bob", type: "COMMENT" },
    { username: "bob", type: "COMMENT" },
    { username: "alice", type: "REPLY" },
  ]);

  const detail = await api("GET", `/api/posts/${postId}`, { token: alice.token });
  assert.equal(detail.body.comments.length, 3);
});

test("commentaires : modification et suppression", async () => {
  const [comment] = await sql("SELECT id FROM comments WHERE content = 'utilise grep -r'");

  assert.equal((await api("PUT", `/api/comments/${comment.id}`, { token: bob.token, body: { content: "x" } })).status, 403);

  const edited = await api("PUT", `/api/comments/${comment.id}`, {
    token: alice.token,
    body: { content: "utilise grep -rn" },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.content, "utilise grep -rn");

  assert.equal((await api("DELETE", `/api/comments/${comment.id}`, { token: bob.token })).status, 403);
  assert.equal((await api("DELETE", `/api/comments/${comment.id}`, { token: modo.token })).status, 200);

  // La réponse est supprimée avec son parent
  const remaining = await sql("SELECT content FROM comments WHERE content IN ('utilise grep -rn', 'et -i')");
  assert.equal(remaining.length, 0);
});

test("likes : bascule, compteur, requêtes simultanées", async () => {
  const post = await newPost(bob, { title: "Likes", content: "x" });
  const url = `/api/posts/${post.body.id}/like`;

  assert.deepEqual((await api("POST", url, { token: alice.token })).body, { liked: true, likes: 1 });
  assert.deepEqual((await api("POST", url, { token: modo.token })).body, { liked: true, likes: 2 });
  assert.deepEqual((await api("POST", url, { token: alice.token })).body, { liked: false, likes: 1 });

  const detail = await api("GET", `/api/posts/${post.body.id}`, { token: modo.token });
  assert.equal(detail.body.post.liked_by_me, true);

  const results = await Promise.all(
    Array.from({ length: 4 }, () => api("POST", url, { token: bob.token }))
  );
  assert.ok(results.every((r) => r.status === 200));

  assert.equal((await api("POST", "/api/posts/9999/like", { token: bob.token })).status, 404);
});

test("suppression de discussion : auteur ou modération", async () => {
  const post = await newPost(bob, { title: "À supprimer", content: "x" });

  assert.equal((await api("DELETE", `/api/posts/${post.body.id}`, { token: alice.token })).status, 403);
  assert.equal((await api("DELETE", `/api/posts/${post.body.id}`, { token: bob.token })).status, 200);
  assert.equal((await api("GET", `/api/posts/${post.body.id}`, { token: bob.token })).status, 404);

  const post2 = await newPost(bob, { title: "Spam", content: "x" });
  assert.equal((await api("DELETE", `/api/posts/${post2.body.id}`, { token: modo.token })).status, 200);
});

test("catégories : gestion réservée aux admins", async () => {
  const list = await api("GET", "/api/categories", { token: bob.token });
  assert.equal(list.body.length, 8);

  assert.equal((await api("POST", "/api/categories", { token: bob.token, body: { name: "X" } })).status, 403);

  const created = await api("POST", "/api/categories", { token: admin.token, body: { name: "Web" } });
  assert.equal(created.status, 201);

  assert.equal((await api("POST", "/api/categories", { token: admin.token, body: { name: "Linux" } })).status, 409);

  const renamed = await api("PUT", `/api/categories/${created.body.id}`, {
    token: admin.token,
    body: { name: "Sécurité Web" },
  });
  assert.equal(renamed.body.name, "Sécurité Web");

  const post = await newPost(bob, { title: "Web", content: "x", category_id: created.body.id });
  assert.equal((await api("DELETE", `/api/categories/${created.body.id}`, { token: admin.token })).status, 200);

  const after = await api("GET", `/api/posts/${post.body.id}`, { token: bob.token });
  assert.equal(after.body.post.category_id, null);
});
