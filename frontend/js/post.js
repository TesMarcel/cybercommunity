// Discussion : contenu, likes, modification, commentaires et réponses
import { api } from "./api.js";
import { isModerator, requireUser } from "./layout.js";
import { openReport } from "./report.js";
import { busy, clear, el, formatDate, params, plural, showMessage } from "./ui.js";

const user = await requireUser("forum");

const postId = Number(params.get("id"));
const container = document.getElementById("post");
const message = document.getElementById("message");
const commentsSection = document.getElementById("comments-section");
const commentsList = document.getElementById("comments");
const commentForm = document.getElementById("comment-form");

const canDelete = (authorId) => authorId === user.id || isModerator(user);

let categories = null;

// ---------- Discussion ----------

function renderPost(post) {
  const likeButton = el(
    "button",
    { type: "button", class: "like-button", "aria-pressed": String(post.liked_by_me) },
    plural(post.likes, "j'aime", "j'aime")
  );

  likeButton.addEventListener("click", async () => {
    likeButton.disabled = true;
    try {
      const result = await api.post(`/api/posts/${post.id}/like`);
      likeButton.setAttribute("aria-pressed", String(result.liked));
      likeButton.textContent = plural(result.likes, "j'aime", "j'aime");
    } catch (error) {
      showMessage(message, error.message);
    } finally {
      likeButton.disabled = false;
    }
  });

  const actions = el("div", { class: "row" }, likeButton);

  if (post.author_id === user.id) {
    actions.append(el("button", { type: "button", onclick: () => editPost(post) }, "Modifier"));
  }

  if (canDelete(post.author_id)) {
    actions.append(el("button", { type: "button", class: "button-danger", onclick: () => deletePost(post) }, "Supprimer"));
  }

  if (post.author_id !== user.id) {
    actions.append(el("button", { type: "button", class: "button-link", onclick: () => openReport("POST", post.id) }, "Signaler"));
  }

  const edited = post.updated_at !== post.created_at;

  container.replaceChildren(
    el(
      "div",
      { class: "card" },
      el("h1", {}, post.title),
      el(
        "div",
        { class: "meta" },
        post.category ? el("span", { class: "tag tag-accent" }, post.category) : null,
        el("span", {}, "par ", el("a", { href: `/pages/profile.html?id=${post.author_id}` }, post.author)),
        el("span", {}, formatDate(post.created_at)),
        edited ? el("span", {}, `(modifié le ${formatDate(post.updated_at)})`) : null
      ),
      el("div", { class: "content stack" }, el("p", {}, post.content)),
      actions
    )
  );

  document.title = `${post.title} — Cyber Community`;
}

async function editPost(post) {
  categories ??= await api.get("/api/categories").catch(() => []);

  const formMessage = el("div", { "aria-live": "polite" });

  const form = el(
    "form",
    { class: "card", novalidate: true },
    el("h1", {}, "Modifier la discussion"),
    formMessage,
    el("div", { class: "field" }, el("label", { for: "edit-title" }, "Titre"), el("input", { id: "edit-title", name: "title", value: post.title, required: true, maxlength: "200" })),
    el(
      "div",
      { class: "field" },
      el("label", { for: "edit-category" }, "Catégorie"),
      el(
        "select",
        { id: "edit-category", name: "category" },
        el("option", { value: "" }, "Sans catégorie"),
        categories.map((c) => el("option", { value: c.id, selected: c.id === post.category_id }, c.name))
      )
    ),
    el("div", { class: "field" }, el("label", { for: "edit-content" }, "Contenu"), el("textarea", { id: "edit-content", name: "content", required: true, maxlength: "20000" }, post.content)),
    el("div", { class: "row" }, el("button", { class: "button-primary", type: "submit" }, "Enregistrer"), el("button", { type: "button", onclick: load }, "Annuler"))
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const done = busy(form.querySelector("button[type=submit]"), "Enregistrement…");

    try {
      await api.put(`/api/posts/${post.id}`, {
        title: form.title.value.trim(),
        content: form.content.value.trim(),
        category_id: form.category.value || null,
      });
      load();
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  container.replaceChildren(form);
  form.title.focus();
}

async function deletePost(post) {
  if (!confirm("Supprimer définitivement cette discussion et ses commentaires ?")) {
    return;
  }

  try {
    await api.del(`/api/posts/${post.id}`);
    location.href = "/pages/forum.html";
  } catch (error) {
    showMessage(message, error.message);
  }
}

// ---------- Commentaires ----------

function commentForm_(placeholderLabel, onSubmit, initial = "") {
  const formMessage = el("div", { "aria-live": "polite" });
  const id = `c-${Math.random().toString(36).slice(2)}`;

  const form = el(
    "form",
    { novalidate: true },
    formMessage,
    el("label", { class: "sr-only", for: id }, placeholderLabel),
    el("textarea", { id, name: "content", required: true, maxlength: "5000" }, initial),
    el("div", { class: "row" }, el("button", { class: "button-primary button-small", type: "submit" }, "Envoyer"), el("button", { class: "button-small", type: "button", onclick: () => form.remove() }, "Annuler"))
  );

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = form.content.value.trim();

    if (!content) {
      return showMessage(formMessage, "Le commentaire est vide.");
    }

    const done = busy(form.querySelector("button[type=submit]"), "Envoi…");

    try {
      await onSubmit(content);
      load();
    } catch (error) {
      showMessage(formMessage, error.message);
      done();
    }
  });

  return form;
}

