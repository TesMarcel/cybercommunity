require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");
const crypto = require("crypto");
const { Pool, types } = require("pg");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Express 5 laisse req.body à undefined quand la requête n'a pas de corps
app.use((req, res, next) => {
  req.body ??= {};
  next();
});

/* =========================================================
   CONFIGURATION
========================================================= */

const PORT = process.env.PORT || 5000;

const JWT_SECRET = process.env.JWT_SECRET;

const DATABASE_URL = process.env.DATABASE_URL;

if (!JWT_SECRET || JWT_SECRET.length < 32) {
  console.error(
    "❌ JWT_SECRET doit être défini dans le fichier .env (32 caractères minimum)"
  );
  process.exit(1);
}

if (!DATABASE_URL) {
  console.error(
    "❌ DATABASE_URL n'est pas défini dans le fichier .env"
  );
  process.exit(1);
}

// BIGINT (ids, COUNT) renvoyés en nombres plutôt qu'en chaînes
types.setTypeParser(20, (value) => parseInt(value, 10));

const pool = new Pool({
  connectionString: DATABASE_URL,
});

/* =========================================================
   DOSSIER UPLOADS
========================================================= */

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "uploads");

// Photos de profil : publiques
const imagesDir = path.join(uploadDir, "images");

// Pièces jointes : privées, servies uniquement par GET /api/files/:id
const filesDir = path.join(uploadDir, "files");

fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(filesDir, { recursive: true });

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

/* =========================================================
   MULTER
========================================================= */

// Extensions acceptées pour les pièces jointes (pas d'exécutables,
// ni de HTML/SVG/JS). Les fichiers sont de toute façon téléchargés,
// jamais affichés par le navigateur.
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".txt", ".md", ".csv", ".log", ".json",
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".zip", ".gz", ".tar", ".7z",
  ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp",
  ".pcap", ".pcapng",
]);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, filesDir);
  },

  // Nom aléatoire sans extension : le nom d'origine reste en base
  filename: function (req, file, cb) {
    cb(null, crypto.randomBytes(16).toString("hex"));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: function (req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      req.fileRejected = true;
      return cb(null, false);
    }

    cb(null, true);
  },
});

// Supprime le fichier reçu si la requête échoue après l'envoi
async function discardUpload(req) {
  if (req.file) {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }
}

// Supprime des pièces jointes (base + disque) à partir de leurs URL /api/files/:id
async function deleteAttachments(urls) {
  const ids = urls
    .map((url) => /^\/api\/files\/(\d+)$/.exec(url ?? "")?.[1])
    .filter(Boolean);

  if (ids.length === 0) {
    return;
  }

  const deleted = await pool.query(
    `
    DELETE FROM files
    WHERE id = ANY($1::bigint[])
    RETURNING stored_name
    `,
    [ids]
  );

  for (const file of deleted.rows) {
    await fs.promises
      .unlink(path.join(filesDir, path.basename(file.stored_name)))
      .catch(() => {});
  }
}

// Enregistre le fichier reçu dans la table files ; renvoie la ligne créée
async function saveUploadedFile(file, uploaderId) {
  const next = await pool.query(
    "SELECT nextval(pg_get_serial_sequence('files', 'id')) AS id"
  );

  const id = next.rows[0].id;

  const result = await pool.query(
    `
    INSERT INTO files(
      id,
      uploader_id,
      original_name,
      stored_name,
      mime_type,
      size_bytes,
      url
    )
    VALUES($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      id,
      uploaderId,
      file.originalname.slice(0, 255),
      file.filename,
      file.mimetype,
      file.size,
      `/api/files/${id}`,
    ]
  );

  return result.rows[0];
}

// Photos : gardées en mémoire, vérifiées, puis écrites sur le disque
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

// Le type est déduit des premiers octets du fichier, pas du nom
// ni du type annoncé par le client (SVG exclu : il peut contenir du JS)
function detectImageType(buffer) {
  if (buffer.length < 12) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }

  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "png";
  }

  if (buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
    return "gif";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

/* =========================================================
   DATABASE
========================================================= */

// Le schéma est créé par database/database.sql (npm run db:init)
async function checkDatabase() {
  const result = await pool.query(`
    SELECT to_regclass('public.users') AS users_table
  `);

  if (!result.rows[0].users_table) {
    throw new Error(
      "Tables absentes : exécutez d'abord database/database.sql (npm run db:init)"
    );
  }

  console.log("✅ Base de données connectée");
}

/* =========================================================
   HELPERS
========================================================= */

const BCRYPT_ROUNDS = 12;

// Hash utilisé quand le login n'existe pas : bcrypt.compare prend
// alors le même temps, ce qui empêche de deviner les comptes existants
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);

// Empreinte du mot de passe stockée dans le token :
// changer de mot de passe invalide tous les anciens tokens
function passwordVersion(passwordHash) {
  return crypto
    .createHash("sha256")
    .update(passwordHash)
    .digest("hex")
    .slice(0, 16);
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      pv: passwordVersion(user.password_hash),
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "7d",
    }
  );
}

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    country: user.country,
    role: user.role,
  };
}

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// bcrypt ignore tout ce qui dépasse 72 octets
function checkPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Le mot de passe doit contenir au moins 8 caractères";
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Le mot de passe ne doit pas dépasser 72 octets";
  }

  return null;
}

// Seuls les échecs comptent : une connexion réussie ne consomme rien
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Trop de tentatives, réessayez dans 15 minutes",
  },
});

// Seuls les comptes réellement créés comptent (pas les erreurs de saisie)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.REGISTER_RATE_LIMIT) || 5,
  skipFailedRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Trop d'inscriptions depuis cette adresse, réessayez plus tard",
  },
});

async function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Token manquant",
    });
  }

  const token = header.split(" ")[1];

  let decoded;

  try {
    decoded = jwt.verify(token, JWT_SECRET, {
      algorithms: ["HS256"],
    });
  } catch (error) {
    return res.status(401).json({
      message: "Token invalide ou expiré",
    });
  }

  const result = await pool.query(
    `
    SELECT id, username, email, country, role, is_active, password_hash
    FROM users
    WHERE id = $1
    `,
    [decoded.id]
  );

  const user = result.rows[0];

  if (!user || decoded.pv !== passwordVersion(user.password_hash)) {
    return res.status(401).json({
      message: "Token invalide ou expiré",
    });
  }

  if (!user.is_active) {
    return res.status(403).json({
      message: "Compte suspendu",
    });
  }

  delete user.password_hash;

  req.user = user;

  next();
}

function adminOnly(req, res, next) {
  if (req.user.role !== "ADMIN") {
    return res.status(403).json({
      message: "Accès réservé aux administrateurs",
    });
  }

  next();
}

function moderatorOrAdmin(req, res, next) {
  if (!["ADMIN", "MODERATOR"].includes(req.user.role)) {
    return res.status(403).json({
      message: "Accès réservé à la modération",
    });
  }

  next();
}

async function notify(userId, type, message) {
  await pool.query(
    `
    INSERT INTO notifications(user_id, type, message)
    VALUES($1, $2, $3)
    `,
    [userId, type, message]
  );
}

/* =========================================================
   HEALTH CHECK
========================================================= */

app.get("/", (req, res) => {
  res.json({
    application: "Cyber Community API",
    status: "online",
    version: "1.0.0",
  });
});

/* =========================================================
   AUTH
========================================================= */

/*
POST /api/auth/register
*/

app.post("/api/auth/register", registerLimiter, async (req, res) => {
  const {
    username,
    email,
    password,
    country,
  } = req.body;

  if (!username || !email || !password || !country) {
    return res.status(400).json({
      message: "Tous les champs sont obligatoires",
    });
  }

  if (typeof username !== "string" || !USERNAME_REGEX.test(username)) {
    return res.status(400).json({
      message:
        "Le nom d'utilisateur doit contenir 3 à 30 caractères (lettres, chiffres, _ . -)",
    });
  }

  if (
    typeof email !== "string" ||
    email.length > 255 ||
    !EMAIL_REGEX.test(email)
  ) {
    return res.status(400).json({
      message: "Email invalide",
    });
  }

  if (typeof country !== "string" || country.trim().length > 100) {
    return res.status(400).json({
      message: "Pays invalide",
    });
  }

  const passwordError = checkPassword(password);

  if (passwordError) {
    return res.status(400).json({
      message: passwordError,
    });
  }

  const normalizedEmail = email.trim().toLowerCase();

  const existing = await pool.query(
    `
    SELECT id
    FROM users
    WHERE LOWER(username) = LOWER($1) OR LOWER(email) = $2
    `,
    [username, normalizedEmail]
  );

  if (existing.rows.length > 0) {
    return res.status(409).json({
      message: "Username ou email déjà utilisé",
    });
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  // Utilisateur et profil créés ensemble, ou pas du tout
  const client = await pool.connect();

  let user;

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      INSERT INTO users(
        username,
        email,
        password_hash,
        country
      )
      VALUES($1, $2, $3, $4)
      RETURNING id, username, email, country, role, password_hash
      `,
      [username, normalizedEmail, passwordHash, country.trim()]
    );

    user = result.rows[0];

    await client.query(
      `
      INSERT INTO profiles(user_id, country)
      VALUES($1, $2)
      `,
      [user.id, country.trim()]
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  res.status(201).json({
    message: "Compte créé",
    token: generateToken(user),
    user: publicUser(user),
  });
});

