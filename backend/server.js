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

const uploadDir = path.join(__dirname, "uploads");

const imagesDir = path.join(uploadDir, "images");

fs.mkdirSync(imagesDir, { recursive: true });

// nosniff : le navigateur ne devine pas le type d'un fichier
// (un faux .png contenant du HTML ne sera pas exécuté)
app.use(
  "/uploads",
  express.static(uploadDir, {
    setHeaders: (res) => {
      res.set("X-Content-Type-Options", "nosniff");
    },
  })
);

/* =========================================================
   MULTER
========================================================= */

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },

  filename: function (req, file, cb) {
    const uniqueName =
      Date.now() +
      "-" +
      Math.round(Math.random() * 1e9) +
      path.extname(file.originalname);

    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

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
  limit: 10,
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
  limit: 5,
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

async function isGroupMember(groupId, userId) {
  const result = await pool.query(
    `
    SELECT *
    FROM group_members
    WHERE group_id = $1
    AND user_id = $2
    `,
    [groupId, userId]
  );

  return result.rows.length > 0;
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

/*
GET /api/categories
*/

app.get("/api/categories", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT *
    FROM categories
    ORDER BY name
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
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({
        message: "Nom obligatoire",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO categories(name)
      VALUES($1)
      RETURNING *
      `,
      [name]
    );

    res.status(201).json(result.rows[0]);
  }
);

/* =========================================================
   FORUM
========================================================= */

/*
GET /api/posts
*/

app.get("/api/posts", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      u.id AS author_id,
      u.username AS author,
      c.id AS category_id,
      c.name AS category,
      COUNT(DISTINCT l.user_id) AS likes,
      COUNT(DISTINCT cm.id) AS comments
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN post_likes l ON l.post_id = p.id
    LEFT JOIN comments cm ON cm.post_id = p.id
    GROUP BY
      p.id,
      u.id,
      c.id
    ORDER BY p.created_at DESC
  `);

  res.json(result.rows);
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
      c.name AS category
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = $1
    `,
    [req.params.id]
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
ADMIN ONLY
*/

app.post(
  "/api/posts",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      title,
      content,
      category_id,
    } = req.body;

    if (!title || !content || !category_id) {
      return res.status(400).json({
        message: "Titre, contenu et catégorie obligatoires",
      });
    }

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
        category_id,
        title,
        content,
      ]
    );

    res.status(201).json(result.rows[0]);
  }
);

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

    if (!content) {
      return res.status(400).json({
        message: "Contenu obligatoire",
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
        parent_id || null,
        content,
      ]
    );

    await notify(
      post.rows[0].author_id,
      "COMMENT",
      `${req.user.username} a commenté votre discussion.`
    );

    res.status(201).json(result.rows[0]);
  }
);

/*
POST /api/posts/:id/like
*/

app.post(
  "/api/posts/:id/like",
  auth,
  async (req, res) => {
    const existing = await pool.query(
      `
      SELECT 1
      FROM post_likes
      WHERE post_id = $1
      AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id,
      ]
    );

    if (existing.rows.length > 0) {
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

      return res.json({
        liked: false,
      });
    }

    await pool.query(
      `
      INSERT INTO post_likes(
        post_id,
        user_id
      )
      VALUES($1, $2)
      `,
      [
        req.params.id,
        req.user.id,
      ]
    );

    res.json({
      liked: true,
    });
  }
);

/* =========================================================
   GROUPES
========================================================= */

/*
GET /api/groups
*/

app.get("/api/groups", auth, async (req, res) => {
  const result = await pool.query(`
    SELECT
      g.id,
      g.name,
      g.description,
      g.created_at,
      u.username AS creator,
      COUNT(gm.user_id) AS members
    FROM groups_table g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN group_members gm
      ON gm.group_id = g.id
    GROUP BY g.id, u.username
    ORDER BY g.created_at DESC
  `);

  res.json(result.rows);
});

/*
POST /api/groups
ADMIN ONLY
*/

