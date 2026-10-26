const express = require("express");
const { pool } = require("../config/database");
const { auth, canManage } = require("../middlewares/auth.middleware");
const { checkText, POST_TITLE_MAX, POST_CONTENT_MAX, COMMENT_MAX } = require("../utils/validators");
const { notify } = require("../services/notification.service");

const router = express.Router();

/* =========================================================
   FORUM
========================================================= */

/*
GET /api/posts?category_id=&author_id=&q=&page=1&limit=20
*/

router.get("/api/posts", auth, async (req, res) => {
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 50);

  const filters = [];
  const values = [req.user.id];

  if (req.query.category_id) {
    values.push(req.query.category_id);
    filters.push(`p.category_id = $${values.length}`);
  }

  if (req.query.author_id) {
    values.push(req.query.author_id);
    filters.push(`p.author_id = $${values.length}`);
  }

  if (typeof req.query.q === "string" && req.query.q.trim()) {
    values.push(`%${req.query.q.trim().replace(/[\\%_]/g, "\\$&")}%`);
    filters.push(
      `(p.title ILIKE $${values.length} OR p.content ILIKE $${values.length})`
    );
  }

  values.push(limit, (page - 1) * limit);

  const result = await pool.query(
    `
    SELECT
      p.id,
      p.title,
      p.content,
      p.created_at,
      p.updated_at,
      u.id AS author_id,
      u.username AS author,
      c.id AS category_id,
      c.name AS category,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      (SELECT COUNT(*) FROM comments cm WHERE cm.post_id = p.id) AS comments,
      EXISTS(
        SELECT 1 FROM post_likes l
        WHERE l.post_id = p.id AND l.user_id = $1
      ) AS liked_by_me,
      COUNT(*) OVER() AS total
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    ${filters.length ? "WHERE " + filters.join(" AND ") : ""}
    ORDER BY p.created_at DESC
    LIMIT $${values.length - 1} OFFSET $${values.length}
    `,
    values
  );

  res.json({
    posts: result.rows.map(({ total, ...post }) => post),
    total: result.rows[0]?.total ?? 0,
    page,
    limit,
  });
});

/*
GET /api/posts/:id
*/

router.get("/api/posts/:id", auth, async (req, res) => {
  const post = await pool.query(
    `
    SELECT
      p.*,
      u.username AS author,
      c.name AS category,
      (SELECT COUNT(*) FROM post_likes l WHERE l.post_id = p.id) AS likes,
      EXISTS(
        SELECT 1 FROM post_likes l
        WHERE l.post_id = p.id AND l.user_id = $2
      ) AS liked_by_me
    FROM posts p
    JOIN users u ON u.id = p.author_id
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.id = $1
    `,
    [req.params.id, req.user.id]
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
Tous les membres
*/

router.post("/api/posts", auth, async (req, res) => {
  const {
    title,
    content,
    category_id,
  } = req.body;

  const error =
    checkText(title, "Titre", POST_TITLE_MAX) ||
    checkText(content, "Contenu", POST_CONTENT_MAX);

  if (error) {
    return res.status(400).json({
      message: error,
    });
  }

  // Catégorie facultative ; une catégorie inexistante donne un 400
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
      category_id || null,
      title.trim(),
      content.trim(),
    ]
  );

  res.status(201).json(result.rows[0]);
});

/*
PUT /api/posts/:id
Auteur uniquement — seuls les champs envoyés sont modifiés
*/

router.put("/api/posts/:id", auth, async (req, res) => {
  const existing = await pool.query(
    `
    SELECT author_id
    FROM posts
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Discussion introuvable",
    });
  }

  if (existing.rows[0].author_id !== req.user.id) {
    return res.status(403).json({
      message: "Seul l'auteur peut modifier cette discussion",
    });
  }

  const columns = [];
  const values = [];

  for (const [field, label, maxLength] of [
    ["title", "Titre", POST_TITLE_MAX],
    ["content", "Contenu", POST_CONTENT_MAX],
  ]) {
    if (!Object.hasOwn(req.body, field)) {
      continue;
    }

    const error = checkText(req.body[field], label, maxLength);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    values.push(req.body[field].trim());
    columns.push(`${field} = $${values.length}`);
  }

  if (Object.hasOwn(req.body, "category_id")) {
    values.push(req.body.category_id || null);
    columns.push(`category_id = $${values.length}`);
  }

  if (columns.length === 0) {
    return res.status(400).json({
      message: "Aucun champ à modifier",
    });
  }

  values.push(req.params.id);

  const result = await pool.query(
    `
    UPDATE posts
    SET ${columns.join(", ")}, updated_at = CURRENT_TIMESTAMP
    WHERE id = $${values.length}
    RETURNING *
    `,
    values
  );

  res.json(result.rows[0]);
});

/*
DELETE /api/posts/:id
Auteur, modérateur ou admin
*/

router.delete("/api/posts/:id", auth, async (req, res) => {
  const existing = await pool.query(
    `
    SELECT author_id
    FROM posts
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Discussion introuvable",
    });
  }

  if (!canManage(req.user, existing.rows[0].author_id)) {
    return res.status(403).json({
      message: "Vous ne pouvez pas supprimer cette discussion",
    });
  }

  await pool.query(
    `
    DELETE FROM posts
    WHERE id = $1
    `,
    [req.params.id]
  );

  res.json({
    message: "Discussion supprimée",
  });
});

