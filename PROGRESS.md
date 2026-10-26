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
| 2 | Groupes : commentaires, quitter, retirer un membre, rôles | ⏳ Prochaine |
| 3 | Fichiers et messagerie : types limités, fichiers privés, pagination | À faire |
| 4 | Notifications, signalements, modération | À faire |
| 5 | Durcissement : CORS, en-têtes, journaux | À faire |
| 5b | Découpage de `server.js` | À faire |
| 6 | Frontend (6 pages) | À faire |
| 7 | Documentation : endpoints, installation, sauvegarde, déploiement | À faire |

## Tests automatisés

`cd backend && npm test` — 32 tests, 6 fichiers dans `backend/test/` (auth, limites, utilisateurs, forum, groupes, modération/signalements/notifications/fichiers).

Dernier résultat (2026-10-26) : **32 réussis, 0 échec**. Contrôle : un bug introduit volontairement (email non masqué) est bien détecté.

## Fonctionnalités vérifiées

- Démarrage, connexion PostgreSQL, `npm run db:init` (manuel).
- Auth : inscription validée, connexion, limite de tentatives, `/me`, changement de mot de passe (anciens tokens invalidés).
- Profils : mise à jour partielle, email masqué, photo vérifiée par contenu.
- Forum : CRUD discussions/commentaires, permissions, likes, catégories, pagination.

## Fichiers importants

- `database/database.sql` : seule source du schéma.
- `backend/server.js` : toute l'API.
- `backend/scripts/db-init.js` : création des tables.

## Problèmes connus

- Aucun frontend.
- Fichiers des groupes privés servis publiquement via `/uploads`.
- CORS ouvert à toutes les origines.
- `main` local en avance sur GitHub : le push doit être fait par l'utilisateur.

## Prochaine action

Tâche 2 (groupes) : commentaires de groupe, quitter un groupe, retirer un membre, rôles d'admin de groupe.
