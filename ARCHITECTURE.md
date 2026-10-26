# Architecture

```text
cybercommunity/
│
├── README.md
├── ARCHITECTURE.md
├── PROGRESS.md              suivi du projet
├── .gitignore
│
├── database/
│   └── database.sql         seule source du schéma (npm run db:init)
│
├── backend/
│   ├── package.json
│   ├── .env.example
│   ├── server.js            point d'entrée : configuration + démarrage
│   │
│   ├── scripts/
│   │   └── db-init.js       crée les tables à partir de database.sql
│   │
│   ├── src/
│   │   ├── app.js           middlewares communs, montage des routes, erreurs
│   │   │
│   │   ├── config/
│   │   │   ├── env.js       variables obligatoires (.env)
│   │   │   └── database.js  connexion PostgreSQL
│   │   │
│   │   ├── routes/          une route = validation + logique + requêtes SQL
│   │   │   ├── auth.routes.js           inscription, connexion, mot de passe
│   │   │   ├── users.routes.js          utilisateurs, profils, photo
│   │   │   ├── categories.routes.js
│   │   │   ├── posts.routes.js          discussions, commentaires, likes
│   │   │   ├── groups.routes.js         groupes, membres, discussions de groupe
│   │   │   ├── messages.routes.js       messages de groupe
│   │   │   ├── files.routes.js          pièces jointes
│   │   │   ├── reports.routes.js        signalements
│   │   │   ├── moderation.routes.js     suspension, rôles
│   │   │   └── notifications.routes.js
│   │   │
│   │   ├── services/
│   │   │   ├── group.service.js         droits sur les groupes
│   │   │   └── notification.service.js
│   │   │
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.js       JWT, rôles
│   │   │   ├── rateLimit.middleware.js  anti brute-force
│   │   │   ├── upload.middleware.js     réception des fichiers
│   │   │   └── error.middleware.js      404 et erreurs
│   │   │
│   │   └── utils/
│   │       ├── jwt.js
│   │       ├── password.js
│   │       ├── validators.js
│   │       └── files.js                 stockage des fichiers
│   │
│   ├── uploads/             créé au démarrage, ignoré par git
│   │   ├── images/          photos de profil (publiques)
│   │   └── files/           pièces jointes (privées, via GET /api/files/:id)
│   │
│   ├── test/                npm test (API, node:test)
│   └── test-e2e/            npm run test:e2e (navigateur Firefox)
│
└── frontend/                servi par Express (même origine que l'API)
    ├── index.html           redirige vers le forum ou la connexion
    ├── pages/
    │   ├── login.html, register.html
    │   ├── forum.html, post.html             forum et discussion
    │   ├── profile.html                      son profil ou celui d'un membre (?id=)
    │   ├── notifications.html
    │   ├── groups.html, group.html           groupes (discussions, messages, membres)
    │   └── moderation.html                   signalements, utilisateurs, catégories
    ├── css/main.css
    └── js/
        ├── api.js           appels à l'API, session, téléchargements
        ├── ui.js            création d'éléments (texte uniquement, jamais de HTML)
        ├── layout.js        en-tête, navigation, badge de notifications
        ├── report.js        boîte de dialogue « Signaler »
        └── <page>.js        un module par page
```

## Choix par rapport au plan initial

- **Pas de couches controllers / models séparées** : chaque route contient sa validation, sa logique et ses requêtes SQL paramétrées. Pour une API de cette taille, cela évite de multiplier les fichiers sans bénéfice. Les règles partagées (droits sur les groupes, notifications, validations) sont isolées dans `services/` et `utils/`.
- **Profils et commentaires** sont regroupés avec les utilisateurs et les discussions (`users.routes.js`, `posts.routes.js`).
- **Pas de dossier `migrations/`** : le schéma est dans `database/database.sql`. Une modification du schéma devra passer par un script de migration dédié.
- **Frontend sans framework ni outil de build** : modules JavaScript natifs. Aucun style ni script inline, pour respecter la politique CSP du serveur.