/*
POST /api/posts/:id/comments
*/

router.post(
  "/api/posts/:id/comments",
  auth,
  async (req, res) => {
    const {
      content,
      parent_id,
    } = req.body;

    const error = checkText(content, "Contenu", COMMENT_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
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

    // Une réponse doit viser un commentaire de la même discussion
    let parent = null;

    if (parent_id) {
      const parentResult = await pool.query(
        `
        SELECT id, author_id
        FROM comments
        WHERE id = $1
        AND post_id = $2
        `,
        [parent_id, req.params.id]
      );

      parent = parentResult.rows[0];

      if (!parent) {
        return res.status(400).json({
          message: "Le commentaire parent n'appartient pas à cette discussion",
        });
      }
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
        parent ? parent.id : null,
        content.trim(),
      ]
    );

    // Pas de notification pour ses propres contenus
    const postAuthorId = post.rows[0].author_id;

    if (postAuthorId !== req.user.id) {
      await notify(
        postAuthorId,
        "COMMENT",
        `${req.user.username} a commenté votre discussion.`
      );
    }

    if (
      parent &&
      parent.author_id !== req.user.id &&
      parent.author_id !== postAuthorId
    ) {
      await notify(
        parent.author_id,
        "REPLY",
        `${req.user.username} a répondu à votre commentaire.`
      );
    }

    res.status(201).json(result.rows[0]);
  }
);

/*
PUT /api/comments/:id
Auteur uniquement
*/

router.put("/api/comments/:id", auth, async (req, res) => {
  const error = checkText(req.body.content, "Contenu", COMMENT_MAX);

  if (error) {
    return res.status(400).json({
      message: error,
    });
  }

  const existing = await pool.query(
    `
    SELECT author_id
    FROM comments
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Commentaire introuvable",
    });
  }

  if (existing.rows[0].author_id !== req.user.id) {
    return res.status(403).json({
      message: "Seul l'auteur peut modifier ce commentaire",
    });
  }

  const result = await pool.query(
    `
    UPDATE comments
    SET content = $1
    WHERE id = $2
    RETURNING *
    `,
    [req.body.content.trim(), req.params.id]
  );

  res.json(result.rows[0]);
});

/*
DELETE /api/comments/:id
Auteur, modérateur ou admin — les réponses sont supprimées avec
*/

router.delete("/api/comments/:id", auth, async (req, res) => {
  const existing = await pool.query(
    `
    SELECT author_id
    FROM comments
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (existing.rows.length === 0) {
    return res.status(404).json({
      message: "Commentaire introuvable",
    });
  }

  if (!canManage(req.user, existing.rows[0].author_id)) {
    return res.status(403).json({
      message: "Vous ne pouvez pas supprimer ce commentaire",
    });
  }

  await pool.query(
    `
    DELETE FROM comments
    WHERE id = $1
    `,
    [req.params.id]
  );

  res.json({
    message: "Commentaire supprimé",
  });
});

/*
POST /api/posts/:id/like
Ajoute ou retire le like
*/

router.post(
  "/api/posts/:id/like",
  auth,
  async (req, res) => {
    const post = await pool.query(
      `
      SELECT id
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

    // Insertion atomique : deux clics simultanés ne créent pas d'erreur
    const inserted = await pool.query(
      `
      INSERT INTO post_likes(
        post_id,
        user_id
      )
      VALUES($1, $2)
      ON CONFLICT DO NOTHING
      `,
      [
        req.params.id,
        req.user.id,
      ]
    );

    const liked = inserted.rowCount === 1;

    if (!liked) {
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
    }

    const count = await pool.query(
      `
      SELECT COUNT(*) AS likes
      FROM post_likes
      WHERE post_id = $1
      `,
      [req.params.id]
    );

    res.json({
      liked,
      likes: count.rows[0].likes,
    });
  }
);

module.exports = router;
