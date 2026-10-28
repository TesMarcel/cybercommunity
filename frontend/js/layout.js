// En-tête commun : navigation, badge de notifications, déconnexion
import { api, session, goToLogin } from "./api.js";
import { el, themeToggle } from "./ui.js";

const LINKS = [
  ["dashboard", "/pages/dashboard.html", "Tableau de bord"],
  ["forum", "/pages/forum.html", "Forum"],
  ["groups", "/pages/groups.html", "Groupes"],
  ["notifications", "/pages/notifications.html", "Notifications"],
  ["profile", "/pages/profile.html", "Profil"],
];

// Page réservée aux membres connectés : renvoie l'utilisateur,
// ou redirige vers la connexion
export async function requireUser(active) {
  if (!session.token()) {
    goToLogin();
    return new Promise(() => {});
  }

  try {
    const user = await api.get("/api/auth/me");
    session.save(null, user);
    renderHeader(user, active);
    return user;
  } catch (error) {
    // 401 : api.js redirige déjà vers la connexion
    if (error.status !== 401) {
      session.clear();
      document.querySelector("main").replaceChildren(
        el("div", { class: "alert alert-error", role: "alert" }, error.message),
        el("a", { class: "button", href: "/pages/login.html" }, "Retour à la connexion")
      );
    }
    return new Promise(() => {});
  }
}

export const isModerator = (user) => ["ADMIN", "MODERATOR"].includes(user?.role);

function renderHeader(user, active) {
  const header = document.querySelector(".site-header .inner");

  const badge = el("span", { class: "badge hidden", id: "notif-badge" });

  const links = LINKS.map(([key, href, label]) =>
    el(
      "a",
      { href, "aria-current": key === active ? "page" : null },
      label,
      key === "notifications" ? badge : null
    )
  );

  if (isModerator(user)) {
    links.push(
      el("a", { href: "/pages/moderation.html", "aria-current": active === "moderation" ? "page" : null }, "Modération")
    );
  }

  links.push(
    el(
      "button",
      {
        type: "button",
        class: "button-link",
        onclick: () => {
          session.clear();
          location.href = "/pages/login.html";
        },
      },
      "Déconnexion"
    )
  );

  header.replaceChildren(
    el("a", { class: "brand", href: "/pages/dashboard.html" }, "> cyber_community"),
    el("nav", { class: "nav", "aria-label": "Navigation principale" }, links),
    themeToggle()
  );

  refreshBadge();
  setInterval(refreshBadge, 30000);
}

export async function refreshBadge() {
  const badge = document.getElementById("notif-badge");

  if (!badge) {
    return;
  }

  try {
    const { unread } = await api.get("/api/notifications/unread-count");
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.classList.toggle("hidden", unread === 0);
    badge.setAttribute("aria-label", `${unread} non lue(s)`);
  } catch {
    // Badge non critique : on réessaiera au prochain intervalle
  }
}