/*
POST /api/auth/login
*/

app.post("/api/auth/login", loginLimiter, async (req, res) => {
  const {
    login,
    password,
  } = req.body;

  if (
    typeof login !== "string" ||
    typeof password !== "string" ||
    !login ||
    !password
  ) {
    return res.status(400).json({
      message: "Login et mot de passe obligatoires",
    });
  }

  const result = await pool.query(
    `
    SELECT *
    FROM users
    WHERE LOWER(username) = LOWER($1)
    OR LOWER(email) = LOWER($1)
    `,
    [login.trim()]
  );

  const user = result.rows[0];

  // Le mot de passe est toujours vérifié, même si le compte n'existe pas
  const valid = await bcrypt.compare(
    password,
    user ? user.password_hash : DUMMY_HASH
  );

  if (!user || !valid) {
    return res.status(401).json({
      message: "Identifiants incorrects",
    });
  }

  if (!user.is_active) {
    return res.status(403).json({
      message: "Compte suspendu",
    });
  }

  res.json({
    message: "Connexion réussie",
    token: generateToken(user),
    user: publicUser(user),
  });
});

/*
GET /api/auth/me
*/

app.get("/api/auth/me", auth, async (req, res) => {
  res.json(publicUser(req.user));
});

/*
PUT /api/auth/password
*/

app.put("/api/auth/password", auth, loginLimiter, async (req, res) => {
  const {
    current_password,
    new_password,
  } = req.body;

  if (typeof current_password !== "string" || !current_password) {
    return res.status(400).json({
      message: "Mot de passe actuel obligatoire",
    });
  }

  const passwordError = checkPassword(new_password);

  if (passwordError) {
    return res.status(400).json({
      message: passwordError,
    });
  }

  const result = await pool.query(
    `
    SELECT password_hash
    FROM users
    WHERE id = $1
    `,
    [req.user.id]
  );

  const valid = await bcrypt.compare(
    current_password,
    result.rows[0].password_hash
  );

  if (!valid) {
    return res.status(401).json({
      message: "Mot de passe actuel incorrect",
    });
  }

  const passwordHash = await bcrypt.hash(new_password, BCRYPT_ROUNDS);

  const updated = await pool.query(
    `
    UPDATE users
    SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, username, email, country, role, password_hash
    `,
    [passwordHash, req.user.id]
  );

  // Les anciens tokens deviennent invalides : on en renvoie un nouveau
  res.json({
    message: "Mot de passe modifié",
    token: generateToken(updated.rows[0]),
  });
});

/* =========================================================
   USERS
========================================================= */

const isModerator = (user) => ["ADMIN", "MODERATOR"].includes(user.role);

/*
GET /api/users?q=&page=1&limit=20
*/

app.get("/api/users", auth, async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";

  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  // % et _ sont des jokers pour ILIKE : on les échappe
  const pattern = `%${q.replace(/[\\%_]/g, "\\$&")}%`;

  const result = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.country,
      u.role,
      u.is_active,
      u.created_at,
      p.pseudonym,
      p.photo_url,
      COUNT(*) OVER() AS total
    FROM users u
    LEFT JOIN profiles p
      ON p.user_id = u.id
    WHERE u.username ILIKE $1
    OR p.pseudonym ILIKE $1
    ORDER BY u.created_at DESC
    LIMIT $2 OFFSET $3
    `,
    [pattern, limit, (page - 1) * limit]
  );

  const showStatus = isModerator(req.user);

  const users = result.rows.map(({ total, is_active, ...user }) =>
    showStatus ? { ...user, is_active } : user
  );

  res.json({
    users,
    total: result.rows[0]?.total ?? 0,
    page,
    limit,
  });
});

/*
GET /api/users/:id
*/

app.get("/api/users/:id", auth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      u.id,
      u.username,
      u.email,
      u.country,
      u.role,
      u.is_active,
      u.created_at,
      p.pseudonym,
      p.photo_url,
      p.full_name,
      p.biography,
      p.skills
    FROM users u
    LEFT JOIN profiles p
      ON p.user_id = u.id
    WHERE u.id = $1
    `,
    [req.params.id]
  );

  if (result.rows.length === 0) {
    return res.status(404).json({
      message: "Utilisateur introuvable",
    });
  }

  const user = result.rows[0];

  // Email visible uniquement par l'utilisateur lui-même et les admins
  if (user.id !== req.user.id && req.user.role !== "ADMIN") {
    delete user.email;
  }

  if (!isModerator(req.user)) {
    delete user.is_active;
  }

  res.json(user);
});

/*
PUT /api/users/profile
Seuls les champs envoyés sont modifiés ; null ou "" vide un champ
*/

const PROFILE_FIELDS = {
  pseudonym: 100,
  full_name: 150,
  country: 100,
  biography: 2000,
  skills: 500,
};

