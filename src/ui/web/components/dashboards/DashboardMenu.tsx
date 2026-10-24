import { useMatch } from "react-router";
import { useTranslation } from "react-i18next";
import { Ellipsis, House } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useDashboards } from "@/hooks/queries.ts";
import { dashboardExportHref } from "@/lib/api.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { dashboardCommand, MAX_DASHBOARDS } from "./DashboardActions.tsx";

/**
 * The dashboard the Overview is showing — roadmap 4.2: the one named in the
 * address, or home. `undefined` while the list that says which is home has
 * not answered; `default` if it failed, since that is the one a first install
 * has and the page should still draw something.
 */
export function useCurrentDashboardId(): string | undefined {
  const match = useMatch(ROUTE_PATHS.overviewDashboard);
  const { data: dashboards, isError } = useDashboards();
  const named = match?.params.dashboardId;
  if (named !== undefined) return named;
  if (isError) return "default";
  return dashboards?.find((d) => d.home)?.id;
}

/**
 * The header's half of the named dashboards: which one is open, and the ⋯ menu
 * of what can be done with it. With a single dashboard the name is left out —
 * "Overview / Overview" says nothing — but the menu stays, since it is where
 * the second one is made.
 */
export function DashboardMenu() {
  const { t } = useTranslation();
  const { data: dashboards = [] } = useDashboards();
  const id = useCurrentDashboardId();
  const current = dashboards.find((d) => d.id === id);
  if (current === undefined) return null;
  const several = dashboards.length > 1;
  const full = dashboards.length >= MAX_DASHBOARDS;

  return (
    <>
      {/* Below 768px the Overview's own picker names it; the header has no
          room for both. */}
      {several && (
        <span className="hidden min-w-0 items-center gap-2 md:flex">
          <span aria-hidden="true" className="text-muted-foreground">
            /
          </span>
          <span className="truncate text-lg font-medium">{current.name}</span>
          {current.home && (
            <span className="flex flex-none items-center gap-1 rounded-full bg-accent px-2 py-0.5 font-mono text-xs text-accent-foreground">
              <House aria-hidden="true" className="size-3" />
              {t("dashboards.home")}
            </span>
          )}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            // A full-size target that does not make the header's title row
            // taller: every view below it would move down by the difference.
            className="-my-2 flex-none"
            aria-label={t("dashboards.menu", { name: current.name })}>
            <Ellipsis aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-60">
          <DropdownMenuItem disabled={full} onSelect={() => dashboardCommand({ kind: "create", from: current.id })}>
            {t("dashboards.action.new")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={full} onSelect={() => dashboardCommand({ kind: "import" })}>
            {t("dashboards.action.import")}
          </DropdownMenuItem>
          {full && (
            <p className="px-2 pb-1.5 text-xs text-muted-foreground">{t("dashboards.full", { max: MAX_DASHBOARDS })}</p>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => dashboardCommand({ kind: "rename", id: current.id })}>
            {t("dashboards.action.rename")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={full} onSelect={() => dashboardCommand({ kind: "duplicate", id: current.id })}>
            {t("dashboards.action.duplicate")}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={current.home} onSelect={() => dashboardCommand({ kind: "home", id: current.id })}>
            <span className="flex-1">{t("dashboards.action.make-home")}</span>
            {current.home && <span className="text-xs text-muted-foreground">{t("dashboards.already-home")}</span>}
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={dashboardExportHref(current.id)} download>
              {t("dashboards.action.export")}
            </a>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            disabled={!several}
            onSelect={() => dashboardCommand({ kind: "delete", id: current.id })}
          >
            <span className="flex-1">{t("dashboards.action.delete")}</span>
            {!several && <span className="text-xs text-muted-foreground">{t("dashboards.is-last")}</span>}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}
