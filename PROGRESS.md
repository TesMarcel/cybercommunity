# Suivi du projet Cyber Community

Dernière mise à jour : 2026-10-26

## Décisions validées

- Forum : tous les membres peuvent créer des discussions.
- Messagerie de groupe : rafraîchissement périodique, pas de WebSocket.
- `server.js` sera découpé selon `ARCHITECTURE.md` une fois les tests en place.
- Frontend : HTML / CSS / JavaScript sans framework (`ARCHITECTURE.md`).

## Tâches

| # | Tâche | État |
|---|---|---|
| 0 | Commit étape 5 + `PROGRESS.md` | ✅ Terminé |
| 1 | Tests automatisés de l'API (`node:test`, base de test) | ✅ Terminé |
| 2 | Groupes : commentaires, quitter, retirer un membre, rôles | ✅ Terminé |
| 3 | Fichiers et messagerie : types limités, fichiers privés, pagination | ✅ Terminé |
| 4 | Notifications, signalements, modération | ✅ Terminé |
| 5 | Durcissement : CORS, en-têtes, journaux | ⏳ Prochaine |
| 5b | Découpage de `server.js` | À faire |
| 6 | Frontend (6 pages) | À faire |
| 7 | Documentation : endpoints, installation, sauvegarde, déploiement | À faire |

## Tests automatisés

`cd backend && npm test` — 49 tests, 7 fichiers dans `backend/test/` (auth, limites, utilisateurs, forum, groupes, fichiers/messagerie, modération/signalements/notifications).

Dernier résultat (2026-10-26, après tâche 4) : **49 réussis, 0 échec**. Contrôle : un bug introduit volontairement (email non masqué) est bien détecté.

## Fonctionnalités vérifiées

- Démarrage, connexion PostgreSQL, `npm run db:init` (manuel).
- Auth : inscription validée, connexion, limite de tentatives, `/me`, changement de mot de passe (anciens tokens invalidés).
- Profils : mise à jour partielle, email masqué, photo vérifiée par contenu.
- Forum : CRUD discussions/commentaires, permissions, likes, catégories, pagination.
- Groupes : visibilité public/privé, rejoindre, admins de groupe (dernier admin protégé), quitter/retirer, discussions et commentaires de groupe.
- Fichiers : pièces jointes privées (`uploads/files`, téléchargement via `GET /api/files/:id` réservé aux membres), types autorisés, 10 Mo max, suppression avec le message ou le groupe. Messages paginés (`limit`, `before`, `after`).
- Signalements : cible existante et visible, doublon bloqué, liste filtrée/paginée, signaleur notifié. Modération : hiérarchie (modérateur → utilisateurs simples), pas d'action sur soi-même, 404. Notifications : pagination, compteur, tout lire, suppression.

## Fichiers importants

- `database/database.sql` : seule source du schéma.
- `backend/server.js` : toute l'API.
- `backend/scripts/db-init.js` : création des tables.

## Problèmes connus

- Aucun frontend.
- CORS ouvert à toutes les origines.
- Les contenus de groupe (discussions, commentaires) ne peuvent pas être signalés : le schéma n'autorise que USER, POST, COMMENT, GROUP, MESSAGE.

## Prochaine action

Tâche 5 : CORS configurable (.env), en-têtes de sécurité HTTP, trust proxy, journaux sans données sensibles.
