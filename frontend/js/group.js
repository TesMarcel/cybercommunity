// Page d'un groupe : discussions, messagerie, membres
import { api, download } from "./api.js";
import { isModerator, requireUser } from "./layout.js";
import { openReport } from "./report.js";
import { busy, clear, el, formatDate, params, plural, showEmpty, showLoading, showMessage } from "./ui.js";

const me = await requireUser("groups");

const groupId = Number(params.get("id"));
const base = `/api/groups/${groupId}`;
const message = document.getElementById("message");
const head = document.getElementById("group-head");

const ROLE_LABELS = { ADMIN: "Admin du groupe", MEMBER: "Membre" };

// Extensions acceptées par le serveur pour les pièces jointes
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
      { class: "card stack" },
      el("h1", {}, group.name),
      el(
        "div",
        { class: "meta" },
        el("span", { class: "tag" }, group.is_private ? "Privé" : "Public"),
        el("span", {}, plural(group.members, "membre", "membres")),
        el("span", {}, `créé par ${group.creator}`),
        group.my_role ? el("span", {}, `Vous : ${ROLE_LABELS[group.my_role]}`) : null
      ),
      group.description ? el("p", { class: "content" }, group.description) : null,
      !canWrite ? el("p", { class: "muted small" }, "Lecture seule : rejoignez le groupe pour participer.") : null,
      actions
    )
  );

  document.title = `${group.name} — Cyber Community`;
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
          { class: "post-item" },
          el("h2", {}, el("button", { type: "button", class: "button-link", onclick: () => openPost(post.id) }, post.title)),
          el("div", { class: "meta" }, el("span", {}, `par ${post.username}`), el("span", {}, formatDate(post.created_at)), el("span", {}, plural(post.comments, "commentaire", "commentaires"))),
          el("p", { class: "excerpt" }, post.content)
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
    el("p", { class: "content" }, post.content),
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
      el("div", { class: "meta" }, el("strong", {}, comment.username), el("span", {}, formatDate(comment.created_at))),
      el("div", { class: "content" }, comment.content),
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

function renderMessage(msg) {
  const actions = el("div", { class: "comment-actions" });

  if (msg.file_url) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-small",
        onclick: () => download(msg.file_url, msg.file_name).catch((error) => showMessage(message, error.message)),
      }, `📎 ${msg.file_name}`)
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
            document.getElementById(`msg-${msg.id}`)?.remove();
          } catch (error) {
            showMessage(message, error.message);
          }
        },
      }, "Supprimer")
    );
  }

  if (msg.sender_id !== me.id) {
    actions.append(el("button", { type: "button", class: "button-link button-small", onclick: () => openReport("MESSAGE", msg.id) }, "Signaler"));
  }

  return el(
    "li",
    { class: `chat-message${msg.sender_id === me.id ? " mine" : ""}`, id: `msg-${msg.id}` },
    el("div", { class: "meta" }, el("strong", {}, msg.username), el("span", {}, formatDate(msg.created_at))),
    msg.content ? el("div", { class: "content" }, msg.content) : null,
    actions
  );
}

function appendMessages(messages) {
  if (messages.length === 0) {
    return;
  }

  const atBottom = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 40;

  chat.querySelector(".empty")?.remove();
  chat.append(...messages.map(renderMessage));

  if (messages.length) {
    lastId = messages[messages.length - 1].id;
    firstId ??= messages[0].id;
  }

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
        chat.prepend(...previous.map(renderMessage));
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
  const file = el("input", { id: "chat-file", name: "file", type: "file", accept: ACCEPT });

  const form = el(
    "form",
    { class: "card chat-form", novalidate: true },
    formMessage,
    el(
      "div",
      { class: "field" },
      el("label", { for: "chat-content" }, "Votre message"),
      el("textarea", { id: "chat-content", name: "content", maxlength: "5000" })
    ),
    el("div", { class: "field" }, el("label", { for: "chat-file" }, "Pièce jointe (facultative, 10 Mo maximum)"), file),
    el("button", { class: "button-primary", type: "submit" }, "Envoyer")
  );

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

    const done = busy(form.querySelector("button"), "Envoi…");
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
