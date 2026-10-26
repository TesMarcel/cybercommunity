// Réception des fichiers (multer)
const crypto = require("crypto");
const path = require("path");
const multer = require("multer");
const { filesDir } = require("../utils/files");

// Extensions acceptées pour les pièces jointes (pas d'exécutables,
// ni de HTML/SVG/JS). Les fichiers sont de toute façon téléchargés,
// jamais affichés par le navigateur.
const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".txt", ".md", ".csv", ".log", ".json",
  ".png", ".jpg", ".jpeg", ".gif", ".webp",
  ".zip", ".gz", ".tar", ".7z",
  ".docx", ".xlsx", ".pptx", ".odt", ".ods", ".odp",
  ".pcap", ".pcapng",
]);

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, filesDir);
  },

  // Nom aléatoire sans extension : le nom d'origine reste en base
  filename: function (req, file, cb) {
    cb(null, crypto.randomBytes(16).toString("hex"));
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
  fileFilter: function (req, file, cb) {
    const extension = path.extname(file.originalname).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(extension)) {
      req.fileRejected = true;
      return cb(null, false);
    }

    cb(null, true);
  },
});

// Photos : gardées en mémoire, vérifiées, puis écrites sur le disque
const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 2 * 1024 * 1024,
  },
});

module.exports = {
  upload,
  photoUpload,
};
