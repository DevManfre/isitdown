import { Outlet, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { Rail } from "@/components/Rail.tsx";
import { Header } from "@/components/Header.tsx";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar.tsx";
import { useTheme } from "@/hooks/useTheme.tsx";
import { usePreferenceSync } from "@/hooks/usePreferenceSync.tsx";

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
  // Seeds theme and locale from the server on a browser that has no stored
  // choice of its own. Mounted here, in the shell, so it runs once per session
  // rather than once per view.
  usePreferenceSync();

  const paramString = [params["providerId"], params["incidentId"]].filter(Boolean).join("/");
  const view = currentView(location.pathname, paramString !== "");

  return (
    // `open` is held at true rather than left to the provider's own state: the
    // rail has no collapse control, and a controlled `open` with no
    // `onOpenChange` also makes the primitive's ⌘B shortcut inert, so there is
    // no way to reach a collapsed rail nothing is styled for.
    <SidebarProvider className="console" open>
      <Rail />
      {/* `SidebarInset` is the page's one <main>, so the animated view below is
          a div. Its stock `bg-background` is dropped: the body carries
          --gradient-page, and an opaque fill here would paint over it. */}
      <SidebarInset className="min-w-0 bg-transparent">
        <Header view={view} />
        <div
          id="view"
          key={viewKey(view, paramString, i18n.language, mode)}
          data-animate={view}
          className="min-w-0 flex-1 px-8 py-6"
        >
          <Outlet />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
