// Accueil : présentation publique ; un membre connecté va directement au forum
import { session } from "./api.js";

if (session.token()) {
  location.replace("/pages/forum.html");
}
