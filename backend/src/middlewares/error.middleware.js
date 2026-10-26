// Route introuvable et gestion centralisée des erreurs
const multer = require("multer");
const { discardUpload } = require("../utils/files");

const PG_ERRORS = {
  "22P02": [400, "Paramètre invalide"],
  "22001": [400, "Valeur trop longue"],
  "23502": [400, "Champ obligatoire manquant"],
  "23503": [400, "Référence inexistante"],
  "23505": [409, "Cette ressource existe déjà"],
  "23514": [400, "Valeur non autorisée"],
};

function notFound(req, res) {
  res.status(404).json({
    message: "Route introuvable",
  });
}

async function errorHandler(error, req, res, next) {
  // Fichier reçu mais requête en échec : on ne le garde pas
  await discardUpload(req);

  // JSON mal formé ou trop volumineux
  if (error.type === "entity.parse.failed") {
    return res.status(400).json({
      message: "JSON invalide",
    });
  }

  if (error.type === "entity.too.large") {
    return res.status(413).json({
      message: "Requête trop volumineuse",
    });
  }

  if (error instanceof multer.MulterError) {
    return res.status(400).json({
      message:
        error.code === "LIMIT_FILE_SIZE"
          ? "Fichier trop volumineux"
          : error.message,
    });
  }

  if (PG_ERRORS[error.code]) {
    const [status, message] = PG_ERRORS[error.code];

    return res.status(status).json({
      message,
    });
  }

  // Message et pile seulement : pas de corps de requête ni d'en-têtes
  console.error(`${req.method} ${req.path} :`, error.stack || error);

  res.status(500).json({
    message: "Erreur interne du serveur",
  });
}

module.exports = {
  notFound,
  errorHandler,
};
