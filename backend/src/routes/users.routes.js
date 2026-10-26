const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { pool } = require("../config/database");
const { auth, isModerator } = require("../middlewares/auth.middleware");
const { photoUpload } = require("../middlewares/upload.middleware");
const { imagesDir, detectImageType } = require("../utils/files");

const router = express.Router();

/* =========================================================
   USERS
========================================================= */

/*
GET /api/users?q=&page=1&limit=20
*/

router.get("/api/users", auth, async (req, res) => {
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

router.get("/api/users/:id", auth, async (req, res) => {
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

router.put("/api/users/profile", auth, async (req, res) => {
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

router.post(
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

module.exports = router;
