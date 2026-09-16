import { fade, type ReelPainter } from "@/components/settings/SettingsReel.tsx";

/**
 * One painter per Settings section — what that section does, as motion.
 *
 * Each one is a pure function of elapsed time, so it loops without keeping
 * state and lands on the same frame 0 every run; that is what lets the visual
 * baselines stay byte-stable (see `SettingsReel`). Colours arrive as resolved
 * tokens, never as literals: `test/ui/theme.test.ts` is the guard, and a reel
 * that hardcoded a violet would be wrong in the light theme anyway.
 *
 * Each one is also *seamless*: painting `t` and `t + LOOP` draws the identical
 * frame, and nothing pops at the wrap. Those are two separate properties and
 * both had to be fixed. A painter whose own period does not divide `LOOP`
 * never repeats at all; one that does can still jump, because a motif whose
 * shape depends on its index has a spatial period wider than one step, and
 * wrapping on one step slides the whole pattern along by one every lap. Any new
 * painter has to pick a period from the divisor list below and wrap on its own
 * full pattern, not on one element of it — `reels.test.ts` checks the first and
 * only your eye checks the second.
 */

/**
 * Seconds after which every reel is back on frame 0.
 *
 * Each painter's own period must divide it: 2, 3, 4, 5, 6, 10, 12, 15, 20, 30.
 */
export const LOOP = 60;

