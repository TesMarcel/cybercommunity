const express = require("express");
const { pool } = require("../config/database");
const { auth, adminOnly, isModerator, canManage } = require("../middlewares/auth.middleware");
const { deleteAttachments } = require("../utils/files");
const { checkText, POST_TITLE_MAX, POST_CONTENT_MAX, COMMENT_MAX } = require("../utils/validators");
const { notify } = require("../services/notification.service");
const { groupAccess, requireGroup } = require("../services/group.service");

const router = express.Router();

/* =========================================================
   GROUPES
========================================================= */

const GROUP_NAME_MAX = 120;
const GROUP_DESCRIPTION_MAX = 2000;

async function countGroupAdmins(groupId) {
  const result = await pool.query(
    `
    SELECT COUNT(*) AS admins
    FROM group_members
    WHERE group_id = $1
    AND group_role = 'ADMIN'
    `,
    [groupId]
  );

  return result.rows[0].admins;
}

/*
GET /api/groups
Groupes publics + groupes dont on est membre (tous pour la modération)
*/

router.get("/api/groups", auth, async (req, res) => {
  const result = await pool.query(
    `
    SELECT
      g.id,
      g.name,
      g.description,
      g.is_private,
      g.created_at,
      u.username AS creator,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
      me.group_role AS my_role
    FROM groups_table g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN group_members me
      ON me.group_id = g.id
      AND me.user_id = $1
    WHERE g.is_private = FALSE
    OR me.user_id IS NOT NULL
    OR $2
    ORDER BY g.created_at DESC
    `,
    [req.user.id, isModerator(req.user)]
  );

  res.json(result.rows);
});

/*
GET /api/groups/:id
*/

router.get("/api/groups/:id", auth, async (req, res) => {
  if (!(await requireGroup(req, res, "canRead"))) {
    return;
  }

  const result = await pool.query(
    `
    SELECT
      g.*,
      u.username AS creator,
      (SELECT COUNT(*) FROM group_members m WHERE m.group_id = g.id) AS members,
      me.group_role AS my_role
    FROM groups_table g
    JOIN users u ON u.id = g.created_by
    LEFT JOIN group_members me
      ON me.group_id = g.id
      AND me.user_id = $2
    WHERE g.id = $1
    `,
    [req.params.id, req.user.id]
  );

  res.json(result.rows[0]);
});

/*
POST /api/groups
ADMIN ONLY — is_private vaut true par défaut
*/