function renderComment(comment, children) {
  const body = el("div", { class: "content" }, comment.content);
  const actions = el("div", { class: "comment-actions" });

  const item = el(
    "li",
    { class: "comment", id: `comment-${comment.id}` },
    el("div", { class: "meta" }, el("a", { href: `/pages/profile.html?id=${comment.author_id}` }, el("strong", {}, comment.username)), el("span", {}, formatDate(comment.created_at))),
    body,
    actions
  );

  actions.append(
    el("button", {
      type: "button",
      class: "button-link button-small",
      onclick: () => {
        const form = commentForm_("Votre réponse", (content) =>
          api.post(`/api/posts/${postId}/comments`, { content, parent_id: comment.id })
        );
        actions.after(form);
        form.content.focus();
      },
    }, "Répondre")
  );

  if (comment.author_id === user.id) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-link button-small",
        onclick: () => {
          const form = commentForm_("Modifier le commentaire", (content) => api.put(`/api/comments/${comment.id}`, { content }), comment.content);
          body.replaceWith(form);
          form.content.focus();
        },
      }, "Modifier")
    );
  }

  if (canDelete(comment.author_id)) {
    actions.append(
      el("button", {
        type: "button",
        class: "button-link button-small button-danger",
        onclick: async () => {
          if (!confirm("Supprimer ce commentaire et ses réponses ?")) return;
          try {
            await api.del(`/api/comments/${comment.id}`);
            load();
          } catch (error) {
            showMessage(message, error.message);
          }
        },
      }, "Supprimer")
    );
  }

  if (comment.author_id !== user.id) {
    actions.append(el("button", { type: "button", class: "button-link button-small", onclick: () => openReport("COMMENT", comment.id) }, "Signaler"));
  }

  if (children.length) {
    item.append(el("ul", { class: "comments" }, children));
  }

  return item;
}

function renderComments(comments) {
  const byParent = new Map();

  for (const comment of comments) {
    const key = comment.parent_id ?? 0;
    byParent.set(key, [...(byParent.get(key) || []), comment]);
  }

  const build = (parentId) => (byParent.get(parentId) || []).map((c) => renderComment(c, build(c.id)));

  clear(commentsList);

  if (comments.length === 0) {
    commentsList.append(el("li", { class: "empty" }, "Aucun commentaire. Soyez le premier à répondre !"));
  } else {
    commentsList.append(...build(0));
  }

  document.getElementById("comments-title").textContent = plural(comments.length, "commentaire", "commentaires");
}

commentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formMessage = document.getElementById("comment-message");
  const content = commentForm.content.value.trim();

  if (!content) {
    return showMessage(formMessage, "Le commentaire est vide.");
  }

  const done = busy(commentForm.querySelector("button"), "Envoi…");

  try {
    await api.post(`/api/posts/${postId}/comments`, { content });
    commentForm.reset();
    showMessage(formMessage, "");
    await load();
  } catch (error) {
    showMessage(formMessage, error.message);
  } finally {
    done();
  }
});

// ---------- Chargement ----------

async function load() {
  try {
    const data = await api.get(`/api/posts/${postId}`);
    renderPost(data.post);
    renderComments(data.comments);
    commentsSection.classList.remove("hidden");

    // Lien direct vers un commentaire (#comment-12) : on y défile
    const target = location.hash && document.getElementById(location.hash.slice(1));
    if (target) {
      target.classList.add("highlight");
      target.scrollIntoView({ block: "center" });
    }
  } catch (error) {
    clear(container);
    commentsSection.classList.add("hidden");
    showMessage(message, error.status === 404 || error.status === 400 ? "Cette discussion n'existe pas ou a été supprimée." : error.message);
  }
}

if (!postId) {
  clear(container);
  showMessage(message, "Discussion introuvable.");
} else {
  load();
}
