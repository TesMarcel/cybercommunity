// Limites anti brute-force (par adresse IP)
const rateLimit = require("express-rate-limit");

// Seuls les échecs comptent : une connexion réussie ne consomme rien
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT) || 10,
  skipSuccessfulRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Trop de tentatives, réessayez dans 15 minutes",
  },
});

// Seuls les comptes réellement créés comptent (pas les erreurs de saisie)
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: Number(process.env.REGISTER_RATE_LIMIT) || 5,
  skipFailedRequests: true,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: {
    message: "Trop d'inscriptions depuis cette adresse, réessayez plus tard",
  },
});

module.exports = {
  loginLimiter,
  registerLimiter,
};