router.post(
  "/api/groups",
  auth,
  adminOnly,
  async (req, res) => {
    const {
      name,
      description,
      is_private,
    } = req.body;

    const error = checkText(name, "Nom du groupe", GROUP_NAME_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    if (description != null && typeof description !== "string") {
      return res.status(400).json({
        message: "Description invalide",
      });
    }

    if (description && description.length > GROUP_DESCRIPTION_MAX) {
      return res.status(400).json({
        message: `Description : ${GROUP_DESCRIPTION_MAX} caractères maximum`,
      });
    }

    const client = await pool.connect();

    let group;

    try {
      await client.query("BEGIN");

      const result = await client.query(
        `
        INSERT INTO groups_table(
          name,
          description,
          is_private,
          created_by
        )
        VALUES($1, $2, $3, $4)
        RETURNING *
        `,
        [
          name.trim(),
          description?.trim() || null,
          is_private !== false,
          req.user.id,
        ]
      );

      group = result.rows[0];

      await client.query(
        `
        INSERT INTO group_members(
          group_id,
          user_id,
          group_role
        )
        VALUES($1, $2, 'ADMIN')
        `,
        [group.id, req.user.id]
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }

    res.status(201).json(group);
  }
);

/*
PUT /api/groups/:id
Administrateurs du groupe — seuls les champs envoyés sont modifiés
*/

router.put("/api/groups/:id", auth, async (req, res) => {
  if (!(await requireGroup(req, res, "canAdmin"))) {
    return;
  }

  const columns = [];
  const values = [];

  if (Object.hasOwn(req.body, "name")) {
    const error = checkText(req.body.name, "Nom du groupe", GROUP_NAME_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    values.push(req.body.name.trim());
    columns.push(`name = $${values.length}`);
  }

  if (Object.hasOwn(req.body, "description")) {
    const description = req.body.description;

    if (description !== null && typeof description !== "string") {
      return res.status(400).json({
        message: "Description invalide",
      });
    }

    if (description && description.length > GROUP_DESCRIPTION_MAX) {
      return res.status(400).json({
        message: `Description : ${GROUP_DESCRIPTION_MAX} caractères maximum`,
      });
    }

    values.push(description?.trim() || null);
    columns.push(`description = $${values.length}`);
  }

  if (Object.hasOwn(req.body, "is_private")) {
    if (typeof req.body.is_private !== "boolean") {
      return res.status(400).json({
        message: "is_private doit valoir true ou false",
      });
    }

    values.push(req.body.is_private);
    columns.push(`is_private = $${values.length}`);
  }

  if (columns.length === 0) {
    return res.status(400).json({
      message: "Aucun champ à modifier",
    });
  }

  values.push(req.params.id);

  const result = await pool.query(
    `
    UPDATE groups_table
    SET ${columns.join(", ")}
    WHERE id = $${values.length}
    RETURNING *
    `,
    values
  );

  res.json(result.rows[0]);
});

/*
DELETE /api/groups/:id
Administrateurs du groupe — supprime aussi discussions et messages
*/

router.delete("/api/groups/:id", auth, async (req, res) => {
  if (!(await requireGroup(req, res, "canAdmin"))) {
    return;
  }

  const attachments = await pool.query(
    `
    SELECT file_url
    FROM group_messages
    WHERE group_id = $1
    AND file_url IS NOT NULL
    `,
    [req.params.id]
  );

  await deleteAttachments(attachments.rows.map((row) => row.file_url));

  await pool.query(
    `
    DELETE FROM groups_table
    WHERE id = $1
    `,
    [req.params.id]
  );

  res.json({
    message: "Groupe supprimé",
  });
});

/*
POST /api/groups/:id/join
Rejoindre un groupe public
*/

router.post("/api/groups/:id/join", auth, async (req, res) => {
  const access = await groupAccess(req.params.id, req.user);

  if (!access) {
    return res.status(404).json({
      message: "Groupe introuvable",
    });
  }

  if (access.isMember) {
    return res.status(409).json({
      message: "Vous êtes déjà membre de ce groupe",
    });
  }

  const group = await pool.query(
    `
    SELECT is_private
    FROM groups_table
    WHERE id = $1
    `,
    [req.params.id]
  );

  if (group.rows[0].is_private) {
    return res.status(403).json({
      message: "Groupe privé : un administrateur du groupe doit vous ajouter",
    });
  }

  await pool.query(
    `
    INSERT INTO group_members(group_id, user_id)
    VALUES($1, $2)
    ON CONFLICT DO NOTHING
    `,
    [req.params.id, req.user.id]
  );

  res.status(201).json({
    message: "Vous avez rejoint le groupe",
  });
});

/*
POST /api/groups/:id/members
Administrateurs du groupe
*/

router.post(
  "/api/groups/:id/members",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canAdmin"))) {
      return;
    }

    const {
      user_id,
    } = req.body;

    if (!user_id) {
      return res.status(400).json({
        message: "user_id obligatoire",
      });
    }

    const inserted = await pool.query(
      `
      INSERT INTO group_members(
        group_id,
        user_id
      )
      VALUES($1, $2)
      ON CONFLICT(group_id, user_id)
      DO NOTHING
      `,
      [
        req.params.id,
        user_id,
      ]
    );

    if (inserted.rowCount === 0) {
      return res.status(409).json({
        message: "Cet utilisateur est déjà membre",
      });
    }

    await notify(
      user_id,
      "GROUP_ADDED",
      "Vous avez été ajouté à un groupe."
    );

    res.status(201).json({
      message: "Membre ajouté",
    });
  }
);

/*
GET /api/groups/:id/members
*/

router.get(
  "/api/groups/:id/members",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const result = await pool.query(
      `
      SELECT
        u.id,
        u.username,
        u.country,
        gm.group_role,
        gm.joined_at
      FROM group_members gm
      JOIN users u ON u.id = gm.user_id
      WHERE gm.group_id = $1
      ORDER BY gm.joined_at
      `,
      [req.params.id]
    );

    res.json(result.rows);
  }
);