app.put("/api/users/profile", auth, async (req, res) => {
  const columns = [];
  const values = [];

  for (const [field, maxLength] of Object.entries(PROFILE_FIELDS)) {
    if (!Object.hasOwn(req.body, field)) {
      continue;
    }

    let value = req.body[field];

    if (value !== null && typeof value !== "string") {
      return res.status(400).json({
        message: `Le champ ${field} doit être du texte`,
      });
    }

    value = value?.trim() || null;

    if (value && value.length > maxLength) {
      return res.status(400).json({
        message: `Le champ ${field} ne doit pas dépasser ${maxLength} caractères`,
      });
    }

    values.push(value);
    columns.push(`${field} = $${values.length}`);
  }

  if (columns.length === 0) {
    return res.status(400).json({
      message: "Aucun champ à modifier",
    });
  }

  values.push(req.user.id);

  const result = await pool.query(
    `
    UPDATE profiles
    SET ${columns.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE user_id = $${values.length}
    RETURNING *
    `,
    values
  );

  res.json(result.rows[0]);
});

/*
POST /api/users/profile/photo
JPEG, PNG, GIF ou WebP, 2 Mo maximum
*/

app.post(
  "/api/users/profile/photo",
  auth,
  photoUpload.single("photo"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({
        message: "Photo manquante",
      });
    }

    const extension = detectImageType(req.file.buffer);

    if (!extension) {
      return res.status(400).json({
        message: "Format non autorisé (JPEG, PNG, GIF ou WebP uniquement)",
      });
    }

    const filename = `${crypto.randomBytes(16).toString("hex")}.${extension}`;

    await fs.promises.writeFile(
      path.join(imagesDir, filename),
      req.file.buffer
    );

    const url = `/uploads/images/${filename}`;

    const previous = await pool.query(
      `
      SELECT photo_url
      FROM profiles
      WHERE user_id = $1
      `,
      [req.user.id]
    );

    await pool.query(
      `
      UPDATE profiles
      SET photo_url = $1, updated_at = CURRENT_TIMESTAMP
      WHERE user_id = $2
      `,
      [url, req.user.id]
    );

    // Suppression de l'ancienne photo (uniquement dans uploads/images)
    const oldUrl = previous.rows[0]?.photo_url;

    if (oldUrl?.startsWith("/uploads/images/")) {
      await fs.promises
        .unlink(path.join(imagesDir, path.basename(oldUrl)))
        .catch(() => {});
    }

    res.json({
      message: "Photo mise à jour",
      url,
    });
  }
);

/* =========================================================
   CATEGORIES
========================================================= */

// Vérifie un champ texte obligatoire ; renvoie un message d'erreur ou null
function checkText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    return `${label} obligatoire`;
  }

  if (value.trim().length > maxLength) {
    return `${label} : ${maxLength} caractères maximum`;
  }

  return null;
}

/*
GET /api/categories
*/

app.get("/api/categories", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT
      c.*,
      (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id) AS posts
    FROM categories c
    ORDER BY c.name
  `);

  res.json(result.rows);
});

/*
POST /api/categories
ADMIN ONLY
*/

app.post(
  "/api/categories",
  auth,
  adminOnly,
  async (req, res) => {
    const error = checkText(req.body.name, "Nom", 100);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await pool.query(
      `
      INSERT INTO categories(name)
      VALUES($1)
      RETURNING *
      `,
      [req.body.name.trim()]
    );

    res.status(201).json(result.rows[0]);
  }
);

/*
PUT /api/categories/:id
ADMIN ONLY
*/

app.put(
  "/api/categories/:id",
  auth,
  adminOnly,
  async (req, res) => {
    const error = checkText(req.body.name, "Nom", 100);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await pool.query(
      `
      UPDATE categories
      SET name = $1
      WHERE id = $2
      RETURNING *
      `,
      [req.body.name.trim(), req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Catégorie introuvable",
      });
    }

    res.json(result.rows[0]);
  }
);

/*
DELETE /api/categories/:id
ADMIN ONLY — les discussions restent, sans catégorie
*/

app.delete(
  "/api/categories/:id",
  auth,
  adminOnly,
  async (req, res) => {
    const result = await pool.query(
      `
      DELETE FROM categories
      WHERE id = $1
      RETURNING id
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Catégorie introuvable",
      });
    }

    res.json({
      message: "Catégorie supprimée",
    });
  }
);

/* =========================================================
   FORUM
========================================================= */

const POST_TITLE_MAX = 200;
const POST_CONTENT_MAX = 20000;
const COMMENT_MAX = 5000;

// Auteur du contenu, ou modérateur / admin
const canManage = (user, authorId) =>
  user.id === authorId || isModerator(user);

/*
GET /api/posts?category_id=&author_id=&q=&page=1&limit=20
*/

app.get("/api/posts", auth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  const filters = [];
  const values = [req.user.id];

  if (req.query.category_id) {
    values.push(req.query.category_id);
    filters.push(`p.category_id = $${values.length}`);
  }

  if (req.query.author_id) {
    values.push(req.query.author_id);
    filters.push(`p.author_id = $${values.length}`);
  }

  if (typeof req.query.q === "string" && req.query.q.trim()) {
    values.push(`%${req.query.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    filters.push(
      `(p.title ILIKE $${values.length} OR p.content ILIKE $${values.length})`
    );
  }

  values.push(limit, (page - 1) * limit);

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      p.updated_at,
      u.id AS author_id,
      u.username AS author,
      c.id AS category_id,
      c.name AS category,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comments,
      EXISTS(
        SELECT 1 FROM post_likes l
        WHERE l.post_id = p.id AND l.user_id = $1
      ) AS liked_by_me,
      COUNT(*) OVER() AS total
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${filters.length ? "WHERE " + filters.join(" AND ") : ""}
    ORDER BY p.created_at DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values
  );

  res.json({
    posts: result.rows.map(({ total, ...post }) => post),
    total: result.rows[0]?.total ?? 0,
    page,
    limit,
  });
});

/*
GET /api/posts/:id
*/

app.get("/api/posts/:id", auth, async (req, res) => {
  const post = await pool.query(
    `
    SELECT
      p.*,
      u.username AS author,
      c.name AS category,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      EXISTS(
        SELECT 1 FROM post_likes l
        WHERE l.post_id = p.id AND l.user_id = $2
      ) AS liked_by_me
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = $1
    `,
    [req.params.id, req.user.id]
  );

  if (post.rows.length === 0) {
    return res.status(404).json({
      message: "Discussion introuvable",
    });
  }

  const comments = await pool.query(
    `
    SELECT
      c.*,
      u.username
    FROM comments c
    JOIN users u ON u.id = c.author_id
    WHERE c.post_id = $1
    ORDER BY c.created_at ASC
    `,
    [req.params.id]
  );

  res.json({
    post: post.rows[0],
    comments: comments.rows,
  });
});

/*
POST /api/posts
Tous les membres
*/

app.post("/api/posts", auth, async (req, res) => {
  const {
    title,
    content,
    category_id,
  } = req.body;

  const error =
    checkText(title, "Titre", POST_TITLE_MAX) ||
    checkText(content, "Contenu", POST_CONTENT_MAX);

  if (error) {
    return res.status(400).json({
      message: error,
    });
  }

  // Catégorie facultative ; une catégorie inexistante donne un 400
  const result = await pool.query(
    `
    INSERT INTO posts(
      author_id,
      category_id,
      title,
      content
    )
    VALUES($1, $2, $3, $4)
    RETURNING *
    `,
    [
      req.user.id,
      category_id || null,
      title.trim(),
      content.trim(),
    ]
  );

  res.status(201).json(result.rows[0]);
});

/*
PUT /api/posts/:id
Auteur uniquement — seuls les champs envoyés sont modifiés
*/

app.put("/api/posts/:id", auth, async (req, res) => {
  const existing = await pool.query(
    `
    SELECT author_id
    FROM posts
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Discussion introuvable",
    });
  }

  if (existing.rows[0].author_id !== req.user.id) {
    return res.status(403).json({
      message: "Seul l'auteur peut modifier cette discussion",
    });
  }

  const columns = [];
  const values = [];

  for (const [field, label, maxLength] of [
    ["title", "Titre", POST_TITLE_MAX],
    ["content", "Contenu", POST_CONTENT_MAX],
  ]) {
    if (!Object.hasOwn(req.body, field)) {
      continue;
    }

    const error = checkText(req.body[field], label, maxLength);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    values.push(req.body[field].trim());
    columns.push(`${field} = $${values.length}`);
  }

  if (Object.hasOwn(req.body, "category_id")) {
    values.push(req.body.category_id || null);
    columns.push(`category_id = $${values.length}`);
  }

  if (columns.length === 0) {
    return res.status(400).json({
      message: "Aucun champ à modifier",
    });
  }

  values.push(req.params.id);

  const result = await pool.query(
    `
    UPDATE posts
    SET ${columns.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${values.length}
    RETURNING *
    `,
    values
  );

  res.json(result.rows[0]);
});

