// Appels à l'API : ajoute le token, traduit les erreurs,
// renvoie vers la connexion si la session a expiré

const TOKEN_KEY = "cybercom_token";
const USER_KEY = "cybercom_user";

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const session = {
  token: () => localStorage.getItem(TOKEN_KEY),

  user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  },

  save(token, user) {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    }
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },

  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

export function goToLogin() {
  const next = location.pathname + location.search;
  location.href = `/pages/login.html?next=${encodeURIComponent(next)}`;
}

// options : body (objet JSON), form (FormData), auth (false pour les pages publiques)
export async function request(method, url, { body, form, auth = true } = {}) {
  const headers = {};
  const token = session.token();

  if (auth && token) {
    headers.Authorization = `Bearer ${token}`;
  }

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response;

  try {
    response = await fetch(url, {
      method,
      headers,
      body: form ?? (body !== undefined ? JSON.stringify(body) : undefined),
    });
  } catch {
    throw new ApiError(0, "Impossible de joindre le serveur. Vérifiez votre connexion.");
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    // Session expirée ou invalide : on se reconnecte
    if (response.status === 401 && auth && token) {
      session.clear();
      goToLogin();
    }

    throw new ApiError(response.status, data?.message || `Erreur ${response.status}`);
  }

  return data;
}

// Téléchargement authentifié d'un fichier (pièces jointes)
export async function download(url, filename) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${session.token()}` },
  });

  if (!response.ok) {
    throw new ApiError(response.status, "Fichier introuvable");
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(await response.blob());
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

export const api = {
  get: (url, options) => request("GET", url, options),
  post: (url, body, options) => request("POST", url, { ...options, body }),
  put: (url, body, options) => request("PUT", url, { ...options, body }),
  del: (url, options) => request("DELETE", url, options),
  upload: (url, form) => request("POST", url, { form }),
};
