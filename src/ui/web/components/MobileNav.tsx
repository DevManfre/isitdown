import { useCallback, useEffect, useState } from "react";
import { matchPath, NavLink, useLocation, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Activity,
  History,
  Menu,
  Monitor,
  Moon,
  Search,
  Send,
  Server,
  Settings,
  Sun,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { openCommandPalette } from "./CommandPalette.tsx";
import { NAV_ROUTES, ROUTE_PATHS, type NavRouteName } from "../../routePaths.ts";
import { useConfigChrome, usePreferencesMutation, useStatusChrome } from "@/hooks/queries.ts";
import { useTheme, type ThemeMode } from "@/hooks/useTheme.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * The rail's answer below 768px — roadmap 7.6.
 *
 * The `Sidebar` primitive already takes the rail off screen at that width (it
 * is `hidden md:block`, with a Sheet for the mobile case), but `App` pins the
 * provider open and mounts no trigger, so on a phone the console simply had no
 * navigation at all. Rather than reach for that Sheet — a 288px drawer of six
 * rows, reachable only from a hamburger nobody sees — the four views an
 * operator actually moves between become a tab bar, and everything else moves
 * into one sheet behind "More".
 *
 * Why CSS and not `useIsMobile()`: the hook reports false on its first render
 * and corrects itself in an effect, so a JS-gated bar would flash into a
 * desktop screenshot and out of a phone one. `md:hidden` is resolved before
 * the first paint, which also keeps the visual baselines deterministic.
 */

/** The four destinations that earn a permanent tab, in rail order. */
const TAB_ROUTES: NavRouteName[] = ["overview", "providers", "incidents", "history"];

const NAV_ICONS: Record<NavRouteName, LucideIcon> = {
  overview: Activity,
  providers: Server,
  incidents: TriangleAlert,
  history: History,
  deliveryLog: Send,
  settings: Settings,
  incidentDetail: TriangleAlert,
};

const THEME_ICONS: Record<ThemeMode, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

/** What the header's "More" button dispatches, the way the palette is opened. */
export const MORE_EVENT = "isitdown:open-more";

/** Opens the More sheet from anywhere in the shell. */
export function openMoreSheet(): void {
  window.dispatchEvent(new Event(MORE_EVENT));
}

export function MobileNav() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { data: status } = useStatusChrome();
  const { data: config } = useConfigChrome();
  const { mode, set: setTheme } = useTheme();
  const savePreferences = usePreferencesMutation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onRequest = (): void => setOpen(true);
    window.addEventListener(MORE_EVENT, onRequest);
    return () => window.removeEventListener(MORE_EVENT, onRequest);
  }, []);

  // Every row closes the sheet before it acts: what it does changes the screen
  // under it, and a sheet left open would cover the answer.
  const run = useCallback((action: () => void) => {
    setOpen(false);
    action();
  }, []);

  // The rail's own count, by the same rule: enabled providers only, because a
  // disabled one stops being polled and its last incidents never resolve.
  const openIncidents =
    status === undefined
      ? 0
      : status.providers
          .filter((provider) => provider.enabled)
          .reduce((total, provider) => total + provider.activeIncidents.length, 0);

  const channels = config?.channels ?? [];
  const activeChannels = channels.filter((channel) => channel.enabled).length;
  const moreActive =
    matchPath({ path: ROUTE_PATHS.settings, end: false }, pathname) !== null ||
    matchPath({ path: ROUTE_PATHS.deliveryLog, end: false }, pathname) !== null;

  return (
    <>
      <nav
        className="mobile-tabs fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label={t("nav.views")}
      >
        {TAB_ROUTES.map((name) => {
          const Icon = NAV_ICONS[name];
          const labelKey = NAV_ROUTES.find((route) => route.name === name)?.labelKey ?? "nav.overview";
          return (
            <NavLink
              key={name}
              to={ROUTE_PATHS[name]}
              className={({ isActive }) =>
                cn(
                  "mobile-tab relative flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px]",
                  isActive ? "text-primary" : "text-muted-foreground",
                )
              }
            >
              <Icon className="size-5" strokeWidth={1.7} aria-hidden="true" />
              <span className="max-w-full truncate">{t(labelKey)}</span>
              {name === "incidents" && openIncidents > 0 && (
                <span className="mobile-tab-badge absolute left-1/2 top-1 ml-1.5 flex min-w-4 items-center justify-center rounded-full bg-destructive/15 px-1 text-[10px] font-semibold text-destructive">
                  {openIncidents}
                </span>
              )}
            </NavLink>
          );
        })}

        <button
          type="button"
          className={cn(
            "mobile-tab flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-[10px]",
            moreActive ? "text-primary" : "text-muted-foreground",
          )}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu className="size-5" strokeWidth={1.7} aria-hidden="true" />
          <span className="max-w-full truncate">{t("nav.more")}</span>
        </button>
      </nav>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="mobile-more gap-0 rounded-t-2xl border-border p-0">
          <SheetHeader className="px-4 pb-2 pt-4">
            <SheetTitle className="text-base">{t("nav.more")}</SheetTitle>
            <SheetDescription className="text-xs">{t("nav.more-description")}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-1 px-2 pb-1">
            <button
              type="button"
              className="mobile-more-row flex min-h-12 items-center gap-3 rounded-md px-2 text-left text-sm"
              onClick={() => run(() => navigate(ROUTE_PATHS.settings))}
            >
              <Settings className="size-5 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <span className="flex-1">{t("nav.settings")}</span>
            </button>
            <button
              type="button"
              className="mobile-more-row flex min-h-12 items-center gap-3 rounded-md px-2 text-left text-sm"
              onClick={() => run(() => navigate(ROUTE_PATHS.deliveryLog))}
            >
              <Send className="size-5 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <span className="flex-1">{t("nav.delivery-log")}</span>
            </button>
            <button
              type="button"
              className="mobile-more-row flex min-h-12 items-center gap-3 rounded-md px-2 text-left text-sm"
              onClick={() => run(openCommandPalette)}
            >
              <Search className="size-5 text-muted-foreground" strokeWidth={1.7} aria-hidden="true" />
              <span className="flex-1">{t("palette.open")}</span>
              <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
            </button>
          </div>


          <div className="flex flex-col gap-2 border-t border-border px-4 py-3">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
              {t("nav.theme")}
            </span>
            {/* Three explicit choices rather than the header's cycling button:
                a phone has room for the whole set, and a control that has to be
                pressed twice to reach "system" is worse than one that says so. */}
            <div className="mobile-more-group grid grid-cols-3 gap-1 rounded-md bg-muted/60 p-1">
              {(Object.keys(THEME_ICONS) as ThemeMode[]).map((option) => {
                const Icon = THEME_ICONS[option];
                return (
                  <button
                    key={option}
                    type="button"
                    className={cn(
                      "flex min-h-10 items-center justify-center gap-1.5 rounded text-xs",
                      mode === option && "bg-card font-medium text-primary shadow-sm",
                    )}
                    aria-pressed={mode === option}
                    onClick={() => {
                      setTheme(option);
                      savePreferences.mutate({ theme: option });
                    }}
                  >
                    <Icon className="size-4" strokeWidth={1.7} aria-hidden="true" />
                    {t(`theme.${option}`)}
                  </button>
                );
              })}
            </div>
          </div>

          {channels.length > 0 && (
            <div className="flex items-center gap-2 border-t border-border px-4 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <span className="flex-1 text-xs text-muted-foreground">
                {t("channel.summary.count", { active: activeChannels, total: channels.length })}
              </span>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}
