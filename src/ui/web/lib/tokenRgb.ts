/**
 * Resolves a CSS custom property to the unit-float RGB triple cobe wants.
 *
 * Every colour in this dashboard is a semantic token, and cobe takes numbers.
 * Rather than hardcoding `[0.9, 0.2, 0.2]` beside a comment claiming it matches
 * `--status-degraded`, this reads the token the browser actually computed — so
 * a change in `tokens.css` reaches the globe like it reaches everything else.
 *
 * Callers must re-read on a theme change: the same token name resolves to a
 * different colour under `light` and `dark`.
 */
const FALLBACK: [number, number, number] = [0.5, 0.5, 0.5];

export function tokenRgb(
  name: string,
  element: Element = document.documentElement,
): [number, number, number] {
  const raw = getComputedStyle(element).getPropertyValue(name).trim();
  if (raw === "") return FALLBACK;

  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(raw);
  if (rgb !== null) {
    return [Number(rgb[1]) / 255, Number(rgb[2]) / 255, Number(rgb[3]) / 255];
  }

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw);
  if (hex !== null) {
    const digits = hex[1] as string;
    const full =
      digits.length === 3
        ? digits
            .split("")
            .map((digit) => digit + digit)
            .join("")
        : digits;
    return [
      Number.parseInt(full.slice(0, 2), 16) / 255,
      Number.parseInt(full.slice(2, 4), 16) / 255,
      Number.parseInt(full.slice(4, 6), 16) / 255,
    ];
  }

  // oklch(), color-mix() and anything else a modern token file may hold: not
  // parsed here on purpose. Guessing a colour is worse than a neutral one.
  return FALLBACK;
}
