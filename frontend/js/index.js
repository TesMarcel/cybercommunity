// Accueil : présentation publique ; un membre connecté va directement au forum
import { session } from "./api.js";
import { themeToggle } from "./ui.js";

if (session.token()) {
  location.replace("/pages/forum.html");
} else {
  document.querySelector(".site-header .row").prepend(themeToggle());
}
