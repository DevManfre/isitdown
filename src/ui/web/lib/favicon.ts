/**
 * Where a provider's icon may live, in the order worth trying. The page's own
 * /favicon.ico comes first, but Statuspage-hosted pages keep theirs on a CDN
 * behind a <link rel="icon"> we cannot read cross-origin, so the DuckDuckGo
 * icon service is the second try. Empty when the base URL does not parse —
 * the ring then keeps its three-letter label instead.
 *
 * Straight port from src/ui/public/js/charts.js:93-105.
 */
export function faviconCandidates(baseUrl: string): string[] {
  try {
    const url = new URL(baseUrl);
    return [`${url.origin}/favicon.ico`, `https://icons.duckduckgo.com/ip3/${url.host}.ico`];
  } catch {
    return [];
  }
}