/*
DELETE /api/posts/:id
Auteur, modérateur ou admin
*/

app.delete("/api/posts/:id", auth, async (req, res) => {
  const existing = await pool.query(
    `
    SELECT author_id
    FROM posts
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Discussion introuvable",
    });
  }

  if (!canManage(req.user, existing.rows[0].author_id)) {
    return res.status(403).json({
      message: "Vous ne pouvez pas supprimer cette discussion",
    });
  }

  await pool.query(
    `
    DELETE FROM posts
    WHERE id = $1
    `,
    [req.params.id]
  );

  res.json({
    message: "Discussion supprimée",
  });
});

/*
POST /api/posts/:id/comments
*/

app.post(
  "/api/posts/:id/comments",
  auth,
  async (req, res) => {
    const {
      content,
      parent_id,
    } = req.body;

    const error = checkText(content, "Contenu", COMMENT_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const post = await pool.query(
      `
      SELECT author_id
      FROM posts
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (post.rows.length === 0) {
      return res.status(404).json({
        message: "Discussion introuvable",
      });
    }

    // Une réponse doit viser un commentaire de la même discussion
    let parent = null;

    if (parent_id) {
      const parentResult = await pool.query(
        `
        SELECT id, author_id
        FROM comments
        WHERE id = $1
        AND post_id = $2
        `,
        [parent_id, req.params.id]
      );

      parent = parentResult.rows[0];

      if (!parent) {
        return res.status(400).json({
          message: "Le commentaire parent n'appartient pas à cette discussion",
        });
      }
    }

    const result = await pool.query(
      `
      INSERT INTO comments(
        post_id,
        author_id,
        parent_id,
        content
      )
      VALUES($1, $2, $3, $4)
      RETURNING *
      `,
      [
        req.params.id,
        req.user.id,
        parent ? parent.id : null,
        content.trim(),
      ]
    );

    // Pas de notification pour ses propres contenus
    const postAuthorId = post.rows[0].author_id;

    if (postAuthorId !== req.user.id) {
      await notify(
        postAuthorId,
        "COMMENT",
        `${req.user.username} a commenté votre discussion.`
      );
    }

    if (
      parent &&
      parent.author_id !== req.user.id &&
      parent.author_id !== postAuthorId
    ) {
      await notify(
        parent.author_id,
        "REPLY",
        `${req.user.username} a répondu à votre commentaire.`
      );
    }

    res.status(201).json(result.rows[0]);
  }
);

/*
PUT /api/comments/:id
Auteur uniquement
*/

app.put("/api/comments/:id", auth, async (req, res) => {
  const error = checkText(req.body.content, "Contenu", COMMENT_MAX);

  if (error) {
    return res.status(400).json({
      message: error,
    });
  }

  const existing = await pool.query(
    `
    SELECT author_id
    FROM comments
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Commentaire introuvable",
    });
  }

  if (existing.rows[0].author_id !== req.user.id) {
    return res.status(403).json({
      message: "Seul l'auteur peut modifier ce commentaire",
    });
  }

  const result = await pool.query(
    `
    UPDATE comments
    SET content = $1
    WHERE id = $2
    RETURNING *
    `,
    [req.body.content.trim(), req.params.id]
  );

  res.json(result.rows[0]);
});

/*
DELETE /api/comments/:id
Auteur, modérateur ou admin — les réponses sont supprimées avec
*/

app.delete("/api/comments/:id", auth, async (req, res) => {
  const existing = await pool.query(
    `
    SELECT author_id
    FROM comments
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Commentaire introuvable",
    });
  }

  if (!canManage(req.user, existing.rows[0].author_id)) {
    return res.status(403).json({
      message: "Vous ne pouvez pas supprimer ce commentaire",
    });
  }

  await pool.query(
    `
    DELETE FROM comments
    WHERE id = $1
    `,
    [req.params.id]
  );

  res.json({
    message: "Commentaire supprimé",
  });
});

/*
POST /api/posts/:id/like
Ajoute ou retire le like
*/

