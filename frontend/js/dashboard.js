// Tableau de bord : vue d'ensemble après connexion.
// Chaque bloc se charge seul : une erreur n'empêche pas d'afficher les autres.
import { api } from "./api.js";
import { isModerator, requireUser } from "./layout.js";
import { el, plural, showEmpty, showLoading, showMessage, timeAgo } from "./ui.js";

const user = await requireUser("dashboard");

document.getElementById("welcome").textContent = `Bonjour, ${user.username}`;

const statsList = document.getElementById("stats");
const latestPosts = document.getElementById("latest-posts");
const myGroups = document.getElementById("my-groups");
const latestNotifications = document.getElementById("latest-notifications");
const topics = document.getElementById("topics");
const progress = document.getElementById("profile-progress");

for (const list of [latestPosts, myGroups, latestNotifications, topics]) {
  showLoading(list);
}

const [members, posts, mine, groups, notifications, categories, profile, reports] = await Promise.allSettled([
  api.get("/api/users?limit=1"),
  api.get("/api/posts?limit=5"),
  api.get(`/api/posts?author_id=${user.id}&limit=1`),
  api.get("/api/groups"),
  api.get("/api/notifications?limit=4"),
  api.get("/api/categories"),
  api.get(`/api/users/${user.id}`),
  isModerator(user) ? api.get("/api/reports?status=PENDING&limit=1") : Promise.resolve(null),
]);

const value = (result) => (result.status === "fulfilled" ? result.value : null);
const joinedGroups = value(groups)?.filter((group) => group.my_role) ?? null;

// ---------- Chiffres clés ----------

// Sans lien (href null), la carte est un simple bloc
function stat(label, number, href, highlight = false) {
  return el(
    "li",
    {},
    el(
      href ? "a" : "div",
      { class: `dash-stat${highlight ? " dash-stat-alert" : ""}`, href },
      el("strong", {}, number ?? "—"),
      el("span", {}, label)
    )
  );
}

statsList.append(
  stat("Membres", value(members)?.total, null),
  stat("Discussions", value(posts)?.total, "/pages/forum.html"),
  stat("Mes discussions", value(mine)?.total, `/pages/profile.html?id=${user.id}`),
  stat("Mes groupes", joinedGroups?.length, "/pages/groups.html"),
  stat("Non lues", value(notifications)?.unread, "/pages/notifications.html", value(notifications)?.unread > 0)
);

if (value(reports)) {
  const pending = value(reports).total;
  statsList.append(stat("Signalements à traiter", pending, "/pages/moderation.html", pending > 0));
}

// ---------- Profil à compléter ----------

const details = value(profile);

if (details) {
  const steps = [
    ["Ajouter une photo de profil", Boolean(details.photo_url)],
    ["Écrire une courte biographie", Boolean(details.biography)],
    ["Indiquer vos compétences", Boolean(details.skills)],
    ["Choisir un pseudonyme", Boolean(details.pseudonym)],
  ];
  const done = steps.filter(([, ok]) => ok).length;

  if (done < steps.length) {
    const percent = Math.round((done / steps.length) * 100);

    progress.append(
      el(
        "div",
        { class: "card-head" },
        el("h2", { id: "progress-title" }, "Complétez votre profil"),
        el("span", { class: "muted small" }, `${done} / ${steps.length}`)
      ),
      el(
        "div",
        { class: "progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": percent, "aria-label": "Profil complété" },
        el("span", { class: `progress-bar progress-${percent}` })
      ),
      el(
        "ul",
        { class: "checklist" },
        steps.map(([label, ok]) =>
          el("li", { class: ok ? "done" : "" }, el("span", { class: "sr-only" }, ok ? "Fait : " : "À faire : "), label)
        )
      ),
      el("a", { class: "button button-small", href: `/pages/profile.html?id=${user.id}` }, "Compléter mon profil")
    );
    progress.classList.remove("hidden");
  }
}

// ---------- Dernières discussions ----------

if (!value(posts)) {
  showMessage(latestPosts, "Impossible de charger les discussions.");
} else if (value(posts).posts.length === 0) {
  showEmpty(latestPosts, "Aucune discussion pour le moment. Lancez la première !");
} else {
  latestPosts.replaceChildren(
    ...value(posts).posts.map((post) =>
      el(
        "li",
        { class: "dash-item" },
        el("a", { class: "dash-item-title", href: `/pages/post.html?id=${post.id}` }, post.title),
        el(
          "div",
          { class: "meta" },
          post.category ? el("span", { class: "tag tag-accent" }, post.category) : null,
          el("span", {}, "par ", post.author),
          timeAgo(post.created_at),
          el("span", {}, plural(post.comments, "commentaire", "commentaires"))
        )
      )
    )
  );
}

// ---------- Mes groupes ----------

if (!joinedGroups) {
  showMessage(myGroups, "Impossible de charger les groupes.");
} else if (joinedGroups.length === 0) {
  myGroups.replaceChildren(
    el(
      "li",
      { class: "empty" },
      "Vous n'avez rejoint aucun groupe. ",
      el("a", { href: "/pages/groups.html" }, "Découvrir les groupes")
    )
  );
} else {
  myGroups.replaceChildren(
    ...joinedGroups.slice(0, 5).map((group) =>
      el(
        "li",
        { class: "dash-item dash-item-row" },
        el("span", { class: "group-initial", "aria-hidden": "true" }, group.name[0].toUpperCase()),
        el(
          "div",
          {},
          el("a", { class: "dash-item-title", href: `/pages/group.html?id=${group.id}` }, group.name),
          el("div", { class: "meta" }, el("span", {}, group.is_private ? "Privé" : "Public"), el("span", {}, plural(group.members, "membre", "membres")))
        )
      )
    )
  );
}

// ---------- Notifications ----------

if (!value(notifications)) {
  showMessage(latestNotifications, "Impossible de charger les notifications.");
} else if (value(notifications).notifications.length === 0) {
  showEmpty(latestNotifications, "Aucune notification.");
} else {
  latestNotifications.replaceChildren(
    ...value(notifications).notifications.map((notification) =>
      el(
        "li",
        { class: `dash-item${notification.is_read ? "" : " unread"}` },
        notification.is_read ? null : el("span", { class: "sr-only" }, "Non lue : "),
        el("div", {}, notification.message),
        el("div", { class: "meta" }, timeAgo(notification.created_at))
      )
    )
  );
}

// ---------- Thématiques ----------

if (!value(categories)) {
  showMessage(topics, "Impossible de charger les thématiques.");
} else if (value(categories).length === 0) {
  showEmpty(topics, "Aucune thématique.");
} else {
  topics.replaceChildren(
    ...value(categories).map((category) =>
      el(
        "li",
        {},
        el(
          "a",
          { class: "topic-chip", href: `/pages/forum.html?category=${category.id}` },
          category.name,
          el("span", { class: "topic-count" }, category.posts)
        )
      )
    )
  );
}
