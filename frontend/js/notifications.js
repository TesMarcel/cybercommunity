// Notifications : liste paginée, lecture, suppression
import { api } from "./api.js";
import { refreshBadge, requireUser } from "./layout.js";
import { ICONS, busy, clear, el, icon, pagination, plural, showEmpty, showLoading, showMessage, timeAgo } from "./ui.js";

await requireUser("notifications");

const list = document.getElementById("notifications");
const message = document.getElementById("message");
const unreadOnly = document.getElementById("unread-only");
const readAll = document.getElementById("read-all");

let page = 1;

// Icône selon le type de notification (types envoyés par le serveur)
const REPLY = "M9 17l-5-5 5-5M4 12h11a5 5 0 0 1 5 5v2";
const USERS = "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8";
const BELL = "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0";
const TYPE_ICONS = {
  COMMENT: ICONS.comment,
  GROUP_COMMENT: ICONS.comment,
  REPLY,
  GROUP_REPLY: REPLY,
  GROUP_ADDED: USERS,
  REPORT_UPDATE: ICONS.shield,
};

const dayFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

function dayLabel(value) {
  const days = Math.round((new Date(new Date().toDateString()) - new Date(new Date(value).toDateString())) / 86400000);
  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 7) return "Cette semaine";
  return dayFormat.format(new Date(value));
}

// Une liste par période : Aujourd'hui, Hier, Cette semaine, puis par date
function renderGroups(notifications) {
  const groups = new Map();

  for (const notification of notifications) {
    const label = dayLabel(notification.created_at);
    groups.set(label, [...(groups.get(label) || []), notification]);
  }

  return [...groups].map(([label, items]) =>
    el(
      "section",
      { class: "notif-group" },
      el("h2", { class: "aside-title" }, label),
      el("ul", { class: "post-list" }, items.map(renderNotification))
    )
  );
}

function renderNotification(notification) {
  const actions = el("div", { class: "row" });

  if (!notification.is_read) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-small",
        onclick: async () => {
          try {
            await api.put(`/api/notifications/${notification.id}/read`);
            load();
          } catch (error) {
            showMessage(message, error.message);
          }
        },
      }, "Marquer comme lue")
    );
  }

  actions.append(
    el("button", {
      type: "button",
      class: "button-small button-danger",
      "aria-label": "Supprimer la notification",
      onclick: async () => {
        try {
          await api.del(`/api/notifications/${notification.id}`);
          load();
        } catch (error) {
          showMessage(message, error.message);
        }
      },
    }, "Supprimer")
  );

  return el(
    "li",
    { class: `post-item notification${notification.is_read ? "" : " unread"}` },
    el("span", { class: "notif-icon" }, icon(TYPE_ICONS[notification.type] || BELL)),
    el(
      "div",
      { class: "text" },
      notification.is_read ? null : el("span", { class: "sr-only" }, "Non lue : "),
      el("div", {}, notification.message),
      el("div", { class: "meta" }, timeAgo(notification.created_at))
    ),
    actions
  );
}

async function load() {
  showMessage(message, "");
  showLoading(list);

  try {
    const data = await api.get(`/api/notifications?page=${page}&limit=20${unreadOnly.checked ? "&unread=true" : ""}`);

    // Page vidée (dernière notification supprimée) : on recule d'une page
    if (data.notifications.length === 0 && page > 1) {
      page -= 1;
      return load();
    }

    clear(list);

    if (data.notifications.length === 0) {
      showEmpty(list, unreadOnly.checked ? "Aucune notification non lue." : "Aucune notification pour le moment.");
    } else {
      list.append(...renderGroups(data.notifications));
    }

    document.getElementById("unread-summary").textContent =
      data.unread === 0 ? "Vous êtes à jour : aucune notification non lue." : `${plural(data.unread, "notification non lue", "notifications non lues")}.`;

    readAll.disabled = data.unread === 0;

    pagination(document.getElementById("pagination"), data, (next) => {
      page = next;
      load();
    });
  } catch (error) {
    clear(list);
    showMessage(message, error.message);
  }

  refreshBadge();
}

unreadOnly.addEventListener("change", () => {
  page = 1;
  load();
});

readAll.addEventListener("click", async () => {
  const done = busy(readAll);
  try {
    await api.put("/api/notifications/read-all");
    await load();
  } catch (error) {
    showMessage(message, error.message);
  } finally {
    done();
  }
});

load();
