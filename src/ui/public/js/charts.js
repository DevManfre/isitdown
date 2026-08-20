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
  operational: {
    color: "var(--status-operational)",
    height: "var(--bar-operational)",
    compact: "var(--bar-compact-operational)",
    poll: "var(--bar-poll-operational)",
  },
  degraded: {
    color: "var(--status-degraded)",
    height: "var(--bar-degraded)",
    compact: "var(--bar-compact-degraded)",
    poll: "var(--bar-poll-degraded)",
  },
  partial_outage: {
    color: "var(--status-partial-outage)",
    height: "var(--bar-partial-outage)",
    compact: "var(--bar-compact-partial-outage)",
    poll: "var(--bar-poll-partial-outage)",
  },
  major_outage: {
    color: "var(--status-major-outage)",
    height: "var(--bar-major-outage)",
    compact: "var(--bar-compact-major-outage)",
    poll: "var(--bar-poll-major-outage)",
  },
  unknown: {
    color: "var(--status-unknown)",
    height: "var(--bar-unknown)",
    compact: "var(--bar-compact-unknown)",
    poll: "var(--bar-poll-unknown)",
  },
};

/**
 * @param {string} status
 * @param {"row" | "compact" | "poll"} [scale] which of the prototype's three bar
 *   rows this bar belongs to; each one has its own set of heights.
 */
export function barSpec(status, scale = "row") {
  const known = Object.hasOwn(TOKENS, status) ? status : "unknown";
  const token = TOKENS[known];
  const height = scale === "compact" ? token.compact : scale === "poll" ? token.poll : token.height;
  return { status: known, color: token.color, height, muted: known === "unknown" };
}

/**
 * The entry delay of the item at `index`, as the prototype writes it: a fixed
 * step per item, optionally after a lead-in for the block as a whole.
 */
export const stagger = (index, step, offset = 0) => `${offset + index * step}ms`;

/** Marks a node as an entry animation; #view[data-animate] decides if it plays. */
export function animate(node, className, delay) {
  node.classList.add(...className.split(" "));
  if (delay !== undefined) node.style.animationDelay = delay;
  return node;
}

export const statusColor = (status) => barSpec(status).color;

/**
 * Where a provider's icon may live, in the order worth trying. The page's own
 * /favicon.ico comes first, but Statuspage-hosted pages keep theirs on a CDN
 * behind a <link rel="icon"> we cannot read cross-origin, so the DuckDuckGo
 * icon service is the second try. Empty when the base URL does not parse —
 * the ring then keeps its three-letter label instead.
 */
export function faviconCandidates(baseUrl) {
  try {
    const url = new URL(baseUrl);
    return [`${url.origin}/favicon.ico`, `https://icons.duckduckgo.com/ip3/${url.host}.ico`];
  } catch {
    return [];
  }
}

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
 * One bar per day, oldest first: the status-page uptime row. Each bar grows out
 * of its baseline 5ms after the one to its left, so the row reads as a sweep.
 * @param {{day: string, status: string}[]} buckets
 * @param {(bucket: {day: string, status: string}) => string} [title]
 * @param {"row" | "compact"} [scale] the overview draws the same data shorter.
 */
export function uptimeBarRow(buckets, title, scale = "row") {
  const row = element("div", scale === "compact" ? "bar-row bar-row-compact" : "bar-row");
  buckets.forEach((bucket, index) => {
    const spec = barSpec(bucket.status, scale);
    const bar = element("span", "bar");
    bar.style.height = spec.height;
    bar.style.background = spec.color;
    if (spec.muted) bar.style.opacity = "0.45";
    bar.title = title === undefined ? "" : title(bucket);
    row.append(animate(bar, "anim-bar", stagger(index, 5)));
  });
  return row;
}

/** The compact inline variant used inside the providers table. */
export function uptimeStrip(buckets) {
  const row = element("div", "bar-strip");
  buckets.forEach((bucket, index) => {
    const spec = barSpec(bucket.status);
    const bar = element("span", "bar");
    bar.style.background = spec.color;
    if (spec.muted) bar.style.opacity = "0.45";
    row.append(animate(bar, "anim-bar anim-bar-strip", stagger(index, 5)));
  });
  return row;
}

