import { Outlet, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { useTheme } from "@/hooks/useTheme.tsx";

/**
 * What a repaint does to the view's entry animations.
 *
 * A changed view, language or theme is a remount, so the animations replay from
 * the start. Anything else — a poll tick, a write the operator just made — is a
 * re-render under the same key, and CSS animations do not restart on a
 * re-render. That is the whole mechanism: no reflow hack, no per-node silencing.
 */
export const viewKey = (view: string, params: string, locale: string, theme: string) =>
  [view, params, locale, theme].join("|");

/** "incident" for the detail route, otherwise the route's own segment. */
export function currentView(pathname: string, hasParams: boolean): string {
  const segment = pathname.split("/").filter(Boolean)[0] ?? "overview";
  return segment === "incidents" && hasParams ? "incident" : segment;
}

export function App() {
  const location = useLocation();
  const params = useParams();
  const { i18n } = useTranslation();
  const { mode } = useTheme();

  const paramString = [params["providerId"], params["incidentId"]].filter(Boolean).join("/");
  const view = currentView(location.pathname, paramString !== "");

  // Task 8 wraps this in the console grid and adds the rail and the header.
  return (
    <main
      id="view"
      key={viewKey(view, paramString, i18n.language, mode)}
      data-animate={view}
      className="min-w-0 flex-1 px-8 py-6"
    >
      <Outlet />
    </main>
  );
}
