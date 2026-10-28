# Suivi du projet Cyber Community

Dernière mise à jour : 2026-10-28

## Décisions validées

- Forum : tous les membres peuvent créer des discussions.
- Messagerie de groupe : rafraîchissement périodique, pas de WebSocket.
- `server.js` découpé selon `ARCHITECTURE.md` (routes, middlewares, services, utils).
- Frontend : HTML / CSS / JavaScript sans framework (`ARCHITECTURE.md`).

## Tâches

| # | Tâche | État |
|---|---|---|
| 0 | Commit étape 5 + `PROGRESS.md` | ✅ Terminé |
| 1 | Tests automatisés de l'API (`node:test`, base de test) | ✅ Terminé |
| 2 | Groupes : commentaires, quitter, retirer un membre, rôles | ✅ Terminé |
| 3 | Fichiers et messagerie : types limités, fichiers privés, pagination | ✅ Terminé |
| 4 | Notifications, signalements, modération | ✅ Terminé |
| 5 | Durcissement : CORS, en-têtes, journaux | ✅ Terminé |
| 5b | Découpage de `server.js` | ✅ Terminé |
| 6 | Frontend (10 pages) | ✅ Terminé |
| 7 | Documentation : endpoints, installation, sauvegarde, déploiement | ✅ Terminé |
| 8 | Design : `CLAUDE.md`, contraste AA, mouvement réduit, navigation mobile, étiquettes porteuses de sens, cibles tactiles 44 px (vérifié 375/768/1440 px dans Firefox) | ✅ Terminé |
| 9 | Page d'accueil publique (style vitrine inspiré de safinum.cm) : mission, thématiques, fonctionnement, charte ; thème clair propre à l'accueil, Poppins locale ; membre connecté → forum (vérifié 375/768/1440 px dans Firefox) | ✅ Terminé (branche `tache-9-accueil`) |
| 10 | Style de l'application aligné sur l'accueil (titres Poppins, boutons en pastille, cartes arrondies, en-tête fixé sur grand écran) + thème clair/sombre (système par défaut, bouton mémorisé, contraste AA vérifié dans les deux thèmes, 375/768/1280 px) | ✅ Terminé (branche `tache-10-theme`) |
| 11 | Accueil toujours visible (membre connecté : « Mon tableau de bord ») ; tableau de bord après connexion/inscription : chiffres clés (membres, discussions, mes discussions, mes groupes, non lues, signalements pour la modération), profil à compléter, dernières discussions, mes groupes, notifications, thématiques ; sans modification de l'API | ✅ Terminé (branche `tache-11-tableau-de-bord`) |
| 12 | Éléments communs (`avatar()`, `timeAgo()`, `richText()` avec blocs de code ``` et bouton Copier, `icon()`, en-tête de page, fil d'Ariane) ; forum en deux colonnes (thématiques cliquables, bonnes pratiques), cartes entièrement cliquables avec avatar et compteurs, compteur de résultats, état vide avec action ; discussion : auteur, fil d'Ariane, blocs de code, commentaires avec avatars. Avatars = initiale (l'API ne renvoie pas la photo de l'auteur) | ✅ Terminé (branche `tache-12-forum`) |
| 13 | Groupes en grille + messagerie en bulles | ⏳ À faire |
| 14 | Profil en onglets, notifications par jour, tableau de bord de modération | ⏳ À faire |

## Tests automatisés

`cd backend && npm test` — 53 tests, 9 fichiers dans `backend/test/` (auth, limites, utilisateurs, forum, groupes, fichiers/messagerie, modération/signalements/notifications, sécurité, CORS).

Dernier résultat (2026-10-28, après tâche 12) : **53 réussis, 0 échec**.

`cd backend && npm run test:e2e` — 106 contrôles dans Firefox, 4 scénarios (`backend/test-e2e/`).

Dernier résultat (2026-10-28, après tâche 12) : **106 réussis, 0 échec**, aucune erreur console/CSP. Ces tests ont révélé et fait corriger 3 bugs du frontend (état vide du chat, bouton bloqué après action, liste déroulante vidée). Contrôle : un bug introduit volontairement (email non masqué) est bien détecté.

## Fonctionnalités vérifiées

- Démarrage, connexion PostgreSQL, `npm run db:init` (manuel).
- Auth : inscription validée, connexion, limite de tentatives, `/me`, changement de mot de passe (anciens tokens invalidés).
- Profils : mise à jour partielle, email masqué, photo vérifiée par contenu.
- Forum : CRUD discussions/commentaires, permissions, likes, catégories, pagination.
- Groupes : visibilité public/privé, rejoindre, admins de groupe (dernier admin protégé), quitter/retirer, discussions et commentaires de groupe.
- Fichiers : pièces jointes privées (`uploads/files`, téléchargement via `GET /api/files/:id` réservé aux membres), types autorisés, 10 Mo max, suppression avec le message ou le groupe. Messages paginés (`limit`, `before`, `after`).
- Signalements : cible existante et visible, doublon bloqué, liste filtrée/paginée, signaleur notifié. Modération : hiérarchie (modérateur → utilisateurs simples), pas d'action sur soi-même, 404. Notifications : pagination, compteur, tout lire, suppression.
- Sauvegarde / restauration : `npm run backup` (base + fichiers), restauration testée dans une base neuve.
- Documentation : `docs/API.md` comparée automatiquement aux routes d'Express (57/57 identiques).
- Durcissement : en-têtes de sécurité (CSP, nosniff, frame DENY, HSTS en production), CORS fermé par défaut (`CORS_ORIGIN`), `TRUST_PROXY`, JSON invalide → 400, corps trop gros → 413, journal sans token/corps/paramètres (vérifié manuellement).

## Fichiers importants

- `database/database.sql` : seule source du schéma.
- `backend/server.js` : démarrage ; `backend/src/` : application découpée (voir `ARCHITECTURE.md`).
- `backend/scripts/db-init.js` : création des tables ; `backend/scripts/backup.sh` : sauvegarde.
- `frontend/` : 11 pages HTML (dont `dashboard.html`), `css/main.css`, un module JS par page.
- `docs/API.md` : routes ; `docs/DEPLOIEMENT.md` : déploiement, sauvegarde, restauration.

## Critères de fin (`md.txt`, section 12)

| Critère | État |
|---|---|
| Fonctionnalités prévues et confirmées implémentées | ✅ |
| Frontend communiquant avec le backend | ✅ vérifié dans Firefox (106 contrôles) |
| Base fonctionnelle avec son schéma | ✅ `database.sql`, `npm run db:init` |
| Parcours utilisateur principaux testés | ✅ API (53 tests) + navigateur |
| Erreurs bloquantes corrigées ou documentées | ✅ |
| Contrôles de sécurité essentiels | ✅ voir `docs/DEPLOIEMENT.md` §11 ; `npm audit` : 0 vulnérabilité (2026-10-26, après passage de puppeteer-core en 25.13.0) |
| Instructions d'installation et d'utilisation à jour | ✅ README, `docs/` |
| Limitations indiquées | ✅ ci-dessous |

## Limitations connues

- **Déploiement non éprouvé** : la procédure `docs/DEPLOIEMENT.md` (Nginx, systemd, HTTPS) n'a pas été déroulée sur un vrai serveur ; `TRUST_PROXY` n'est pas testé automatiquement.
- **Pas de migrations** : une évolution du schéma demandera un script de migration dédié.
- **Signalement impossible** pour les discussions et commentaires *de groupe* (types non prévus par le schéma ; nécessite une migration).
- **Messagerie non instantanée** : rafraîchissement toutes les 5 secondes (choix validé).
- **Pas d'emails** : ni confirmation d'adresse, ni « mot de passe oublié ».
- **Token dans `localStorage`** (7 jours) ; risque limité par la CSP.
- **Pas d'antivirus** sur les pièces jointes.
- **Limites anti brute-force en mémoire** : remises à zéro au redémarrage.

## Prochaine action

Le plan validé est terminé. Suites possibles, à décider :

1. Déployer sur un serveur en suivant `docs/DEPLOIEMENT.md`.
2. Migration pour permettre le signalement des contenus de groupe.
3. « Mot de passe oublié » (nécessite un service d'envoi d'emails).
