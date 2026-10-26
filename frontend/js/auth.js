// Connexion et inscription
import { api, session } from "./api.js";
import { busy, params, showMessage } from "./ui.js";

const message = document.getElementById("message");

// Après connexion : page demandée (même site uniquement) ou forum
function redirectAfterLogin() {
  const next = params.get("next");
  location.href = next && next.startsWith("/") && !next.startsWith("//") ? next : "/pages/forum.html";
}

// Déjà connecté : inutile de rester ici
if (session.token()) {
  redirectAfterLogin();
}

function markInvalid(form) {
  for (const input of form.querySelectorAll("input")) {
    input.setAttribute("aria-invalid", String(!input.checkValidity()));
  }
}

const loginForm = document.getElementById("login-form");

loginForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  markInvalid(loginForm);

  if (!loginForm.checkValidity()) {
    return showMessage(message, "Renseignez votre identifiant et votre mot de passe.");
  }

  const done = busy(loginForm.querySelector("button"), "Connexion…");

  try {
    const data = await api.post(
      "/api/auth/login",
      { login: loginForm.login.value.trim(), password: loginForm.password.value },
      { auth: false }
    );
    session.save(data.token, data.user);
    redirectAfterLogin();
  } catch (error) {
    showMessage(message, error.message);
    done();
  }
});

const registerForm = document.getElementById("register-form");

registerForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  const { password, confirm } = registerForm;
  confirm.setCustomValidity(password.value === confirm.value ? "" : "different");
  markInvalid(registerForm);

  if (!registerForm.checkValidity()) {
    const firstInvalid = registerForm.querySelector(":invalid");
    firstInvalid.focus();
    return showMessage(
      message,
      firstInvalid === confirm && confirm.value
        ? "Les deux mots de passe ne correspondent pas."
        : "Vérifiez les champs signalés en rouge."
    );
  }

  const done = busy(registerForm.querySelector("button"), "Création…");

  try {
    const data = await api.post(
      "/api/auth/register",
      {
        username: registerForm.username.value.trim(),
        email: registerForm.email.value.trim(),
        country: registerForm.country.value.trim(),
        password: password.value,
      },
      { auth: false }
    );
    session.save(data.token, data.user);
    location.href = "/pages/forum.html";
  } catch (error) {
    showMessage(message, error.message);
    done();
  }
});
