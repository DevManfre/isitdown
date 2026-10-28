import { Link, matchPath, NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, History, House, Plus, Send, Server, Settings, TriangleAlert, type LucideIcon } from "lucide-react";
import { NAV_ROUTES, ROUTE_PATHS, type NavRouteName, type RouteName } from "../../routePaths.ts";
import { BrandMark } from "@/components/BrandMark.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar.tsx";
import { useDashboards, useStatusChrome } from "@/hooks/queries.ts";
import { useCurrentDashboardId } from "@/components/dashboards/DashboardMenu.tsx";
import { dashboardCommand, dashboardPath, MAX_DASHBOARDS } from "@/components/dashboards/DashboardActions.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * One glyph per view. A label alone is what the rail had, and at six rows of
 * the same weight the operator reads the list rather than aims at it; the glyph
 * is what makes a row findable without reading. They are the lucide set the
 * rest of the dashboard already draws from, so nothing new ships for this.
 */
const NAV_ICONS: Record<NavRouteName, LucideIcon> = {
  overview: Activity,
  providers: Server,
  incidents: TriangleAlert,
  history: History,
  deliveryLog: Send,
  settings: Settings,
  // Never rendered: the detail route is not in NAV_ROUTES. Declared so the
  // record stays exhaustive over NavRouteName and a new rail route cannot be
  // added without a glyph. `settingsSection` is outside that type: it is a
  // Settings page, lighting the Settings row, not a rail destination of its own.
  incidentDetail: TriangleAlert,
};

/**
 * The rail is the shadcn `Sidebar` primitive, pinned open: App holds the
 * provider's `open` at true, so no collapsed state — and none of the
 * primitive's collapsed-width rules — is ever reachable here.
 *
 * Views only. It used to end in a chip per notification channel, which at
 * thirty channels was most of the rail spent on names nothing is clicked in;
 * the channels are Settings → Notifications' business.
 */
export function Rail() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const { data: status } = useStatusChrome();
  const { data: dashboards = [] } = useDashboards();
  const currentDashboard = useCurrentDashboardId();
  const onOverview = matchPath({ path: ROUTE_PATHS.overview, end: false }, pathname) !== null;

  const badgeFor = (name: RouteName): number | undefined => {
    if (status === undefined) return undefined;
    // Both badges count the enabled providers only, because that is what the
    // views behind them list now.
    if (name === "providers") return status.providers.filter((p) => p.enabled).length;
    if (name === "incidents") {
      // Enabled providers only, the way the incident list itself counts: a
      // disabled provider stops being polled, so the incidents its last poll
      // left behind never resolve and would pin the badge open for good.
      const open = status.providers
        .filter((p) => p.enabled)
        .reduce((total, p) => total + p.activeIncidents.length, 0);
      return open === 0 ? undefined : open;
    }
    return undefined;
  };

  return (
    <Sidebar role="navigation" aria-label={t("nav.views")} className="rail">
      <SidebarHeader className="rail-brand flex-row items-center gap-2 overflow-hidden px-6 py-4">
        <BrandMark className="rail-mark size-5" />
        <span className="rail-name font-medium">{t("app.name")}</span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="rail-links p-0" data-tour="rail">
          <SidebarMenu className="gap-0">
            {NAV_ROUTES.map(({ name, labelKey }) => {
              const badge = badgeFor(name);
              const Icon = NAV_ICONS[name];
              return (
                <SidebarMenuItem key={name} data-tour={`nav-${name}`}>
                  <SidebarMenuButton
                    asChild
                    // What NavLink's own `isActive` computes, by the same rule:
                    // an unended match, so /incidents/github/i1 still lights the
                    // Incidents row. With `asChild` the link renders the button,
                    // so the state has to be handed in rather than read out of
                    // NavLink's render prop.
                    isActive={matchPath({ path: ROUTE_PATHS[name], end: false }, pathname) !== null}
                    className="rounded-none"
                  >
                    <NavLink to={ROUTE_PATHS[name]}>
                      <Icon className="rail-icon size-4" strokeWidth={1.6} aria-hidden="true" />
                      <span>{t(labelKey)}</span>
                    </NavLink>
                  </SidebarMenuButton>
                  {badge !== undefined && (
                    <SidebarMenuBadge
                      className={cn(
                        "rail-badge mr-4",
                        name === "incidents"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <NumberTicker locale={i18n.language} value={badge} />
                    </SidebarMenuBadge>
                  )}
                  {/* Roadmap 4.2. The named dashboards, under the view they
                      are pages of — only once there is a second one: a list
                      of one would repeat the row above it. The first is made
                      from the header's menu. */}
                  {name === "overview" && dashboards.length > 1 && (
                    <SidebarMenuSub aria-label={t("dashboards.rail-label")} className="mr-0 pr-2">
                      {dashboards.map((d) => (
                        <SidebarMenuSubItem key={d.id}>
                          <SidebarMenuSubButton asChild isActive={onOverview && d.id === currentDashboard}>
                            {/* A plain Link: NavLink decides `aria-current` by the
                                address alone, and the bare #/overview is home's
                                page without naming it. */}
                            <Link
                              to={dashboardPath(d.id)}
                              aria-current={onOverview && d.id === currentDashboard ? "page" : undefined}
                            >
                              <span className="min-w-0 flex-1 truncate">{d.name}</span>
                              {d.home && (
                                <House role="img" aria-label={t("dashboards.home")} className="text-primary" strokeWidth={1.8} />
                              )}
                            </Link>
                          </SidebarMenuSubButton>
                        </SidebarMenuSubItem>
                      ))}
                      <SidebarMenuSubItem>
                        <SidebarMenuSubButton asChild>
                          <button
                            type="button"
                            className="w-full text-primary"
                            disabled={dashboards.length >= MAX_DASHBOARDS}
                            title={
                              dashboards.length >= MAX_DASHBOARDS ? t("dashboards.full", { max: MAX_DASHBOARDS }) : undefined
                            }
                            onClick={() =>
                              dashboardCommand({ kind: "create", from: onOverview ? currentDashboard : undefined })
                            }
                          >
                            <Plus aria-hidden="true" className="text-primary" />
                            <span>{t("dashboards.new")}</span>
                          </button>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    </SidebarMenuSub>
                  )}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

    </Sidebar>
  );
}
