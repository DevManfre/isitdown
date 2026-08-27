import { matchPath, NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { NAV_ROUTES, ROUTE_PATHS, type RouteName } from "../../routePaths.ts";
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
    if (name === "providers") return status.providers.length;
    if (name === "incidents") {
      const open = status.providers.reduce((total, p) => total + p.activeIncidents.length, 0);
      return open === 0 ? undefined : open;
    }
    return undefined;
  };

  return (
    <Sidebar role="navigation" aria-label={t("nav.views")} className="rail">
      <SidebarHeader className="rail-brand flex-row items-center gap-2 overflow-hidden px-6 py-4">
        <span className="rail-dot size-2 shrink-0 rounded-full bg-primary" />
        <span className="rail-name font-medium">{t("app.name")}</span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup className="rail-links p-0">
          <SidebarMenu className="gap-0">
            {NAV_ROUTES.map(({ name, labelKey }) => {
              const badge = badgeFor(name);
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
                    <NavLink to={ROUTE_PATHS[name]}>{t(labelKey)}</NavLink>
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

      <SidebarFooter className="rail-foot mt-auto gap-1 px-6">
        <span className="text-xs text-muted-foreground">{t("nav.notifier")}</span>
        <div className="rail-channels flex flex-col gap-1">
          {(config?.channels ?? []).map((channel) => (
            <div key={channel.id} className="rail-channel flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "size-1.5 rounded-full",
                  channel.enabled ? "bg-status-operational" : "bg-muted-foreground",
                )}
              />
              <span>{channel.id}</span>
            </div>
          ))}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