/*
PUT /api/groups/:id/members/:userId
Changer le rôle (MEMBER / ADMIN) — administrateurs du groupe
*/

router.put(
  "/api/groups/:id/members/:userId",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canAdmin"))) {
      return;
    }

    const { group_role } = req.body;

    if (!["MEMBER", "ADMIN"].includes(group_role)) {
      return res.status(400).json({
        message: "group_role doit valoir MEMBER ou ADMIN",
      });
    }

    const current = await pool.query(
      `
      SELECT group_role
      FROM group_members
      WHERE group_id = $1
      AND user_id = $2
      `,
      [req.params.id, req.params.userId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        message: "Membre introuvable",
      });
    }

    if (
      current.rows[0].group_role === "ADMIN" &&
      group_role === "MEMBER" &&
      (await countGroupAdmins(req.params.id)) <= 1
    ) {
      return res.status(400).json({
        message: "Le groupe doit garder au moins un administrateur",
      });
    }

    const result = await pool.query(
      `
      UPDATE group_members
      SET group_role = $1
      WHERE group_id = $2
      AND user_id = $3
      RETURNING user_id, group_role
      `,
      [group_role, req.params.id, req.params.userId]
    );

    res.json(result.rows[0]);
  }
);

/*
DELETE /api/groups/:id/members/:userId
Quitter le groupe (soi-même) ou retirer un membre (administrateurs)
*/

router.delete(
  "/api/groups/:id/members/:userId",
  auth,
  async (req, res) => {
    const isSelf = Number(req.params.userId) === req.user.id;

    if (!(await requireGroup(req, res, isSelf ? "isMember" : "canAdmin"))) {
      return;
    }

    const current = await pool.query(
      `
      SELECT group_role
      FROM group_members
      WHERE group_id = $1
      AND user_id = $2
      `,
      [req.params.id, req.params.userId]
    );

    if (current.rows.length === 0) {
      return res.status(404).json({
        message: "Membre introuvable",
      });
    }

    if (
      current.rows[0].group_role === "ADMIN" &&
      (await countGroupAdmins(req.params.id)) <= 1
    ) {
      return res.status(400).json({
        message:
          "Le dernier administrateur ne peut pas quitter le groupe : nommez d'abord un autre administrateur",
      });
    }

    await pool.query(
      `
      DELETE FROM group_members
      WHERE group_id = $1
      AND user_id = $2
      `,
      [req.params.id, req.params.userId]
    );

    res.json({
      message: isSelf ? "Vous avez quitté le groupe" : "Membre retiré",
    });
  }
);

/*
GET /api/groups/:id/posts
*/

router.get(
  "/api/groups/:id/posts",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const result = await pool.query(
      `
      SELECT
        gp.*,
        u.username,
        (SELECT COUNT(*) FROM group_comments gc WHERE gc.group_post_id = gp.id) AS comments
      FROM group_posts gp
      JOIN users u ON u.id = gp.author_id
      WHERE gp.group_id = $1
      ORDER BY gp.created_at DESC
      `,
      [req.params.id]
    );

    res.json(result.rows);
  }
);

/*
POST /api/groups/:id/posts
*/

router.post(
  "/api/groups/:id/posts",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canWrite"))) {
      return;
    }

    const {
      title,
      content,
    } = req.body;

    const error =
      checkText(title, "Titre", POST_TITLE_MAX) ||
      checkText(content, "Contenu", POST_CONTENT_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await pool.query(
      `
      INSERT INTO group_posts(
        group_id,
        author_id,
        title,
        content
      )
      VALUES($1, $2, $3, $4)
      RETURNING *
      `,
      [
        req.params.id,
        req.user.id,
        title.trim(),
        content.trim(),
      ]
    );

    res.status(201).json(result.rows[0]);
  }
);

// Discussion du groupe :id, ou réponse 404 ; renvoie null dans ce cas
async function findGroupPost(req, res) {
  const result = await pool.query(
    `
    SELECT *
    FROM group_posts
    WHERE id = $1
    AND group_id = $2
    `,
    [req.params.postId, req.params.id]
  );

  if (result.rows.length === 0) {
    res.status(404).json({
      message: "Discussion introuvable",
    });
    return null;
  }

  return result.rows[0];
}