app.post(
  "/api/posts/:id/like",
  auth,
  async (req, res) => {
    const post = await pool.query(
      `
      SELECT id
      FROM posts
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (post.rows.length === 0) {
      return res.status(404).json({
        message: "Discussion introuvable",
      });
    }

    // Insertion atomique : deux clics simultanés ne créent pas d'erreur
    const inserted = await pool.query(
      `
      INSERT INTO post_likes(
        post_id,
        user_id
      )
      VALUES($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [
        req.params.id,
        req.user.id,
      ]
    );

    const liked = inserted.rowCount === 1;

    if (!liked) {
      await pool.query(
        `
        DELETE FROM post_likes
        WHERE post_id = $1
        AND user_id = $2
        `,
        [
          req.params.id,
          req.user.id,
        ]
      );
    }

    const count = await pool.query(
      `
      SELECT COUNT(*) AS likes
      FROM post_likes
      WHERE post_id = $1
      `,
      [req.params.id]
    );

    res.json({
      liked,
      likes: count.rows[0].likes,
    });
  }
);

/* =========================================================
   GROUPES
========================================================= */

const GROUP_NAME_MAX = 120;
const GROUP_DESCRIPTION_MAX = 2000;

// Droits d'un utilisateur sur un groupe.
// Groupe public : lisible par tous. Groupe privé : membres uniquement.
// Admin du site : tous les droits ; modérateur : lecture (modération).
async function groupAccess(groupId, user) {
  const result = await pool.query(
    `
    SELECT
      g.id,
      g.is_private,
      gm.group_role
    FROM groups_table g
    LEFT JOIN group_members gm
      ON gm.group_id = g.id
      AND gm.user_id = $2
    WHERE g.id = $1
    `,
    [groupId, user.id]
  );

  const group = result.rows[0];

  if (!group) {
    return null;
  }

  const isMember = Boolean(group.group_role);
  const siteAdmin = user.role === "ADMIN";

  return {
    isMember,
    canRead: isMember || !group.is_private || isModerator(user),
    canWrite: isMember || siteAdmin,
    canAdmin: group.group_role === "ADMIN" || siteAdmin,
  };
}

// Charge les droits et répond 404 / 403 si besoin ; renvoie null dans ce cas
async function requireGroup(req, res, right) {
  const access = await groupAccess(req.params.id, req.user);

  if (!access) {
    res.status(404).json({
      message: "Groupe introuvable",
    });
    return null;
  }

  if (!access[right]) {
    res.status(403).json({
      message:
        right === "canAdmin"
          ? "Réservé aux administrateurs du groupe"
          : "Vous n'êtes pas membre de ce groupe",
    });
    return null;
  }

  return access;
}

async function countGroupAdmins(groupId) {
  const result = await pool.query(
    `
    SELECT COUNT(*) AS admins
    FROM group_members
    WHERE group_id = $1
    AND group_role = 'ADMIN'
    `,
    [groupId]
  );

  return result.rows[0].admins;
}

/*
GET /api/groups
Groupes publics + groupes dont on est membre (tous pour la modération)
*/

app.get("/api/groups", auth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      g.id,
      g.name,
      g.description,
      g.is_private,
      g.created_at,
      u.username AS creator,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
      me.group_role AS my_role
    FROM groups_table g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN group_members me
      ON me.group_id = g.id
      AND me.user_id = $1
    WHERE g.is_private = FALSE
    OR me.user_id IS NOT NULL
    OR $2
    ORDER BY g.created_at DESC
    `,
    [req.user.id, isModerator(req.user)]
  );

  res.json(result.rows);
});

/*
GET /api/groups/:id
*/

app.get("/api/groups/:id", auth, async (req, res) => {
  if (!(await requireGroup(req, res, "canRead"))) {
    return;
  }

  const result = await pool.query(
    `
    SELECT
      g.*,
      u.username AS creator,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
      me.group_role AS my_role
    FROM groups_table g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN group_members me
      ON me.group_id = g.id
      AND me.user_id = $2
    WHERE g.id = $1
    `,
    [req.params.id, req.user.id]
  );

  res.json(result.rows[0]);
});

/*
POST /api/groups
ADMIN ONLY — is_private vaut true par défaut
*/

app.post(
  "/api/groups",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      name,
      description,
      is_private,
    } = req.body;

    const error = checkText(name, "Nom du groupe", GROUP_NAME_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    if (description != null && typeof description !== "string") {
      return res.status(400).json({
        message: "Description invalide",
      });
    }

    if (description && description.length > GROUP_DESCRIPTION_MAX) {
      return res.status(400).json({
        message: `Description : ${GROUP_DESCRIPTION_MAX} caractères maximum`,
      });
    }

    const client = await pool.connect();

    let group;

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
        INSERT INTO groups_table(
          name,
          description,
          is_private,
          created_by
        )
        VALUES($1, $2, $3, $4)
        RETURNING *
        `,
        [
          name.trim(),
          description?.trim() || null,
          is_private !== false,
          req.user.id,
        ]
      );

      group = result.rows[0];

      await client.query(
        `
        INSERT INTO group_members(
          group_id,
          user_id,
          group_role
        )
        VALUES($1, $2, 'ADMIN')
        `,
        [group.id, req.user.id]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json(group);
  }
);

/*
PUT /api/groups/:id
Administrateurs du groupe — seuls les champs envoyés sont modifiés
*/

app.put("/api/groups/:id", auth, async (req, res) => {
  if (!(await requireGroup(req, res, "canAdmin"))) {
    return;
  }

  const columns = [];
  const values = [];

  if (Object.hasOwn(req.body, "name")) {
    const error = checkText(req.body.name, "Nom du groupe", GROUP_NAME_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    values.push(req.body.name.trim());
    columns.push(`name = $${values.length}`);
  }

  if (Object.hasOwn(req.body, "description")) {
    const description = req.body.description;

    if (description !== null && typeof description !== "string") {
      return res.status(400).json({
        message: "Description invalide",
      });
    }

    if (description && description.length > GROUP_DESCRIPTION_MAX) {
      return res.status(400).json({
        message: `Description : ${GROUP_DESCRIPTION_MAX} caractères maximum`,
      });
    }

    values.push(description?.trim() || null);
    columns.push(`description = $${values.length}`);
  }

  if (Object.hasOwn(req.body, "is_private")) {
    if (typeof req.body.is_private !== "boolean") {
      return res.status(400).json({
        message: "is_private doit valoir true ou false",
      });
    }

    values.push(req.body.is_private);
    columns.push(`is_private = $${values.length}`);
  }

  if (columns.length === 0) {
    return res.status(400).json({
      message: "Aucun champ à modifier",
    });
  }

  values.push(req.params.id);

  const result = await pool.query(
    `
    UPDATE groups_table
    SET ${columns.join(", ")}
    WHERE id = $${values.length}
    RETURNING *
    `,
    values
  );

  res.json(result.rows[0]);
});

/*
DELETE /api/groups/:id
Administrateurs du groupe — supprime aussi discussions et messages
*/

app.delete("/api/groups/:id", auth, async (req, res) => {
  if (!(await requireGroup(req, res, "canAdmin"))) {
    return;
  }

  const attachments = await pool.query(
    `
    SELECT file_url
    FROM group_messages
    WHERE group_id = $1
    AND file_url IS NOT NULL
    `,
    [req.params.id]
  );

  await deleteAttachments(attachments.rows.map((row) => row.file_url));

  await pool.query(
    `
    DELETE FROM groups_table
    WHERE id = $1
    `,
    [req.params.id]
  );

  res.json({
    message: "Groupe supprimé",
  });
});

/*
POST /api/groups/:id/join
Rejoindre un groupe public
*/

app.post("/api/groups/:id/join", auth, async (req, res) => {
  const access = await groupAccess(req.params.id, req.user);

  if (!access) {
    return res.status(404).json({
      message: "Groupe introuvable",
    });
  }

  if (access.isMember) {
    return res.status(409).json({
      message: "Vous êtes déjà membre de ce groupe",
    });
  }

  const group = await pool.query(
    `
    SELECT is_private
    FROM groups_table
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (group.rows[0].is_private) {
    return res.status(403).json({
      message: "Groupe privé : un administrateur du groupe doit vous ajouter",
    });
  }

  await pool.query(
    `
    INSERT INTO group_members(group_id, user_id)
    VALUES($1, $2)
    ON CONFLICT DO NOTHING
    `,
    [req.params.id, req.user.id]
  );

  res.status(201).json({
    message: "Vous avez rejoint le groupe",
  });
});

/*
POST /api/groups/:id/members
Administrateurs du groupe
*/

app.post(
  "/api/groups/:id/members",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canAdmin"))) {
      return;
    }

    const {
      user_id,
    } = req.body;

    if (!user_id) {
      return res.status(400).json({
        message: "user_id obligatoire",
      });
    }

    const inserted = await pool.query(
      `
      INSERT INTO group_members(
        group_id,
        user_id
      )
      VALUES($1, $2)
      ON CONFLICT(group_id, user_id)
      DO NOTHING
      `,
      [
        req.params.id,
        user_id,
      ]
    );

    if (inserted.rowCount === 0) {
      return res.status(409).json({
        message: "Cet utilisateur est déjà membre",
      });
    }

    await notify(
      user_id,
      "GROUP_ADDED",
      "Vous avez été ajouté à un groupe."
    );

    res.status(201).json({
      message: "Membre ajouté",
    });
  }
);

/*
GET /api/groups/:id/members
*/

app.get(
  "/api/groups/:id/members",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.country,
        gm.group_role,
        gm.joined_at
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY gm.joined_at
      `,
      [req.params.id]
    );

    res.json(result.rows);
  }
);

/*
PUT /api/groups/:id/members/:userId
Changer le rôle (MEMBER / ADMIN) — administrateurs du groupe
*/

app.put(
  "/api/groups/:id/members/:userId",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canAdmin"))) {
      return;
    }

    const { group_role } = req.body;

    if (!["MEMBER", "ADMIN"].includes(group_role)) {
      return res.status(400).json({
        message: "group_role doit valoir MEMBER ou ADMIN",
      });
    }

    const current = await pool.query(
      `
      SELECT group_role
      FROM group_members
      WHERE group_id = $1
      AND user_id = $2
      `,
      [req.params.id, req.params.userId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        message: "Membre introuvable",
      });
    }

    if (
      current.rows[0].group_role === "ADMIN" &&
      group_role === "MEMBER" &&
      (await countGroupAdmins(req.params.id)) <= 1
    ) {
      return res.status(400).json({
        message: "Le groupe doit garder au moins un administrateur",
      });
    }

    const result = await pool.query(
      `
      UPDATE group_members
      SET group_role = $1
      WHERE group_id = $2
      AND user_id = $3
      RETURNING user_id, group_role
      `,
      [group_role, req.params.id, req.params.userId]
    );

    res.json(result.rows[0]);
  }
);

