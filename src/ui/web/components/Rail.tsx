import { useState } from "react";
import { matchPath, NavLink, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { NAV_ROUTES, ROUTE_PATHS, type RouteName } from "../../routePaths.ts";
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
import { useRail } from "@/hooks/useRail.tsx";
import { cn } from "@/lib/utils.ts";

/**
 * The rail is the shadcn `Sidebar` primitive, collapsing to an icon strip.
 *
 * Two of its collapsed-state rules are overridden per row rather than fought in
 * CSS. Stock `collapsible="icon"` squares every menu button off at 32px and
 * hides the badges outright, because a stock icon rail has room for a glyph and
 * nothing else. This one keeps its labels and peeks back to full width on hover
 * (motion.css), so during a peek those rules would clip exactly what the peek
 * exists to show. `cn()` is tailwind-merge, so an override with the same variant
 * and the same utility group replaces the primitive's own.
 */
export function Rail() {
  const { t } = useTranslation();
  const { collapsed, toggle } = useRail();
  const { pathname } = useLocation();
  const { data: status } = useStatusChrome();
  const { data: config } = useConfigChrome();
  // Right after the collapse click the pointer is still standing on the rail,
  // and `:hover` alone would reopen it in the same instant. `.rail-hold` blinds
  // the hover (see motion.css) until the pointer has actually left once —
  // the vanilla dashboard's app.js kept the same class for the same reason.
  const [hold, setHold] = useState(false);

  const badgeFor = (name: RouteName): string | undefined => {
    if (status === undefined) return undefined;
    if (name === "providers") return String(status.providers.length);
    if (name === "incidents") {
      const open = status.providers.reduce((total, p) => total + p.activeIncidents.length, 0);
      return open === 0 ? undefined : String(open);
    }
    return undefined;
  };

  return (
    <Sidebar
      collapsible="icon"
      role="navigation"
      aria-label={t("nav.views")}
      className={cn("rail", hold && "rail-hold")}
      onMouseLeave={() => setHold(false)}
    >
      <SidebarHeader className="rail-brand flex-row items-center gap-2 overflow-hidden px-6 py-4">
        <span className="rail-dot size-2 shrink-0 rounded-full bg-primary" />
        <span className="rail-name font-medium">{t("app.name")}</span>
        <button
          type="button"
          className="rail-toggle ml-auto text-muted-foreground"
          aria-expanded={!collapsed}
          aria-label={t(collapsed ? "nav.rail-expand" : "nav.rail-collapse")}
          onClick={(event) => {
            const collapsing = !collapsed;
            toggle();
            // Focus would hold the rail open through :focus-within just as
            // surely as hover would, so it is dropped on the way down.
            if (collapsing) event.currentTarget.blur();
            setHold(collapsing);
          }}
        >
          <span className="rail-toggle-chevron block size-2 rotate-45 border-b-2 border-l-2 border-current" />
        </button>
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
                    className="rounded-none group-data-[collapsible=icon]:size-auto!"
                  >
                    <NavLink to={ROUTE_PATHS[name]}>{t(labelKey)}</NavLink>
                  </SidebarMenuButton>
                  {badge !== undefined && (
                    <SidebarMenuBadge
                      className={cn(
                        "rail-badge mr-4 group-data-[collapsible=icon]:flex",
                        name === "incidents"
                          ? "bg-destructive/15 text-destructive"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {badge}
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
