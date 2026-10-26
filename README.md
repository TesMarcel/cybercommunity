# Cyber Community

Plateforme communautaire (forum, groupes, messagerie, modération) autour de la cybersécurité, de la programmation, de Linux et des CTF.

- **Démarrer en local** : section [Démarrer le backend](#démarrer-le-backend), puis ouvrir http://localhost:5000
- **Routes de l'API** : [docs/API.md](docs/API.md)
- **Déploiement, sauvegarde, restauration** : [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)
- **Organisation du code** : [ARCHITECTURE.md](ARCHITECTURE.md) — **suivi** : [PROGRESS.md](PROGRESS.md)

La suite de ce document décrit en détail la base de données.

## 1. Présentation

Ce projet contient la structure **PostgreSQL** de la plateforme **Cyber Community**.

La base de données est conçue pour gérer :

* les utilisateurs ;
* les profils ;
* les rôles et permissions ;
* les discussions du forum ;
* les commentaires et réponses ;
* les likes ;
* les groupes privés ;
* les membres des groupes ;
* les discussions de groupes ;
* les messages de groupes ;
* les fichiers ;
* les signalements ;
* les notifications ;
* les catégories du forum.

> Cette base fournit uniquement la partie **SQL / PostgreSQL**.
> Le backend Node.js/Express (`backend/`) et le frontend (`frontend/`) utilisent cette base.

---

# 2. Technologies

Le projet utilise :

* **PostgreSQL** : système de gestion de base de données
* **pgAdmin** : interface graphique pour PostgreSQL
* **SQL** : création et gestion de la structure de la base
* **Node.js / Express** : API REST et service du frontend
* **HTML / CSS / JavaScript** : frontend, sans framework

---

# 3. Création de la base de données

Dans PostgreSQL, créer une base appelée :

```text
cyber_community
```

Avec pgAdmin :

```text
Servers
└── PostgreSQL
    └── Databases
        └── Create
            └── Database
```

Nom :

```text
cyber_community
```

Puis enregistrer.

---

# 4. Exécution du script SQL

Une fois la base créée :

1. Ouvrir **pgAdmin**.
2. Sélectionner :

```text
cyber_community
```

3. Ouvrir :

```text
Tools → Query Tool
```

4. Copier le contenu du fichier :

```text
database.sql
```

5. Coller le SQL dans Query Tool.
6. Cliquer sur :

```text
Execute
```

ou utiliser :

```text
F5
```

---

# 5. Structure de la base

La base contient les tables suivantes :

```text
users
profiles
categories
posts
comments
post_likes
groups_table
group_members
group_posts
group_comments
group_messages
files
reports
notifications
```

---

# 6. Table users

La table `users` contient les comptes des utilisateurs.

Structure principale :

```text
users
├── id
├── username
├── email
├── password_hash
├── country
├── role
├── is_active
├── created_at
└── updated_at
```

### Rôle des colonnes

### `id`

Identifiant unique de l'utilisateur.

### `username`

Nom d'utilisateur unique.

### `email`

Adresse email unique.

### `password_hash`

Mot de passe stocké sous forme de hash.

Le mot de passe ne doit jamais être enregistré directement en clair.

### `country`

Pays de l'utilisateur.

### `role`

Rôle de l'utilisateur.

Valeurs possibles :

```text
USER
MODERATOR
ADMIN
```

### `is_active`

Permet d'activer ou de suspendre un compte.

```text
TRUE  = compte actif
FALSE = compte suspendu
```

---

# 7. Table profiles

La table `profiles` contient les informations publiques du profil.

```text
profiles
├── user_id
├── pseudonym
├── photo_url
├── full_name
├── country
├── biography
├── skills
└── updated_at
```

La relation est :

```text
users 1 ───── 1 profiles
```

Un utilisateur possède un profil.

Si l'utilisateur est supprimé, son profil est automatiquement supprimé.

---

# 8. Table categories

Cette table contient les catégories du forum.

Catégories initiales :

```text
Cybersécurité
Programmation
Linux
Réseaux
CTF
Actualités
Débutants
Autres
```

Structure :

```text
categories
├── id
├── name
└── created_at
```

---

# 9. Table posts

Cette table contient les discussions principales du forum.

```text
posts
├── id
├── author_id
├── category_id
├── title
├── content
├── created_at
└── updated_at
```

Relations :

```text
users
   │
   └── posts

categories
   │
   └── posts
```

Chaque discussion possède :

* un auteur ;
* un titre ;
* un contenu ;
* éventuellement une catégorie.

---

# 10. Table comments

Cette table contient les commentaires des discussions.

```text
comments
├── id
├── post_id
├── author_id
├── parent_id
├── content
└── created_at
```

Elle permet également les réponses aux commentaires.

Exemple :

```text
Discussion
│
├── Commentaire A
│   ├── Réponse A1
│   └── Réponse A2
│
└── Commentaire B
```

La colonne :

```text
parent_id
```

permet de savoir si un commentaire est une réponse à un autre commentaire.

---

# 11. Table post_likes

Cette table enregistre les likes.

```text
post_likes
├── post_id
├── user_id
└── created_at
```

La combinaison :

```text
post_id + user_id
```

est unique.

Ainsi, un utilisateur ne peut pas liker plusieurs fois la même discussion.

---

# 12. Table groups_table

Cette table contient les groupes privés.

```text
groups_table
├── id
├── name
├── description
├── is_private
├── created_by
└── created_at
```

Par défaut :

```text
is_private = TRUE
```

Un groupe est donc privé.

---

# 13. Table group_members

Cette table permet de gérer les membres des groupes.

```text
group_members
├── group_id
├── user_id
├── group_role
└── joined_at
```

Les rôles dans un groupe sont :

```text
MEMBER
ADMIN
```

Relation :

```text
users
   │
   └── group_members
             │
             └── groups_table
```

---

# 14. Table group_posts

Cette table contient les discussions à l'intérieur d'un groupe.

```text
group_posts
├── id
├── group_id
├── author_id
├── title
├── content
├── created_at
└── updated_at
```

---

# 15. Table group_comments

Cette table contient les commentaires des discussions de groupe.

```text
group_comments
├── id
├── group_post_id
├── author_id
├── parent_id
├── content
└── created_at
```

Elle fonctionne de manière similaire à la table `comments`.

---

# 16. Table group_messages

Cette table gère les messages envoyés dans les groupes.

```text
group_messages
├── id
├── group_id
├── sender_id
├── content
├── file_url
├── file_name
└── created_at
```

Un message peut contenir :

* du texte ;
* un fichier ;
* une image ;
* ou les deux.

Exemple :

```text
Bonjour tout le monde !
```

ou :

```text
[image.png]
```

ou :

```text
Voici le document.
[document.pdf]
```

---

# 17. Table files

Cette table permet de conserver les informations relatives aux fichiers envoyés.

```text
files
├── id
├── uploader_id
├── original_name
├── stored_name
├── mime_type
├── size_bytes
├── url
└── created_at
```

La base ne contient pas directement le fichier.

Elle contient les informations permettant au backend de retrouver le fichier.

---

# 18. Table reports

Cette table gère les signalements.

Un utilisateur peut signaler :

```text
USER
POST
COMMENT
GROUP
MESSAGE
```

Structure :

```text
reports
├── id
├── reporter_id
├── target_type
├── target_id
├── reason
├── details
├── status
├── handled_by
├── created_at
└── updated_at
```

Les statuts possibles sont :

```text
PENDING
REVIEWED
RESOLVED
REJECTED
```

Exemple :

```text
Utilisateur A
     │
     │ signale
     ▼
Discussion 25
     │
     ▼
reports
     │
     ▼
PENDING
```

Un modérateur ou un administrateur pourra ensuite traiter le signalement.

---

# 19. Table notifications

Cette table contient les notifications des utilisateurs.

```text
notifications
├── id
├── user_id
├── type
├── message
├── is_read
└── created_at
```

Exemples :

```text
Quelqu'un a commenté votre discussion.

Votre signalement a été traité.

Vous avez été ajouté à un groupe.
```

`is_read` indique si la notification a été consultée.

---

# 20. Relations principales

La structure générale est :

```text
                    ┌──────────────┐
                    │    USERS     │
                    └──────┬───────┘
                           │
             ┌─────────────┼──────────────┐
             │             │              │
             ▼             ▼              ▼
         PROFILES        POSTS        GROUP_MEMBERS
                           │              │
                  ┌────────┴──────┐       │
                  ▼               ▼       ▼
              COMMENTS        LIKES    GROUPS
                                           │
                                  ┌────────┼────────┐
                                  ▼        ▼        ▼
                              GROUP_POSTS MESSAGES MEMBERS
                                  │
                                  ▼
                            GROUP_COMMENTS
```

---

# 21. Sécurité des mots de passe

La base possède :

```text
password_hash
```

et non :

```text
password
```

Le backend devra utiliser un système de hash sécurisé avant d'enregistrer le mot de passe.

Exemple conceptuel :

```text
Mot de passe utilisateur
        │
        ▼
    Hash sécurisé
        │
        ▼
   PostgreSQL
```

Il ne faut jamais stocker :

```text
password = "12345678"
```

directement dans PostgreSQL.

---

# 22. Rôles

Le système possède trois rôles.

## USER

Utilisateur normal.

Il pourra notamment :

* consulter le forum ;
* commenter ;
* liker ;
* consulter ses groupes ;
* participer aux groupes ;
* envoyer des messages ;
* effectuer des signalements.

## MODERATOR

Le modérateur pourra notamment :

* traiter les signalements ;
* supprimer des discussions ;
* supprimer des commentaires ;
* suspendre des utilisateurs.

## ADMIN

L'administrateur possède les permissions d'administration.

Il pourra notamment :

* gérer les utilisateurs ;
* gérer les rôles ;
* gérer les catégories ;
* gérer les groupes ;
* gérer les modérateurs ;
* gérer les signalements.

---

# 23. Suppression en cascade

Plusieurs relations utilisent :

```sql
ON DELETE CASCADE
```

Cela signifie que lorsqu'une donnée principale est supprimée, les données qui en dépendent peuvent être supprimées automatiquement.

Exemple :

```text
USER
 │
 ├── PROFILE
 ├── COMMENTS
 ├── LIKES
 └── NOTIFICATIONS
```

Si le compte utilisateur est supprimé, ses données dépendantes sont également supprimées lorsque la relation le prévoit.

Cela évite de conserver des données orphelines.

---

# 24. Index

Des index ont été ajoutés pour améliorer les recherches.

Exemples :

```text
idx_users_username
idx_users_email
idx_posts_author
idx_posts_category
idx_comments_post
idx_group_members_user
idx_group_posts_group
idx_group_messages_group
idx_notifications_user
idx_reports_status
```

Ils deviennent particulièrement utiles lorsque la base contient beaucoup d'utilisateurs et de contenus.

---

# 25. Architecture du projet

Organisation actuelle :

```text
cybercommunity/
│
├── README.md
├── ARCHITECTURE.md        (architecture cible)
├── .gitignore
│
├── database/
│   └── database.sql       (seule source du schéma)
│
└── backend/
    ├── package.json
    ├── .env.example
    └── server.js          (API REST Express)
```

`database.sql` est la **seule source de vérité** du schéma : le serveur ne crée pas de tables, il vérifie seulement au démarrage que le schéma est présent.

## Démarrer le backend

Prérequis : Node.js 18 ou plus récent, PostgreSQL.

```bash
cd backend
npm install

cp .env.example .env
# Remplir DATABASE_URL et JWT_SECRET dans .env

# Créer les tables (une seule fois, base cyber_community déjà créée)
npm run db:init

npm start          # ou : npm run dev (redémarrage automatique)
```

Ouvrir ensuite **http://localhost:5000** dans le navigateur : le serveur fournit à la fois l'application (dossier `frontend/`) et l'API (`/api/...`).

Pour donner le rôle administrateur au premier compte créé (depuis le dossier `backend`) :

```bash
npm run make-admin -- VOTRE_NOM
```

Le serveur refuse de démarrer si `JWT_SECRET` (32 caractères minimum) ou `DATABASE_URL` sont absents.

## Lancer les tests

Les tests utilisent une **base séparée**, entièrement vidée à chaque lancement. Son nom doit se terminer par `_test` (sinon les tests refusent de démarrer).

```bash
sudo -iu postgres createdb cyber_community_test   # une seule fois
# Renseigner TEST_DATABASE_URL dans backend/.env
cd backend
npm test
```

### Tests dans le navigateur

Ils pilotent **Firefox** (sans fenêtre) comme un vrai utilisateur : inscription, forum, profil, notifications, groupes, messagerie, modération, affichage mobile, protection XSS. Ils utilisent la même base `_test`.

```bash
cd backend
npm run test:e2e               # tous les scénarios
npm run test:e2e -- 3-groups   # un seul scénario
```

Firefox est cherché dans `/usr/bin/firefox` ; sinon, définir `FIREFOX_PATH`.

---

# 26. Ordre de développement

Le projet sera développé dans cet ordre :

```text
1. Base PostgreSQL
        ↓
2. Backend Node.js / Express
        ↓
3. Authentification
        ↓
4. Utilisateurs / profils
        ↓
5. Forum
        ↓
6. Groupes
        ↓
7. Messagerie
        ↓
8. Fichiers
        ↓
9. Notifications
        ↓
10. Signalements
        ↓
11. Modération
        ↓
12. Frontend
```

---

# 27. Vérification dans pgAdmin

Après l'exécution du SQL, aller dans :

```text
cyber_community
    ↓
Schemas
    ↓
public
    ↓
Tables
```

Vous devriez retrouver :

```text
categories
comments
files
group_comments
group_members
group_messages
group_posts
groups_table
notifications
post_likes
posts
profiles
reports
users
```

Si les tables n'apparaissent pas immédiatement :

```text
Clic droit sur Tables
        ↓
Refresh
```

---

# 28. Vérification avec SQL

Pour vérifier les tables directement :

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
ORDER BY table_name;
```

Pour vérifier les catégories :

```sql
SELECT *
FROM categories
ORDER BY id;
```

Pour vérifier les utilisateurs :

```sql
SELECT id, username, email, country, role, is_active
FROM users;
```

---

# 29. Important : ce que SQL ne fait pas

Le fichier SQL ne fait pas :

* l'interface utilisateur ;
* les pages HTML ;
* l'authentification JWT ;
* l'API REST ;
* l'envoi des requêtes HTTP ;
* le traitement des fichiers ;
* l'interface d'administration.

Ces fonctionnalités seront réalisées par le **backend applicatif**.

Le rôle de PostgreSQL est principalement de :

```text
STOCKER
ORGANISER
RELier
PROTÉGER
RECHERCHER
les données.
```

---

# 30. Connexion avec le backend

Le backend Node.js/Express communiquera avec PostgreSQL.

Architecture :

```text
┌──────────────────────┐
│      FRONTEND        │
│   HTML/CSS/JS        │
└──────────┬───────────┘
           │
           │ HTTP / REST API
           ▼
┌──────────────────────┐
│       BACKEND        │
│    Node.js/Express   │
└──────────┬───────────┘
           │
           │ SQL
           ▼
┌──────────────────────┐
│     PostgreSQL       │
│   cyber_community    │
└──────────────────────┘
```

Le frontend ne devra donc pas communiquer directement avec PostgreSQL.

---

# 31. État actuel

La partie SQL comprend :

* [x] Utilisateurs
* [x] Profils
* [x] Catégories
* [x] Discussions
* [x] Commentaires
* [x] Réponses aux commentaires
* [x] Likes
* [x] Groupes privés
* [x] Membres des groupes
* [x] Discussions de groupes
* [x] Commentaires de groupes
* [x] Messages de groupes
* [x] Fichiers
* [x] Signalements
* [x] Notifications
* [x] Rôles
* [x] Contraintes SQL
* [x] Clés étrangères
* [x] Index

À développer ensuite :

* [x] API REST
* [x] Authentification JWT (limite de tentatives, changement de mot de passe)
* [x] Middleware de permissions
* [x] Upload sécurisé des fichiers
* [x] Validation des entrées côté serveur
* [x] Administration (API)
* [x] Tests (npm test)
* [x] Messagerie rafraîchie toutes les 5 secondes (WebSocket écarté : choix validé)
* [x] Tests navigateur (npm run test:e2e)
* [x] Documentation : API, déploiement, sauvegarde
* [x] Frontend (HTML / CSS / JavaScript)

---

# 32. Important pour le développement

Cette base est destinée au développement de la plateforme communautaire.

Les fonctionnalités liées à des activités criminelles ou à la facilitation d'attaques informatiques ne font pas partie de cette architecture.

Les fonctionnalités communautaires, de cybersécurité défensive, de programmation, Linux, réseaux, CTF, modération et administration peuvent être développées normalement.

---

# 33. Sauvegarde et restauration

La base seule ne suffit pas : les photos de profil et les pièces jointes sont des fichiers (`backend/uploads/`). Le script fourni sauvegarde les deux :

```bash
cd backend
npm run backup
```

Résultat dans `backend/backups/` : un fichier `.dump` (base) et un `.uploads.tar.gz` (fichiers). Les 14 dernières sauvegardes sont conservées.

Restauration, sauvegarde automatique quotidienne et copie hors du serveur : voir [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md#9-sauvegarde).

---

# 34. Conclusion

`database.sql` constitue la fondation du projet.

Il définit les données et leurs relations.

Le backend applicatif utilise cette structure pour fournir une API.

La séparation est donc :

```text
PostgreSQL
    ↓
database.sql
    ↓
Backend Node.js / Express
    ↓
API REST
    ↓
Frontend HTML / CSS / JavaScript
```

Cette architecture permet de développer chaque partie indépendamment et de faire évoluer progressivement l'application.
