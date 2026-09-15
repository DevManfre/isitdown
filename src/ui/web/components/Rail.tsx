import { matchPath, NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { Activity, History, Send, Server, Settings, TriangleAlert, type LucideIcon } from "lucide-react";
import { NAV_ROUTES, ROUTE_PATHS, type NavRouteName, type RouteName } from "../../routePaths.ts";
import { BrandMark } from "@/components/BrandMark.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar.tsx";
import { useConfigChrome, useStatusChrome } from "@/hooks/queries.ts";
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
 */
export function Rail() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const { data: status } = useStatusChrome();
  const { data: config } = useConfigChrome();

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

  const channels = config?.channels ?? [];
  const active = channels.filter((channel) => channel.enabled).length;

  return (
    <Sidebar role="navigation" aria-label={t("nav.views")} className="rail">
      <SidebarHeader className="rail-brand flex-row items-center gap-2 overflow-hidden px-6 py-4">
        <BrandMark className="rail-mark size-5" />
        <span className="rail-name font-medium">{t("app.name")}</span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="rail-links p-0">
          <SidebarMenu className="gap-0">
            {NAV_ROUTES.map(({ name, labelKey }) => {
              const badge = badgeFor(name);
              const Icon = NAV_ICONS[name];
              return (
                <SidebarMenuItem key={name}>
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
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      {/* The channel list used to be a column of ten rows, which is most of the
          rail's height spent on a list nothing is ever clicked in. The same ten
          names wrap as chips, and the line under them is the figure the column
          never said out loud: how many of them would actually send. */}
      <SidebarFooter className="rail-foot mt-auto gap-2 px-6">
        <span className="text-xs text-muted-foreground">{t("nav.channels")}</span>
        <div className="rail-channels flex flex-wrap gap-1">
          {channels.map((channel) => (
            <span
              key={channel.id}
              className={cn(
                "rail-channel inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono text-[10px]",
                channel.enabled
                  ? "bg-status-operational/10 text-muted-foreground"
                  : "bg-muted text-muted-foreground/70",
              )}
            >
              <span
                className={cn(
                  "size-1 rounded-full",
                  channel.enabled ? "bg-status-operational" : "bg-muted-foreground",
                )}
              />
              {channel.id}
            </span>
          ))}
        </div>
        {channels.length > 0 && (
          <span className="rail-channels text-xs text-muted-foreground">
            {t("channel.summary.count", { active, total: channels.length })}
          </span>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
