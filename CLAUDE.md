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

Identité : **terminal sobre, outil pour praticiens**. Lisible, dense sans être chargé, crédible pour un public technique.

- Fond sombre neutre, une seule couleur d'accent (vert terminal `--accent`), bleu réservé aux liens/focus, rouge/orange réservés aux états (danger, avertissement).
- Monospace (`--mono`) pour la marque, les métadonnées techniques, les tags, le code ; sans-serif système (`--font`) pour le texte courant.
- Hiérarchie par la taille, la graisse et l'espacement, pas par la couleur ou la décoration.
- **Interdits** : dégradés violets/néon, glassmorphism, `backdrop-filter`, cartes très arrondies empilées partout, ombres colorées, effets « glow » gratuits, emojis décoratifs, illustrations génériques. Pas de style « landing page IA ».
- Rayons faibles (≤ 8 px), bordures fines plutôt qu'ombres pour séparer les surfaces.

**Exception : la page d'accueil publique** (`frontend/index.html`, classe `body.landing`, section « Page d'accueil » de `main.css`), validée par l'utilisateur le 2026-10-28, adopte un style vitrine inspiré de safinum.cm : thème clair (variables redéfinies sur `.landing`), titres en Poppins (servie depuis `frontend/fonts/`, licence OFL), grille fine en fond, boutons arrondis, cartes à `--radius-lg`, pied de page sombre. Elle garde l'accent vert unique, sans dégradé coloré, ombre ni emoji. Les pages de l'application suivent toujours les règles ci-dessus jusqu'à la tâche 10 (alignement + mode clair/sombre).

## Design system (`frontend/css/main.css`)

Toutes les valeurs passent par les variables de `:root`. Pas de couleur, taille ou durée en dur dans les règles.

| Famille | Variables |
|---|---|
| Couleurs | `--bg`, `--surface`, `--surface-2`, `--border`, `--text`, `--muted`, `--accent`, `--accent-hover`, `--link`, `--danger`, `--warning` |
| Typo | `--font`, `--mono` (échelle `rem` : 0.875 / 1 / 1.25 / 1.6) |
| Rayon | `--radius` |

À introduire au besoin, en complétant `:root` plutôt qu'en dupliquant : `--space-1…6` (échelle 4 px), `--shadow-1/2` (profondeur : fond → surface → surface-2 → dialog), `--duration`, `--ease`.

- **Réutiliser** les classes existantes avant d'en créer : `.card`, `.stack`, `.row`, `.page-title`, `.field`, `.hint`, `.button` / `.button-primary` / `.button-danger` / `.button-link` / `.button-small`, `.alert-error` / `.alert-success`, `.loading`, `.empty`, `.tag`, `.meta`, `.badge`, `.pagination`, `.sr-only`, `.hidden`.
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
