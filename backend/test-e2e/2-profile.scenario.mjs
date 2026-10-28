// Scénario navigateur : profil et notifications
import { writeFileSync } from "node:fs";

export default async function (t) {
  const { page, check, text, waitText, clickText } = t;

  const tess = await t.register("tess");
  const bob = await t.register("bob");
  await t.sql("UPDATE users SET role = 'MODERATOR' WHERE username = 'tess'");

  await t.login("tess");

  // Mon profil
  await page.goto(t.BASE + "/pages/profile.html");
  await waitText("#profile h1", "tess");
  check("mon profil : email visible", (await text(".details"))?.includes("tess@test.fr"));
  check("mon profil : onglet Aperçu ouvert par défaut", (await page.$("#panel-edit.hidden")) !== null && (await page.$("#panel-overview:not(.hidden)")) !== null);
  await page.click("#tab-edit");
  await page.waitForSelector("#panel-edit:not(.hidden)");
  await page.type("#f-pseudonym", "Tess");
  await page.type("#f-skills", "Linux, Python");
  await page.type("#f-biography", "Analyste SOC.\n<b>pas du gras</b>");
  await clickText("#profile form button", "Enregistrer");
  await waitText("#message", "Profil enregistré");
  check("profil enregistré et affiché", (await text(".details"))?.includes("Linux, Python"));
  check("biographie affichée comme texte", (await page.$$("#profile .content b")).length === 0);
  check("après enregistrement : retour à l'aperçu", (await page.$("#panel-overview:not(.hidden)")) !== null);
  check("compétences en étiquettes", (await page.$$(".skill-list li")).length === 2);

  // Photo : refus d'un faux fichier puis envoi d'une vraie image
  writeFileSync(`${t.SHOTS}/faux.png`, "<html>pas une image</html>");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC", "base64");
  writeFileSync(`${t.SHOTS}/ok.png`, png);
  await page.click("#tab-photo");
  const input = await page.$("#photo");
  await input.uploadFile(`${t.SHOTS}/faux.png`);
  await clickText("#profile form button", "Envoyer la photo");
  await waitText("#profile form", "Format non autorisé");
  check("photo : faux PNG refusé avec message", true);
  await (await page.$("#photo")).uploadFile(`${t.SHOTS}/ok.png`);
  await clickText("#profile form button", "Envoyer la photo");
  await waitText("#message", "Photo mise à jour");
  const loaded = await page.$eval("img.avatar", (img) => img.complete && img.naturalWidth > 0).catch(() => false);
  check("photo affichée", loaded);

  // Mot de passe : erreurs puis succès, la session continue
  await page.click("#tab-security");
  await page.waitForSelector("#panel-security:not(.hidden)");
  await page.type("#current", "motdepasse1");
  await page.type("#next", "court");
  await page.type("#confirm", "court");
  await clickText("#profile form button", "Changer le mot de passe");
  await waitText("#profile form", "au moins 8");
  await page.$eval("#next", (n) => (n.value = "nouveaumdp1"));
  await page.$eval("#confirm", (n) => (n.value = "nouveaumdp1"));
  await clickText("#profile form button", "Changer le mot de passe");
  await waitText("#profile form", "Mot de passe modifié");
  await page.reload();
  await waitText("#profile h1", "tess");
  check("mot de passe changé, session conservée", true);
  await page.screenshot({ path: `${t.SHOTS}/4-profil.png`, fullPage: true });

  // Profil d'un autre : pas d'email, pas de formulaire, actions de modération
  await page.goto(t.BASE + `/pages/profile.html?id=${bob.user.id}`);
  await waitText("#profile h1", "bob");
  check("autre profil : email masqué", !(await text(".details"))?.includes("@"));
  check("autre profil : pas de formulaire d'édition", (await page.$$("#profile form")).length === 0);
  page.on("dialog", () => {});
  await clickText("#profile button", "Suspendre le compte");
  await waitText("#profile", "Suspendu");
  check("modérateur : suspension depuis le profil", true);
  await clickText("#profile button", "Réactiver le compte");
  await waitText("#profile button", "Suspendre le compte");
  check("modérateur : réactivation", true);

  await page.goto(t.BASE + "/pages/profile.html?id=9999");
  await waitText("#message", "n'existe pas");
  check("profil inexistant : message clair", true);

  // Notifications : bob commente un post de tess
  const oldToken = await t.apiCall("GET", "/api/auth/me", null, tess.token);
  check("ancien token invalidé après changement de mot de passe", oldToken.status === 401, oldToken.status);
  const currentToken = await page.evaluate(() => localStorage.getItem("cybercom_token"));
  const post = await t.apiCall("POST", "/api/posts", { title: "Sujet", content: "x" }, currentToken);
  for (let i = 0; i < 3; i++) {
    await t.apiCall("POST", `/api/posts/${post.body.id}/comments`, { content: `c${i}` }, bob.token);
  }
  // Ancien token de tess invalidé par le changement de mot de passe : celui de la page est valide
  await page.goto(t.BASE + "/pages/notifications.html");
  await waitText("#notif-badge", "3");
  check("badge : 3 non lues", true);
  await waitText("#notifications", "a commenté votre discussion");
  check("notifications listées", (await page.$$("#notifications li")).length === 3);
  check("notifications regroupées : « Aujourd'hui »", (await text("#notifications .notif-group h2")) === "Aujourd'hui");
  check("notifications : une icône par notification", (await page.$$("#notifications .notif-icon svg")).length === 3);
  check("notifications : résumé des non lues", (await text("#unread-summary"))?.includes("3 notifications non lues"), await text("#unread-summary"));

  await clickText("#notifications button", "Marquer comme lue");
  await page.waitForFunction(() => document.getElementById("notif-badge").textContent === "2");
  check("marquer une notification comme lue : badge à jour", true);

  await page.click("#unread-only");
  await page.waitForFunction(() => document.querySelectorAll("#notifications li.unread").length === 2 && document.querySelectorAll("#notifications li").length === 2);
  check("filtre non lues", true);

  await page.click("#read-all");
  await waitText("#notifications", "Aucune notification non lue");
  await page.waitForFunction(() => document.getElementById("notif-badge").classList.contains("hidden"));
  check("tout marquer comme lu : badge masqué", true);

  await page.click("#unread-only");
  await page.waitForFunction(() => document.querySelectorAll("#notifications li").length === 3);
  await clickText("#notifications button", "Supprimer");
  await page.waitForFunction(() => document.querySelectorAll("#notifications li").length === 2);
  check("suppression d'une notification", true);
  await page.screenshot({ path: `${t.SHOTS}/5-notifications.png`, fullPage: true });

  // Liens auteur dans le forum
  await page.goto(t.BASE + `/pages/post.html?id=${post.body.id}`);
  await waitText("#comments", "c0");
  const href = await page.$eval("#comments a", (a) => a.getAttribute("href"));
  check("lien vers le profil de l'auteur du commentaire", href === `/pages/profile.html?id=${bob.user.id}`, href);

  // Compte suspendu : message clair
  await t.sql(`UPDATE users SET is_active = FALSE WHERE username = 'tess'`);
  await page.goto(t.BASE + "/pages/forum.html");
  await waitText("main", "Compte suspendu");
  check("compte suspendu : message au lieu d'une page vide", true);

  await page.setViewport({ width: 375, height: 760 });
  await t.sql(`UPDATE users SET is_active = TRUE WHERE username = 'tess'`);
  await t.login("tess", "nouveaumdp1");
  await page.goto(t.BASE + "/pages/profile.html");
  await waitText("#profile h1", "tess");
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("profil mobile : pas de défilement horizontal", overflow <= 0, `${overflow}px`);
}
