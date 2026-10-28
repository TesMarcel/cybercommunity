// Profil : le sien (modifiable) ou celui d'un autre membre (?id=)
import { api, session } from "./api.js";
import { isModerator, requireUser } from "./layout.js";
import { openReport } from "./report.js";
import { busy, el, formatDate, params, plural, showMessage, timeAgo } from "./ui.js";

const me = await requireUser("profile");

const userId = Number(params.get("id")) || me.id;
const isMe = userId === me.id;

const container = document.getElementById("profile");
const message = document.getElementById("message");

const ROLES = { USER: "Membre", MODERATOR: "Modérateur", ADMIN: "Administrateur" };

// Onglets de mon profil ; l'onglet ouvert survit au rechargement des données
const TABS = [
  ["overview", "Aperçu"],
  ["edit", "Modifier le profil"],
  ["photo", "Photo"],
  ["security", "Sécurité"],
];
let activeTab = "overview";

const sinceFormat = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric" });

function avatar(profile) {
  return profile.photo_url
    ? el("img", { class: "avatar", src: profile.photo_url, alt: `Photo de ${profile.username}` })
    : el("span", { class: "avatar avatar-placeholder", "aria-hidden": "true" }, profile.username[0].toUpperCase());
}

function details(profile) {
  const rows = [
    ["Pseudo", profile.pseudonym],
    ["Nom", profile.full_name],
    ["Pays", profile.country],
    ["Email", profile.email],
    ["Compétences", profile.skills],
    ["Membre depuis", formatDate(profile.created_at)],
  ].filter(([, value]) => value);

  if (rows.length === 0) {
    return el("p", { class: "muted" }, "Aucune information.");
  }

  return el("dl", { class: "details" }, rows.flatMap(([label, value]) => [el("dt", {}, label), el("dd", {}, value)]));
}

// ---------- Profil d'un autre membre ----------

function moderationActions(profile) {
  // Un modérateur n'agit que sur les membres simples ; un admin sur tous
  const allowed = isModerator(me) && (me.role === "ADMIN" || profile.role === "USER");

  if (!allowed || profile.is_active === undefined) {
    return null;
  }

  const action = profile.is_active ? "suspend" : "activate";

  return el(
    "button",
    {
      type: "button",
      class: profile.is_active ? "button-danger" : "",
      onclick: async (event) => {
        const label = profile.is_active ? "Suspendre" : "Réactiver";
        if (!confirm(`${label} le compte de ${profile.username} ?`)) return;
        const done = busy(event.currentTarget);
        try {
          await api.put(`/api/moderation/users/${profile.id}/${action}`);
          load();
        } catch (error) {
          showMessage(message, error.message);
          done();
        }
      },
    },
    profile.is_active ? "Suspendre le compte" : "Réactiver le compte"
  );
}

// ---------- Mon profil ----------

