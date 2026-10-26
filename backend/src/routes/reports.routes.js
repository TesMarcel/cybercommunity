const express = require("express");
const { pool } = require("../config/database");
const { auth, moderatorOrAdmin } = require("../middlewares/auth.middleware");
const { checkText, parsePage } = require("../utils/validators");
const { notify } = require("../services/notification.service");
const { groupAccess } = require("../services/group.service");

const router = express.Router();

/* =========================================================
   SIGNALEMENTS
========================================================= */

const REPORT_STATUSES = ["PENDING", "REVIEWED", "RESOLVED", "REJECTED"];

// Requête qui renvoie la cible et, pour les contenus de groupe, son groupe
const REPORT_TARGETS = {
  USER: "SELECT id, NULL AS group_id FROM users WHERE id = $1",
  POST: "SELECT id, NULL AS group_id FROM posts WHERE id = $1",
  COMMENT: "SELECT id, NULL AS group_id FROM comments WHERE id = $1",
  GROUP: "SELECT id, id AS group_id FROM groups_table WHERE id = $1",
  MESSAGE: "SELECT id, group_id FROM group_messages WHERE id = $1",
};

/*
POST /api/reports
*/

router.post(
  "/api/reports",
  auth,
  async (req, res) => {
    const {
      target_type,
      target_id,
      reason,
      details,
    } = req.body;

    if (!Object.hasOwn(REPORT_TARGETS, target_type)) {
      return res.status(400).json({
        message: `target_type doit valoir ${Object.keys(REPORT_TARGETS).join(", ")}`,
      });
    }

    if (!Number.isInteger(Number(target_id)) || Number(target_id) <= 0) {
      return res.status(400).json({
        message: "target_id invalide",
      });
    }

    const error = checkText(reason, "Motif", 100);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    if (details != null && (typeof details !== "string" || details.length > 2000)) {
      return res.status(400).json({
        message: "Détails : texte de 2000 caractères maximum",
      });
    }

    if (target_type === "USER" && Number(target_id) === req.user.id) {
      return res.status(400).json({
        message: "Vous ne pouvez pas vous signaler vous-même",
      });
    }

    const target = (
      await pool.query(REPORT_TARGETS[target_type], [target_id])
    ).rows[0];

    // Contenu de groupe : il faut pouvoir le voir pour le signaler
    // (les groupes privés restent invisibles aux non-membres)
    let visible = Boolean(target);

    if (target?.group_id) {
      visible = Boolean((await groupAccess(target.group_id, req.user))?.canRead);
    }

    if (!visible) {
      return res.status(404).json({
        message: "Élément signalé introuvable",
      });
    }

    const duplicate = await pool.query(
      `
      SELECT id
      FROM reports
      WHERE reporter_id = $1
      AND target_type = $2
      AND target_id = $3
      AND status = 'PENDING'
      `,
      [req.user.id, target_type, target_id]
    );

    if (duplicate.rows.length > 0) {
      return res.status(409).json({
        message: "Vous avez déjà signalé cet élément, il est en cours d'examen",
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
        reason.trim(),
        details?.trim() || null,
      ]
    );

    res.status(201).json({
      message: "Signalement envoyé",
      report: result.rows[0],
    });
  }
);

/*
GET /api/reports?status=PENDING&page=1&limit=20
MODERATOR / ADMIN
*/

router.get(
  "/api/reports",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);

    const status = req.query.status;

    if (status && !REPORT_STATUSES.includes(status)) {
      return res.status(400).json({
        message: "Statut invalide",
      });
    }

    const result = await pool.query(
      `
      SELECT
        r.*,
        u.username AS reporter,
        h.username AS handler,
        COUNT(*) OVER() AS total
      FROM reports r
      JOIN users u
        ON u.id = r.reporter_id
      LEFT JOIN users h
        ON h.id = r.handled_by
      WHERE ($1::text IS NULL OR r.status = $1)
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [status || null, limit, offset]
    );

    res.json({
      reports: result.rows.map(({ total, ...report }) => report),
      total: result.rows[0]?.total ?? 0,
      page,
      limit,
    });
  }
);

/*
PUT /api/reports/:id
MODERATOR / ADMIN
*/

router.put(
  "/api/reports/:id",
  auth,
  moderatorOrAdmin,
  async (req, res) => {
    const {
      status,
    } = req.body;

    if (!REPORT_STATUSES.includes(status)) {
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

    const report = result.rows[0];

    if (!report) {
      return res.status(404).json({
        message: "Signalement introuvable",
      });
    }

    if (status === "RESOLVED" || status === "REJECTED") {
      await notify(
        report.reporter_id,
        "REPORT_UPDATE",
        status === "RESOLVED"
          ? "Votre signalement a été traité. Merci !"
          : "Votre signalement a été examiné et rejeté."
      );
    }

    res.json(report);
  }
);

module.exports = router;
