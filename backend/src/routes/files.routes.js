const express = require("express");
const path = require("path");
const { pool } = require("../config/database");
const { auth } = require("../middlewares/auth.middleware");
const { upload } = require("../middlewares/upload.middleware");
const { filesDir, saveUploadedFile } = require("../utils/files");
const { groupAccess } = require("../services/group.service");

const router = express.Router();

/* =========================================================
   FILES
========================================================= */

/*
POST /api/files
*/

router.post(
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

router.get("/api/files/:id", auth, async (req, res) => {
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

module.exports = router;