/**
 * A provider tile: a ring in its status colour around its short code.
 *
 * The ring is a gauge of the whole 0–100% scale. The prototype zoomed on the
 * last percent, which only worked while live polling kept every uptime between
 * 99 and 100 — backfilled history makes far lower values normal and would
 * collapse every ring to a stub. A measured uptime keeps a 6° floor, because a
 * ring that reads as empty says less than one that reads as barely started;
 * zero (never measured, or fully down) renders as an unbroken grey ring.
 */
export function uptimeRing(provider, delay) {
  const tile = animate(element("div", "ring-tile"), "anim-rise", delay);
  const ring = animate(element("div", "ring"), "anim-ring", delay);
  const color = statusColor(provider.overallStatus);
  const degrees = provider.uptime90 > 0 ? Math.max(6, (provider.uptime90 / 100) * 360) : 0;
  ring.style.background = `conic-gradient(${color} 0 ${degrees}deg, var(--status-unknown) ${degrees}deg 360deg)`;

  const inner = element("div", "ring-inner");
  const short = element("span", "ring-label", provider.name.slice(0, 3).toUpperCase());
  short.style.color = color;
  inner.append(short);
  const candidates = faviconCandidates(provider.baseUrl);
  if (candidates.length > 0) {
    // The label is the fallback: the icon only takes its place once one of the
    // candidates has actually loaded, so a page without a favicon costs nothing.
    const img = element("img", "ring-icon");
    img.alt = "";
    let attempt = 0;
    img.addEventListener("load", () => short.replaceWith(img));
    img.addEventListener("error", () => {
      attempt += 1;
      if (attempt < candidates.length) img.src = candidates[attempt];
    });
    img.src = candidates[0];
  }
  ring.append(inner);

  const text = element("div", "stack-tight");
  text.append(element("span", "provider-name", provider.name));
  const meta = element("span", "mono muted", `${formatPercent(provider.uptime90)} · 90d`);
  meta.style.fontSize = "10.5px";
  text.append(meta);

  tile.append(ring, text);
  return tile;
}

/**
 * The four gradient columns of the history view.
 *
 * A month with a null uptime was never sampled. It renders as a placeholder at
 * minimum height: printing 0.00% would claim a month-long outage that never
 * happened.
 */
export function monthColumns(months, labelFor, noDataLabel) {
  const wrap = element("div", "month-cols");
  months.forEach((month, index) => {
    const column = element("div", "month-col");
    const measured = month.uptime !== null;
    const delay = stagger(index, 90);
    column.append(
      animate(
        element("span", "mono muted", measured ? formatPercent(month.uptime) : noDataLabel),
        "anim-fade",
        delay,
      ),
    );
    const bar = element("div", "month-bar");
    // Floor keeps a bad month visible instead of collapsing it to nothing.
    bar.style.height = measured ? `${Math.max(Math.round(month.uptime * 0.6), 8)}px` : "8px";
    if (!measured) bar.style.opacity = "0.35";
    column.append(animate(bar, "anim-bar anim-bar-month", delay));
    column.append(element("span", "mono muted", labelFor(month.month)));
    wrap.append(column);
  });
  return wrap;
}

/** The incident view's strip of the most recent polls, oldest on the left. */
export function pollStrip(samples, size = 24) {
  const strip = element("div", "poll-strip");
  trimToLatest(samples, size)
    .slice()
    .reverse()
    .forEach((sample, index) => {
      const spec = barSpec(sample.overallStatus, "poll");
      const bar = element("span", "bar");
      bar.style.height = spec.height;
      bar.style.background = spec.color;
      if (spec.muted) bar.style.opacity = "0.45";
      strip.append(animate(bar, "anim-bar", stagger(index, 22)));
    });
  return strip;
}

/**
 * @param {string} status
 * @param {number} [glow] halo radius in px — 12 on the overview, 8 in the
 *   providers table, none in the lists. The halo is the status colour at 55%,
 *   as the prototype draws it, not the solid colour.
 * @param {boolean} [pulse] the slow ring of a state that is still unfolding.
 */
export function statusDot(status, glow = 0, pulse = false) {
  const dot = element("span", "dot");
  dot.style.background = statusColor(status);
  if (glow > 0) {
    dot.style.boxShadow = `0 0 ${glow}px color-mix(in srgb, ${statusColor(status)} 55%, transparent)`;
  }
  if (pulse) {
    // The pulse expands in currentColor, so the dot carries its colour twice.
    dot.style.color = statusColor(status);
    dot.classList.add("dot-pulse");
  }
  return dot;
}
