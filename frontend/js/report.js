// Boîte de dialogue « Signaler » (utilisateur, discussion, commentaire, groupe, message)
import { api } from "./api.js";
import { busy, el, showMessage } from "./ui.js";

const REASONS = [
  "Spam ou publicité",
  "Harcèlement ou insulte",
  "Contenu illégal ou dangereux",
  "Contenu offensant",
  "Hors sujet",
  "Autre",
];

let dialog;

function build() {
  const message = el("div", { "aria-live": "polite" });

  const form = el(
    "form",
    { method: "dialog", novalidate: true },
    el("h2", { id: "report-title" }, "Signaler"),
    message,
    el(
      "div",
      { class: "field" },
      el("label", { for: "report-reason" }, "Motif"),
      el("select", { id: "report-reason", name: "reason" }, REASONS.map((reason) => el("option", {}, reason)))
    ),
    el(
      "div",
      { class: "field" },
      el("label", { for: "report-details" }, "Précisions (facultatif)"),
      el("textarea", { id: "report-details", name: "details", maxlength: "2000" })
    ),
    el(
      "div",
      { class: "row" },
      el("button", { class: "button-primary", type: "submit", value: "send" }, "Envoyer le signalement"),
      el("button", { type: "button", onclick: () => dialog.close() }, "Annuler")
    )
  );

  dialog = el("dialog", { "aria-labelledby": "report-title" }, form);
  dialog.form = form;
  dialog.message = message;
  document.body.append(dialog);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const done = busy(form.querySelector("button[type=submit]"), "Envoi…");

    try {
      await api.post("/api/reports", {
        target_type: dialog.targetType,
        target_id: dialog.targetId,
        reason: form.reason.value,
        details: form.details.value.trim() || null,
      });
      showMessage(message, "Signalement envoyé. Merci, l'équipe de modération va l'examiner.", "success");
      setTimeout(() => dialog.close(), 1500);
    } catch (error) {
      showMessage(message, error.message);
    } finally {
      done();
    }
  });
}

export function openReport(targetType, targetId) {
  if (!dialog) {
    build();
  }

  dialog.targetType = targetType;
  dialog.targetId = targetId;
  dialog.form.reset();
  showMessage(dialog.message, "");
  dialog.showModal();
}
