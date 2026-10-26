// Hachage et règles des mots de passe
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 12;

// Hash utilisé quand le login n'existe pas : bcrypt.compare prend
// alors le même temps, ce qui empêche de deviner les comptes existants
const DUMMY_HASH = bcrypt.hashSync("dummy-password", BCRYPT_ROUNDS);

// bcrypt ignore tout ce qui dépasse 72 octets
function checkPassword(password) {
  if (typeof password !== "string" || password.length < 8) {
    return "Le mot de passe doit contenir au moins 8 caractères";
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    return "Le mot de passe ne doit pas dépasser 72 octets";
  }

  return null;
}

module.exports = {
  BCRYPT_ROUNDS,
  DUMMY_HASH,
  checkPassword,
};
