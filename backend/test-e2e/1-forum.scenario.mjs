// Scénario navigateur : connexion, inscription, forum
export default async function (t) {
  const { page, check, text, waitText, clickText } = t;

  // 1. Accueil non connecté : présentation de la communauté
  await page.goto(t.BASE + "/");
  await waitText("#hero-title", "cybersécurité");
  check("accueil non connecté → présentation de la communauté", (await page.evaluate(() => location.pathname)) === "/");
  check("accueil : lien d'inscription", (await page.$("a.button-primary[href='/pages/register.html']")) !== null);
  await page.screenshot({ path: `${t.SHOTS}/0-accueil.png`, fullPage: true });

  // 2. Inscription : erreurs puis succès
  await page.goto(t.BASE + "/pages/register.html");
  await page.type("#username", "tess");
  await page.type("#email", "tess@test.fr");
  await page.type("#country", "Bénin");
  await page.type("#password", "court");
  await page.type("#confirm", "court");
  await page.click("button[type=submit]");
  await waitText("#message", "Vérifiez");
  check("inscription : mot de passe trop court signalé", true);

  await page.$eval("#password", (n) => (n.value = ""));
  await page.$eval("#confirm", (n) => (n.value = ""));
  await page.type("#password", "motdepasse1");
  await page.type("#confirm", "autrechose1");
  await page.click("button[type=submit]");
  await waitText("#message", "ne correspondent pas");
  check("inscription : confirmation différente signalée", true);

  await page.$eval("#confirm", (n) => (n.value = ""));
  await page.type("#confirm", "motdepasse1");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => location.pathname === "/pages/forum.html");
  await waitText(".nav", "Déconnexion");
  check("inscription réussie → forum avec navigation", true);

  await page.goto(t.BASE + "/");
  await page.waitForFunction(() => location.pathname === "/pages/forum.html");
  check("accueil connecté → forum", true);

  await waitText("#posts", "Aucune discussion");
  check("forum vide : message d'état vide", true);
  await page.screenshot({ path: `${t.SHOTS}/1-forum-vide.png` });

  // 3. Nouvelle discussion avec contenu piégé (XSS)
  await page.click("#new-post-toggle");
  await page.click("#new-post-form button[type=submit]");
  await waitText("#new-post-message", "obligatoires");
  check("nouvelle discussion : champs vides refusés", true);

  const evil = '<img src=x onerror=alert(1)> Titre piégé';
  await page.type("#title", evil);
  await page.select("#category", "3");
  await page.type("#content", "Ligne 1\n<script>alert(2)</script>\nLigne 3");
  await page.click("#new-post-form button[type=submit]");
  await page.waitForFunction(() => location.pathname === "/pages/post.html");
  await waitText("#post h1", "Titre piégé");
  check("discussion créée et affichée", true);
  check("XSS : titre affiché comme texte", (await text("#post h1")) === evil, await text("#post h1"));
  check("XSS : aucune balise <img>/<script> injectée", (await page.$$("#post img, #post script")).length === 0);

  // 4. Like
  await page.click(".like-button");
  await waitText(".like-button", "1 j'aime");
  const pressed = await page.$eval(".like-button", (n) => n.getAttribute("aria-pressed"));
  check("like : compteur et état aria-pressed", pressed === "true", pressed);
  await page.click(".like-button");
  await waitText(".like-button", "0 j'aime");
  check("like retiré", true);

  // 5. Commentaires : vide, ajout, réponse, modification
  await waitText("#comments", "Aucun commentaire");
  await page.type("#comment-content", "Premier commentaire");
  await page.click("#comment-form button");
  await waitText("#comments", "Premier commentaire");
  check("commentaire ajouté", true);

  await page.evaluate(() => [...document.querySelectorAll(".comment-actions button")].find((b) => b.textContent === "Répondre").click());
  await page.type(".comment form textarea", "Une réponse");
  await page.click(".comment form button[type=submit]");
  await waitText(".comment .comment", "Une réponse");
  check("réponse imbriquée sous le commentaire", true);
  await waitText("#comments-title", "2 commentaires");

  await page.evaluate(() => [...document.querySelectorAll(".comment-actions button")].find((b) => b.textContent === "Modifier").click());
  await page.$eval(".comment form textarea", (n) => (n.value = ""));
  await page.type(".comment form textarea", "Commentaire modifié");
  await page.click(".comment form button[type=submit]");
  await waitText("#comments", "Commentaire modifié");
  check("commentaire modifié", true);
  await page.screenshot({ path: `${t.SHOTS}/2-discussion.png`, fullPage: true });

  // 6. Modification de la discussion
  await page.evaluate(() => [...document.querySelectorAll("#post button")].find((b) => b.textContent === "Modifier").click());
  await page.waitForSelector("#edit-title");
  await page.$eval("#edit-title", (n) => (n.value = ""));
  await page.type("#edit-title", "Titre corrigé");
  await page.click("#post form button[type=submit]");
  await waitText("#post h1", "Titre corrigé");
  check("discussion modifiée", (await text("#post .meta"))?.includes("modifié"), await text("#post .meta"));

  // 7. Liste, recherche, filtre
  await page.goto(t.BASE + "/pages/forum.html");
  await waitText("#posts", "Titre corrigé");
  check("liste : discussion présente avec compteurs", (await text("#posts .meta"))?.includes("2 commentaires"), await text("#posts .meta"));

  // Thème : le bouton bascule, le choix survit au rechargement
  const theme = () => page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);
  const before = await theme();
  await page.click(".theme-toggle");
  const after = await theme();
  check("thème : le bouton bascule clair/sombre", before !== after, `${before} → ${after}`);
  await page.screenshot({ path: `${t.SHOTS}/1-forum-${after}.png` });
  await page.reload();
  await waitText("#posts", "Titre corrigé");
  check("thème : choix conservé après rechargement", (await theme()) === after);
  await page.click(".theme-toggle");
  check("thème : retour au thème initial", (await theme()) === before);
  await page.screenshot({ path: `${t.SHOTS}/1-forum-${before}.png` });

  await page.type("#q", "introuvable-xyz");
  await page.click("#filters button");
  await waitText("#posts", "Aucune discussion ne correspond");
  check("recherche sans résultat : message adapté", true);
  check("filtres reflétés dans l'adresse", page.url().includes("q=introuvable-xyz"), page.url());

  await page.$eval("#q", (n) => (n.value = ""));
  await page.select("#filter-category", "3");
  await waitText("#posts", "Titre corrigé");
  check("filtre par catégorie", true);

  // 8. Déconnexion / reconnexion avec retour à la page demandée
  await page.evaluate(() => [...document.querySelectorAll(".nav button")].find((b) => b.textContent === "Déconnexion").click());
  await page.waitForFunction(() => location.pathname === "/pages/login.html");
  await page.goto(t.BASE + "/pages/post.html?id=1");
  await page.waitForFunction(() => location.pathname === "/pages/login.html" && location.search.includes("next="));
  check("page protégée → connexion avec ?next", true);

  await page.type("#login", "tess");
  await page.type("#password", "mauvais123");
  await page.click("button[type=submit]");
  await waitText("#message", "Identifiants incorrects");
  check("connexion : mauvais mot de passe signalé", true);

  await page.$eval("#password", (n) => (n.value = ""));
  await page.type("#password", "motdepasse1");
  await page.click("button[type=submit]");
  await page.waitForFunction(() => location.pathname === "/pages/post.html");
  check("connexion → retour à la discussion demandée", true);

  // 9. Discussion inexistante
  await page.goto(t.BASE + "/pages/post.html?id=9999");
  await waitText("#message", "n'existe pas");
  check("discussion inexistante : message clair", true);

  // 10. Signalement d'un contenu d'un autre (via API pour créer l'autre compte)
  const other = await page.evaluate(async () => {
    const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "bob", email: "bob@test.fr", password: "motdepasse1", country: "Togo" }) });
    const { token } = await r.json();
    const p = await fetch("/api/posts", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ title: "Post de bob", content: "contenu" }) });
    return (await p.json()).id;
  });
  await page.goto(t.BASE + `/pages/post.html?id=${other}`);
  await waitText("#post h1", "Post de bob");
  check("pas de bouton Modifier/Supprimer sur le contenu d'un autre",
    await page.evaluate(() => ![...document.querySelectorAll("#post button")].some((b) => ["Modifier", "Supprimer"].includes(b.textContent))));
  await page.evaluate(() => [...document.querySelectorAll("#post button")].find((b) => b.textContent === "Signaler").click());
  await page.waitForSelector("dialog[open]");
  await page.click("dialog button[type=submit]");
  await waitText("dialog", "Signalement envoyé");
  check("signalement envoyé depuis la boîte de dialogue", true);

  // 11. Mobile
  await page.setViewport({ width: 375, height: 760 });
  await page.goto(t.BASE + "/pages/forum.html");
  await waitText("#posts", "Post de bob");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("mobile 375px : pas de défilement horizontal", overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: `${t.SHOTS}/3-forum-mobile.png`, fullPage: true });
}
