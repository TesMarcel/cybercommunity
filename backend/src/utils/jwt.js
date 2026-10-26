// Création des tokens JWT
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const { JWT_SECRET } = require("../config/env");

// Empreinte du mot de passe stockée dans le token :
// changer de mot de passe invalide tous les anciens tokens
function passwordVersion(passwordHash) {
  return crypto
    .createHash("sha256")
    .update(passwordHash)
    .digest("hex")
    .slice(0, 16);
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      pv: passwordVersion(user.password_hash),
    },
    JWT_SECRET,
    {
      algorithm: "HS256",
      expiresIn: "7d",
    }
  );
}

module.exports = {
  passwordVersion,
  generateToken,
};