/*
DELETE /api/groups/:id/members/:userId
Quitter le groupe (soi-même) ou retirer un membre (administrateurs)
*/

app.delete(
  "/api/groups/:id/members/:userId",
  auth,
  async (req, res) => {
    const isSelf = Number(req.params.userId) === req.user.id;

    if (!(await requireGroup(req, res, isSelf ? "isMember" : "canAdmin"))) {
      return;
    }

    const current = await pool.query(
      `
      SELECT group_role
      FROM group_members
      WHERE group_id = $1
      AND user_id = $2
      `,
      [req.params.id, req.params.userId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        message: "Membre introuvable",
      });
    }

    if (
      current.rows[0].group_role === "ADMIN" &&
      (await countGroupAdmins(req.params.id)) <= 1
    ) {
      return res.status(400).json({
        message:
          "Le dernier administrateur ne peut pas quitter le groupe : nommez d'abord un autre administrateur",
      });
    }

    await pool.query(
      `
      DELETE FROM group_members
      WHERE group_id = $1
      AND user_id = $2
      `,
      [req.params.id, req.params.userId]
    );

    res.json({
      message: isSelf ? "Vous avez quitté le groupe" : "Membre retiré",
    });
  }
);

/*
GET /api/groups/:id/posts
*/

app.get(
  "/api/groups/:id/posts",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const result = await pool.query(
      `
      SELECT
        gp.*,
        u.username,
        (SELECT COUNT(*) FROM group_comments gc WHERE gc.group_post_id = gp.id) AS comments
      FROM group_posts gp
      JOIN users u ON u.id = gp.author_id
      WHERE gp.group_id = $1
      ORDER BY gp.created_at DESC
      `,
      [req.params.id]
    );

    res.json(result.rows);
  }
);

/*
POST /api/groups/:id/posts
*/

app.post(
  "/api/groups/:id/posts",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canWrite"))) {
      return;
    }

    const {
      title,
      content,
    } = req.body;

    const error =
      checkText(title, "Titre", POST_TITLE_MAX) ||
      checkText(content, "Contenu", POST_CONTENT_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await pool.query(
      `
      INSERT INTO group_posts(
        group_id,
        author_id,
        title,
        content
      )
      VALUES($1, $2, $3, $4)
      RETURNING *
      `,
      [
        req.params.id,
        req.user.id,
        title.trim(),
        content.trim(),
      ]
    );

    res.status(201).json(result.rows[0]);
  }
);

// Discussion du groupe :id, ou réponse 404 ; renvoie null dans ce cas
async function findGroupPost(req, res) {
  const result = await pool.query(
    `
    SELECT *
    FROM group_posts
    WHERE id = $1
    AND group_id = $2
    `,
    [req.params.postId, req.params.id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({
      message: "Discussion introuvable",
    });
    return null;
  }

  return result.rows[0];
}

/*
GET /api/groups/:id/posts/:postId
Discussion et ses commentaires
*/

app.get(
  "/api/groups/:id/posts/:postId",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

    const comments = await pool.query(
      `
      SELECT
        gc.*,
        u.username
      FROM group_comments gc
      JOIN users u ON u.id = gc.author_id
      WHERE gc.group_post_id = $1
      ORDER BY gc.created_at ASC
      `,
      [post.id]
    );

    res.json({
      post,
      comments: comments.rows,
    });
  }
);

/*
PUT /api/groups/:id/posts/:postId
Auteur uniquement
*/

