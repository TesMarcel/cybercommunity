// Scénario navigateur : groupes, discussions, messagerie, membres
import { writeFileSync } from "node:fs";

export default async function (t) {
  const { page, check, text, waitText, clickText } = t;

  const admin = await t.register("admin");
  await t.register("bob");
  await t.sql("UPDATE users SET role = 'ADMIN' WHERE username = 'admin'");

  // --- Admin : création d'un groupe privé et d'un groupe public
  await t.login("admin");
  await page.goto(t.BASE + "/pages/groups.html");
  await waitText("#groups", "Aucun groupe");
  check("liste vide pour l'admin : invitation à créer", true);
  await page.click("#new-group-toggle");
  await page.type("#name", "Red Team");
  await page.type("#description", "Exercices offensifs");
  await page.click("#new-group-form button[type=submit]");
  await page.waitForFunction(() => location.pathname === "/pages/group.html");
  await waitText("#group-head h1", "Red Team");
  check("groupe privé créé → page du groupe", (await text("#group-head .meta"))?.includes("Privé"));
  const privateUrl = page.url();

  await page.goto(t.BASE + "/pages/groups.html");
  await page.click("#new-group-toggle");
  await page.type("#name", "Débutants");
  await page.click("#is_private");
  await page.click("#new-group-form button[type=submit]");
  await waitText("#group-head h1", "Débutants");
  check("groupe public créé", (await text("#group-head .meta"))?.includes("Public"));

  // --- Bob : ne voit que le public, le rejoint
  await t.login("bob");
  await page.goto(t.BASE + "/pages/groups.html");
  await waitText("#groups", "Débutants");
  check("bob : le groupe privé est invisible", !(await text("#groups")).includes("Red Team"));
  check("pas de bouton de création pour un membre", await page.$eval("#new-group-toggle", (b) => b.classList.contains("hidden")));
  await clickText("#groups button", "Rejoindre");
  await page.waitForFunction(() => location.pathname === "/pages/group.html");
  await waitText("#group-head", "Vous : Membre");
  check("bob rejoint le groupe public", true);

  await page.goto(privateUrl);
  await waitText("#message", "privé");
  check("accès direct au groupe privé : refusé avec message", true);

  // --- Admin ajoute bob au groupe privé via la recherche
  await t.login("admin");
  await page.goto(privateUrl);
  await waitText("#group-head h1", "Red Team");
  await page.click("#tab-members");
  await page.waitForSelector("#member-search");
  await page.type("#member-search", "bo");
  await clickText("#panel-members form button", "Rechercher");
  await waitText("#panel-members", "bob");
  await clickText("#panel-members button", "Ajouter");
  await waitText("#panel-members .card h2", "2 membres");
  check("ajout de bob par recherche", true);

  // --- Bob : discussions, commentaires, chat
  await t.login("bob");
  await page.goto(privateUrl);
  await waitText("#group-head", "Vous : Membre");
  await page.waitForSelector("#gp-title");
  await page.type("#gp-title", "Plan d'attaque");
  await page.type("#gp-content", "Étape 1 : reconnaissance");
  await clickText("#panel-posts button", "Publier");
  await waitText("#panel-posts h2", "Plan d'attaque");
  check("discussion de groupe créée", true);
  await page.type("#panel-posts .card textarea", "Premier commentaire");
  await clickText("#panel-posts .card button", "Envoyer");
  await waitText("#panel-posts .comments", "Premier commentaire");
  await clickText("#panel-posts .comments button", "Répondre");
  await page.type("#panel-posts .comment form textarea", "Réponse");
  await clickText("#panel-posts .comment form button", "Envoyer");
  await waitText("#panel-posts .comment .comment", "Réponse");
  check("commentaire et réponse dans le groupe", true);

  await page.click("#tab-messages");
  await waitText("#panel-messages", "Aucun message");
  await page.type("#chat-content", "Salut l'équipe");
  await page.keyboard.press("Enter");
  await waitText(".chat", "Salut l'équipe");
  check("message envoyé avec Entrée", true);

  writeFileSync(`${t.SHOTS}/rapport.txt`, "contenu du rapport");
  writeFileSync(`${t.SHOTS}/page.html`, "<script>alert(1)</script>");
  await (await page.$("#chat-file")).uploadFile(`${t.SHOTS}/page.html`);
  await clickText("#panel-messages button", "Envoyer");
  await waitText("#panel-messages form", "Type de fichier non autorisé");
  check("pièce jointe HTML refusée avec message", true);

  await (await page.$("#chat-file")).uploadFile(`${t.SHOTS}/rapport.txt`);
  await waitText(".chat-file-info", "rapport.txt");
  check("fichier choisi affiché avant l'envoi", true);
  await clickText("#panel-messages button", "Envoyer");
  await waitText(".chat", "rapport.txt");
  check("pièce jointe envoyée et affichée", true);
  check("messagerie : mes messages en bulles à droite", (await page.$$(".chat-message.mine")).length === 2);
  check("messagerie : messages consécutifs regroupés", (await page.$$(".chat-message.mine.continued")).length === 1);
  check("messagerie : séparateur « Aujourd'hui »", (await text(".chat-day"))?.includes("Aujourd'hui"));
  check("messagerie : barre d'envoi vidée", await page.$eval(".chat-file-info", (n) => n.classList.contains("hidden")));
  await page.screenshot({ path: `${t.SHOTS}/6-chat-bulles.png` });

  // Téléchargement authentifié : même requête que le bouton
  const content = await page.evaluate(async () => {
    const url = [...document.querySelectorAll(".chat-message")].pop() && (await (await fetch(`/api/groups/${new URLSearchParams(location.search).get("id")}/messages`, { headers: { Authorization: `Bearer ${localStorage.getItem("cybercom_token")}` } })).json()).find((m) => m.file_url).file_url;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${localStorage.getItem("cybercom_token")}` } });
    return r.text();
  });
  check("pièce jointe téléchargeable par un membre", content === "contenu du rapport", content);

  // Message d'un autre membre reçu sans recharger (rafraîchissement 5 s)
  const groupId = new URL(privateUrl).searchParams.get("id");
  await t.apiCall("POST", `/api/groups/${groupId}/messages`, { content: "Bien reçu, bob" }, admin.token);
  await waitText(".chat", "Bien reçu, bob", 12000);
  check("message d'admin reçu automatiquement", true);
  await page.screenshot({ path: `${t.SHOTS}/6-chat.png`, fullPage: true });

  // --- Admin : nomme bob admin du groupe
  await t.login("admin");
  await page.goto(privateUrl);
  await page.click("#tab-members");
  await waitText("#panel-members", "bob");
  await clickText("#panel-members button", "Nommer admin");
  await page.waitForFunction(() => document.querySelectorAll("#panel-members .tag").length === 2 && [...document.querySelectorAll("#panel-members .tag")].every((n) => n.textContent === "Admin du groupe"));
  check("bob nommé admin du groupe", true);

  // --- Bob voit les actions d'admin, quitte le groupe public
  await t.login("bob");
  await page.goto(privateUrl);
  await waitText("#group-head", "Vous : Admin du groupe");
  check("bob voit « Modifier » et « Supprimer le groupe »", (await text("#group-head")).includes("Supprimer le groupe"));

  await page.goto(t.BASE + "/pages/groups.html");
  await waitText("#groups", "Débutants");
  await page.evaluate(() => [...document.querySelectorAll("#groups a")].find((a) => a.textContent === "Débutants").click());
  await waitText("#group-head h1", "Débutants");
  await clickText("#group-head button", "Quitter le groupe");
  await page.waitForFunction(() => location.pathname === "/pages/groups.html");
  await waitText("#groups", "Non membre");
  check("bob quitte le groupe public", true);

  await page.click("#group-filter button[data-filter='mine']");
  check("filtre « Mes groupes »", (await text("#groups")).includes("Red Team") && !(await text("#groups")).includes("Débutants"));
  await page.click("#group-filter button[data-filter='all']");
  await page.screenshot({ path: `${t.SHOTS}/7-groupes-grille.png` });

  // Mobile
  await page.setViewport({ width: 375, height: 760 });
  await page.goto(privateUrl);
  await page.click("#tab-messages");
  await waitText(".chat", "Bien reçu");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("groupe mobile : pas de défilement horizontal", overflow <= 0, `${overflow}px`);
  await page.screenshot({ path: `${t.SHOTS}/7-groupe-mobile.png`, fullPage: true });

  // Suppression du groupe par l'admin
  await page.setViewport({ width: 1200, height: 900 });
  await t.login("admin");
  await page.goto(privateUrl);
  await waitText("#group-head", "Supprimer le groupe");
  await clickText("#group-head button", "Supprimer le groupe");
  await page.waitForFunction(() => location.pathname === "/pages/groups.html");
  await waitText("#groups", "Débutants");
  check("groupe supprimé", !(await text("#groups")).includes("Red Team"));
}
