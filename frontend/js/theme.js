// Thème choisi par le membre, appliqué avant l'affichage pour éviter un flash.
// Script classique (pas un module) chargé dans <head> de chaque page.
// Sans choix enregistré, le CSS suit le réglage clair/sombre du système.
(function () {
  try {
    const theme = localStorage.getItem("cc-theme");

    if (theme === "light" || theme === "dark") {
      document.documentElement.dataset.theme = theme;
    }
  } catch {
    // Stockage indisponible (navigation privée) : thème du système
  }
})();
