import { useState } from "react";
import { NavLink } from "react-router";
import { useTranslation } from "react-i18next";
import { NAV_ROUTES, ROUTE_PATHS, type RouteName } from "../../routePaths.ts";
import { useConfigChrome, useStatusChrome } from "@/hooks/queries.ts";
import { useRail } from "@/hooks/useRail.tsx";
import { cn } from "@/lib/utils.ts";

export function Rail() {
  const { t } = useTranslation();
  const { collapsed, toggle } = useRail();
  const { data: status } = useStatusChrome();
  const { data: config } = useConfigChrome();
  // Right after the collapse click the pointer is still standing on the rail,
  // and :hover alone would reopen it in the same instant. `.rail-hold` blinds
  // that hover (see motion.css) until the pointer has actually left once —
  // vanilla's app.js kept the same class for the same reason.
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
    <nav
      className={cn(
        "rail flex flex-col gap-4 overflow-hidden border-r border-border bg-card py-4",
        hold && "rail-hold",
      )}
      aria-label={t("nav.views")}
      onMouseLeave={() => setHold(false)}
    >
      <div className="rail-brand flex items-center gap-2 px-6">
        <span className="rail-dot size-2 rounded-full bg-primary" />
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
          <span className="rail-toggle-chevron block size-2 rotate-45 border-r-2 border-b-2 border-current" />
        </button>
      </div>

      <div className="rail-links flex flex-col">
        {NAV_ROUTES.map(({ name, labelKey }) => (
          <NavLink
            key={name}
            to={ROUTE_PATHS[name]}
            className={({ isActive }) =>
              cn(
                "rail-link flex items-center gap-2 border-l-2 border-transparent py-2 pl-6 text-sm",
                isActive && "border-primary bg-accent text-foreground",
              )
            }
          >
            <span>{t(labelKey)}</span>
            {badgeFor(name) !== undefined && (
              <span
                className={cn(
                  "rail-badge ml-auto mr-4 rounded px-1.5 text-xs",
                  name === "incidents" ? "bg-destructive/15 text-destructive" : "bg-muted text-muted-foreground",
                )}
              >
                {badgeFor(name)}
              </span>
            )}
          </NavLink>
        ))}
      </div>

      <div className="rail-foot mt-auto flex flex-col gap-1 px-6">
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
      </div>
    </nav>
  );
}
