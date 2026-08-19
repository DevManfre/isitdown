/**
 * The chart primitives of design 3a, built from DOM nodes and CSS tokens — no
 * chart library, no canvas, no SVG. Every one of them takes data that the server
 * has already aggregated: nothing here re-derives a percentage or a bucket.
 *
 * The mapping helpers are pure and exported separately so they can be tested
 * without a browser.
 */

import { formatPercent } from "./i18n.js";

/**
 * Token names are listed rather than built from the status string. A name
 * assembled at runtime cannot be checked against tokens.css, and the guard test
 * that keeps every colour in the token file would have nothing to look at.
 */
const TOKENS = {
  operational: { color: "var(--status-operational)", height: "var(--bar-operational)" },
  degraded: { color: "var(--status-degraded)", height: "var(--bar-degraded)" },
  partial_outage: { color: "var(--status-partial-outage)", height: "var(--bar-partial-outage)" },
  major_outage: { color: "var(--status-major-outage)", height: "var(--bar-major-outage)" },
  unknown: { color: "var(--status-unknown)", height: "var(--bar-unknown)" },
};

export function barSpec(status) {
  const known = Object.hasOwn(TOKENS, status) ? status : "unknown";
  return { status: known, ...TOKENS[known], muted: known === "unknown" };
}

export const statusColor = (status) => barSpec(status).color;

/** Keeps only the newest `size` entries of a newest-first list. */
export function trimToLatest(list, size) {
  return list.slice(0, size);
}

export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * One bar per day, oldest first: the status-page uptime row.
 * @param {{day: string, status: string}[]} buckets
 * @param {(bucket: {day: string, status: string}) => string} [title]
 */
export function uptimeBarRow(buckets, title) {
  const row = element("div", "bar-row");
  for (const bucket of buckets) {
    const spec = barSpec(bucket.status);
    const bar = element("span", "bar");
    bar.style.height = spec.height;
    bar.style.background = spec.color;
    if (spec.muted) bar.style.opacity = "0.45";
    bar.title = title === undefined ? "" : title(bucket);
    row.append(bar);
  }
  return row;
}

/** The compact inline variant used inside the providers table. */
export function uptimeStrip(buckets) {
  const row = element("div", "bar-strip");
  for (const bucket of buckets) {
    const spec = barSpec(bucket.status);
    const bar = element("span", "bar");
    bar.style.background = spec.color;
    if (spec.muted) bar.style.opacity = "0.45";
    row.append(bar);
  }
  return row;
}

/** A provider tile: a ring in its status colour around its short code. */
export function uptimeRing(provider) {
  const tile = element("div", "ring-tile");
  const ring = element("div", "ring");
  const color = statusColor(provider.overallStatus);
  ring.style.background = `conic-gradient(${color} ${Math.max(provider.uptime90, 2)}%, var(--color-neutral-800) 0)`;

  const inner = element("div", "ring-inner");
  const short = element("span", "ring-label", provider.name.slice(0, 3).toUpperCase());
  short.style.color = color;
  inner.append(short);
  ring.append(inner);

  const text = element("div", "stack-tight");
  text.append(element("span", "provider-name", provider.name));
  const meta = element("span", "mono muted", `${formatPercent(provider.uptime90)} · 90d`);
  meta.style.fontSize = "10.5px";
  text.append(meta);

  tile.append(ring, text);
  return tile;
}

/** The four gradient columns of the history view. */
export function monthColumns(months, labelFor) {
  const wrap = element("div", "month-cols");
  for (const month of months) {
    const column = element("div", "month-col");
    column.append(element("span", "mono muted", formatPercent(month.uptime)));
    const bar = element("div", "month-bar");
    // Floor keeps a bad month visible instead of collapsing it to nothing.
    bar.style.height = `${Math.max(Math.round(month.uptime * 0.6), 8)}px`;
    column.append(bar);
    column.append(element("span", "mono muted", labelFor(month.month)));
    wrap.append(column);
  }
  return wrap;
}

/** The incident view's strip of the most recent polls, oldest on the left. */
export function pollStrip(samples, size = 24) {
  const strip = element("div", "poll-strip");
  for (const sample of trimToLatest(samples, size).slice().reverse()) {
    const spec = barSpec(sample.overallStatus);
    const bar = element("span", "bar");
    bar.style.height = spec.height;
    bar.style.background = spec.color;
    if (spec.muted) bar.style.opacity = "0.45";
    strip.append(bar);
  }
  return strip;
}

export function statusDot(status, glow = false) {
  const dot = element("span", "dot");
  dot.style.background = statusColor(status);
  if (glow) dot.style.boxShadow = `0 0 12px ${statusColor(status)}`;
  return dot;
}
