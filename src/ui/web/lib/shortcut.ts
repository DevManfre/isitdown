/**
 * Whether this machine's command key is ⌘ rather than Ctrl.
 *
 * The palette answers both (`CommandPalette`), but the hint printed on the
 * header said "⌘K" everywhere — on Windows and Linux a key the keyboard does
 * not have. `userAgentData` first, where the browser offers it; the
 * deprecated `navigator.platform` is the fallback every browser still fills.
 */
export function isApplePlatform(nav: Pick<Navigator, "platform"> & { userAgentData?: { platform?: string } } = navigator): boolean {
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