function editForm(profile) {
  const formMessage = el("div", { "aria-live": "polite" });

  const field = (name, label, max, textarea = false) =>
    el(
      "div",
      { class: "field" },
      el("label", { for: `f-${name}` }, label),
      textarea
        ? el("textarea", { id: `f-${name}`, name, maxlength: String(max) }, profile[name] ?? "")
        : el("input", { id: `f-${name}`, name, maxlength: String(max), value: profile[name] ?? "" })
    );

  const form = el(
    "form",
    { class: "card", novalidate: true },
    el("h2", {}, "Modifier mon profil"),
    formMessage,
    el("div", { class: "grid-2" }, field("pseudonym", "Pseudo", 100), field("full_name", "Nom complet", 150)),
    field("country", "Pays", 100),
    field("skills", "Compétences", 500),
    field("biography", "Biographie", 2000, true),
    el("button", { class: "button-primary", type: "submit" }, "Enregistrer")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const done = busy(form.querySelector("button"), "Enregistrement…");

    const body = {};
    for (const name of ["pseudonym", "full_name", "country", "skills", "biography"]) {
      body[name] = form[name].value.trim();
    }

    try {
      await api.put("/api/users/profile", body);
      activeTab = "overview";
      await load();
      showMessage(message, "Profil enregistré.", "success");
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  return form;
}

function photoForm() {
  const formMessage = el("div", { "aria-live": "polite" });
  const input = el("input", { id: "photo", name: "photo", type: "file", accept: "image/jpeg,image/png,image/gif,image/webp", required: true });

  const form = el(
    "form",
    { class: "card", novalidate: true },
    el("h2", {}, "Photo de profil"),
    formMessage,
    el("div", { class: "field" }, el("label", { for: "photo" }, "Image (JPEG, PNG, GIF ou WebP, 2 Mo maximum)"), input),
    el("button", { type: "submit" }, "Envoyer la photo")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = input.files[0];

    if (!file) {
      return showMessage(formMessage, "Choisissez une image.");
    }

    if (file.size > 2 * 1024 * 1024) {
      return showMessage(formMessage, "L'image dépasse 2 Mo.");
    }

    const done = busy(form.querySelector("button"), "Envoi…");
    const data = new FormData();
    data.append("photo", file);

    try {
      await api.upload("/api/users/profile/photo", data);
      activeTab = "overview";
      await load();
      showMessage(message, "Photo mise à jour.", "success");
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  return form;
}

function passwordForm() {
  const formMessage = el("div", { "aria-live": "polite" });

  const form = el(
    "form",
    { class: "card", novalidate: true },
    el("h2", {}, "Changer de mot de passe"),
    formMessage,
    el("div", { class: "field" }, el("label", { for: "current" }, "Mot de passe actuel"), el("input", { id: "current", name: "current", type: "password", autocomplete: "current-password", required: true })),
    el(
      "div",
      { class: "grid-2" },
      el("div", { class: "field" }, el("label", { for: "next" }, "Nouveau mot de passe"), el("input", { id: "next", name: "next", type: "password", autocomplete: "new-password", required: true, minlength: "8" })),
      el("div", { class: "field" }, el("label", { for: "confirm" }, "Confirmer"), el("input", { id: "confirm", name: "confirm", type: "password", autocomplete: "new-password", required: true }))
    ),
    el("p", { class: "hint" }, "Vos autres sessions (autres navigateurs) seront déconnectées."),
    el("button", { type: "submit" }, "Changer le mot de passe")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (form.next.value.length < 8) {
      return showMessage(formMessage, "Le nouveau mot de passe doit contenir au moins 8 caractères.");
    }

    if (form.next.value !== form.confirm.value) {
      return showMessage(formMessage, "Les deux mots de passe ne correspondent pas.");
    }

    const done = busy(form.querySelector("button"), "Modification…");

    try {
      const data = await api.put("/api/auth/password", {
        current_password: form.current.value,
        new_password: form.next.value,
      });
      // Les anciens tokens sont invalidés : on garde le nouveau
      session.save(data.token, me);
      form.reset();
      showMessage(formMessage, "Mot de passe modifié.", "success");
    } catch (error) {
      showMessage(formMessage, error.message);
    } finally {
      done();
    }
  });

  return form;
}

// ---------- Discussions du membre ----------

function postsSection(profile, posts) {
  const section = el(
    "section",
    { class: "card" },
    el("div", { class: "card-head" }, el("h2", {}, isMe ? "Mes discussions" : `Discussions de ${profile.username}`))
  );

  if (!posts) {
    section.append(el("p", { class: "muted" }, "Impossible de charger les discussions."));
  } else if (posts.posts.length === 0) {
    section.append(el("p", { class: "muted" }, "Aucune discussion publiée."));
  } else {
    section.append(
      el(
        "ul",
        { class: "dash-list" },
        posts.posts.map((post) =>
          el(
            "li",
            { class: "dash-item" },
            el("a", { class: "dash-item-title", href: `/pages/post.html?id=${post.id}` }, post.title),
            el(
              "div",
              { class: "meta" },
              post.category ? el("span", { class: "tag tag-accent" }, post.category) : null,
              timeAgo(post.created_at),
              el("span", {}, plural(post.comments, "commentaire", "commentaires"))
            )
          )
        )
      ),
      posts.total > posts.posts.length ? el("p", { class: "muted small" }, `${posts.total} discussions au total`) : null
    );
  }

  return section;
}

// ---------- Onglets ----------

function tabs(panels) {
  const list = el("div", { class: "tabs", role: "tablist", "aria-label": "Sections de mon profil" });

  const select = (name, focus = false) => {
    activeTab = name;
    for (const [key] of TABS) {
      const button = document.getElementById(`tab-${key}`);
      button.setAttribute("aria-selected", String(key === name));
      button.tabIndex = key === name ? 0 : -1;
      panels[key].classList.toggle("hidden", key !== name);
    }
    if (focus) document.getElementById(`tab-${name}`).focus();
  };

  for (const [key, label] of TABS) {
    const button = el("button", { type: "button", role: "tab", id: `tab-${key}`, "aria-controls": `panel-${key}` }, label);
    button.addEventListener("click", () => select(key));
    // Flèches gauche/droite entre les onglets (accessibilité clavier)
    button.addEventListener("keydown", (event) => {
      const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (!offset) return;
      const index = TABS.findIndex(([name]) => name === key);
      select(TABS[(index + offset + TABS.length) % TABS.length][0], true);
    });
    list.append(button);
    panels[key].setAttribute("role", "tabpanel");
    panels[key].id = `panel-${key}`;
    panels[key].setAttribute("aria-labelledby", `tab-${key}`);
  }

  return { list, select };
}

// ---------- Chargement ----------

async function load() {
  let profile;

  try {
    profile = await api.get(`/api/users/${userId}`);
  } catch (error) {
    container.replaceChildren();
    return showMessage(message, error.status === 404 || error.status === 400 ? "Ce membre n'existe pas." : error.message);
  }

  const posts = await api.get(`/api/posts?author_id=${profile.id}&limit=5`).catch(() => null);
  const skills = (profile.skills || "").split(",").map((skill) => skill.trim()).filter(Boolean);

  const actions = el("div", { class: "row profile-actions" });

  if (!isMe) {
    actions.append(el("button", { type: "button", class: "button-link", onclick: () => openReport("USER", profile.id) }, "Signaler ce membre"));
    const moderation = moderationActions(profile);
    if (moderation) actions.append(moderation);
  }

  // En-tête : bannière, photo, nom, rôle, chiffres
  const head = el(
    "section",
    { class: "card profile-hero" },
    el("div", { class: "profile-cover", "aria-hidden": "true" }),
    el(
      "div",
      { class: "profile-identity" },
      avatar(profile),
      el(
        "div",
        { class: "profile-name" },
        el("h1", {}, profile.username),
        el(
          "div",
          { class: "row" },
          el("span", { class: "tag tag-accent" }, ROLES[profile.role] ?? profile.role),
          profile.is_active === false ? el("span", { class: "tag tag-danger" }, "Suspendu") : null,
          profile.pseudonym ? el("span", { class: "muted small" }, profile.pseudonym) : null,
          profile.country ? el("span", { class: "muted small" }, profile.country) : null
        )
      ),
      actions
    ),
    el(
      "ul",
      { class: "profile-stats", "aria-label": "En bref" },
      el("li", {}, el("strong", {}, posts ? posts.total : "—"), el("span", {}, "discussions")),
      el("li", {}, el("strong", {}, skills.length), el("span", {}, "compétences")),
      el("li", {}, el("strong", {}, sinceFormat.format(new Date(profile.created_at))), el("span", {}, "membre depuis"))
    )
  );

  const about = el(
    "section",
    { class: "card" },
    el("div", { class: "card-head" }, el("h2", {}, "À propos")),
    profile.biography ? el("p", { class: "content" }, profile.biography) : el("p", { class: "muted" }, isMe ? "Ajoutez une biographie dans « Modifier le profil »." : "Pas encore de biographie."),
    skills.length ? el("ul", { class: "skill-list", "aria-label": "Compétences" }, skills.map((skill) => el("li", { class: "tag" }, skill))) : null,
    details(profile)
  );

  const overview = el("div", { class: "profile-grid" }, about, postsSection(profile, posts));

  if (!isMe) {
    container.replaceChildren(head, overview);
  } else {
    const panels = {
      overview,
      edit: el("div", {}, editForm(profile)),
      photo: el("div", {}, photoForm()),
      security: el("div", {}, passwordForm()),
    };
    const { list, select } = tabs(panels);
    container.replaceChildren(head, list, ...Object.values(panels));
    select(activeTab);
  }

  document.title = `${profile.username} — Cyber Community`;
}

load();
