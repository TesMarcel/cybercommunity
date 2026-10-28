// Accueil : présentation publique, affichée à tous.
// Un membre connecté voit des liens vers son tableau de bord à la place
// des boutons de connexion et d'inscription.
import { session } from "./api.js";
import { el, themeToggle } from "./ui.js";

const actions = document.querySelector(".site-header .row");

if (session.token()) {
  actions.replaceChildren(
    el("a", { class: "button button-primary button-pill", href: "/pages/dashboard.html" }, "Mon tableau de bord")
  );

  for (const link of document.querySelectorAll("[data-member-link]")) {
    link.href = "/pages/dashboard.html";
    // Seul le texte change : l'icône flèche est conservée
    link.firstChild.textContent = `${link.dataset.memberLink} `;
  }

  for (const node of document.querySelectorAll("[data-guest-only]")) {
    node.remove();
  }
}

actions.prepend(themeToggle());
