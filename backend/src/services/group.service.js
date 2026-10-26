// Droits des utilisateurs sur les groupes
const { pool } = require("../config/database");
const { isModerator } = require("../middlewares/auth.middleware");

// Droits d'un utilisateur sur un groupe.
// Groupe public : lisible par tous. Groupe privé : membres uniquement.
// Admin du site : tous les droits ; modérateur : lecture (modération).
async function groupAccess(groupId, user) {
  const result = await pool.query(
    `
    SELECT
      g.id,
      g.is_private,
      gm.group_role
    FROM groups_table g
    LEFT JOIN group_members gm
      ON gm.group_id = g.id
      AND gm.user_id = $2
    WHERE g.id = $1
    `,
    [groupId, user.id]
  );

  const group = result.rows[0];

  if (!group) {
    return null;
  }

  const isMember = Boolean(group.group_role);
  const siteAdmin = user.role === "ADMIN";

  return {
    isMember,
    canRead: isMember || !group.is_private || isModerator(user),
    canWrite: isMember || siteAdmin,
    canAdmin: group.group_role === "ADMIN" || siteAdmin,
  };
}

// Charge les droits et répond 404 / 403 si besoin ; renvoie null dans ce cas
async function requireGroup(req, res, right) {
  const access = await groupAccess(req.params.id, req.user);

  if (!access) {
    res.status(404).json({
      message: "Groupe introuvable",
    });
    return null;
  }

  if (!access[right]) {
    res.status(403).json({
      message:
        right === "canAdmin"
          ? "Réservé aux administrateurs du groupe"
          : "Vous n'êtes pas membre de ce groupe",
    });
    return null;
  }

  return access;
}

module.exports = {
  groupAccess,
  requireGroup,
};
