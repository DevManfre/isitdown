/**
 * The dialog of design 3a, on top of the Nocturne `.dialog` surface.
 *
 * Keyboard behaviour is part of the component rather than left to the browser:
 * Escape closes, focus is trapped inside while open and restored to whatever
 * opened it on close.
 */

import { element } from "../charts.js";
import { applyTranslations, t } from "../i18n.js";

/**
 * @param {{
 *   title: string,
 *   subtitle?: string,
 *   fields?: {
 *     name?: string,
 *     label: string,
 *     value?: string,
 *     placeholder?: string,
 *     mono?: boolean,
 *     readOnly?: boolean,
 *     half?: boolean,
 *     hint?: string,
 *     render?: (field: HTMLElement) => void,
 *   }[],
 *   confirmLabel: string,
 *   onConfirm: (values: Record<string, string>) => Promise<void> | void,
 * }} options
 */
export function openModal(options) {
  const previousFocus = /** @type {HTMLElement | null} */ (document.activeElement);

  const backdrop = element("div", "dialog-backdrop");
  const dialog = element("div", "dialog");
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");

  const heading = element("div", "stack-tight");
  heading.append(element("h3", "dialog-title", options.title));
  if (options.subtitle !== undefined) heading.append(element("span", "muted", options.subtitle));
  dialog.append(heading);

  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  const fields = options.fields ?? [];
  if (fields.length > 0) {
    // Two columns, and a field takes the whole row unless it asks for a half.
    const grid = element("div", "dialog-fields");
    for (const field of fields) {
      const wrap = element("div", field.half === true ? "field" : "field field-full");
      wrap.append(element("label", undefined, field.label));
      if (field.render !== undefined) {
        // A field that draws its own control — a picker rather than an input —
        // so it can sit in reading order with the rest instead of after them.
        field.render(wrap);
      } else {
        const input = /** @type {HTMLInputElement} */ (element("input", field.mono ? "input mono" : "input"));
        input.value = field.value ?? "";
        if (field.placeholder !== undefined) input.placeholder = field.placeholder;
        if (field.readOnly === true) input.readOnly = true;
        inputs[field.name ?? ""] = input;
        wrap.append(input);
      }
      if (field.hint !== undefined) {
        wrap.append(element("span", "mono field-hint", field.hint));
      }
      grid.append(wrap);
    }
    dialog.append(grid);
  }

  const message = element("p", "muted");
  message.hidden = true;
  dialog.append(message);

  const actions = element("div", "dialog-actions");
  const cancel = element("button", "btn btn-ghost", t("action.cancel"));
  cancel.type = "button";
  const confirm = element("button", "btn btn-primary", options.confirmLabel);
  confirm.type = "button";
  const right = element("div", "header-actions");
  right.append(cancel, confirm);
  actions.append(element("span"), right);
  dialog.append(actions);

  backdrop.append(dialog);
  document.body.append(backdrop);
  applyTranslations(dialog);

  const focusable = () =>
    /** @type {HTMLElement[]} */ ([...dialog.querySelectorAll("input, button")]).filter(
      (node) => !(/** @type {HTMLInputElement} */ (node).disabled),
    );
  focusable()[0]?.focus();

  let settled = false;
  const close = () => {
    if (settled) return;
    settled = true;
    document.removeEventListener("keydown", onKeydown);
    // The node leaves when its closing animation ends, so the dialog is seen
    // going. The timeout is the fallback for a tab that never animates.
    backdrop.classList.add("is-closing");
    const drop = () => {
      backdrop.removeEventListener("animationend", onAnimationEnd);
      backdrop.remove();
    };
    /**
     * The dialog's own animation bubbles up here too, so the scrim's is picked
     * out by target rather than by taking the first event that arrives.
     * @param {AnimationEvent} event
     */
    function onAnimationEnd(event) {
      if (event.target === backdrop) drop();
    }
    backdrop.addEventListener("animationend", onAnimationEnd);
    setTimeout(drop, 400);
    previousFocus?.focus();
  };

  /** @param {KeyboardEvent} event */
  function onKeydown(event) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = focusable();
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  document.addEventListener("keydown", onKeydown);

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) close();
  });
  cancel.addEventListener("click", close);

  confirm.addEventListener("click", async () => {
    const values = Object.fromEntries(
      Object.entries(inputs).map(([name, input]) => [name, input.value.trim()]),
    );
    confirm.disabled = true;
    message.hidden = true;
    try {
      await options.onConfirm(values);
      close();
    } catch (error) {
      // A validation error belongs beside the form, not in an alert box.
      message.textContent = /** @type {Error} */ (error).message;
      message.hidden = false;
      confirm.disabled = false;
    }
  });

  return { close, dialog, message };
}

/** A yes/no dialog for an action that destroys data. */
export function confirmModal({ title, body, confirmLabel, onConfirm }) {
  return openModal({
    title,
    subtitle: body,
    confirmLabel,
    onConfirm,
  });
}
