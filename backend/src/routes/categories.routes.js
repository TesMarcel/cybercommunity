const express = require("express");
const { pool } = require("../config/database");
const { auth, adminOnly } = require("../middlewares/auth.middleware");
const { checkText } = require("../utils/validators");

const router = express.Router();

/* =========================================================
   CATEGORIES
========================================================= */

/*
GET /api/categories
*/

router.get("/api/categories", auth, async (req, res) => {
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

router.post(
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

router.put(
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

router.delete(
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

module.exports = router;
