# API Cyber Community

Toutes les routes sont préfixées par `/api` et échangent du JSON, sauf les envois de fichiers (`multipart/form-data`).

## Généralités

**Authentification** : en-tête `Authorization: Bearer <token>`. Le token est obtenu à l'inscription ou à la connexion. Il est valable 7 jours et devient invalide si le mot de passe change. Toutes les routes l'exigent, sauf `/api/health`, `/api/auth/register` et `/api/auth/login`.

**Erreurs** : réponse `{ "message": "..." }` en français, avec le code HTTP adapté :

| Code | Signification |
|---|---|
| 400 | Donnée invalide (champ manquant, trop long, JSON mal formé, identifiant non numérique…) |
| 401 | Token absent, invalide ou expiré ; identifiants incorrects |
| 403 | Droits insuffisants, ou compte suspendu |
| 404 | Élément introuvable (ou invisible pour vous, ex. groupe privé) |
| 409 | Doublon (nom déjà pris, déjà membre, signalement déjà en attente…) |
| 413 | Requête trop volumineuse |
| 429 | Trop de tentatives (limite anti brute-force) |

**Pagination** (quand indiqué) : paramètres `page` (défaut 1) et `limit` (défaut 20, maximum 50). Réponse `{ <liste>, total, page, limit }`.

**Rôles** : `USER` (membre), `MODERATOR`, `ADMIN`. Dans un groupe : `MEMBER` ou `ADMIN` (admin du groupe).

Légende des accès : **Public** = sans token · **Membre** = tout compte connecté · **Auteur** = auteur du contenu · **Modération** = `MODERATOR` ou `ADMIN` · **Admin** = `ADMIN` du site.

---

## État

| Méthode | Route | Accès | Description |
|---|---|---|---|
| GET | `/api/health` | Public | `{ application, status: "online", version }` |

## Authentification

| Méthode | Route | Accès | Corps | Réponse |
|---|---|---|---|---|
| POST | `/api/auth/register` | Public · 5 comptes/h par IP | `username` (3-30 : lettres, chiffres, `_ . -`), `email`, `password` (8 car. à 72 octets), `country` | 201 `{ token, user }` |
| POST | `/api/auth/login` | Public · 10 échecs/15 min par IP | `login` (nom ou email), `password` | `{ token, user }` |
| GET | `/api/auth/me` | Membre | — | `{ id, username, email, country, role }` |
| PUT | `/api/auth/password` | Membre | `current_password`, `new_password` | `{ token }` : nouveau token, les anciens sont invalidés |

## Utilisateurs et profils

| Méthode | Route | Accès | Paramètres / corps | Réponse |
|---|---|---|---|---|
| GET | `/api/users` | Membre | `q` (nom ou pseudo), pagination | `{ users, total, page, limit }` ; `is_active` visible par la modération |
| GET | `/api/users/:id` | Membre | — | Profil complet ; `email` visible par soi-même et les admins ; `is_active` par la modération |
| PUT | `/api/users/profile` | Membre (soi) | Champs envoyés seulement : `pseudonym` (100), `full_name` (150), `country` (100), `biography` (2000), `skills` (500). `""` ou `null` vide le champ | Profil |
| POST | `/api/users/profile/photo` | Membre (soi) | Fichier `photo` : JPEG, PNG, GIF, WebP (vérifié sur le contenu), 2 Mo max | `{ url }` (`/uploads/images/...`, public) |

## Forum

| Méthode | Route | Accès | Paramètres / corps | Réponse |
|---|---|---|---|---|
| GET | `/api/categories` | Membre | — | `[{ id, name, posts }]` |
| POST | `/api/categories` | Admin | `name` (100) | 201 catégorie |
| PUT | `/api/categories/:id` | Admin | `name` | Catégorie |
| DELETE | `/api/categories/:id` | Admin | — | Les discussions restent, sans catégorie |
| GET | `/api/posts` | Membre | `category_id`, `author_id`, `q` (titre et contenu), pagination | `{ posts, total, page, limit }` avec `likes`, `comments`, `liked_by_me` |
| GET | `/api/posts/:id` | Membre | — | `{ post, comments }` |
| POST | `/api/posts` | Membre | `title` (200), `content` (20 000), `category_id` (facultatif) | 201 discussion |
| PUT | `/api/posts/:id` | Auteur | Champs envoyés : `title`, `content`, `category_id` | Discussion |
| DELETE | `/api/posts/:id` | Auteur ou Modération | — | Supprime aussi les commentaires |
| POST | `/api/posts/:id/comments` | Membre | `content` (5000), `parent_id` (réponse : commentaire de la même discussion) | 201 commentaire ; notifie l'auteur (`COMMENT`) et le commentaire parent (`REPLY`) |
| PUT | `/api/comments/:id` | Auteur | `content` | Commentaire |
| DELETE | `/api/comments/:id` | Auteur ou Modération | — | Supprime aussi les réponses |
| POST | `/api/posts/:id/like` | Membre | — | Bascule : `{ liked, likes }` |

## Groupes

Un groupe **public** est visible et lisible par tous les membres ; un groupe **privé** seulement par ses membres (et la modération). Les admins du site ont tous les droits.

