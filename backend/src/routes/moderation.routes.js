const express = require("express");
const { pool } = require("../config/database");
const { auth, adminOnly, moderatorOrAdmin } = require("../middlewares/auth.middleware");

const router = express.Router();

/* =========================================================
   MODERATION
========================================================= */

/*
DELETE /api/moderation/posts/:id
*/

router.delete(
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

router.delete(
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

// Suspension / réactivation : un modérateur n'agit que sur les
// utilisateurs simples, un admin sur tous sauf lui-même
async function setUserActive(req, res, isActive) {
  const target = (
    await pool.query("SELECT id, role FROM users WHERE id = $1", [req.params.id])
  ).rows[0];

  if (!target) {
    return res.status(404).json({
      message: "Utilisateur introuvable",
    });
  }

  if (target.id === req.user.id) {
    return res.status(400).json({
      message: "Vous ne pouvez pas modifier votre propre compte",
    });
  }

  if (req.user.role !== "ADMIN" && target.role !== "USER") {
    return res.status(403).json({
      message: "Seul un administrateur peut agir sur un modérateur ou un administrateur",
    });
  }

  const result = await pool.query(
    `
    UPDATE users
    SET is_active = $1, updated_at = CURRENT_TIMESTAMP
    WHERE id = $2
    RETURNING id, username, is_active
    `,
    [isActive, target.id]
  );

  res.json({
    message: isActive ? "Utilisateur réactivé" : "Utilisateur suspendu",
    user: result.rows[0],
  });
}

/*
PUT /api/moderation/users/:id/suspend
*/

router.put(
  "/api/moderation/users/:id/suspend",
  auth,
  moderatorOrAdmin,
  (req, res) => setUserActive(req, res, false)
);

/*
PUT /api/moderation/users/:id/activate
*/

router.put(
  "/api/moderation/users/:id/activate",
  auth,
  moderatorOrAdmin,
  (req, res) => setUserActive(req, res, true)
);

/* =========================================================
   ADMINISTRATION DES RÔLES
========================================================= */

/*
PUT /api/admin/users/:id/role
Un admin ne peut pas changer son propre rôle : il reste
donc toujours au moins un administrateur
*/

router.put(
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

    if (Number(req.params.id) === req.user.id) {
      return res.status(400).json({
        message: "Vous ne pouvez pas modifier votre propre rôle",
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

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Utilisateur introuvable",
      });
    }

    res.json(result.rows[0]);
  }
);

module.exports = router;
