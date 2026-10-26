const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { setup, teardown, api, createUser, sql } = require("./helpers");

let admin;
let bob;
let eve;
let groupId;

const filesOnDisk = () => fs.readdirSync(path.join(process.env.UPLOAD_DIR, "files"));

function message(token, { content, file, name = "note.txt", type = "text/plain" } = {}, id = groupId) {
  const form = new FormData();

  if (content !== undefined) {
    form.append("content", content);
  }

  if (file !== undefined) {
    form.append("file", new Blob([file], { type }), name);
  }

  return api("POST", `/api/groups/${id}/messages`, { token, form });
}

before(async () => {
  await setup();
  admin = await createUser("admin", "ADMIN");
  bob = await createUser("bob");
  eve = await createUser("eve");

  const group = await api("POST", "/api/groups", { token: admin.token, body: { name: "Privé" } });
  groupId = group.body.id;

  await api("POST", `/api/groups/${groupId}/members`, { token: admin.token, body: { user_id: bob.id } });
});

after(teardown);

test("non-membre : refusé avant que le fichier soit écrit", async () => {
  const res = await message(eve.token, { content: "x", file: "secret" });
  assert.equal(res.status, 403);
  assert.equal(filesOnDisk().length, 0);
});

test("pièce jointe : envoi et téléchargement par les membres", async () => {
  const res = await message(bob.token, { content: "Rapport", file: "contenu du rapport", name: "rapport.txt" });
  assert.equal(res.status, 201);
  assert.match(res.body.file_url, /^\/api\/files\/\d+$/);
  assert.equal(res.body.file_name, "rapport.txt");

  const download = await api("GET", res.body.file_url, { token: admin.token });
  assert.equal(download.status, 200);
  assert.equal(download.body, "contenu du rapport");
  assert.equal(download.headers.get("content-type"), "application/octet-stream");
  assert.match(download.headers.get("content-disposition"), /^attachment; filename="?rapport\.txt"?$/);
  assert.equal(download.headers.get("x-content-type-options"), "nosniff");

  assert.equal((await api("GET", res.body.file_url, { token: bob.token })).status, 200);

  // Non-membre et accès sans authentification
  assert.equal((await api("GET", res.body.file_url, { token: eve.token })).status, 404);
  assert.equal((await api("GET", res.body.file_url)).status, 401);

  // Le dossier des pièces jointes n'est pas servi publiquement
  const [stored] = filesOnDisk();
  assert.equal((await api("GET", `/uploads/files/${stored}`)).status, 404);
  assert.equal((await api("GET", `/uploads/${stored}`)).status, 404);
});

test("types et tailles refusés, rien ne reste sur le disque", async () => {
  const before = filesOnDisk().length;

  for (const name of ["page.html", "image.svg", "script.js", "programme.exe", "sans-extension"]) {
    const res = await message(bob.token, { file: "x", name });
    assert.equal(res.status, 400, name);
    assert.equal(res.body.message, "Type de fichier non autorisé");
  }

  const big = await message(bob.token, { file: Buffer.alloc(11 * 1024 * 1024), name: "gros.zip" });
  assert.equal(big.status, 400);
  assert.equal(big.body.message, "Fichier trop volumineux");

  const tooLong = await message(bob.token, { content: "a".repeat(5001), file: "x" });
  assert.equal(tooLong.status, 400);

  assert.equal((await message(bob.token, { content: "   " })).status, 400);

  assert.equal(filesOnDisk().length, before);
});

test("fichier isolé : visible par son déposant seulement", async () => {
  const form = new FormData();
  form.append("file", new Blob(["notes"], { type: "text/plain" }), "notes.md");

  const res = await api("POST", "/api/files", { token: eve.token, form });
  assert.equal(res.status, 201);
  assert.equal(res.body.url, `/api/files/${res.body.id}`);

  assert.equal((await api("GET", res.body.url, { token: eve.token })).status, 200);
  assert.equal((await api("GET", res.body.url, { token: bob.token })).status, 404);
  assert.equal((await api("GET", "/api/files/9999", { token: eve.token })).status, 404);

  const rejected = new FormData();
  rejected.append("file", new Blob(["<h1>x</h1>"]), "x.html");
  assert.equal((await api("POST", "/api/files", { token: eve.token, form: rejected })).status, 400);
});

test("pagination des messages : derniers, historique, nouveaux", async () => {
  const group = await api("POST", "/api/groups", { token: admin.token, body: { name: "Chat" } });
  const id = group.body.id;

  for (let i = 1; i <= 5; i++) {
    await api("POST", `/api/groups/${id}/messages`, { token: admin.token, body: { content: `m${i}` } });
  }

  const latest = await api("GET", `/api/groups/${id}/messages?limit=2`, { token: admin.token });
  assert.deepEqual(latest.body.map((m) => m.content), ["m4", "m5"]);

  const older = await api("GET", `/api/groups/${id}/messages?limit=2&before=${latest.body[0].id}`, { token: admin.token });
  assert.deepEqual(older.body.map((m) => m.content), ["m2", "m3"]);

  const newer = await api("GET", `/api/groups/${id}/messages?after=${older.body[0].id}`, { token: admin.token });
  assert.deepEqual(newer.body.map((m) => m.content), ["m3", "m4", "m5"]);

  const none = await api("GET", `/api/groups/${id}/messages?after=${latest.body[1].id}`, { token: admin.token });
  assert.deepEqual(none.body, []);
});

test("suppression d'un message : pièce jointe supprimée avec", async () => {
  const sent = await message(bob.token, { file: "à supprimer", name: "temp.txt" });
  const countBefore = filesOnDisk().length;

  const url = `/api/groups/${groupId}/messages/${sent.body.id}`;

  assert.equal((await api("DELETE", url, { token: eve.token })).status, 403);
  assert.equal((await api("DELETE", url, { token: bob.token })).status, 200);
  assert.equal((await api("DELETE", url, { token: bob.token })).status, 404);

  assert.equal((await api("GET", sent.body.file_url, { token: bob.token })).status, 404);
  assert.equal(filesOnDisk().length, countBefore - 1);
});

test("suppression du groupe : pièces jointes supprimées", async () => {
  const before = filesOnDisk().length;
  const linked = await sql("SELECT COUNT(*) AS n FROM group_messages WHERE group_id = $1 AND file_url IS NOT NULL", [groupId]);

  assert.equal((await api("DELETE", `/api/groups/${groupId}`, { token: admin.token })).status, 200);

  assert.equal(filesOnDisk().length, before - linked[0].n);
});
