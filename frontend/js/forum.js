// Forum : liste filtrée et paginée, création de discussion
import { api } from "./api.js";
import { requireUser } from "./layout.js";
import { busy, clear, el, formatDate, pagination, params, plural, showEmpty, showLoading, showMessage } from "./ui.js";

await requireUser("forum");

const list = document.getElementById("posts");
const listMessage = document.getElementById("list-message");
const filters = document.getElementById("filters");
const filterCategory = document.getElementById("filter-category");
const newPost = document.getElementById("new-post");
const newPostForm = document.getElementById("new-post-form");
const toggle = document.getElementById("new-post-toggle");

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

// ---------- Liste ----------

function renderPost(post) {
  return el(
    "li",
    { class: "post-item" },
    el("h2", {}, el("a", { href: `/pages/post.html?id=${post.id}` }, post.title)),
    el(
      "div",
      { class: "meta" },
      post.category ? el("span", { class: "tag" }, post.category) : null,
      el("span", {}, "par ", el("a", { href: `/pages/profile.html?id=${post.author_id}` }, post.author)),
      el("span", {}, formatDate(post.created_at)),
      el("span", {}, plural(post.likes, "j'aime", "j'aime")),
      el("span", {}, plural(post.comments, "commentaire", "commentaires"))
    ),
    el("p", { class: "excerpt" }, post.content)
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

  const apiQuery = new URLSearchParams({ page: state.page, limit: 20 });
  if (state.q) apiQuery.set("q", state.q);
  if (state.category) apiQuery.set("category_id", state.category);

  try {
    const data = await api.get(`/api/posts?${apiQuery}`);

    clear(list);

    if (data.posts.length === 0) {
      showEmpty(list, state.q || state.category ? "Aucune discussion ne correspond à votre recherche." : "Aucune discussion pour le moment. Lancez la première !");
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
