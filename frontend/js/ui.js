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

// Bouton clair / sombre (le thème initial est posé par js/theme.js)
const THEME_ICONS = {
  // Soleil : affiché en mode sombre, propose le mode clair
  light: "M12 3v2M12 19v2M5 5l1.4 1.4M17.6 17.6 19 19M3 12h2M19 12h2M5 19l1.4-1.4M17.6 6.4 19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z",
  // Lune : affichée en mode clair, propose le mode sombre
  dark: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
};

function currentTheme() {
  const chosen = document.documentElement.dataset.theme;

  if (chosen) {
    return chosen;
  }

  return matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function themeToggle() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path);

  const button = el("button", { type: "button", class: "theme-toggle" }, svg);

  const render = () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    const label = next === "light" ? "Passer en mode clair" : "Passer en mode sombre";
    path.setAttribute("d", THEME_ICONS[next]);
    button.setAttribute("aria-label", label);
    button.title = label;
  };

  button.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;

    try {
      localStorage.setItem("cc-theme", next);
    } catch {
      // Choix valable pour cette page seulement
    }

    render();
  });

  render();
  return button;
}

export const params = new URLSearchParams(location.search);

export function plural(count, singular, pluralForm) {
  return `${count} ${count > 1 ? pluralForm : singular}`;
}