| Méthode | Route | Accès | Paramètres / corps | Réponse |
|---|---|---|---|---|
| GET | `/api/groups` | Membre | — | Groupes visibles, avec `members` et `my_role` |
| GET | `/api/groups/:id` | Lecteur du groupe | — | Groupe |
| POST | `/api/groups` | Admin | `name` (120), `description` (2000), `is_private` (défaut `true`) | 201 groupe ; le créateur en est admin |
| PUT | `/api/groups/:id` | Admin du groupe | Champs envoyés : `name`, `description`, `is_private` | Groupe |
| DELETE | `/api/groups/:id` | Admin du groupe | — | Supprime discussions, messages et pièces jointes |
| POST | `/api/groups/:id/join` | Membre | — | 201 ; groupes publics uniquement |
| GET | `/api/groups/:id/members` | Lecteur du groupe | — | `[{ id, username, country, group_role, joined_at }]` |
| POST | `/api/groups/:id/members` | Admin du groupe | `user_id` | 201 ; notifie (`GROUP_ADDED`) |
| PUT | `/api/groups/:id/members/:userId` | Admin du groupe | `group_role` : `MEMBER` / `ADMIN` | Le dernier admin ne peut pas être rétrogradé |
| DELETE | `/api/groups/:id/members/:userId` | Soi-même (quitter) ou Admin du groupe | — | Le dernier admin ne peut pas partir |
| GET | `/api/groups/:id/posts` | Lecteur du groupe | — | Discussions avec nombre de commentaires |
| POST | `/api/groups/:id/posts` | Membre du groupe | `title`, `content` | 201 |
| GET | `/api/groups/:id/posts/:postId` | Lecteur du groupe | — | `{ post, comments }` |
| PUT | `/api/groups/:id/posts/:postId` | Auteur | `title`, `content` | Discussion |
| DELETE | `/api/groups/:id/posts/:postId` | Auteur, admin du groupe ou Modération | — | |
| POST | `/api/groups/:id/posts/:postId/comments` | Membre du groupe | `content`, `parent_id` | 201 ; notifie (`GROUP_COMMENT`, `REPLY`) |
| DELETE | `/api/groups/:id/comments/:commentId` | Auteur, admin du groupe ou Modération | — | Supprime aussi les réponses |

## Messagerie de groupe et fichiers

| Méthode | Route | Accès | Paramètres / corps | Réponse |
|---|---|---|---|---|
| GET | `/api/groups/:id/messages` | Lecteur du groupe | `limit` (50, max 100) ; `before=<id>` (historique) ou `after=<id>` (nouveaux) | Messages du plus ancien au plus récent |
| POST | `/api/groups/:id/messages` | Membre du groupe | `multipart/form-data` : `content` (5000) et/ou `file` | 201 message (`file_url`, `file_name`) |
| DELETE | `/api/groups/:id/messages/:messageId` | Expéditeur, admin du groupe ou Modération | — | Supprime aussi la pièce jointe |
| POST | `/api/files` | Membre | Fichier `file` | 201 `{ id, url, original_name, ... }` |
| GET | `/api/files/:id` | Déposant, Admin, ou lecteur d'un groupe où le fichier est partagé | — | Fichier, **toujours en téléchargement** ; 404 si non autorisé |

Pièces jointes : 10 Mo maximum ; extensions acceptées : `pdf txt md csv log json png jpg jpeg gif webp zip gz tar 7z docx xlsx pptx odt ods odp pcap pcapng`.

## Signalements et modération

| Méthode | Route | Accès | Paramètres / corps | Réponse |
|---|---|---|---|---|
| POST | `/api/reports` | Membre | `target_type` (`USER`, `POST`, `COMMENT`, `GROUP`, `MESSAGE`), `target_id`, `reason` (100), `details` (2000) | 201 ; la cible doit exister et être visible ; doublon en attente → 409 |
| GET | `/api/reports` | Modération | `status` (`PENDING`, `REVIEWED`, `RESOLVED`, `REJECTED`), pagination | `{ reports, ... }` avec `target_preview`, `target_author_id`, `target_post_id`, `target_group_id` |
| PUT | `/api/reports/:id` | Modération | `status` | Signalement ; `RESOLVED` / `REJECTED` notifient le signaleur (`REPORT_UPDATE`) |
| PUT | `/api/moderation/users/:id/suspend` | Modération | — | Un modérateur n'agit que sur les membres `USER` ; jamais sur soi-même |
| PUT | `/api/moderation/users/:id/activate` | Modération | — | Mêmes règles |
| DELETE | `/api/moderation/posts/:id` | Modération | — | Équivalent de `DELETE /api/posts/:id` |
| DELETE | `/api/moderation/comments/:id` | Modération | — | Équivalent de `DELETE /api/comments/:id` |
| PUT | `/api/admin/users/:id/role` | Admin | `role` : `USER`, `MODERATOR`, `ADMIN` | Pas sur son propre compte |

## Notifications

| Méthode | Route | Accès | Paramètres | Réponse |
|---|---|---|---|---|
| GET | `/api/notifications` | Membre | `unread=true`, pagination | `{ notifications, total, unread, page, limit }` |
| GET | `/api/notifications/unread-count` | Membre | — | `{ unread }` |
| PUT | `/api/notifications/read-all` | Membre | — | `{ updated }` |
| PUT | `/api/notifications/:id/read` | Membre (les siennes) | — | Notification |
| DELETE | `/api/notifications/:id` | Membre (les siennes) | — | |

Types : `COMMENT`, `REPLY`, `GROUP_ADDED`, `GROUP_COMMENT`, `REPORT_UPDATE`.

## Exemple

```bash
TOKEN=$(curl -s -X POST localhost:5000/api/auth/login -H "Content-Type: application/json" \
  -d '{"login":"tess","password":"motdepasse1"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')

curl -s "localhost:5000/api/posts?q=linux&limit=5" -H "Authorization: Bearer $TOKEN"
```
