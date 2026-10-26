// Scénario navigateur : modération
export default async function (t) {
  const { page, check, text, waitText, clickText } = t;

  const admin = await t.register("admin");
  const modo = await t.register("modo");
  const bob = await t.register("bob");
  const eve = await t.register("eve");
  await t.sql("UPDATE users SET role = 'ADMIN' WHERE username = 'admin'");
  await t.sql("UPDATE users SET role = 'MODERATOR' WHERE username = 'modo'");

  // Contenus d'eve signalés par bob
  const post = await t.apiCall("POST", "/api/posts", { title: "Achetez maintenant", content: "spam" }, eve.token);
  const comment = await t.apiCall("POST", `/api/posts/${post.body.id}/comments`, { content: "lien douteux" }, eve.token);
  await t.apiCall("POST", "/api/reports", { target_type: "POST", target_id: post.body.id, reason: "Spam ou publicité" }, bob.token);
  await t.apiCall("POST", "/api/reports", { target_type: "COMMENT", target_id: comment.body.id, reason: "Spam ou publicité", details: "phishing" }, bob.token);

  // Membre simple : accès refusé, pas de lien dans le menu
  await t.login("bob");
  check("membre : pas de lien Modération", !(await text(".nav"))?.includes("Modération"));
  await page.goto(t.BASE + "/pages/moderation.html");
  await waitText("main", "Accès réservé");
  check("membre : page de modération refusée", true);

  // Modérateur
  await t.login("modo");
  await page.goto(t.BASE + "/pages/moderation.html");
  await waitText("#reports", "Achetez maintenant");
  check("signalements en attente avec aperçu", (await text("#reports")).includes("lien douteux"));
  check("catégories cachées au modérateur", await page.$eval("#categories-section", (n) => n.classList.contains("hidden")));
  await page.screenshot({ path: `${t.SHOTS}/8-moderation.png`, fullPage: true });

  // Lien vers le commentaire dans sa discussion
  const href = await page.evaluate(() => [...document.querySelectorAll("#reports a")].find((a) => a.textContent === "lien douteux").getAttribute("href"));
  check("lien du commentaire vers sa discussion", href === `/pages/post.html?id=${post.body.id}#comment-${comment.body.id}`, href);
  await page.goto(t.BASE + href);
  await page.waitForSelector(".comment.highlight");
  check("commentaire mis en évidence à l'ouverture", true);

  // Supprimer le commentaire depuis la modération -> signalement résolu
  await page.goto(t.BASE + "/pages/moderation.html");
  await waitText("#reports", "lien douteux");
  await page.evaluate(() => {
    const item = [...document.querySelectorAll("#reports li")].find((li) => li.textContent.includes("lien douteux"));
    [...item.querySelectorAll("button")].find((b) => b.textContent === "Supprimer le contenu").click();
  });
  await page.waitForFunction(() => !document.querySelector("#reports").textContent.includes("lien douteux"));
  check("contenu supprimé et signalement retiré des « en attente »", await t.sql(`SELECT COUNT(*) FROM comments WHERE id = ${comment.body.id}`) === "0");

  await page.select("#report-status", "RESOLVED");
  await waitText("#reports", "Élément déjà supprimé");
  check("signalement résolu, élément marqué supprimé", (await text("#reports")).includes("traité par modo"));

  // Rejeter l'autre signalement
  await page.select("#report-status", "PENDING");
  await waitText("#reports", "Achetez maintenant");
  await clickText("#reports button", "Marquer rejeté");
  await waitText("#reports", "Aucun signalement en attente");
  check("signalement rejeté", true);
  check("bob notifié du traitement", await t.sql(`SELECT COUNT(*) FROM notifications WHERE user_id = ${bob.user.id} AND type = 'REPORT_UPDATE'`) === "2");

  // Utilisateurs : suspendre eve ; pas d'action sur l'admin ni sur soi
  await page.type("#users-q", "eve");
  await clickText("#users-search button", "Rechercher");
  await waitText("#users", "eve");
  await clickText("#users button", "Suspendre");
  await waitText("#users", "Suspendu");
  check("modérateur : suspension d'un membre", true);
  await page.$eval("#users-q", (n) => (n.value = ""));
  await clickText("#users-search button", "Rechercher");
  await waitText("#users", "admin");
  const adminRow = await page.evaluate(() => [...document.querySelectorAll("#users li")].find((li) => li.querySelector("a").textContent === "admin").querySelectorAll("button, select").length);
  check("modérateur : aucune action sur un admin", adminRow === 0, adminRow);
  check("modérateur : pas de sélecteur de rôle", (await page.$$("#users select")).length === 0);

  // Admin : rôles et catégories
  await t.login("admin");
  await page.goto(t.BASE + "/pages/moderation.html");
  await waitText("#categories", "Linux");
  check("admin : catégories visibles", true);
  await page.type("#category-name", "Sécurité Web");
  await clickText("#category-form button", "Ajouter");
  await waitText("#categories", "Sécurité Web");
  check("admin : catégorie ajoutée", true);
  await page.type("#category-name", "Linux");
  await clickText("#category-form button", "Ajouter");
  await waitText("#message", "existe déjà");
  check("admin : doublon de catégorie signalé", true);

  await waitText("#users", "bob");
  await page.evaluate(() => {
    const select = [...document.querySelectorAll("#users li")].find((li) => li.querySelector("a").textContent === "bob").querySelector("select");
    select.value = "MODERATOR";
    select.dispatchEvent(new Event("change"));
  });
  await page.waitForFunction(() => [...document.querySelectorAll("#users li")].find((li) => li.querySelector("a").textContent === "bob")?.querySelector(".tag").textContent === "Modérateur");
  const role = await t.sql("SELECT role FROM users WHERE username = 'bob'");
  check("admin : bob promu modérateur", role === "MODERATOR", role);

  await page.setViewport({ width: 375, height: 760 });
  await page.reload();
  await waitText("#users", "bob");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("modération mobile : pas de défilement horizontal", overflow <= 0, `${overflow}px`);
}
