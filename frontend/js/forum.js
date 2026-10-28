// Forum : liste filtrée et paginée, création de discussion
import { api } from "./api.js";
import { requireUser } from "./layout.js";
import { ICONS, avatar, busy, clear, el, icon, pagination, params, plural, showLoading, showMessage, timeAgo } from "./ui.js";

await requireUser("forum");

const list = document.getElementById("posts");
const listMessage = document.getElementById("list-message");
const filters = document.getElementById("filters");
const filterCategory = document.getElementById("filter-category");
const newPost = document.getElementById("new-post");
const newPostForm = document.getElementById("new-post-form");
const toggle = document.getElementById("new-post-toggle");
const resultCount = document.getElementById("result-count");

const state = {
  q: params.get("q") || "",
  category: params.get("category") || "",
  page: Number(params.get("page")) || 1,
};

// ---------- Catégories ----------

const categories = await api.get("/api/categories").catch(() => []);

filterCategory.append(el("option", { value: "" }, "Toutes les catégories"));
newPostForm.category.append(el("option", { value: "" }, "Sans catégorie"));

for (const category of categories) {
  filterCategory.append(el("option", { value: category.id }, `${category.name} (${category.posts})`));
  newPostForm.category.append(el("option", { value: category.id }, category.name));
}

filters.q.value = state.q;
filterCategory.value = state.category;

// Colonne de droite : mêmes catégories, en liens
const categoryNav = document.getElementById("category-nav");

function categoryLink(id, name, count) {
  const link = el(
    "a",
    { href: id ? `?category=${id}` : "?", dataset: { category: id } },
    el("span", {}, name),
    count === null ? null : el("span", { class: "topic-count" }, count)
  );

  link.addEventListener("click", (event) => {
    event.preventDefault();
    state.category = id;
    state.page = 1;
    filterCategory.value = id;
    load();
  });

  return el("li", {}, link);
}

categoryNav.append(
  categoryLink("", "Toutes les discussions", null),
  ...categories.map((category) => categoryLink(String(category.id), category.name, category.posts))
);

function markActiveCategory() {
  for (const link of categoryNav.querySelectorAll("a")) {
    link.setAttribute("aria-current", link.dataset.category === state.category ? "page" : "false");
  }
}

// ---------- Liste ----------

// Toute la carte est cliquable (lien du titre étiré), l'auteur reste un lien à part
function renderPost(post) {
  return el(
    "li",
    { class: "post-item post-card" },
    avatar(post.author),
    el(
      "div",
      { class: "post-card-body" },
      el(
        "div",
        { class: "meta" },
        el("a", { class: "post-card-author", href: `/pages/profile.html?id=${post.author_id}` }, post.author),
        timeAgo(post.created_at),
        post.category ? el("span", { class: "tag tag-accent" }, post.category) : null
      ),
      el("h2", {}, el("a", { class: "stretched-link", href: `/pages/post.html?id=${post.id}` }, post.title)),
      // Extrait sans les marqueurs de blocs de code (```bash)
      el("p", { class: "excerpt" }, post.content.replace(/```[\w+#.-]*/g, " ")),
      el(
        "div",
        { class: "meta post-card-stats" },
        el("span", {}, icon(ICONS.heart), plural(post.likes, "j'aime", "j'aime")),
        el("span", {}, icon(ICONS.comment), plural(post.comments, "commentaire", "commentaires"))
      )
    )
  );
}

function renderEmpty(text, withAction) {
  return el(
    "li",
    { class: "empty empty-state" },
    el("p", {}, text),
    withAction
      ? el("button", { type: "button", class: "button-primary", onclick: () => showForm(true) }, icon(ICONS.plus), "Lancer une discussion")
      : null
  );
}

async function load() {
  // L'adresse reflète les filtres : retour arrière et partage de lien
  const query = new URLSearchParams();
  if (state.q) query.set("q", state.q);
  if (state.category) query.set("category", state.category);
  if (state.page > 1) query.set("page", state.page);
  history.replaceState(null, "", `?${query}`);

  showMessage(listMessage, "");
  showLoading(list);
  markActiveCategory();

  const apiQuery = new URLSearchParams({ page: state.page, limit: 20 });
  if (state.q) apiQuery.set("q", state.q);
  if (state.category) apiQuery.set("category_id", state.category);

  try {
    const data = await api.get(`/api/posts?${apiQuery}`);

    clear(list);
    resultCount.textContent = state.q || state.category ? `${plural(data.total, "discussion trouvée", "discussions trouvées")}` : plural(data.total, "discussion", "discussions");

    if (data.posts.length === 0) {
      const filtered = Boolean(state.q || state.category);
      list.append(renderEmpty(filtered ? "Aucune discussion ne correspond à votre recherche." : "Aucune discussion pour le moment. Lancez la première !", !filtered));
    } else {
      list.append(...data.posts.map(renderPost));
    }

    pagination(document.getElementById("pagination"), data, (page) => {
      state.page = page;
      load();
      window.scrollTo(0, 0);
    });
  } catch (error) {
    clear(list);
    resultCount.textContent = "";
    showMessage(listMessage, error.message);
  }
}

filters.addEventListener("submit", (event) => {
  event.preventDefault();
  state.q = filters.q.value.trim();
  state.category = filterCategory.value;
  state.page = 1;
  load();
});

filterCategory.addEventListener("change", () => filters.requestSubmit());

// ---------- Nouvelle discussion ----------

function showForm(visible) {
  newPost.classList.toggle("hidden", !visible);
  toggle.setAttribute("aria-expanded", String(visible));
  if (visible) {
    newPostForm.title.focus();
  }
}

toggle.addEventListener("click", () => showForm(newPost.classList.contains("hidden")));
document.getElementById("new-post-cancel").addEventListener("click", () => showForm(false));

// Lien « Nouvelle discussion » du tableau de bord
if (params.get("new") === "1") {
  showForm(true);
}

newPostForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const message = document.getElementById("new-post-message");

  const title = newPostForm.title.value.trim();
  const content = newPostForm.content.value.trim();

  newPostForm.title.setAttribute("aria-invalid", String(!title));
  newPostForm.content.setAttribute("aria-invalid", String(!content));

  if (!title || !content) {
    return showMessage(message, "Le titre et le contenu sont obligatoires.");
  }

  const done = busy(newPostForm.querySelector("button[type=submit]"), "Publication…");

  try {
    const post = await api.post("/api/posts", {
      title,
      content,
      category_id: newPostForm.category.value || null,
    });
    location.href = `/pages/post.html?id=${post.id}`;
  } catch (error) {
    showMessage(message, error.message);
    done();
  }
});

load();
