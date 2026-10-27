// Modération : signalements, utilisateurs, catégories (admins)
import { api } from "./api.js";
import { isModerator, requireUser } from "./layout.js";
import { busy, clear, el, formatDate, pagination, showEmpty, showLoading, showMessage } from "./ui.js";

const me = await requireUser("moderation");
const message = document.getElementById("message");
const isAdmin = me.role === "ADMIN";

const TYPES = { USER: "Membre", POST: "Discussion", COMMENT: "Commentaire", GROUP: "Groupe", MESSAGE: "Message de groupe" };
const STATUSES = { PENDING: "En attente", REVIEWED: "Examiné", RESOLVED: "Résolu", REJECTED: "Rejeté" };
const STATUS_TAGS = { PENDING: "tag-warning", RESOLVED: "tag-success" };
const ROLES = { USER: "Membre", MODERATOR: "Modérateur", ADMIN: "Administrateur" };

if (!isModerator(me)) {
  document.querySelector("main").replaceChildren(
    el("div", { class: "alert alert-error", role: "alert" }, "Accès réservé aux modérateurs et administrateurs."),
    el("a", { class: "button", href: "/pages/forum.html" }, "Retour au forum")
  );
  await new Promise(() => {}); // arrêt de la page
}

// Exécute une action, affiche l'erreur éventuelle, puis recharge
async function act(button, action, reload) {
  const done = busy(button);
  try {
    await action();
    showMessage(message, "");
    await reload();
  } catch (error) {
    showMessage(message, error.message);
  } finally {
    // Sans effet si la liste a été redessinée ; indispensable pour
    // les boutons de formulaire qui restent en place
    done();
  }
}

// ---------- Signalements ----------

const reportsList = document.getElementById("reports");
const statusFilter = document.getElementById("report-status");
let reportsPage = 1;

function targetLink(report) {
  const id = report.target_id;
  switch (report.target_type) {
    case "USER": return `/pages/profile.html?id=${id}`;
    case "POST": return `/pages/post.html?id=${id}`;
    case "COMMENT": return report.target_post_id ? `/pages/post.html?id=${report.target_post_id}#comment-${id}` : null;
    case "GROUP": return `/pages/group.html?id=${id}`;
    case "MESSAGE": return report.target_group_id ? `/pages/group.html?id=${report.target_group_id}` : null;
    default: return null;
  }
}

// Suppression du contenu signalé, selon son type
function deleteTarget(report) {
  switch (report.target_type) {
    case "POST": return api.del(`/api/posts/${report.target_id}`);
    case "COMMENT": return api.del(`/api/comments/${report.target_id}`);
    case "MESSAGE": return api.del(`/api/groups/${report.target_group_id}/messages/${report.target_id}`);
    default: return Promise.reject(new Error("Suppression impossible pour ce type"));
  }
}

function renderReport(report) {
  const exists = report.target_preview !== null;
  const link = exists ? targetLink(report) : null;
  const actions = el("div", { class: "row" });

  for (const status of ["REVIEWED", "RESOLVED", "REJECTED"]) {
    if (status !== report.status) {
      actions.append(
        el("button", {
          type: "button",
          class: "button-small",
          onclick: (event) => act(event.currentTarget, () => api.put(`/api/reports/${report.id}`, { status }), loadReports),
        }, `Marquer ${STATUSES[status].toLowerCase()}`)
      );
    }
  }

  if (exists && ["POST", "COMMENT", "MESSAGE"].includes(report.target_type)) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-small button-danger",
        onclick: (event) => {
          if (!confirm("Supprimer définitivement le contenu signalé ?")) return;
          act(event.currentTarget, async () => {
            await deleteTarget(report);
            await api.put(`/api/reports/${report.id}`, { status: "RESOLVED" });
          }, loadReports);
        },
      }, "Supprimer le contenu")
    );
  }

  if (exists && report.target_author_id && report.target_author_id !== me.id) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-small button-danger",
        onclick: (event) => {
          if (!confirm("Suspendre l'auteur de ce contenu ?")) return;
          act(event.currentTarget, () => api.put(`/api/moderation/users/${report.target_author_id}/suspend`), loadReports);
        },
      }, "Suspendre l'auteur")
    );
  }

  return el(
    "li",
    { class: "post-item stack" },
    el(
      "div",
      { class: "meta" },
      el("span", { class: "tag" }, TYPES[report.target_type]),
      el("span", { class: `tag ${STATUS_TAGS[report.status] ?? ""}` }, STATUSES[report.status]),
      el("span", {}, `signalé par ${report.reporter}`),
      el("span", {}, formatDate(report.created_at)),
      report.handler ? el("span", {}, `traité par ${report.handler}`) : null
    ),
    el("p", {}, el("strong", {}, report.reason), report.details ? el("span", { class: "muted" }, ` — ${report.details}`) : null),
    exists
      ? el("p", { class: "content card" }, link ? el("a", { href: link }, report.target_preview) : report.target_preview)
      : el("p", { class: "muted" }, "Élément déjà supprimé."),
    actions
  );
}