app.put(
  "/api/groups/:id/posts/:postId",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

    if (post.author_id !== req.user.id) {
      return res.status(403).json({
        message: "Seul l'auteur peut modifier cette discussion",
      });
    }

    const title = req.body.title ?? post.title;
    const content = req.body.content ?? post.content;

    const error =
      checkText(title, "Titre", POST_TITLE_MAX) ||
      checkText(content, "Contenu", POST_CONTENT_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await pool.query(
      `
      UPDATE group_posts
      SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [title.trim(), content.trim(), post.id]
    );

    res.json(result.rows[0]);
  }
);

/*
DELETE /api/groups/:id/posts/:postId
Auteur, administrateurs du groupe ou modération
*/

app.delete(
  "/api/groups/:id/posts/:postId",
  auth,
  async (req, res) => {
    const access = await requireGroup(req, res, "canRead");

    if (!access) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

    if (!access.canAdmin && !canManage(req.user, post.author_id)) {
      return res.status(403).json({
        message: "Vous ne pouvez pas supprimer cette discussion",
      });
    }

    await pool.query(
      `
      DELETE FROM group_posts
      WHERE id = $1
      `,
      [post.id]
    );

    res.json({
      message: "Discussion supprimée",
    });
  }
);

/*
POST /api/groups/:id/posts/:postId/comments
*/

app.post(
  "/api/groups/:id/posts/:postId/comments",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canWrite"))) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

    const {
      content,
      parent_id,
    } = req.body;

    const error = checkText(content, "Contenu", COMMENT_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    let parent = null;

    if (parent_id) {
      const parentResult = await pool.query(
        `
        SELECT id, author_id
        FROM group_comments
        WHERE id = $1
        AND group_post_id = $2
        `,
        [parent_id, post.id]
      );

      parent = parentResult.rows[0];

      if (!parent) {
        return res.status(400).json({
          message: "Le commentaire parent n'appartient pas à cette discussion",
        });
      }
    }

    const result = await pool.query(
      `
      INSERT INTO group_comments(
        group_post_id,
        author_id,
        parent_id,
        content
      )
      VALUES($1, $2, $3, $4)
      RETURNING *
      `,
      [post.id, req.user.id, parent ? parent.id : null, content.trim()]
    );

    if (post.author_id !== req.user.id) {
      await notify(
        post.author_id,
        "GROUP_COMMENT",
        `${req.user.username} a commenté votre discussion de groupe.`
      );
    }

    if (
      parent &&
      parent.author_id !== req.user.id &&
      parent.author_id !== post.author_id
    ) {
      await notify(
        parent.author_id,
        "REPLY",
        `${req.user.username} a répondu à votre commentaire.`
      );
    }

    res.status(201).json(result.rows[0]);
  }
);

/*
DELETE /api/groups/:id/comments/:commentId
Auteur, administrateurs du groupe ou modération
*/

app.delete(
  "/api/groups/:id/comments/:commentId",
  auth,
  async (req, res) => {
    const access = await requireGroup(req, res, "canRead");

    if (!access) {
      return;
    }

    const result = await pool.query(
      `
      SELECT gc.author_id
      FROM group_comments gc
      JOIN group_posts gp ON gp.id = gc.group_post_id
      WHERE gc.id = $1
      AND gp.group_id = $2
      `,
      [req.params.commentId, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Commentaire introuvable",
      });
    }

    if (!access.canAdmin && !canManage(req.user, result.rows[0].author_id)) {
      return res.status(403).json({
        message: "Vous ne pouvez pas supprimer ce commentaire",
      });
    }

    await pool.query(
      `
      DELETE FROM group_comments
      WHERE id = $1
      `,
      [req.params.commentId]
    );

    res.json({
      message: "Commentaire supprimé",
    });
  }
);

/* =========================================================
   MESSAGES DE GROUPE
========================================================= */

const MESSAGE_MAX = 5000;

// Vérifie l'appartenance AVANT de recevoir le fichier :
// un non-membre ne peut rien déposer sur le disque
async function groupWriter(req, res, next) {
  if (await requireGroup(req, res, "canWrite")) {
    next();
  }
}

/*
POST /api/groups/:id/messages
Texte (content) et/ou pièce jointe (file, 10 Mo max)
*/

app.post(
  "/api/groups/:id/messages",
  auth,
  groupWriter,
  upload.single("file"),
  async (req, res) => {
    if (req.fileRejected) {
      return res.status(400).json({
        message: "Type de fichier non autorisé",
      });
    }

    let content = req.body.content ?? null;

    if (content !== null && typeof content !== "string") {
      await discardUpload(req);
      return res.status(400).json({
        message: "Message invalide",
      });
    }

    content = content?.trim() || null;

    if (!content && !req.file) {
      return res.status(400).json({
        message: "Message ou fichier obligatoire",
      });
    }

    if (content && content.length > MESSAGE_MAX) {
      await discardUpload(req);
      return res.status(400).json({
        message: `Message : ${MESSAGE_MAX} caractères maximum`,
      });
    }

    let file = null;

    if (req.file) {
      file = await saveUploadedFile(req.file, req.user.id);
    }

    const result = await pool.query(
      `
      INSERT INTO group_messages(
        group_id,
        sender_id,
        content,
        file_url,
        file_name
      )
      VALUES($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        req.params.id,
        req.user.id,
        content,
        file?.url ?? null,
        file?.original_name ?? null,
      ]
    );

    res.status(201).json(result.rows[0]);
  }
);

/*
GET /api/groups/:id/messages
  ?limit=50              derniers messages
  ?before=<id>           messages plus anciens (historique)
  ?after=<id>            nouveaux messages (rafraîchissement)
Toujours triés du plus ancien au plus récent
*/

app.get(
  "/api/groups/:id/messages",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 100);

    const after = parseInt(req.query.after, 10);
    const before = parseInt(req.query.before, 10);

    let result;

    if (after) {
      result = await pool.query(
        `
        SELECT gm.*, u.username
        FROM group_messages gm
        JOIN users u ON u.id = gm.sender_id
        WHERE gm.group_id = $1
        AND gm.id > $2
        ORDER BY gm.id ASC
        LIMIT $3
        `,
        [req.params.id, after, limit]
      );
    } else {
      result = await pool.query(
        `
        SELECT gm.*, u.username
        FROM group_messages gm
        JOIN users u ON u.id = gm.sender_id
        WHERE gm.group_id = $1
        AND ($2::bigint IS NULL OR gm.id < $2)
        ORDER BY gm.id DESC
        LIMIT $3
        `,
        [req.params.id, before || null, limit]
      );

      result.rows.reverse();
    }

    res.json(result.rows);
  }
);

/*
DELETE /api/groups/:id/messages/:messageId
Expéditeur, administrateurs du groupe ou modération
*/

app.delete(
  "/api/groups/:id/messages/:messageId",
  auth,
  async (req, res) => {
    const access = await requireGroup(req, res, "canRead");

    if (!access) {
      return;
    }

    const result = await pool.query(
      `
      SELECT sender_id, file_url
      FROM group_messages
      WHERE id = $1
      AND group_id = $2
      `,
      [req.params.messageId, req.params.id]
    );

    const message = result.rows[0];

    if (!message) {
      return res.status(404).json({
        message: "Message introuvable",
      });
    }

    if (!access.canAdmin && !canManage(req.user, message.sender_id)) {
      return res.status(403).json({
        message: "Vous ne pouvez pas supprimer ce message",
      });
    }

    await pool.query(
      `
      DELETE FROM group_messages
      WHERE id = $1
      `,
      [req.params.messageId]
    );

    await deleteAttachments([message.file_url]);

    res.json({
      message: "Message supprimé",
    });
  }
);

/* =========================================================
   FILES
========================================================= */

/*
POST /api/files
*/

app.post(
  "/api/files",
  auth,
  upload.single("file"),
  async (req, res) => {
    if (req.fileRejected) {
      return res.status(400).json({
        message: "Type de fichier non autorisé",
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: "Fichier manquant",
      });
    }

    const file = await saveUploadedFile(req.file, req.user.id);

    res.status(201).json(file);
  }
);

/*
GET /api/files/:id
Téléchargement : déposant, admin du site, ou membres du groupe
dont un message contient ce fichier
*/

