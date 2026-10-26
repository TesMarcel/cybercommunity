// Authentification (JWT) et contrôle des rôles
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");
const { pool } = require("../config/database");
const { passwordVersion } = require("../utils/jwt");

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

const isModerator = (user) => ["ADMIN", "MODERATOR"].includes(user.role);

// Auteur du contenu, ou modérateur / admin
const canManage = (user, authorId) =>
  user.id === authorId || isModerator(user);

module.exports = {
  auth,
  adminOnly,
  moderatorOrAdmin,
  isModerator,
  canManage,
};
