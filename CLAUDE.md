# CLAUDE.md — Cyber Community

Communauté francophone cybersécurité / programmation / Linux / CTF : forum, groupes, messagerie, profils, notifications, modération.
Répondre et documenter **en français**.

## Stack réelle (à respecter)

- **Frontend** : HTML statique (`frontend/index.html`, `frontend/pages/*.html`) + JS vanilla en modules ES (`frontend/js/*.js`) + **une seule feuille** `frontend/css/main.css`. Pas de framework, pas de bundler, pas de préprocesseur CSS. N'en ajouter aucun.
- **Backend** : Express 5 + PostgreSQL (`backend/`), sert aussi le frontend. API documentée dans `docs/API.md`.
- **CSP stricte** (`backend/src/app.js`) : `default-src 'self'`. Conséquences :
  - aucun `style="…"`, aucun `<style>` inline, aucun `onclick=` inline ;
  - aucune police, CDN ou image externe → polices **système** ou fichiers servis depuis `frontend/` ;
  - ne jamais assouplir la CSP pour un besoin esthétique.
- Construction du DOM via `el()` de `frontend/js/ui.js` ; le contenu utilisateur est toujours inséré en **texte** (`textContent`), jamais en HTML.

## Direction artistique

Identité : **terminal sobre, outil pour praticiens**, avec une finition « vitrine » inspirée de safinum.cm (validée par l'utilisateur le 2026-10-28). Lisible, dense sans être chargé, crédible pour un public technique.

- **Deux thèmes**, sombre et clair, définis uniquement par les variables de `:root` (sombre) et `:root[data-theme="light"]` + `@media (prefers-color-scheme: light)` (clair ; ces deux blocs doivent rester identiques). Sans choix enregistré, le site suit le système ; le bouton `.theme-toggle` (`themeToggle()` de `js/ui.js`) mémorise le choix (`localStorage` `cc-theme`), appliqué avant affichage par `js/theme.js` (script classique dans `<head>` de chaque page).
- Une seule couleur d'accent (vert `--accent`), bleu réservé aux liens/focus, rouge/orange réservés aux états (danger, avertissement). Vérifier le contraste AA **dans les deux thèmes**.
- Titres (`h1`–`h3`) en Poppins (`--font-display`, servie depuis `frontend/fonts/`, licence OFL) ; monospace (`--mono`) pour la marque, les métadonnées techniques, les tags, les sur-titres ; sans-serif système (`--font`) pour le texte courant.
- Boutons en pastille (rayon 999px), cartes à `--radius-lg`, champs et petits éléments à `--radius` ; bordures fines plutôt qu'ombres.
- Pages de l'application compactes (pas de grands titres vitrine) ; le style vitrine complet (grille en fond, grand titre, sections, pied de page sombre) est réservé à l'accueil (`body.landing`).
- **Interdits** : dégradés colorés/néon, glassmorphism, `backdrop-filter`, ombres colorées, effets « glow », emojis décoratifs, illustrations génériques.

## Design system (`frontend/css/main.css`)

Toutes les valeurs passent par les variables de `:root`. Pas de couleur, taille ou durée en dur dans les règles.

| Famille | Variables |
|---|---|
| Couleurs | `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--accent-hover`, `--link`, `--danger`, `--warning` |
| Typo | `--font`, `--font-display`, `--mono` (échelle `rem` : 0.875 / 1 / 1.25 / 1.6) |
| Rayon | `--radius`, `--radius-lg` |
| États / fonds | `--on-color`, `--input-border`, `--error-bg`, `--success-bg`, `--highlight-bg`, `--backdrop`, `--grid-line` |
| Mouvement | `--duration`, `--ease` |

À introduire au besoin, en complétant `:root` plutôt qu'en dupliquant : `--space-1…6` (échelle 4 px), `--shadow-1/2` (profondeur : fond → surface → surface-2 → dialog).

- **Réutiliser** les fonctions de `js/ui.js` (`avatar()`, `timeAgo()`, `richText()` pour tout contenu saisi par un membre, `icon(ICONS.…)`) et les classes existantes avant d'en créer : `.page-head`, `.eyebrow`, `.card-head`, `.breadcrumb`, `.avatar-initial`, `.code-block`, `.empty-state`, `.card`, `.stack`, `.row`, `.page-title`, `.field`, `.hint`, `.button` / `.button-primary` / `.button-danger` / `.button-link` / `.button-small`, `.alert-error` / `.alert-success`, `.loading`, `.empty`, `.tag`, `.meta`, `.badge`, `.pagination`, `.sr-only`, `.hidden`.
- Garder la structure du fichier par sections commentées (`/* ---------- Section ---------- */`) ; ajouter une section par composant/page.
- En-tête (`.site-header`, généré par `js/layout.js`) et pied de page identiques sur toutes les pages.

## Qualité frontend — exigences

- **Responsive** mobile-first : vérifier ~375 px, ~768 px, ≥ 1280 px. Aucun défilement horizontal. Cibles tactiles ≥ 44 px sur mobile.
- **États** pour chaque vue chargée par l'API : chargement (`showLoading`), vide (`showEmpty`), erreur (`showMessage(…, "error")`), succès (`showMessage(…, "success")`), désactivé (`busy()` sur les boutons pendant une requête). Ne jamais laisser une zone blanche silencieuse.
- **Accessibilité** : contraste WCAG AA (4.5:1 texte, 3:1 composants), `:focus-visible` toujours visible, tout opérable au clavier, `label` associé à chaque champ, `aria-live` pour les messages, `aria-current`, `aria-expanded`, `aria-invalid` cohérents. `lang="fr"` sur chaque page.
- **Animations** : courtes (≤ 200 ms), fonctionnelles (feedback, apparition), uniquement `opacity`/`transform`. Tout envelopper dans un bloc `@media (prefers-reduced-motion: reduce)` qui les neutralise.
- **Ne rien casser** : ne pas renommer les `id`, classes ou attributs utilisés par `frontend/js/*.js` ou par `backend/test-e2e/*` sans mettre à jour ces fichiers. Ne pas toucher aux routes API, à l'authentification (JWT) ni au schéma SQL pour une tâche de design.

## Méthode de travail

1. Examiner le code concerné (HTML + JS + CSS de la page) avant de modifier.
2. Énoncer la direction choisie et la liste des fichiers touchés, puis proposer un plan court.
3. Implémenter par petites étapes ; une branche par étape (`etape-N-…`), merge sur `main` uniquement à la demande.
4. Vérifier (depuis `backend/`) :
   - `npm test` — tests API (base `_test`) ;
   - `npm run test:e2e` — scénarios Firefox (puppeteer-core), produit des captures d'écran ;
   - lancer l'app (`npm start`, http://localhost:5000) et contrôler visuellement les pages modifiées aux trois largeurs si un navigateur est accessible.
5. Corriger les défauts visuels constatés avant de conclure.
6. Rapporter honnêtement : ne jamais annoncer une vérification non effectuée ; citer les échecs avec leur sortie.
7. Mettre à jour `PROGRESS.md` après chaque tâche.

Ne pas réécrire l'application pour changer son apparence : faire évoluer `main.css` et le balisage existant.
