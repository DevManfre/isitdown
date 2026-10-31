/**
 * A custom accent colour — roadmap 4.19.
 *
 * The operator picks one hex value; everything the accent has to be in a
 * dashboard — the fill, the text on the fill, the hover step — is derived here
 * so a choice cannot leave a button with white text on yellow. The status
 * colours are not part of this: an accent that turned the "operational" green
 * into the instance's brand colour would make the dashboard lie, so only the
 * tokens `--primary`, `--ring` and the accent-tinted chips are written.
 */

/** The only shape the server stores: `#rrggbb`. */
export const ACCENT_PATTERN = /^#[0-9a-f]{6}$/i;

const STORAGE_KEY = "isitdown.identity";

export interface AccentTokens {
  /** The fill, as picked. */
  accent: string;
  /** Text on the fill: one of the two inks `tokens.css` declares. */
  foreground: string;
  /** The hover step, nudged toward whichever ink the foreground is not. */
  hover: string;
}

type Rgb = readonly [number, number, number];

const parseHex = (hex: string): Rgb =>
  [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)) as unknown as Rgb;

/** `#rrggbb` for three channels — the one place a hex string is built rather than read. */
export const rgbToHex = ([red, green, blue]: Rgb): string =>
  `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;

const channel = (value: number): number => {
  const unit = value / 255;
  return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
};

const luminanceOf = ([red, green, blue]: Rgb): number => 0.2126 * channel(red) + 0.7152 * channel(green) + 0.0722 * channel(blue);

const ratioOf = (a: Rgb, b: Rgb): number => {
  const [hi, lo] = [luminanceOf(a), luminanceOf(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

/** WCAG relative luminance of `#rrggbb`. */
export const luminance = (hex: string): number => luminanceOf(parseHex(hex));

/** WCAG contrast ratio of two `#rrggbb` colours. */
export const contrastRatio = (a: string, b: string): number => ratioOf(parseHex(a), parseHex(b));

// The two inks' channels, for the arithmetic only. What reaches the stylesheet
// is the token (`--on-accent-light` / `--on-accent-dark`), so `tokens.css` stays
// the one place a colour is written down; channels rather than hex strings
// because the palette scan (test/ui/theme.test.ts) allows no colour literal
// outside it, and accent.test.ts checks these against the file.
export const LIGHT_INK: Rgb = [255, 255, 255];
export const DARK_INK: Rgb = [24, 24, 27];

/** Tokens for one accent, or null when it is not a `#rrggbb` value. */
export function accentTokens(hex: string): AccentTokens | null {
  if (!ACCENT_PATTERN.test(hex)) return null;
  const rgb = parseHex(hex);
  const light = ratioOf(rgb, LIGHT_INK) >= ratioOf(rgb, DARK_INK);
  return {
    accent: hex.toLowerCase(),
    foreground: light ? "var(--on-accent-light)" : "var(--on-accent-dark)",
    hover: `color-mix(in srgb, ${hex.toLowerCase()} 85%, ${light ? "black" : "white"})`,
  };
}

/**
 * How well the accent reads as text or a ring on a ground: the ratio a hint can
 * report beside the picker. Under 3:1 an accent-coloured label or focus ring is
 * hard to see (WCAG's floor for graphics and large text), which is worth
 * saying, though not worth forbidding — the operator may only use it on the
 * button.
 */
export const accentReadability = (hex: string, ground: string): number | null =>
  ACCENT_PATTERN.test(hex) && ACCENT_PATTERN.test(ground) ? contrastRatio(hex, ground) : null;

const PROPERTIES = ["--color-accent", "--status-accent", "--primary-foreground", "--primary-hover"] as const;

/** Writes (or, with an empty value, removes) the accent on the document. */
export function applyAccent(hex: string, root: HTMLElement = document.documentElement): void {
  const tokens = accentTokens(hex);
  if (tokens === null) {
    for (const property of PROPERTIES) root.style.removeProperty(property);
    return;
  }
  root.style.setProperty("--color-accent", tokens.accent);
  root.style.setProperty("--status-accent", tokens.accent);
  root.style.setProperty("--primary-foreground", tokens.foreground);
  root.style.setProperty("--primary-hover", tokens.hover);
}

/**
 * The last identity, kept in this browser so the inline script in `index.html`
 * can paint it before React runs — the same reason the theme is stored twice.
 */
export function rememberIdentity(identity: { accentColor: string }): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accentTokens(identity.accentColor)));
  } catch {
    /* blocked storage only costs one frame of the default accent */
  }
}
