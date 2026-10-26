const express = require("express");
const { pool } = require("../config/database");
const { auth } = require("../middlewares/auth.middleware");
const { parsePage } = require("../utils/validators");

const router = express.Router();

/* =========================================================
   NOTIFICATIONS
========================================================= */

/*
GET /api/notifications?unread=true&page=1&limit=20
*/

router.get(
  "/api/notifications",
  auth,
  async (req, res) => {
    const { page, limit, offset } = parsePage(req.query);

    const unreadOnly = req.query.unread === "true";

    const result = await pool.query(
      `
      SELECT
        *,
        COUNT(*) OVER() AS total
      FROM notifications
      WHERE user_id = $1
      AND ($2 = FALSE OR is_read = FALSE)
      ORDER BY created_at DESC, id DESC
      LIMIT $3 OFFSET $4
      `,
      [req.user.id, unreadOnly, limit, offset]
    );

    const unread = await pool.query(
      `
      SELECT COUNT(*) AS unread
      FROM notifications
      WHERE user_id = $1
      AND is_read = FALSE
      `,
      [req.user.id]
    );

    res.json({
      notifications: result.rows.map(({ total, ...notification }) => notification),
      total: result.rows[0]?.total ?? 0,
      unread: unread.rows[0].unread,
      page,
      limit,
    });
  }
);

/*
GET /api/notifications/unread-count
Léger : pour le badge rafraîchi régulièrement par le frontend
*/

router.get(
  "/api/notifications/unread-count",
  auth,
  async (req, res) => {
    const result = await pool.query(
      `
      SELECT COUNT(*) AS unread
      FROM notifications
      WHERE user_id = $1
      AND is_read = FALSE
      `,
      [req.user.id]
    );

    res.json(result.rows[0]);
  }
);

/*
PUT /api/notifications/read-all
*/

router.put(
  "/api/notifications/read-all",
  auth,
  async (req, res) => {
    const result = await pool.query(
      `
      UPDATE notifications
      SET is_read = TRUE
      WHERE user_id = $1
      AND is_read = FALSE
      `,
      [req.user.id]
    );

    res.json({
      message: "Notifications marquées comme lues",
      updated: result.rowCount,
    });
  }
);

/*
PUT /api/notifications/:id/read
*/

router.put(
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

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Notification introuvable",
      });
    }

    res.json(result.rows[0]);
  }
);

/*
DELETE /api/notifications/:id
*/

router.delete(
  "/api/notifications/:id",
  auth,
  async (req, res) => {
    const result = await pool.query(
      `
      DELETE FROM notifications
      WHERE id = $1
      AND user_id = $2
      `,
      [
        req.params.id,
        req.user.id,
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        message: "Notification introuvable",
      });
    }

    res.json({
      message: "Notification supprimée",
    });
  }
);

module.exports = router;
