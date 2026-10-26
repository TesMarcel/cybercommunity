// Application Express : middlewares communs, routes, gestion des erreurs
const path = require("path");
const express = require("express");
const cors = require("cors");
const { imagesDir } = require("./utils/files");
const { notFound, errorHandler } = require("./middlewares/error.middleware");

const app = express();

app.disable("x-powered-by");

// Derrière un proxy (Nginx, hébergeur) : nombre de proxys à croire,
// pour que la limite de tentatives voie la vraie IP du client
if (process.env.TRUST_PROXY) {
  app.set("trust proxy", Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);
}

// En-têtes de sécurité (équivalent minimal de helmet, sans dépendance)
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data: blob:; object-src 'none'; " +
      "base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });

  // HSTS seulement en production, où le site est servi en HTTPS
  if (process.env.NODE_ENV === "production") {
    res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  next();
});

// CORS : aucune origine extérieure autorisée par défaut (frontend servi
// par ce même serveur). CORS_ORIGIN=http://localhost:5500,https://... sinon
const corsOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (corsOrigins.length > 0) {
  app.use(cors({ origin: corsOrigins }));
}

// Journal des requêtes : méthode, chemin, statut, durée.
// Jamais d'en-têtes (token), de corps ni de paramètres (recherches)
if (process.env.LOG_REQUESTS !== "false") {
  app.use((req, res, next) => {
    const start = Date.now();

    res.on("finish", () => {
      console.log(
        `${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`
      );
    });

    next();
  });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express 5 laisse req.body à undefined quand la requête n'a pas de corps
app.use((req, res, next) => {
  req.body ??= {};
  next();
});

// nosniff : le navigateur ne devine pas le type d'un fichier
// (un faux .png contenant du HTML ne sera pas exécuté)
app.use(
  "/uploads/images",
  express.static(imagesDir, {
    setHeaders: (res) => {
      res.set("X-Content-Type-Options", "nosniff");
    },
  })
);

// Frontend (HTML / CSS / JS) servi par le même serveur que l'API
app.use(express.static(path.join(__dirname, "..", "..", "frontend")));

app.get("/api/health", (req, res) => {
  res.json({
    application: "Cyber Community API",
    status: "online",
    version: "1.0.0",
  });
});

// Même ordre qu'avant le découpage
for (const name of [
  "auth",
  "users",
  "categories",
  "posts",
  "groups",
  "messages",
  "files",
  "reports",
  "moderation",
  "notifications",
]) {
  app.use(require(`./routes/${name}.routes`));
}

app.use(notFound);
app.use(errorHandler);

module.exports = app;
