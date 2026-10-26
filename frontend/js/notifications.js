// Notifications : liste paginée, lecture, suppression
import { api } from "./api.js";
import { refreshBadge, requireUser } from "./layout.js";
import { busy, clear, el, formatDate, pagination, showEmpty, showLoading, showMessage } from "./ui.js";

await requireUser("notifications");

const list = document.getElementById("notifications");
const message = document.getElementById("message");
const unreadOnly = document.getElementById("unread-only");
const readAll = document.getElementById("read-all");

let page = 1;

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
    el(
      "div",
      { class: "text" },
      notification.is_read ? null : el("span", { class: "sr-only" }, "Non lue : "),
      el("div", {}, notification.message),
      el("div", { class: "meta" }, formatDate(notification.created_at))
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
      list.append(...data.notifications.map(renderNotification));
    }

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
