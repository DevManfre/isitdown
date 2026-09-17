import { Outlet, useLocation, useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { CommandPalette } from "@/components/CommandPalette.tsx";
import { Rail } from "@/components/Rail.tsx";
import { Header } from "@/components/Header.tsx";
import { MobileNav } from "@/components/MobileNav.tsx";
import { ViewFrame } from "@/components/ViewFrame.tsx";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar.tsx";
import { useTheme } from "@/hooks/useTheme.tsx";
import { useDocumentStatus } from "@/hooks/useDocumentStatus.tsx";
import { usePreferenceSync } from "@/hooks/usePreferenceSync.tsx";
import { usePreferences } from "@/hooks/queries.ts";
import { useViewReady } from "@/hooks/useViewReady.ts";

/**
 * What a repaint does to the view's entry animations.
 *
 * A changed view, language or theme is a remount, so the animations replay from
 * the start. Anything else — a poll tick, a write the operator just made — is a
 * re-render under the same key, and CSS animations do not restart on a
 * re-render. That is the whole mechanism: no reflow hack, no per-node silencing.
 *
 * *When* they replay is `ViewFrame`'s call, not this key's: a remounted view
 * holds its cascade until its first data has landed, so the page enters once
 * rather than once per query.
 */
export const viewKey = (
  view: string,
  params: string,
  locale: string,
  theme: string,
  timeZone: string = "auto",
) => [view, params, locale, theme, timeZone].join("|");

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
  // rather than once per view. A seed that lands changes `viewKey` and remounts
  // the view, so the frame below waits for it rather than cascading once in the
  // default theme and again in the operator's.
  const seeded = usePreferenceSync();
  const { data: preferences } = usePreferences();
  // The browser tab reflects the worst status in the fleet. Mounted in the
  // shell, like the seed above, because the tab belongs to no single view.
  useDocumentStatus();
  // The same readiness `ViewFrame` gates the view on, held here for the chrome
  // around it. `Rail`, `Header` and `PollIndicator` are siblings of the frame,
  // so they were never behind its gate: they painted a countdown that said
  // "not polled yet", a rail with no badges and no channels, and swapped all
  // three for real figures a second before the view entered. Read separately
  // rather than handed down from the frame because the two gates differ in
  // exactly one way — the frame is keyed on the view and resets its gate on
  // every remount to replay the cascade, and the chrome, which does not
  // remount, must not blank itself again each time the operator changes view.
  const ready = useViewReady(!seeded);

  const paramString = [params["providerId"], params["incidentId"]].filter(Boolean).join("/");
  const view = currentView(location.pathname, paramString !== "");

  return (
    // `open` is held at true rather than left to the provider's own state: the
    // rail has no collapse control, and a controlled `open` with no
    // `onOpenChange` also makes the primitive's ⌘B shortcut inert, so there is
    // no way to reach a collapsed rail nothing is styled for.
    <SidebarProvider className="console" open data-ready={ready ? "" : undefined}>
      <Rail />
      {/* Roadmap 5.4. A sibling of the rail rather than of the view: the
          shortcut has to answer on every screen, and a palette mounted inside
          a view would take its own key listener away with it on navigation. */}
      <CommandPalette />
      {/* Roadmap 7.6. The rail is `hidden md:block` inside the primitive, so
          below 768px the console had no navigation at all: this is what stands
          in for it — a tab bar and one sheet, both `md:hidden`. A sibling of
          the rail for the same reason the palette is: it has to answer on
          every screen. */}
      <MobileNav />
      {/* `SidebarInset` is the page's one <main>, so the animated view below is
          a div. Its stock `bg-background` is dropped: the body carries
          --gradient-page, and an opaque fill here would paint over it. */}
      <SidebarInset className="min-w-0 bg-transparent">
        <Header view={view} />
        <ViewFrame
          // The zone is in the key for the same reason the locale is: the
          // formatters read it at render time from a module-level value, so a
          // changed zone only reaches the timestamps already on screen if the
          // view remounts.
          key={viewKey(view, paramString, i18n.language, mode, preferences?.timeZone ?? "auto")}
          view={view}
          hold={!seeded}
        >
          <Outlet />
        </ViewFrame>
      </SidebarInset>
    </SidebarProvider>
  );
}
