const express = require("express");
const { pool } = require("../config/database");
const { auth, canManage } = require("../middlewares/auth.middleware");
const { upload } = require("../middlewares/upload.middleware");
const { discardUpload, deleteAttachments, saveUploadedFile } = require("../utils/files");
const { requireGroup } = require("../services/group.service");

const router = express.Router();

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

router.post(
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

router.get(
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

router.delete(
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

module.exports = router;
