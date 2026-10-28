// Page d'un groupe : discussions, messagerie, membres
import { api, download } from "./api.js";
import { isModerator, requireUser } from "./layout.js";
import { openReport } from "./report.js";
import { avatar, busy, clear, el, formatDate, icon, params, plural, richText, showEmpty, showLoading, showMessage, timeAgo } from "./ui.js";

const me = await requireUser("groups");

const groupId = Number(params.get("id"));
const base = `/api/groups/${groupId}`;
const message = document.getElementById("message");
const head = document.getElementById("group-head");

const ROLE_LABELS = { ADMIN: "Admin du groupe", MEMBER: "Membre" };

// Extensions acceptées par le serveur pour les pièces jointes
const PAPERCLIP = "M21.4 11.1l-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5";

const SEND = "M22 2L11 13M22 2l-7 20-4-9-9-4z";

const ACCEPT = ".pdf,.txt,.md,.csv,.log,.json,.png,.jpg,.jpeg,.gif,.webp,.zip,.gz,.tar,.7z,.docx,.xlsx,.pptx,.odt,.ods,.odp,.pcap,.pcapng";

let group;
let canWrite = false;
let canAdmin = false;

const canDelete = (authorId) => canAdmin || authorId === me.id || isModerator(me);

// ---------- En-tête du groupe ----------

function renderHead() {
  const actions = el("div", { class: "row" });

  if (!group.my_role && !group.is_private) {
    actions.append(el("button", { type: "button", class: "button-primary", onclick: join }, "Rejoindre le groupe"));
  }

  if (canAdmin) {
    actions.append(el("button", { type: "button", onclick: editGroup }, "Modifier"));
    actions.append(el("button", { type: "button", class: "button-danger", onclick: deleteGroup }, "Supprimer le groupe"));
  }

  if (group.my_role) {
    actions.append(el("button", { type: "button", onclick: () => removeMember(me.id, true) }, "Quitter le groupe"));
  }

  actions.append(el("button", { type: "button", class: "button-link", onclick: () => openReport("GROUP", group.id) }, "Signaler"));

  head.replaceChildren(
    el(
      "div",
      { class: "card group-hero" },
      el("span", { class: "group-initial group-initial-lg", "aria-hidden": "true" }, group.name[0].toUpperCase()),
      el("h1", {}, group.name),
      el(
        "div",
        { class: "meta" },
        el("span", { class: "tag" }, group.is_private ? "Privé" : "Public"),
        el("span", {}, plural(group.members, "membre", "membres")),
        el("span", {}, `créé par ${group.creator}`),
        group.my_role ? el("span", {}, `Vous : ${ROLE_LABELS[group.my_role]}`) : null
      ),
      group.description ? el("p", { class: "content muted" }, group.description) : null,
      !canWrite ? el("p", { class: "muted small" }, "Lecture seule : rejoignez le groupe pour participer.") : null,
      actions
    )
  );

  document.title = `${group.name} — Cyber Community`;
  document.getElementById("breadcrumb-group").replaceChildren(el("span", { "aria-hidden": "true" }, "/"), el("span", {}, group.name));
}

async function join(event) {
  const done = busy(event.currentTarget);
  try {
    await api.post(`${base}/join`);
    await loadGroup();
  } catch (error) {
    showMessage(message, error.message);
    done();
  }
}