/** The engine: a sweep that comes round once per poll, lighting what it passes. */
const engine: ReelPainter = (ctx, w, h, t, ink) => {
  const period = 6; // LOOP / 10
  const cx = w * 0.5;
  const cy = h * 0.58;
  const radius = Math.min(w, h) * 0.52;
  const angle = ((t % period) / period) * Math.PI * 2 - Math.PI / 2;

  ctx.lineWidth = 1;
  ctx.strokeStyle = fade(ink.accent, 0.16);
  for (const step of [0.45, 0.72, 1]) {
    ctx.beginPath();
    ctx.arc(cx, cy, radius * step, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.strokeStyle = fade(ink.accent, 0.7);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
  ctx.stroke();

  // Eighteen marks on the ring: each lights as the sweep crosses it, then
  // fades — the tick *is* the poll, which is what the section configures.
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 - Math.PI / 2;
    const r = radius * (0.45 + ((i * 7) % 5) * 0.11);
    let since = angle - a;
    while (since < 0) since += Math.PI * 2;
    const lit = Math.max(0, 1 - since / (Math.PI * 0.9));
    ctx.fillStyle = fade(ink.accent, 0.2 + lit * 0.7);
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.5 + lit * 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Services: the fleet as a slow drift of provider marks, worst ones louder. */
const services: ReelPainter = (ctx, w, h, t, ink) => {
  const rows = 3;
  const stride = 120;
  // A mark's width and alpha come from its index modulo three, so the row's
  // pattern is three strides wide and the drift has to wrap on `group`, not on
  // `stride`: wrapping on one stride re-labelled every mark once a lap and the
  // whole row jumped. Whole laps per LOOP, so each row also lands back on its
  // own frame 0 rather than at some arbitrary point of the pattern.
  const group = stride * 3;
  const laps = [1, -2, 3];
  const tints = [ink.ok, ink.warn, ink.ok];

  for (let row = 0; row < rows; row++) {
    const y = h * (0.26 + row * 0.22);
    const drift = ((t / LOOP) * laps[row]! * group) % group;
    // `drift` spans a full group either way, so the marks that cover the band
    // can start three strides off either edge.
    for (let i = -4; i <= Math.ceil(w / stride) + 4; i++) {
      // `%` keeps the sign of its left operand, and a negative index would
      // hand the leftmost marks a narrower body than the same mark gets once
      // it has drifted into view.
      const variant = (((i + row) % 3) + 3) % 3;
      const x = i * stride + drift;
      const width = 46 + variant * 18;
      ctx.fillStyle = fade(row === 1 ? tints[row]! : ink.accent, 0.13 + variant * 0.05);
      ctx.beginPath();
      ctx.roundRect(x, y - 7, width, 14, 7);
      ctx.fill();
      ctx.fillStyle = fade(tints[row]!, 0.6);
      ctx.beginPath();
      ctx.arc(x + 9, y, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }
};

/** Recently removed: marks that fade out of the fleet rather than move. */
const removed: ReelPainter = (ctx, w, h, t, ink) => {
  for (let i = 0; i < 24; i++) {
    const x = ((i * 53) % 100) / 100 * w;
    const y = h * (0.2 + (((i * 31) % 70) / 100));
    const phase = (t / 5 + i / 24) % 1; // period 5 = LOOP / 12
    // Rises and falls inside the phase: fading from full to nothing left the
    // mark at its widest exactly when it snapped back to its smallest.
    ctx.fillStyle = fade(ink.accent, Math.sin(phase * Math.PI) * 0.35);
    ctx.beginPath();
    ctx.arc(x, y, 2 + phase * 5, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Notifications: what gets announced, rising out of the page and away. */
const notifications: ReelPainter = (ctx, w, h, t, ink) => {
  const tints = [ink.warn, ink.ok, ink.danger];
  for (let i = 0; i < 3; i++) {
    const phase = (t / 3 + i / 3) % 1; // period 3 = LOOP / 20
    const y = h * 0.86 - phase * h * 0.7;
    const alpha = Math.sin(phase * Math.PI) * 0.5;
    const width = w * 0.42;
    const x = w * (0.1 + (i % 2) * 0.34);
    ctx.fillStyle = fade(ink.accent, alpha * 0.4);
    ctx.beginPath();
    ctx.roundRect(x, y, width, 22, 8);
    ctx.fill();
    ctx.fillStyle = fade(tints[i]!, alpha * 1.6);
    ctx.beginPath();
    ctx.arc(x + 12, y + 11, 3, 0, Math.PI * 2);
    ctx.fill();
  }
};

/** Delivery: one beam leaving the engine for each channel, staggered. */
const delivery: ReelPainter = (ctx, w, h, t, ink) => {
  const from = { x: w * 0.16, y: h * 0.5 };
  const targets = [0.24, 0.5, 0.76].map((k) => ({ x: w * 0.84, y: h * k }));
  const tints = [ink.ok, ink.ok, ink.warn];

  ctx.fillStyle = fade(ink.accent, 0.85);
  ctx.beginPath();
  ctx.arc(from.x, from.y, 4.5, 0, Math.PI * 2);
  ctx.fill();

  targets.forEach((to, i) => {
    const mid = (from.x + to.x) / 2;
    ctx.lineWidth = 1;
    ctx.strokeStyle = fade(ink.accent, 0.18);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.bezierCurveTo(mid, from.y, mid, to.y, to.x, to.y);
    ctx.stroke();

    // The bead's position on that same cubic, so the light travels the wire
    // rather than near it.
    const p = (t / 4 + i * 0.22) % 1; // period 4 = LOOP / 15
    const q = 1 - p;
    const bx = q * q * q * from.x + 3 * q * q * p * mid + 3 * q * p * p * mid + p * p * p * to.x;
    const by = q * q * q * from.y + 3 * q * q * p * from.y + 3 * q * p * p * to.y + p * p * p * to.y;
    // Lit only once it has left the engine and dark again before it arrives, so
    // the wrap moves an invisible bead instead of teleporting a bright one back
    // across the card.
    const ease = Math.min(1, Math.min(p, 1 - p) / 0.14);
    const glow = ctx.createRadialGradient(bx, by, 0, bx, by, 14);
    glow.addColorStop(0, fade(ink.accent, 0.8 * ease));
    glow.addColorStop(1, fade(ink.accent, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(bx, by, 14, 0, Math.PI * 2);
    ctx.fill();

    // The channel takes the delivery at the wrap and decays from it, rather
    // than brightening before one wrap and dropping at the next.
    const arrival = Math.max(0, 1 - p / 0.3);
    ctx.fillStyle = fade(tints[i]!, 0.45 + arrival * 0.5);
    ctx.beginPath();
    ctx.arc(to.x, to.y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  });
};

/** Data: the history itself, its oldest column pruned once per cycle. */
const data: ReelPainter = (ctx, w, h, t, ink) => {
  const bars = 30;
  const gap = 3;
  const barWidth = (w - gap * (bars - 1)) / bars;
  const cycle = 2; // bars * cycle = LOOP
  const elapsed = Math.floor(t / cycle);
  const frac = (t % cycle) / cycle;
  const shift = frac * (barWidth + gap);

  for (let i = 0; i <= bars; i++) {
    // Column `i` of one cycle stands where column `i - 1` stands at the start of
    // the next, so its height has to travel with it: keying the seed on
    // `i + elapsed` hands each column the value its right-hand neighbour just
    // had. Re-seeding on the cycle alone redrew all thirty heights at once every
    // cycle. Modulo `bars` closes the loop — no stored state, no Math.random.
    const seed = Math.sin(((i + elapsed) % bars) * 12.9898) * 43758.5453;
    const noise = seed - Math.floor(seed);
    const barHeight = h * (0.16 + noise * 0.46);
    const fading = i === 0 ? 1 - frac : 1;
    ctx.fillStyle = fade(ink.accent, (0.14 + noise * 0.34) * fading);
    ctx.beginPath();
    ctx.roundRect(i * (barWidth + gap) - shift, h * 0.76 - barHeight, barWidth, barHeight, 2);
    ctx.fill();
  }
};

/** Appearance: the wipe that switching a theme is, across a strip of tokens. */
const appearance: ReelPainter = (ctx, w, h, t, ink) => {
  const period = 10; // LOOP / 6
  const p = (t % period) / period;
  const edge = (p < 0.5 ? p * 2 : 2 - p * 2) * w;
  const columns = 8;
  const columnWidth = w / columns;

  for (let i = 0; i < columns; i++) {
    const x = i * columnWidth;
    // How far the edge has crossed this column, rather than whether it has:
    // a boolean made all eight tokens flip on one frame each pass, sixteen
    // steps a loop on a band that is otherwise continuous.
    const reach = Math.min(1, Math.max(0, (edge - (x + columnWidth / 2)) / columnWidth + 0.5));
    ctx.fillStyle = fade(ink.accent, 0.05 + reach * (0.05 + i * 0.035));
    ctx.fillRect(x + 1, h * 0.2, columnWidth - 2, h * 0.52);
  }
  ctx.strokeStyle = fade(ink.accent, 0.8);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(edge, h * 0.14);
  ctx.lineTo(edge, h * 0.78);
  ctx.stroke();
};

/** Keyed by the section ids the rail already uses. */
export const SECTION_REELS = {
  engine,
  services,
  removed,
  notifications,
  delivery,
  data,
  appearance,
} satisfies Record<string, ReelPainter>;
