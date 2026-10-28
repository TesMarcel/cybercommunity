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

const relativeFormat = new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" });

const RELATIVE_STEPS = [
  ["year", 31536000],
  ["month", 2592000],
  ["week", 604800],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

// « il y a 2 heures », date complète au survol
export function timeAgo(value) {
  const seconds = (new Date(value) - Date.now()) / 1000;
  const [unit, size] = RELATIVE_STEPS.find(([, size]) => Math.abs(seconds) >= size) || [];
  const text = unit ? relativeFormat.format(Math.round(seconds / size), unit) : "à l'instant";

  return el("time", { datetime: new Date(value).toISOString(), title: formatDate(value) }, text);
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

// Icône SVG décorative (tracé au format de l'attribut d) ; ICONS : tracés communs
export const ICONS = {
  heart: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1.1L12 21l7.8-7.5 1-1.1a5.5 5.5 0 0 0 0-7.8z",
  comment: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  plus: "M12 5v14M5 12h14",
  code: "M16 18l6-6-6-6M8 6l-6 6 6 6",
  shield: "M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z",
};

export function icon(d) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "icon");
  svg.setAttribute("aria-hidden", "true");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

// Avatar : initiale du pseudo (l'API du forum ne renvoie pas la photo)
export function avatar(name, size = "") {
  return el("span", { class: `avatar-initial${size ? ` avatar-${size}` : ""}`, "aria-hidden": "true" }, (name || "?")[0].toUpperCase());
}

// Texte saisi par un membre : paragraphes, et blocs de code entre ```
// (```bash en ouverture indique le langage). Tout est inséré en texte.
export function richText(content) {
  const root = el("div", { class: "content rich" });
  const parts = content.split("```");

  // Bloc non refermé : le dernier ``` est du texte ordinaire
  if (parts.length % 2 === 0) {
    const rest = parts.pop();
    parts[parts.length - 1] += `\`\`\`${rest}`;
  }

  parts.forEach((part, index) => {
    if (index % 2 === 0) {
      const text = part.replace(/^\n+|\n+$/g, "");
      if (text) {
        root.append(el("p", {}, text));
      }
      return;
    }

    const match = part.match(/^([\w+#.-]*)\n([\s\S]*)$/);
    const language = match ? match[1] : "";
    const code = (match ? match[2] : part).replace(/\n$/, "");
    root.append(codeBlock(code, language));
  });

  return root;
}

function codeBlock(code, language) {
  const copy = el("button", { type: "button", class: "button-link button-small" }, "Copier");

  copy.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copy.textContent = "Copié";
    } catch {
      copy.textContent = "Copie impossible";
    }
    setTimeout(() => (copy.textContent = "Copier"), 1500);
  });

  return el(
    "figure",
    { class: "code-block" },
    el("figcaption", {}, el("span", {}, language || "code"), copy),
    el("pre", {}, el("code", {}, code))
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
  const svg = icon("");
  const path = svg.firstChild;

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
