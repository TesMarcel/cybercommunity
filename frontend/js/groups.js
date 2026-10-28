// Liste des groupes : rejoindre un groupe public, création (admins)
import { api } from "./api.js";
import { requireUser } from "./layout.js";
import { busy, clear, el, icon, plural, showEmpty, showLoading, showMessage } from "./ui.js";

const me = await requireUser("groups");

const list = document.getElementById("groups");
const message = document.getElementById("message");

const ROLE_LABELS = { ADMIN: "Admin du groupe", MEMBER: "Membre" };

const LOCK = "M7 11V7a5 5 0 0 1 10 0v4M5 11h14v10H5z";
const GLOBE = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18";

const FILTERS = {
  all: () => true,
  mine: (group) => Boolean(group.my_role),
  public: (group) => !group.is_private,
  private: (group) => group.is_private,
};

const EMPTY_FILTERED = {
  mine: "Vous n'avez rejoint aucun groupe.",
  public: "Aucun groupe public.",
  private: "Aucun groupe privé visible.",
};

let groups = [];
let filter = "all";

function renderGroup(group) {
  const actions = el("div", { class: "row" });

  if (!group.my_role && !group.is_private) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-primary button-small",
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

  // Carte entièrement cliquable (lien du nom étiré), le bouton reste au-dessus
  return el(
    "li",
    { class: "group-card" },
    el(
      "div",
      { class: "group-card-head" },
      el("span", { class: "group-initial", "aria-hidden": "true" }, group.name[0].toUpperCase()),
      el(
        "span",
        { class: `tag${group.is_private ? "" : " tag-success"}` },
        icon(group.is_private ? LOCK : GLOBE),
        group.is_private ? "Privé" : "Public"
      )
    ),
    el("h2", {}, el("a", { class: "stretched-link", href: `/pages/group.html?id=${group.id}` }, group.name)),
    el("p", { class: "excerpt" }, group.description || "Pas de description."),
    el(
      "div",
      { class: "group-card-foot" },
      el(
        "div",
        { class: "meta" },
        el("span", {}, plural(group.members, "membre", "membres")),
        group.my_role ? el("span", { class: "tag tag-accent" }, ROLE_LABELS[group.my_role]) : el("span", {}, "Non membre")
      ),
      actions
    )
  );
}

function render() {
  clear(list);
  const visible = groups.filter(FILTERS[filter]);

  if (groups.length === 0) {
    showEmpty(list, me.role === "ADMIN" ? "Aucun groupe. Créez le premier !" : "Aucun groupe disponible pour le moment.");
  } else if (visible.length === 0) {
    showEmpty(list, EMPTY_FILTERED[filter]);
  } else {
    list.append(...visible.map(renderGroup));
  }
}

for (const button of document.querySelectorAll("#group-filter button")) {
  button.addEventListener("click", () => {
    filter = button.dataset.filter;
    for (const other of document.querySelectorAll("#group-filter button")) {
      other.setAttribute("aria-pressed", String(other === button));
    }
    render();
  });
}

async function load() {
  showLoading(list);

  try {
    groups = await api.get("/api/groups");
    render();
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
