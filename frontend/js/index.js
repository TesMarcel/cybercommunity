// Accueil : forum si connecté, sinon connexion
import { session } from "./api.js";

location.replace(session.token() ? "/pages/forum.html" : "/pages/login.html");
