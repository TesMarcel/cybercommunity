// Liste des groupes : rejoindre un groupe public, création (admins)
import { api } from "./api.js";
import { requireUser } from "./layout.js";
import { busy, clear, el, plural, showEmpty, showLoading, showMessage } from "./ui.js";

const me = await requireUser("groups");

const list = document.getElementById("groups");
const message = document.getElementById("message");

const ROLE_LABELS = { ADMIN: "Admin du groupe", MEMBER: "Membre" };

function renderGroup(group) {
  const actions = el("div", { class: "row" });

  if (!group.my_role && !group.is_private) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-small",
        onclick: async (event) => {
          const done = busy(event.currentTarget);
          try {
            await api.post(`/api/groups/${group.id}/join`);
            location.href = `/pages/group.html?id=${group.id}`;
          } catch (error) {
            showMessage(message, error.message);
            done();
          }
        },
      }, "Rejoindre")
    );
  }

  return el(
    "li",
    { class: "post-item" },
    el("h2", {}, el("a", { href: `/pages/group.html?id=${group.id}` }, group.name)),
    el(
      "div",
      { class: "meta" },
      el("span", { class: "tag" }, group.is_private ? "Privé" : "Public"),
      el("span", {}, plural(group.members, "membre", "membres")),
      group.my_role ? el("span", {}, ROLE_LABELS[group.my_role]) : el("span", {}, "Non membre")
    ),
    group.description ? el("p", { class: "excerpt" }, group.description) : null,
    actions
  );
}

async function load() {
  showLoading(list);

  try {
    const groups = await api.get("/api/groups");
    clear(list);

    if (groups.length === 0) {
      showEmpty(list, me.role === "ADMIN" ? "Aucun groupe. Créez le premier !" : "Aucun groupe disponible pour le moment.");
    } else {
      list.append(...groups.map(renderGroup));
    }
  } catch (error) {
    clear(list);
    showMessage(message, error.message);
  }
}

// ---------- Création (admins du site) ----------

if (me.role === "ADMIN") {
  const toggle = document.getElementById("new-group-toggle");
  const section = document.getElementById("new-group");
  const form = document.getElementById("new-group-form");

  const show = (visible) => {
    section.classList.toggle("hidden", !visible);
    toggle.setAttribute("aria-expanded", String(visible));
    if (visible) form.name.focus();
  };

  toggle.classList.remove("hidden");
  toggle.addEventListener("click", () => show(section.classList.contains("hidden")));
  document.getElementById("new-group-cancel").addEventListener("click", () => show(false));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formMessage = document.getElementById("new-group-message");
    const name = form.name.value.trim();

    if (!name) {
      form.name.setAttribute("aria-invalid", "true");
      return showMessage(formMessage, "Le nom du groupe est obligatoire.");
    }

    const done = busy(form.querySelector("button[type=submit]"), "Création…");

    try {
      const group = await api.post("/api/groups", {
        name,
        description: form.description.value.trim() || null,
        is_private: form.is_private.checked,
      });
      location.href = `/pages/group.html?id=${group.id}`;
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });
}

load();