async function loadReports() {
  showLoading(reportsList);
  const status = statusFilter.value;

  try {
    const data = await api.get(`/api/reports?page=${reportsPage}&limit=10${status ? `&status=${status}` : ""}`);

    if (data.reports.length === 0 && reportsPage > 1) {
      reportsPage -= 1;
      return loadReports();
    }

    clear(reportsList);

    if (data.reports.length === 0) {
      showEmpty(reportsList, status === "PENDING" ? "Aucun signalement en attente. 👍" : "Aucun signalement.");
    } else {
      reportsList.append(...data.reports.map(renderReport));
    }

    pagination(document.getElementById("reports-pagination"), data, (page) => {
      reportsPage = page;
      loadReports();
    });
  } catch (error) {
    clear(reportsList);
    showMessage(message, error.message);
  }
}

statusFilter.addEventListener("change", () => {
  reportsPage = 1;
  loadReports();
});

// ---------- Utilisateurs ----------

const usersList = document.getElementById("users");
const usersSearch = document.getElementById("users-search");
let usersPage = 1;

function renderUser(user) {
  const actions = el("div", { class: "row" });

  // Un modérateur n'agit que sur les membres simples ; personne sur soi-même
  const canAct = user.id !== me.id && (isAdmin || user.role === "USER");

  if (canAct) {
    const action = user.is_active ? "suspend" : "activate";
    actions.append(
      el("button", {
        type: "button",
        class: `button-small${user.is_active ? " button-danger" : ""}`,
        onclick: (event) => act(event.currentTarget, () => api.put(`/api/moderation/users/${user.id}/${action}`), loadUsers),
      }, user.is_active ? "Suspendre" : "Réactiver")
    );
  }

  if (isAdmin && user.id !== me.id) {
    const select = el(
      "select",
      { "aria-label": `Rôle de ${user.username}`, class: "button-small" },
      Object.entries(ROLES).map(([value, label]) => el("option", { value, selected: value === user.role }, label))
    );
    select.addEventListener("change", () => {
      if (!confirm(`Donner le rôle « ${ROLES[select.value]} » à ${user.username} ?`)) {
        select.value = user.role;
        return;
      }
      act(select, () => api.put(`/api/admin/users/${user.id}/role`, { role: select.value }), loadUsers);
    });
    actions.append(select);
  }

  return el(
    "li",
    {},
    el("a", { href: `/pages/profile.html?id=${user.id}` }, user.username),
    el("span", { class: "tag" }, ROLES[user.role]),
    user.is_active ? null : el("span", { class: "tag tag-danger" }, "Suspendu"),
    el("span", { class: "spacer" }),
    actions
  );
}

async function loadUsers() {
  showLoading(usersList);
  const q = usersSearch.q.value.trim();

  try {
    const data = await api.get(`/api/users?page=${usersPage}&limit=10${q ? `&q=${encodeURIComponent(q)}` : ""}`);
    clear(usersList);

    if (data.users.length === 0) {
      showEmpty(usersList, "Aucun utilisateur trouvé.");
    } else {
      usersList.append(...data.users.map(renderUser));
    }

    pagination(document.getElementById("users-pagination"), data, (page) => {
      usersPage = page;
      loadUsers();
    });
  } catch (error) {
    clear(usersList);
    showMessage(message, error.message);
  }
}

usersSearch.addEventListener("submit", (event) => {
  event.preventDefault();
  usersPage = 1;
  loadUsers();
});

// ---------- Catégories (admins) ----------

const categoriesList = document.getElementById("categories");
const categoryForm = document.getElementById("category-form");

function renderCategory(category) {
  return el(
    "li",
    {},
    el("span", { class: "spacer" }, category.name, el("span", { class: "muted small" }, ` (${category.posts} discussion${category.posts > 1 ? "s" : ""})`)),
    el("button", {
      type: "button",
      class: "button-small",
      onclick: (event) => {
        const name = prompt("Nouveau nom de la catégorie :", category.name);
        if (!name || name.trim() === category.name) return;
        act(event.currentTarget, () => api.put(`/api/categories/${category.id}`, { name: name.trim() }), loadCategories);
      },
    }, "Renommer"),
    el("button", {
      type: "button",
      class: "button-small button-danger",
      onclick: (event) => {
        if (!confirm(`Supprimer la catégorie « ${category.name} » ? Ses discussions seront conservées, sans catégorie.`)) return;
        act(event.currentTarget, () => api.del(`/api/categories/${category.id}`), loadCategories);
      },
    }, "Supprimer")
  );
}

async function loadCategories() {
  try {
    const categories = await api.get("/api/categories");
    clear(categoriesList).append(...categories.map(renderCategory));
  } catch (error) {
    showMessage(message, error.message);
  }
}

if (isAdmin) {
  document.getElementById("categories-section").classList.remove("hidden");

  categoryForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = categoryForm.name.value.trim();
    if (!name) return showMessage(message, "Saisissez un nom de catégorie.");
    act(categoryForm.querySelector("button"), async () => {
      await api.post("/api/categories", { name });
      categoryForm.reset();
    }, loadCategories);
  });

  loadCategories();
}

loadReports();
loadUsers();
