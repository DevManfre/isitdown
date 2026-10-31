/**
 * Every theme the dashboard can wear — roadmap 4.18.
 *
 * `light`, `dark` and `system` are the base three the header button cycles. The
 * rest are chosen in Settings, because they answer a need rather than a mood:
 * `contrast` is WCAG AAA for low vision, `colorblind` swaps the red/green pair
 * the status colours lean on, and `oled` is the pure-black ground a wallboard
 * wants. One list, read by the preference schema, the route and the dashboard,
 * so a theme added here is accepted everywhere or nowhere.
 */
export const BASE_THEMES = ["light", "dark", "system"] as const;
export const EXTRA_THEMES = ["contrast", "colorblind", "oled"] as const;
export const THEME_MODES = [...BASE_THEMES, ...EXTRA_THEMES] as const;

export type ThemeMode = (typeof THEME_MODES)[number];
