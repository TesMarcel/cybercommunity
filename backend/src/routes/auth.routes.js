const express = require("express");
const bcrypt = require("bcryptjs");
const { pool } = require("../config/database");
const { auth } = require("../middlewares/auth.middleware");
const { loginLimiter, registerLimiter } = require("../middlewares/rateLimit.middleware");
const { BCRYPT_ROUNDS, DUMMY_HASH, checkPassword } = require("../utils/password");
const { generateToken } = require("../utils/jwt");
const { USERNAME_REGEX, EMAIL_REGEX } = require("../utils/validators");

const router = express.Router();

function publicUser(user) {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    country: user.country,
    role: user.role,
  };
}

/* =========================================================
   AUTH
========================================================= */

/*
POST /api/auth/register
*/

router.post("/api/auth/register", registerLimiter, async (req, res) => {
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

router.post("/api/auth/login", loginLimiter, async (req, res) => {
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

router.get("/api/auth/me", auth, async (req, res) => {
  res.json(publicUser(req.user));
});

/*
PUT /api/auth/password
*/

router.put("/api/auth/password", auth, loginLimiter, async (req, res) => {
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

module.exports = router;
