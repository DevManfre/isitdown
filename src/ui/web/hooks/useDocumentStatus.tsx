import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useStatusChrome } from "@/hooks/queries.ts";
import { useTheme } from "@/hooks/useTheme.tsx";
import { faviconDataUri, fleetStatus } from "@/lib/documentStatus.ts";

/** The icon link the page ships with; `null` until the first run has looked. */
const ICON_SELECTOR = 'link[rel="icon"]';

/**
 * Puts the worst thing happening to the fleet in the browser tab — roadmap
 * 5.10: the title counts the providers in trouble, and the favicon takes a dot
 * in that severity's colour.
 *
 * Mounted once in the app shell rather than per view, because the tab is not a
 * view's to own: an operator sitting on History must see the same tab as one
 * sitting on the Overview.
 *
 * Status is read through `useStatusChrome`, the never-throwing twin of
 * `useStatus`: this hook renders above every view's error boundary, so a failed
 * status read here would take the whole dashboard down rather than one view. A
 * fleet it cannot read leaves the tab exactly as it is — the last honest thing
 * it said — rather than claiming calm.
 *
 * The calm state is a restore, not a green dot: the page's own `favicon.svg`
 * goes back in place, so a dot in the tab always means something to look at.
 */
export function useDocumentStatus(): void {
  const { t } = useTranslation();
  // The dot's colour comes from a token, which resolves differently per theme,
  // so a theme change has to redraw it.
  const { mode } = useTheme();
  const { data } = useStatusChrome();
  /** The page's original icon href and title, captured before anything is written. */
  const original = useRef<{ href: string | null; title: string } | undefined>(undefined);

  const fleet = data === undefined ? undefined : fleetStatus(data.providers);

  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>(ICON_SELECTOR);
    if (original.current === undefined) {
      original.current = {
        href: link === null ? null : link.getAttribute("href"),
        title: document.title,
      };
    }
    if (fleet === undefined) return;

    const calm = fleet.affected === 0;
    document.title = calm
      ? original.current.title
      : t("document.title.affected", { count: fleet.affected });

    if (link === null) return;
    const href = calm ? original.current.href : faviconDataUri(fleet.worst);
    // Rewritten only on a change: assigning the same href still makes some
    // browsers re-fetch the icon, and this effect runs on every status read.
    if (href !== null && link.getAttribute("href") !== href) link.setAttribute("href", href);
  }, [fleet?.affected, fleet?.worst, mode, t]);
}
