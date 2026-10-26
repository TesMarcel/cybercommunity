// Stockage des fichiers téléversés
const path = require("path");
const fs = require("fs");
const { pool } = require("../config/database");

const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, "..", "..", "uploads");

// Photos de profil : publiques
const imagesDir = path.join(uploadDir, "images");

// Pièces jointes : privées, servies uniquement par GET /api/files/:id
const filesDir = path.join(uploadDir, "files");

fs.mkdirSync(imagesDir, { recursive: true });
fs.mkdirSync(filesDir, { recursive: true });

// Supprime le fichier reçu si la requête échoue après l'envoi
async function discardUpload(req) {
  if (req.file) {
    await fs.promises.unlink(req.file.path).catch(() => {});
  }
}

// Supprime des pièces jointes (base + disque) à partir de leurs URL /api/files/:id
async function deleteAttachments(urls) {
  const ids = urls
    .map((url) => /^\/api\/files\/(\d+)$/.exec(url ?? "")?.[1])
    .filter(Boolean);

  if (ids.length === 0) {
    return;
  }

  const deleted = await pool.query(
    `
    DELETE FROM files
    WHERE id = ANY($1::bigint[])
    RETURNING stored_name
    `,
    [ids]
  );

  for (const file of deleted.rows) {
    await fs.promises
      .unlink(path.join(filesDir, path.basename(file.stored_name)))
      .catch(() => {});
  }
}

// Enregistre le fichier reçu dans la table files ; renvoie la ligne créée
async function saveUploadedFile(file, uploaderId) {
  const next = await pool.query(
    "SELECT nextval(pg_get_serial_sequence('files', 'id')) AS id"
  );

  const id = next.rows[0].id;

  const result = await pool.query(
    `
    INSERT INTO files(
      id,
      uploader_id,
      original_name,
      stored_name,
      mime_type,
      size_bytes,
      url
    )
    VALUES($1, $2, $3, $4, $5, $6, $7)
    RETURNING *
    `,
    [
      id,
      uploaderId,
      file.originalname.slice(0, 255),
      file.filename,
      file.mimetype,
      file.size,
      `/api/files/${id}`,
    ]
  );

  return result.rows[0];
}

// Le type est déduit des premiers octets du fichier, pas du nom
// ni du type annoncé par le client (SVG exclu : il peut contenir du JS)
function detectImageType(buffer) {
  if (buffer.length < 12) {
    return null;
  }

  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "jpg";
  }

  if (
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    )
  ) {
    return "png";
  }

  if (buffer.subarray(0, 6).toString("ascii").match(/^GIF8[79]a$/)) {
    return "gif";
  }

  if (
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "webp";
  }

  return null;
}

module.exports = {
  imagesDir,
  filesDir,
  discardUpload,
  deleteAttachments,
  saveUploadedFile,
  detectImageType,
};