function editGroup() {
  const formMessage = el("div", { "aria-live": "polite" });

  const form = el(
    "form",
    { class: "card", novalidate: true },
    el("h1", {}, "Modifier le groupe"),
    formMessage,
    el("div", { class: "field" }, el("label", { for: "g-name" }, "Nom"), el("input", { id: "g-name", name: "name", value: group.name, required: true, maxlength: "120" })),
    el("div", { class: "field" }, el("label", { for: "g-description" }, "Description"), el("textarea", { id: "g-description", name: "description", maxlength: "2000" }, group.description ?? "")),
    el("div", { class: "field" }, el("label", { class: "row" }, el("input", { type: "checkbox", class: "checkbox", name: "is_private", checked: group.is_private }), "Groupe privé")),
    el("div", { class: "row" }, el("button", { class: "button-primary", type: "submit" }, "Enregistrer"), el("button", { type: "button", onclick: renderHead }, "Annuler"))
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const done = busy(form.querySelector("button[type=submit]"), "Enregistrement…");
    try {
      await api.put(base, {
        name: form.name.value.trim(),
        description: form.description.value.trim() || null,
        is_private: form.is_private.checked,
      });
      await loadGroup();
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  head.replaceChildren(form);
  form.name.focus();
}

async function deleteGroup() {
  if (!confirm(`Supprimer définitivement le groupe « ${group.name} », ses discussions, messages et fichiers ?`)) {
    return;
  }
  try {
    await api.del(base);
    location.href = "/pages/groups.html";
  } catch (error) {
    showMessage(message, error.message);
  }
}

// ---------- Onglets ----------

const tabs = ["posts", "messages", "members"];
const loaders = { posts: loadPosts, messages: openChat, members: loadMembers };
let currentTab = "posts";

function selectTab(name) {
  currentTab = name;

  for (const tab of tabs) {
    const button = document.getElementById(`tab-${tab}`);
    button.setAttribute("aria-selected", String(tab === name));
    button.tabIndex = tab === name ? 0 : -1;
    document.getElementById(`panel-${tab}`).classList.toggle("hidden", tab !== name);
  }

  loaders[name]();
}

for (const tab of tabs) {
  const button = document.getElementById(`tab-${tab}`);
  button.addEventListener("click", () => selectTab(tab));

  // Flèches gauche/droite entre les onglets (accessibilité clavier)
  button.addEventListener("keydown", (event) => {
    const offset = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
    if (!offset) return;
    const next = tabs[(tabs.indexOf(tab) + offset + tabs.length) % tabs.length];
    document.getElementById(`tab-${next}`).focus();
    selectTab(next);
  });
}

// ---------- Discussions ----------

const postsPanel = document.getElementById("panel-posts");

async function loadPosts() {
  showLoading(postsPanel);

  try {
    const posts = await api.get(`${base}/posts`);
    const list = el("ul", { class: "post-list" });

    if (posts.length === 0) {
      list.append(el("li", { class: "empty" }, "Aucune discussion dans ce groupe."));
    }

    for (const post of posts) {
      list.append(
        el(
          "li",
          { class: "post-item post-card" },
          avatar(post.username),
          el(
            "div",
            { class: "post-card-body" },
            el("div", { class: "meta" }, el("strong", {}, post.username), timeAgo(post.created_at)),
            el("h2", {}, el("button", { type: "button", class: "button-link stretched-link", onclick: () => openPost(post.id) }, post.title)),
            el("p", { class: "excerpt" }, post.content.replace(/```[\w+#.-]*/g, " ")),
            el("div", { class: "meta post-card-stats" }, el("span", {}, plural(post.comments, "commentaire", "commentaires")))
          )
        )
      );
    }

    postsPanel.replaceChildren(canWrite ? newPostForm() : "", list);
  } catch (error) {
    clear(postsPanel);
    showMessage(message, error.message);
  }
}

function newPostForm() {
  const formMessage = el("div", { "aria-live": "polite" });

  const form = el(
    "form",
    { class: "card", novalidate: true },
    el("h2", {}, "Nouvelle discussion"),
    formMessage,
    el("div", { class: "field" }, el("label", { for: "gp-title" }, "Titre"), el("input", { id: "gp-title", name: "title", required: true, maxlength: "200" })),
    el("div", { class: "field" }, el("label", { for: "gp-content" }, "Contenu"), el("textarea", { id: "gp-content", name: "content", required: true, maxlength: "20000" })),
    el("button", { class: "button-primary", type: "submit" }, "Publier")
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = form.title.value.trim();
    const content = form.content.value.trim();

    if (!title || !content) {
      return showMessage(formMessage, "Le titre et le contenu sont obligatoires.");
    }

    const done = busy(form.querySelector("button"), "Publication…");
    try {
      const post = await api.post(`${base}/posts`, { title, content });
      openPost(post.id);
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  return form;
}

async function openPost(postId) {
  showLoading(postsPanel);

  let data;
  try {
    data = await api.get(`${base}/posts/${postId}`);
  } catch (error) {
    showMessage(message, error.message);
    return loadPosts();
  }

  const { post, comments } = data;
  const back = el("p", {}, el("button", { type: "button", class: "button-link", onclick: loadPosts }, "← Toutes les discussions du groupe"));

  const actions = el("div", { class: "row" });

  if (post.author_id === me.id) {
    actions.append(el("button", { type: "button", onclick: () => editPost(post) }, "Modifier"));
  }

  if (canDelete(post.author_id)) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-danger",
        onclick: async () => {
          if (!confirm("Supprimer cette discussion et ses commentaires ?")) return;
          try {
            await api.del(`${base}/posts/${post.id}`);
            loadPosts();
          } catch (error) {
            showMessage(message, error.message);
          }
        },
      }, "Supprimer")
    );
  }

  const article = el(
    "article",
    { class: "card" },
    el("h2", {}, post.title),
    el("div", { class: "meta" }, el("span", {}, formatDate(post.created_at))),
    richText(post.content),
    actions
  );

  // Arbre des commentaires
  const byParent = new Map();
  for (const comment of comments) {
    const key = comment.parent_id ?? 0;
    byParent.set(key, [...(byParent.get(key) || []), comment]);
  }

  const renderComment = (comment) => {
    const commentActions = el("div", { class: "comment-actions" });

    if (canWrite) {
      commentActions.append(
        el("button", {
          type: "button",
          class: "button-link button-small",
          onclick: () => {
            const form = commentForm((content) => api.post(`${base}/posts/${post.id}/comments`, { content, parent_id: comment.id }), () => openPost(post.id));
            commentActions.after(form);
            form.content.focus();
          },
        }, "Répondre")
      );
    }

    if (canDelete(comment.author_id)) {
      commentActions.append(
        el("button", {
          type: "button",
          class: "button-link button-small button-danger",
          onclick: async () => {
            if (!confirm("Supprimer ce commentaire et ses réponses ?")) return;
            try {
              await api.del(`${base}/comments/${comment.id}`);
              openPost(post.id);
            } catch (error) {
              showMessage(message, error.message);
            }
          },
        }, "Supprimer")
      );
    }

    const children = byParent.get(comment.id) || [];

    return el(
      "li",
      { class: "comment" },
      el("div", { class: "comment-head" }, avatar(comment.username, "sm"), el("div", { class: "meta" }, el("strong", {}, comment.username), timeAgo(comment.created_at))),
      richText(comment.content),
      commentActions,
      children.length ? el("ul", { class: "comments" }, children.map(renderComment)) : null
    );
  };

  const roots = byParent.get(0) || [];

  postsPanel.replaceChildren(
    back,
    article,
    el("h3", {}, plural(comments.length, "commentaire", "commentaires")),
    el("ul", { class: "comments" }, roots.length ? roots.map(renderComment) : el("li", { class: "empty" }, "Aucun commentaire.")),
    canWrite ? el("div", { class: "card" }, el("h3", {}, "Ajouter un commentaire"), commentForm((content) => api.post(`${base}/posts/${post.id}/comments`, { content }), () => openPost(post.id), false)) : ""
  );
}

function commentForm(send, after, cancellable = true) {
  const formMessage = el("div", { "aria-live": "polite" });
  const id = `gc-${Math.random().toString(36).slice(2)}`;

  const form = el(
    "form",
    { novalidate: true },
    formMessage,
    el("label", { class: "sr-only", for: id }, "Commentaire"),
    el("textarea", { id, name: "content", required: true, maxlength: "5000" }),
    el(
      "div",
      { class: "row" },
      el("button", { class: "button-primary button-small", type: "submit" }, "Envoyer"),
      cancellable ? el("button", { class: "button-small", type: "button", onclick: () => form.remove() }, "Annuler") : null
    )
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = form.content.value.trim();
    if (!content) return showMessage(formMessage, "Le commentaire est vide.");

    const done = busy(form.querySelector("button[type=submit]"), "Envoi…");
    try {
      await send(content);
      after();
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  return form;
}

function editPost(post) {
  const formMessage = el("div", { "aria-live": "polite" });

  const form = el(
    "form",
    { class: "card", novalidate: true },
    el("h2", {}, "Modifier la discussion"),
    formMessage,
    el("div", { class: "field" }, el("label", { for: "ep-title" }, "Titre"), el("input", { id: "ep-title", name: "title", value: post.title, required: true, maxlength: "200" })),
    el("div", { class: "field" }, el("label", { for: "ep-content" }, "Contenu"), el("textarea", { id: "ep-content", name: "content", required: true, maxlength: "20000" }, post.content)),
    el("div", { class: "row" }, el("button", { class: "button-primary", type: "submit" }, "Enregistrer"), el("button", { type: "button", onclick: () => openPost(post.id) }, "Annuler"))
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const done = busy(form.querySelector("button[type=submit]"), "Enregistrement…");
    try {
      await api.put(`${base}/posts/${post.id}`, { title: form.title.value.trim(), content: form.content.value.trim() });
      openPost(post.id);
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  postsPanel.replaceChildren(form);
}

// ---------- Messagerie (rafraîchie toutes les 5 secondes) ----------

const chatPanel = document.getElementById("panel-messages");
const chat = el("ul", { class: "chat", "aria-live": "polite", "aria-label": "Messages du groupe" });
let firstId = null;
let lastId = null;
let pollTimer = null;
let chatReady = false;

// Regroupement : messages d'un même auteur à moins de 5 minutes d'intervalle
const GROUP_DELAY = 5 * 60 * 1000;
let lastRendered = null;

const dayFormat = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const dayKey = (value) => new Date(value).toDateString();

function dayLabel(value) {
  const days = Math.round((new Date(new Date().toDateString()) - new Date(dayKey(value))) / 86400000);
  return days === 0 ? "Aujourd'hui" : days === 1 ? "Hier" : dayFormat.format(new Date(value));
}

function renderMessage(msg, continued) {
  const mine = msg.sender_id === me.id;
  const actions = el("div", { class: "chat-actions" });
  const bubble = el("div", { class: "chat-bubble", title: formatDate(msg.created_at) }, msg.content ? richText(msg.content) : null);

  if (msg.file_url) {
    bubble.append(
      el("button", {
        type: "button",
        class: "file-chip",
        onclick: () => download(msg.file_url, msg.file_name).catch((error) => showMessage(message, error.message)),
      }, icon(PAPERCLIP), msg.file_name)
    );
  }

  if (canDelete(msg.sender_id)) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-link button-small button-danger",
        onclick: async () => {
          if (!confirm("Supprimer ce message ?")) return;
          try {
            await api.del(`${base}/messages/${msg.id}`);
            const node = document.getElementById(`msg-${msg.id}`);
            // Le message suivant reprend l'en-tête (auteur, heure) si besoin
            if (!node?.classList.contains("continued")) {
              node?.nextElementSibling?.classList.remove("continued");
            }
            node?.remove();
          } catch (error) {
            showMessage(message, error.message);
          }
        },
      }, "Supprimer")
    );
  }

  if (!mine) {
    actions.append(el("button", { type: "button", class: "button-link button-small", onclick: () => openReport("MESSAGE", msg.id) }, "Signaler"));
  }

  return el(
    "li",
    { class: `chat-message${mine ? " mine" : ""}${continued ? " continued" : ""}`, id: `msg-${msg.id}` },
    mine ? null : avatar(msg.username, "sm"),
    el(
      "div",
      { class: "chat-body" },
      el("div", { class: "chat-meta" }, mine ? el("span", { class: "sr-only" }, "Vous") : el("strong", {}, msg.username), timeAgo(msg.created_at)),
      bubble,
      actions
    )
  );
}

// Suite de messages : séparateurs de jour et regroupement par auteur
function renderBatch(messages, previous) {
  const nodes = [];

  for (const msg of messages) {
    if (!previous || dayKey(previous.created_at) !== dayKey(msg.created_at)) {
      nodes.push(el("li", { class: "chat-day", dataset: { day: dayKey(msg.created_at) } }, el("span", {}, dayLabel(msg.created_at))));
      previous = null;
    }

    const continued = Boolean(previous) && previous.sender_id === msg.sender_id && new Date(msg.created_at) - new Date(previous.created_at) < GROUP_DELAY;
    nodes.push(renderMessage(msg, continued));
    previous = msg;
  }

  return nodes;
}

function appendMessages(messages) {
  if (messages.length === 0) {
    return;
  }

  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;

  chat.querySelector(".empty")?.remove();
  chat.append(...renderBatch(messages, lastRendered));
  lastRendered = messages[messages.length - 1];

  lastId = lastRendered.id;
  firstId ??= messages[0].id;

  if (atBottom) {
    chat.scrollTop = chat.scrollHeight;
  }
}

async function poll() {
  if (document.hidden || currentTab !== "messages") {
    return;
  }

  try {
    const messages = await api.get(`${base}/messages?after=${lastId ?? 0}`);
    appendMessages(messages);
  } catch {
    // Réessai au prochain intervalle
  }
}

async function openChat() {
  if (chatReady) {
    return poll();
  }

  showLoading(chatPanel);

  let messages;
  try {
    messages = await api.get(`${base}/messages?limit=50`);
  } catch (error) {
    clear(chatPanel);
    return showMessage(message, error.message);
  }

  const older = el("button", { type: "button", class: "button-small", onclick: loadOlder }, "Messages plus anciens");
  older.classList.toggle("hidden", messages.length < 50);

  chatPanel.replaceChildren(el("p", {}, older), chat, canWrite ? chatForm() : el("p", { class: "muted" }, "Rejoignez le groupe pour écrire."));

  if (messages.length === 0) {
    chat.append(el("li", { class: "empty" }, "Aucun message. Lancez la conversation !"));
  }

  appendMessages(messages);
  chat.scrollTop = chat.scrollHeight;

  chatReady = true;
  pollTimer = setInterval(poll, 5000);

  async function loadOlder() {
    const done = busy(older, "Chargement…");
    try {
      const previous = await api.get(`${base}/messages?limit=50&before=${firstId}`);
      if (previous.length) {
        firstId = previous[0].id;
        const height = chat.scrollHeight;
        const nodes = renderBatch(previous, null);
        // Même jour que le premier message déjà affiché : un seul séparateur
        const firstDay = chat.firstElementChild;
        if (firstDay?.classList.contains("chat-day") && firstDay.dataset.day === dayKey(previous[previous.length - 1].created_at)) {
          firstDay.remove();
        }
        chat.prepend(...nodes);
        chat.scrollTop = chat.scrollHeight - height;
      }
      done();
      older.classList.toggle("hidden", previous.length < 50);
    } catch (error) {
      showMessage(message, error.message);
      done();
    }
  }
}

function chatForm() {
  const formMessage = el("div", { "aria-live": "polite" });
  const file = el("input", { id: "chat-file", name: "file", type: "file", accept: ACCEPT, class: "sr-only" });
  const fileInfo = el("div", { class: "chat-file-info hidden" });

  const showFile = () => {
    const chosen = file.files[0];
    fileInfo.classList.toggle("hidden", !chosen);
    fileInfo.replaceChildren(
      ...(chosen
        ? [
            el("span", { class: "file-chip" }, icon(PAPERCLIP), chosen.name),
            el("button", { type: "button", class: "button-link button-small", onclick: () => { file.value = ""; showFile(); } }, "Retirer"),
          ]
        : [])
    );
  };

  file.addEventListener("change", showFile);

  const form = el(
    "form",
    { class: "card chat-form", novalidate: true },
    formMessage,
    fileInfo,
    el(
      "div",
      { class: "chat-composer" },
      el("label", { class: "button attach-button", title: "Joindre un fichier (10 Mo maximum)" }, icon(PAPERCLIP), el("span", { class: "sr-only" }, "Joindre un fichier (10 Mo maximum)"), file),
      el("label", { class: "sr-only", for: "chat-content" }, "Votre message"),
      el("textarea", { id: "chat-content", name: "content", maxlength: "5000", rows: "1", placeholder: "Écrire un message…", "aria-describedby": "chat-hint" }),
      el("button", { class: "button-primary send-button", type: "submit" }, icon(SEND), el("span", { class: "send-label" }, "Envoyer"))
    ),
    el("p", { class: "hint", id: "chat-hint" }, "Entrée pour envoyer, Maj+Entrée pour aller à la ligne. Code entre ```.")
  );

  form.addEventListener("reset", () => setTimeout(() => {
    showFile();
    grow();
  }));

  // Le champ grandit avec le texte (plafond fixé en CSS)
  const grow = () => {
    form.content.style.height = "auto";
    form.content.style.height = `${form.content.scrollHeight + 2}px`;
  };
  form.content.addEventListener("input", grow);

  // Entrée envoie, Maj+Entrée va à la ligne
  form.content.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = form.content.value.trim();
    const attachment = file.files[0];

    if (!content && !attachment) {
      return showMessage(formMessage, "Écrivez un message ou joignez un fichier.");
    }

    if (attachment && attachment.size > 10 * 1024 * 1024) {
      return showMessage(formMessage, "Le fichier dépasse 10 Mo.");
    }

    const data = new FormData();
    if (content) data.append("content", content);
    if (attachment) data.append("file", attachment);

    const done = busy(form.querySelector("button[type=submit]"), "Envoi…");
    try {
      await api.upload(`${base}/messages`, data);
      form.reset();
      showMessage(formMessage, "");
      await poll();
      chat.scrollTop = chat.scrollHeight;
    } catch (error) {
      showMessage(formMessage, error.message);
    } finally {
      done();
      form.content.focus();
    }
  });

  return form;
}

// ---------- Membres ----------

const membersPanel = document.getElementById("panel-members");

async function loadMembers() {
  showLoading(membersPanel);

  let members;
  try {
    members = await api.get(`${base}/members`);
  } catch (error) {
    clear(membersPanel);
    return showMessage(message, error.message);
  }

  const list = el("ul", { class: "member-list" });

  for (const member of members) {
    const actions = el("div", { class: "row" });

    if (canAdmin && member.id !== me.id) {
      const promote = member.group_role === "ADMIN" ? "MEMBER" : "ADMIN";
      actions.append(
        el("button", {
          type: "button",
          class: "button-small",
          onclick: async () => {
            try {
              await api.put(`${base}/members/${member.id}`, { group_role: promote });
              loadMembers();
            } catch (error) {
              showMessage(message, error.message);
            }
          },
        }, promote === "ADMIN" ? "Nommer admin" : "Retirer les droits admin"),
        el("button", { type: "button", class: "button-small button-danger", onclick: () => removeMember(member.id, false, member.username) }, "Retirer")
      );
    }

    list.append(
      el(
        "li",
        {},
        avatar(member.username, "sm"),
        el("a", { href: `/pages/profile.html?id=${member.id}` }, member.username),
        el("span", { class: "tag" }, ROLE_LABELS[member.group_role]),
        el("span", { class: "muted small spacer" }, `depuis le ${formatDate(member.joined_at)}`),
        actions
      )
    );
  }

  membersPanel.replaceChildren(canAdmin ? addMemberForm(members) : "", el("div", { class: "card" }, el("h2", {}, plural(members.length, "membre", "membres")), list));
}

function addMemberForm(members) {
  const formMessage = el("div", { "aria-live": "polite" });
  const results = el("ul", { class: "member-list" });

  const form = el(
    "form",
    { class: "card", role: "search", novalidate: true },
    el("h2", {}, "Ajouter un membre"),
    formMessage,
    el("div", { class: "row" }, el("label", { class: "sr-only", for: "member-search" }, "Rechercher un utilisateur"), el("input", { id: "member-search", name: "q", placeholder: "Nom d'utilisateur ou pseudo", class: "spacer" }), el("button", { type: "submit" }, "Rechercher")),
    results
  );

  const memberIds = new Set(members.map((m) => m.id));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const q = form.q.value.trim();
    if (!q) return showMessage(formMessage, "Saisissez un nom à rechercher.");

    showMessage(formMessage, "");
    try {
      const data = await api.get(`/api/users?q=${encodeURIComponent(q)}&limit=10`);
      const candidates = data.users.filter((u) => !memberIds.has(u.id));
      clear(results);

      if (candidates.length === 0) {
        results.append(el("li", { class: "muted" }, "Aucun utilisateur à ajouter."));
      }

      for (const user of candidates) {
        results.append(
          el(
            "li",
            {},
            el("span", { class: "spacer" }, user.username, user.pseudonym ? el("span", { class: "muted small" }, ` (${user.pseudonym})`) : null),
            el("button", {
              type: "button",
              class: "button-small button-primary",
              onclick: async () => {
                try {
                  await api.post(`${base}/members`, { user_id: user.id });
                  await loadGroup();
                  selectTab("members");
                } catch (error) {
                  showMessage(formMessage, error.message);
                }
              },
            }, "Ajouter")
          )
        );
      }
    } catch (error) {
      showMessage(formMessage, error.message);
    }
  });

  return form;
}

async function removeMember(userId, isSelf, username) {
  const question = isSelf ? "Quitter ce groupe ?" : `Retirer ${username} du groupe ?`;
  if (!confirm(question)) return;

  try {
    await api.del(`${base}/members/${userId}`);
    if (isSelf) {
      location.href = "/pages/groups.html";
    } else {
      await loadGroup();
      selectTab("members");
    }
  } catch (error) {
    showMessage(message, error.message);
  }
}

// ---------- Chargement ----------

async function loadGroup() {
  try {
    group = await api.get(base);
  } catch (error) {
    head.replaceChildren();
    document.getElementById("group-body").classList.add("hidden");
    return showMessage(message, error.status === 403 ? "Ce groupe est privé : vous n'en êtes pas membre." : error.status === 404 || error.status === 400 ? "Ce groupe n'existe pas." : error.message);
  }

  canWrite = Boolean(group.my_role) || me.role === "ADMIN";
  canAdmin = group.my_role === "ADMIN" || me.role === "ADMIN";

  // Les droits ont pu changer : la messagerie sera reconstruite
  chatReady = false;
  clearInterval(pollTimer);
  clear(chat);
  firstId = lastId = null;

  showMessage(message, "");
  renderHead();
  document.getElementById("group-body").classList.remove("hidden");
  selectTab(currentTab);
}

if (!groupId) {
  head.replaceChildren();
  showMessage(message, "Groupe introuvable.");
} else {
  loadGroup();
}