app.get("/api/files/:id", auth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT *
    FROM files
    WHERE id = $1
    `,
    [req.params.id]
  );

  const file = result.rows[0];

  if (!file) {
    return res.status(404).json({
      message: "Fichier introuvable",
    });
  }

  let allowed = file.uploader_id === req.user.id || req.user.role === "ADMIN";

  if (!allowed) {
    const messages = await pool.query(
      `
      SELECT DISTINCT group_id
      FROM group_messages
      WHERE file_url = $1
      `,
      [file.url]
    );

    for (const { group_id } of messages.rows) {
      const access = await groupAccess(group_id, req.user);

      if (access?.canRead) {
        allowed = true;
        break;
      }
    }
  }

  // 404 plutôt que 403 : ne révèle pas l'existence du fichier
  if (!allowed) {
    return res.status(404).json({
      message: "Fichier introuvable",
    });
  }

  // Toujours en téléchargement, jamais affiché dans le navigateur
  res.set("X-Content-Type-Options", "nosniff");
  res.attachment(file.original_name);
  res.type("application/octet-stream");

  res.sendFile(path.join(filesDir, path.basename(file.stored_name)), (error) => {
    if (error && !res.headersSent) {
      res.status(404).json({
        message: "Fichier introuvable",
      });
    }
  });
});

/* =========================================================
   SIGNALEMENTS
========================================================= */

/*
POST /api/reports
*/

app.post(
  "/api/reports",
  auth,
  async (req, res) => {
    const {
      target_type,
      target_id,
      reason,
      details,
    } = req.body;

    if (!target_type || !target_id || !reason) {
      return res.status(400).json({
        message:
          "target_type, target_id et reason sont obligatoires",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO reports(
        reporter_id,
        target_type,
        target_id,
        reason,
        details
      )
      VALUES($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [
        req.user.id,
        target_type,
        target_id,
        reason,
        details || null,
      ]
    );

    res.status(201).json({
      message: "Signalement envoyé",
      report: result.rows[0],
    });
  }
);

/*
GET /api/reports
MODERATOR / ADMIN
*/

app.get(
  "/api/reports",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const result = await pool.query(`
      SELECT
        r.*,
        u.username AS reporter
      FROM reports r
      JOIN users u
        ON u.id = r.reporter_id
      ORDER BY r.created_at DESC
    `);

    res.json(result.rows);
  }
);

/*
PUT /api/reports/:id
MODERATOR / ADMIN
*/

app.put(
  "/api/reports/:id",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const {
      status,
    } = req.body;

    const allowed = [
      "PENDING",
      "REVIEWED",
      "RESOLVED",
      "REJECTED",
    ];

    if (!allowed.includes(status)) {
      return res.status(400).json({
        message: "Statut invalide",
      });
    }

    const result = await pool.query(
      `
      UPDATE reports
      SET
        status = $1,
        handled_by = $2,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [
        status,
        req.user.id,
        req.params.id,
      ]
    );

    res.json(result.rows[0]);
  }
);

/* =========================================================
   MODERATION
========================================================= */

/*
DELETE /api/moderation/posts/:id
*/

app.delete(
  "/api/moderation/posts/:id",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const result = await pool.query(
      `
      DELETE FROM posts
      WHERE id = $1
      RETURNING *
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Discussion introuvable",
      });
    }

    res.json({
      message: "Discussion supprimée",
    });
  }
);

/*
DELETE /api/moderation/comments/:id
*/

app.delete(
  "/api/moderation/comments/:id",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const result = await pool.query(
      `
      DELETE FROM comments
      WHERE id = $1
      RETURNING *
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Commentaire introuvable",
      });
    }

    res.json({
      message: "Commentaire supprimé",
    });
  }
);

/*
PUT /api/moderation/users/:id/suspend
*/

app.put(
  "/api/moderation/users/:id/suspend",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const result = await pool.query(
      `
      UPDATE users
      SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, is_active
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Utilisateur introuvable",
      });
    }

    res.json({
      message: "Utilisateur suspendu",
      user: result.rows[0],
    });
  }
);

/*
PUT /api/moderation/users/:id/activate
*/

app.put(
  "/api/moderation/users/:id/activate",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const result = await pool.query(
      `
      UPDATE users
      SET is_active = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING id, username, is_active
      `,
      [req.params.id]
    );

    res.json({
      message: "Utilisateur réactivé",
      user: result.rows[0],
    });
  }
);

/* =========================================================
   ADMINISTRATION DES RÔLES
========================================================= */

/*
PUT /api/admin/users/:id/role
*/

app.put(
  "/api/admin/users/:id/role",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      role,
    } = req.body;

    if (!["USER", "MODERATOR", "ADMIN"].includes(role)) {
      return res.status(400).json({
        message: "Rôle invalide",
      });
    }

    const result = await pool.query(
      `
      UPDATE users
      SET role = $1, updated_at = CURRENT_TIMESTAMP
      WHERE id = $2
      RETURNING id, username, role
      `,
      [
        role,
        req.params.id,
      ]
    );

    res.json(result.rows[0]);
  }
);

/* =========================================================
   NOTIFICATIONS
========================================================= */

/*
GET /api/notifications
*/

app.get(
  "/api/notifications",
  auth,
  async (req, res) => {
    const result = await pool.query(
      `
      SELECT *
      FROM notifications
      WHERE user_id = $1
      ORDER BY created_at DESC
      `,
      [req.user.id]
    );

    res.json(result.rows);
  }
);

/*
PUT /api/notifications/:id/read
*/

app.put(
  "/api/notifications/:id/read",
  auth,
  async (req, res) => {
    const result = await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE id = $1
      AND user_id = $2
      RETURNING *
      `,
      [
        req.params.id,
        req.user.id,
      ]
    );

    res.json(result.rows[0]);
  }
);

/* =========================================================
   404
========================================================= */

app.use((req, res) => {
  res.status(404).json({
    message: "Route introuvable",
  });
});

/* =========================================================
   ERROR HANDLER
========================================================= */

const PG_ERRORS = {
  "22P02": [400, "Paramètre invalide"],
  "22001": [400, "Valeur trop longue"],
  "23502": [400, "Champ obligatoire manquant"],
  "23503": [400, "Référence inexistante"],
  "23505": [409, "Cette ressource existe déjà"],
  "23514": [400, "Valeur non autorisée"],
};

app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Fichier trop volumineux"
          : error.message,
    });
  }

  if (PG_ERRORS[error.code]) {
    const [status, message] = PG_ERRORS[error.code];

    return res.status(status).json({
      message,
    });
  }

  console.error(error);

  res.status(500).json({
    message: "Erreur interne du serveur",
  });
});

/* =========================================================
   START SERVER
========================================================= */

async function startServer() {
  try {
    await checkDatabase();

    app.listen(PORT, () => {
      console.log(`
========================================
🚀 CYBER COMMUNITY API
========================================

Serveur : http://localhost:${PORT}
API     : http://localhost:${PORT}/api
Status  : ONLINE

========================================
`);
    });
  } catch (error) {
    console.error(
      "❌ Impossible de démarrer le serveur :",
      error
    );

    process.exit(1);
  }
}

// Lancé directement (npm start) : démarre le serveur.
// Importé (tests) : expose seulement l'application et la connexion.
if (require.main === module) {
  startServer();
}

module.exports = { app, pool };