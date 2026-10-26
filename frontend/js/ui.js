// Petits outils d'interface. Le contenu saisi par les utilisateurs est
// toujours inséré comme TEXTE (textContent), jamais comme HTML.

// el("a", { href: "/", class: "x" }, "texte", autreElement)
export function el(tag, attributes = {}, ...children) {
  const node = document.createElement(tag);

  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) {
      continue;
    }

    if (key.startsWith("on") && typeof value === "function") {
      node.addEventListener(key.slice(2), value);
    } else if (key === "class") {
      node.className = value;
    } else if (key === "dataset") {
      Object.assign(node.dataset, value);
    } else {
      node.setAttribute(key, value === true ? "" : value);
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) {
      continue;
    }
    node.append(child instanceof Node ? child : String(child));
  }

  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

// Message d'erreur ou de réussite dans un conteneur (aria-live)
export function showMessage(container, text, type = "error") {
  clear(container);

  if (text) {
    container.append(el("div", { class: `alert alert-${type}`, role: type === "error" ? "alert" : "status" }, text));
  }
}

export function showLoading(container, text = "Chargement…") {
  clear(container).append(el("p", { class: "loading" }, text));
}

export function showEmpty(container, text) {
  clear(container).append(el("p", { class: "empty" }, text));
}

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDate(value) {
  return dateFormat.format(new Date(value));
}

// Désactive un bouton pendant une action ; renvoie une fonction pour le réactiver
// (une liste déroulante est seulement désactivée : changer son texte
// effacerait ses options)
export function busy(button, text = "Patientez…") {
  const isButton = button.tagName === "BUTTON";
  const original = button.textContent;
  button.disabled = true;

  if (isButton) {
    button.textContent = text;
  }

  return () => {
    button.disabled = false;
    if (isButton) {
      button.textContent = original;
    }
  };
}

export function pagination(container, { page, limit, total }, onChange) {
  clear(container);

  const pages = Math.max(1, Math.ceil(total / limit));

  if (pages <= 1) {
    return;
  }

  container.append(
    el("button", { type: "button", disabled: page <= 1, onclick: () => onChange(page - 1) }, "← Précédent"),
    el("span", { class: "muted small" }, `Page ${page} / ${pages}`),
    el("button", { type: "button", disabled: page >= pages, onclick: () => onChange(page + 1) }, "Suivant →")
  );
}

export const params = new URLSearchParams(location.search);

export function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}