/*
GET /api/groups/:id/posts/:postId
Discussion et ses commentaires
*/

router.get(
  "/api/groups/:id/posts/:postId",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

    const comments = await pool.query(
      `
      SELECT
        gc.*,
        u.username
      FROM group_comments gc
      JOIN users u ON u.id = gc.author_id
      WHERE gc.group_post_id = $1
      ORDER BY gc.created_at ASC
      `,
      [post.id]
    );

    res.json({
      post,
      comments: comments.rows,
    });
  }
);

/*
PUT /api/groups/:id/posts/:postId
Auteur uniquement
*/

router.put(
  "/api/groups/:id/posts/:postId",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canRead"))) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

    if (post.author_id !== req.user.id) {
      return res.status(403).json({
        message: "Seul l'auteur peut modifier cette discussion",
      });
    }

    const title = req.body.title ?? post.title;
    const content = req.body.content ?? post.content;

    const error =
      checkText(title, "Titre", POST_TITLE_MAX) ||
      checkText(content, "Contenu", POST_CONTENT_MAX);

    if (error) {
      return res.status(400).json({
        message: error,
      });
    }

    const result = await pool.query(
      `
      UPDATE group_posts
      SET title = $1, content = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [title.trim(), content.trim(), post.id]
    );

    res.json(result.rows[0]);
  }
);

/*
DELETE /api/groups/:id/posts/:postId
Auteur, administrateurs du groupe ou modération
*/

router.delete(
  "/api/groups/:id/posts/:postId",
  auth,
  async (req, res) => {
    const access = await requireGroup(req, res, "canRead");

    if (!access) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

    if (!access.canAdmin && !canManage(req.user, post.author_id)) {
      return res.status(403).json({
        message: "Vous ne pouvez pas supprimer cette discussion",
      });
    }

    await pool.query(
      `
      DELETE FROM group_posts
      WHERE id = $1
      `,
      [post.id]
    );

    res.json({
      message: "Discussion supprimée",
    });
  }
);

/*
POST /api/groups/:id/posts/:postId/comments
*/

router.post(
  "/api/groups/:id/posts/:postId/comments",
  auth,
  async (req, res) => {
    if (!(await requireGroup(req, res, "canWrite"))) {
      return;
    }

    const post = await findGroupPost(req, res);

    if (!post) {
      return;
    }

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

    let parent = null;

    if (parent_id) {
      const parentResult = await pool.query(
        `
        SELECT id, author_id
        FROM group_comments
        WHERE id = $1
        AND group_post_id = $2
        `,
        [parent_id, post.id]
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
      INSERT INTO group_comments(
        group_post_id,
        author_id,
        parent_id,
        content
      )
      VALUES($1, $2, $3, $4)
      RETURNING *
      `,
      [post.id, req.user.id, parent ? parent.id : null, content.trim()]
    );

    if (post.author_id !== req.user.id) {
      await notify(
        post.author_id,
        "GROUP_COMMENT",
        `${req.user.username} a commenté votre discussion de groupe.`
      );
    }

    if (
      parent &&
      parent.author_id !== req.user.id &&
      parent.author_id !== post.author_id
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
DELETE /api/groups/:id/comments/:commentId
Auteur, administrateurs du groupe ou modération
*/

router.delete(
  "/api/groups/:id/comments/:commentId",
  auth,
  async (req, res) => {
    const access = await requireGroup(req, res, "canRead");

    if (!access) {
      return;
    }

    const result = await pool.query(
      `
      SELECT gc.author_id
      FROM group_comments gc
      JOIN group_posts gp ON gp.id = gc.group_post_id
      WHERE gc.id = $1
      AND gp.group_id = $2
      `,
      [req.params.commentId, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        message: "Commentaire introuvable",
      });
    }

    if (!access.canAdmin && !canManage(req.user, result.rows[0].author_id)) {
      return res.status(403).json({
        message: "Vous ne pouvez pas supprimer ce commentaire",
      });
    }

    await pool.query(
      `
      DELETE FROM group_comments
      WHERE id = $1
      `,
      [req.params.commentId]
    );

    res.json({
      message: "Commentaire supprimé",
    });
  }
);

module.exports = router;
