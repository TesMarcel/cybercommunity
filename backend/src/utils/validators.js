// Règles de validation partagées entre les routes

const POST_TITLE_MAX = 200;
const POST_CONTENT_MAX = 20000;
const COMMENT_MAX = 5000;

const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,30}$/;

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Vérifie un champ texte obligatoire ; renvoie un message d'erreur ou null
function checkText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    return `${label} obligatoire`;
  }

  if (value.trim().length > maxLength) {
    return `${label} : ${maxLength} caractères maximum`;
  }

  return null;
}

const parsePage = (query, defaultLimit = 20) => {
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), 50);

  return { page, limit, offset: (page - 1) * limit };
};

module.exports = {
  USERNAME_REGEX,
  EMAIL_REGEX,
  checkText,
  parsePage,
  POST_TITLE_MAX,
  POST_CONTENT_MAX,
  COMMENT_MAX,
};
