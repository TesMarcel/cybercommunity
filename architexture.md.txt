cyber-community/
│
├── README.md
├── .gitignore
│
├── database/
│   ├── database.sql
│   ├── seed.sql
│   └── migrations/
│
├── backend/
│   │
│   ├── package.json
│   ├── .env
│   ├── .env.example
│   ├── server.js
│   │
│   ├── src/
│   │   ├── app.js
│   │   │
│   │   ├── config/
│   │   │   ├── database.js
│   │   │   └── env.js
│   │   │
│   │   ├── routes/
│   │   │   ├── auth.routes.js
│   │   │   ├── users.routes.js
│   │   │   ├── profiles.routes.js
│   │   │   ├── posts.routes.js
│   │   │   ├── comments.routes.js
│   │   │   ├── groups.routes.js
│   │   │   ├── messages.routes.js
│   │   │   ├── reports.routes.js
│   │   │   └── notifications.routes.js
│   │   │
│   │   ├── controllers/
│   │   │   ├── auth.controller.js
│   │   │   ├── users.controller.js
│   │   │   ├── profiles.controller.js
│   │   │   ├── posts.controller.js
│   │   │   ├── comments.controller.js
│   │   │   ├── groups.controller.js
│   │   │   ├── messages.controller.js
│   │   │   ├── reports.controller.js
│   │   │   └── notifications.controller.js
│   │   │
│   │   ├── services/
│   │   │   ├── auth.service.js
│   │   │   ├── user.service.js
│   │   │   ├── post.service.js
│   │   │   ├── group.service.js
│   │   │   ├── message.service.js
│   │   │   └── notification.service.js
│   │   │
│   │   ├── models/
│   │   │   ├── user.model.js
│   │   │   ├── post.model.js
│   │   │   ├── comment.model.js
│   │   │   ├── group.model.js
│   │   │   └── message.model.js
│   │   │
│   │   ├── middlewares/
│   │   │   ├── auth.middleware.js
│   │   │   ├── role.middleware.js
│   │   │   ├── validation.middleware.js
│   │   │   ├── rateLimit.middleware.js
│   │   │   └── error.middleware.js
│   │   │
│   │   └── utils/
│   │       ├── jwt.js
│   │       ├── password.js
│   │       ├── logger.js
│   │       └── validators.js
│   │
│   ├── uploads/
│   │   ├── images/
│   │   └── files/
│   │
│   └── tests/
│
└── frontend/
    │
    ├── index.html
    ├── pages/
    │   ├── login.html
    │   ├── register.html
    │   ├── profile.html
    │   ├── forum.html
    │   ├── groups.html
    │   └── notifications.html
    │
    ├── css/
    │   ├── main.css
    │   ├── auth.css
    │   ├── forum.css
    │   └── groups.css
    │
    ├── js/
    │   ├── api.js
    │   ├── auth.js
    │   ├── profile.js
    │   ├── forum.js
    │   ├── groups.js
    │   ├── messages.js
    │   └── notifications.js
    │
    └── assets/
        ├── images/
        └── icons/