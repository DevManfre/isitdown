/**
 * Design 3a's Settings: polling on the left with the monitored services, the
 * notification channels on the right.
 *
 * One deliberate departure from the prototype, which draws editable credential
 * fields: a secret is never typed, stored or displayed here. Each channel field
 * shows the *name* of the environment variable that carries the credential and
 * whether it currently resolves. The name is editable; the value is not, because
 * the API refuses to accept one at all.
 */

import * as api from "../api.js";
import { animate, element, stagger } from "../charts.js";
import { t } from "../i18n.js";
import { refresh } from "../app.js";
import { editButton, removeButton, openAddServiceDialog } from "./providers.js";

export async function renderSettings(container, state) {
  const config = await api.getConfig();
  const grid = element("div", "settings-grid");
  grid.append(leftColumn(config, state), rightColumn(config));
  container.append(grid);
}

function leftColumn(config, state) {
  const column = element("div", "settings-column");

  const polling = element("div", "settings-block");
  polling.append(element("span", "kicker", t("settings.polling")));

  const fields = element("div", "settings-fields");
  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  for (const [name, labelKey, value] of [
    ["intervalMinutes", "field.interval", config.polling.intervalMinutes],
    ["requestTimeoutSeconds", "field.timeout", config.polling.requestTimeoutSeconds],
    ["maxRetries", "field.retries", config.polling.maxRetries],
  ]) {
    const field = element("div", "field");
    field.append(element("label", undefined, t(labelKey)));
    const input = /** @type {HTMLInputElement} */ (element("input", "input mono"));
    input.type = "number";
    input.value = String(value);
    inputs[name] = input;
    field.append(input);
    fields.append(field);
  }
  polling.append(fields);
  polling.append(element("span", "muted", t("settings.jitter-note")));

  const saveRow = element("div", "header-actions");
  const save = element("button", "btn btn-primary", t("action.save"));
  save.type = "button";
  const status = element("span", "muted", t("settings.hot-note"));
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api.patchSettings({
        intervalMinutes: Number(inputs.intervalMinutes.value),
        requestTimeoutSeconds: Number(inputs.requestTimeoutSeconds.value),
        maxRetries: Number(inputs.maxRetries.value),
      });
      await refresh();
    } catch (error) {
      status.textContent = /** @type {Error} */ (error).message;
    } finally {
      save.disabled = false;
    }
  });
  saveRow.append(save, status);
  polling.append(saveRow);
  column.append(polling);

  const services = element("div", "settings-block");
  const head = element("div", "row-between");
  head.append(element("span", "kicker", t("settings.services")));
  const add = element("button", "btn btn-ghost", t("action.add-service"));
  add.type = "button";
  add.addEventListener("click", openAddServiceDialog);
  head.append(add);
  services.append(head);

  const known = new Map((state.status?.providers ?? []).map((provider) => [provider.id, provider]));
  config.services.forEach((service, index) => {
    const row = animate(element("div", "service-row"), "anim-rise anim-rise-row", stagger(index, 60));
    const left = element("div", "row-between");
    left.style.justifyContent = "flex-start";
    left.style.gap = "10px";
    const dot = element("span", "dot dot-sm");
    dot.style.background = service.enabled ? "var(--status-operational)" : "var(--color-neutral-700)";
    left.append(dot, element("span", "provider-name", service.name));
    const meta = element("span", "mono muted", `${service.adapter} · ${hostOf(service.baseUrl)}`);
    meta.style.fontSize = "10.5px";
    left.append(meta);

    const actions = element("div", "row-actions");
    actions.append(editButton(known.get(service.id) ?? service), removeButton(service));
    row.append(left, actions);
    services.append(row);
  });
  column.append(services);
  return column;
}

function rightColumn(config) {
  const column = element("div", "settings-channels");
  column.append(element("span", "kicker", t("settings.channels")));
  column.append(element("span", "muted", t("settings.secret-note")));

  config.channels.forEach((channel, index) => {
    column.append(channelCard(channel, stagger(index, 90, 40)));
  });
  return column;
}

function channelCard(channel, delay) {
  const card = animate(element("div", "panel panel-channel"), "anim-rise", delay);

  const head = element("div", "row-between");
  const left = element("div", "row-between");
  left.style.justifyContent = "flex-start";
  left.style.gap = "8px";
  const dot = element("span", "dot dot-sm");
  dot.style.background = channel.enabled ? "var(--status-operational)" : "var(--color-neutral-700)";
  left.append(dot, element("span", "provider-name", channel.id));
  head.append(left, element("span", "mono muted", t(channel.enabled ? "channel.enabled" : "channel.disabled")));
  card.append(head);

  /** @type {Record<string, HTMLInputElement>} */
  const inputs = {};
  for (const field of channel.fields) {
    const wrap = element("div", "field");
    const label = element("div", "row-between");
    label.append(element("label", undefined, `${field.name} — ${t("field.env-var")}`));
    const chip = element("span", "mono muted", t(field.isSet ? "channel.env-set" : "channel.env-missing"));
    chip.style.color = field.isSet ? "var(--status-operational)" : "var(--status-degraded)";
    label.append(chip);
    wrap.append(label);

    const input = /** @type {HTMLInputElement} */ (element("input", "input mono"));
    input.value = field.envVar;
    inputs[`${field.name}Env`] = input;
    wrap.append(input);
    card.append(wrap);
  }

  const message = element("span", "muted");
  const actions = element("div", "header-actions");

  const save = element("button", "btn btn-primary", t("action.save"));
  save.type = "button";
  save.addEventListener("click", async () => {
    save.disabled = true;
    try {
      await api.patchChannel(channel.id, {
        fields: Object.fromEntries(Object.entries(inputs).map(([name, input]) => [name, input.value.trim()])),
      });
      await refresh();
    } catch (error) {
      message.textContent = /** @type {Error} */ (error).message;
    } finally {
      save.disabled = false;
    }
  });

  const toggle = element("button", "btn btn-ghost", t(channel.enabled ? "action.disable" : "action.enable"));
  toggle.type = "button";
  toggle.addEventListener("click", async () => {
    await api.patchChannel(channel.id, { enabled: !channel.enabled });
    await refresh();
  });

  const test = element("button", "btn btn-ghost", t("action.send-test"));
  test.type = "button";
  test.addEventListener("click", async () => {
    test.disabled = true;
    message.textContent = "";
    try {
      const result = await api.testChannel(channel.id);
      message.textContent = result.ok
        ? t("channel.test-ok")
        : t("channel.test-failed", { error: result.error });
    } finally {
      test.disabled = false;
    }
  });

  actions.append(save, test, toggle);
  card.append(actions, message);
  return card;
}

const hostOf = (baseUrl) => {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
};