app.post(
  "/api/groups",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      name,
      description,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        message: "Nom du groupe obligatoire",
      });
    }

    const result = await pool.query(
      `
      INSERT INTO groups_table(
        name,
        description,
        created_by
      )
      VALUES($1, $2, $3)
      RETURNING *
      `,
      [
        name,
        description || null,
        req.user.id,
      ]
    );

    const group = result.rows[0];

    await pool.query(
      `
      INSERT INTO group_members(
        group_id,
        user_id,
        group_role
      )
      VALUES($1, $2, 'ADMIN')
      `,
      [
        group.id,
        req.user.id,
      ]
    );

    res.status(201).json(group);
  }
);

/*
POST /api/groups/:id/members
ADMIN ONLY
*/

app.post(
  "/api/groups/:id/members",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      user_id,
    } = req.body;

    if (!user_id) {
      return res.status(400).json({
        message: "user_id obligatoire",
      });
    }

    const group = await pool.query(
      `
      SELECT id
      FROM groups_table
      WHERE id = $1
      `,
      [req.params.id]
    );

    if (group.rows.length === 0) {
      return res.status(404).json({
        message: "Groupe introuvable",
      });
    }

    await pool.query(
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

    await notify(
      user_id,
      "GROUP_ADDED",
      "Vous avez été ajouté à un groupe."
    );

    res.json({
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
    const member = await isGroupMember(
      req.params.id,
      req.user.id
    );

    if (!member && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Vous n'êtes pas membre de ce groupe",
      });
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
POST /api/groups/:id/posts
*/

app.post(
  "/api/groups/:id/posts",
  auth,
  async (req, res) => {
    const member = await isGroupMember(
      req.params.id,
      req.user.id
    );

    if (!member && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Vous n'êtes pas membre de ce groupe",
      });
    }

    const {
      title,
      content,
    } = req.body;

    if (!title || !content) {
      return res.status(400).json({
        message: "Titre et contenu obligatoires",
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
        title,
        content,
      ]
    );

    res.status(201).json(result.rows[0]);
  }
);

/*
GET /api/groups/:id/posts
*/

app.get(
  "/api/groups/:id/posts",
  auth,
  async (req, res) => {
    const member = await isGroupMember(
      req.params.id,
      req.user.id
    );

    if (!member && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Vous n'êtes pas membre de ce groupe",
      });
    }

    const result = await pool.query(
      `
      SELECT
        gp.*,
        u.username
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

/* =========================================================
   MESSAGES DE GROUPE
========================================================= */

/*
POST /api/groups/:id/messages
*/

app.post(
  "/api/groups/:id/messages",
  auth,
  upload.single("file"),
  async (req, res) => {
    const member = await isGroupMember(
      req.params.id,
      req.user.id
    );

    if (!member && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Vous n'êtes pas membre du groupe",
      });
    }

    const content = req.body.content || null;

    let fileUrl = null;
    let fileName = null;

    if (req.file) {
      fileUrl = `/uploads/${req.file.filename}`;
      fileName = req.file.originalname;
    }

    if (!content && !req.file) {
      return res.status(400).json({
        message: "Message ou fichier obligatoire",
      });
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
        fileUrl,
        fileName,
      ]
    );

    res.status(201).json(result.rows[0]);
  }
);

/*
GET /api/groups/:id/messages
*/

app.get(
  "/api/groups/:id/messages",
  auth,
  async (req, res) => {
    const member = await isGroupMember(
      req.params.id,
      req.user.id
    );

    if (!member && req.user.role !== "ADMIN") {
      return res.status(403).json({
        message: "Accès refusé",
      });
    }

    const result = await pool.query(
      `
      SELECT
        gm.*,
        u.username
      FROM group_messages gm
      JOIN users u ON u.id = gm.sender_id
      WHERE gm.group_id = $1
      ORDER BY gm.created_at ASC
      `,
      [req.params.id]
    );

    res.json(result.rows);
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
    if (!req.file) {
      return res.status(400).json({
        message: "Fichier manquant",
      });
    }

    const url = `/uploads/${req.file.filename}`;

    const result = await pool.query(
      `
      INSERT INTO files(
        uploader_id,
        original_name,
        stored_name,
        mime_type,
        size_bytes,
        url
      )
      VALUES($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
      [
        req.user.id,
        req.file.originalname,
        req.file.filename,
        req.file.mimetype,
        req.file.size,
        url,
      ]
    );

    res.status(201).json(result.rows[0]);
  }
);

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

startServer();