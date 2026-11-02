import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Card, CardContent } from "@/components/ui/card.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { EmptyFleet } from "@/components/EmptyFleet.tsx";
import { ProviderIcon } from "@/components/ProviderIcon.tsx";
import { ViewSkeleton } from "@/components/ViewSkeleton.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useStatus } from "@/hooks/queries.ts";
import { useCountWidth } from "@/hooks/useCountWidth.ts";
import { useViewParam } from "@/hooks/useViewParam.ts";
import { drawOrder, statusLabelKey, statusTier, type StatusTier } from "@/lib/chartConfig.ts";
import { cn } from "@/lib/utils.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/** The status chips, worst first — "all" being no chip at all. */
type Tier = "all" | Exclude<StatusTier, never>;
const TIERS: { value: Tier; labelKey: string }[] = [
  { value: "all", labelKey: "components.filter.all" },
  { value: "danger", labelKey: "components.filter.danger" },
  { value: "warn", labelKey: "components.filter.warn" },
  { value: "ok", labelKey: "components.filter.ok" },
  { value: "unknown", labelKey: "components.filter.unknown" },
];
const parseTier = (raw: string): Tier | null => (TIERS.some((tier) => tier.value === raw) ? (raw as Tier) : null);
const parseQuery = (raw: string): string | null => (raw.length <= 200 ? raw : null);

/** Typed text settles into the address after this pause, not per keystroke. */
const QUERY_PAUSE_MS = 250;

interface Row {
  providerId: string;
  providerName: string;
  baseUrl: string;
  componentId: string;
  name: string;
  status: string;
  tier: StatusTier;
}

/**
 * Every component of every provider — roadmap 4.23. Until now a component was
 * only ever seen inside its own provider, so "is anything called API down?"
 * meant opening each one in turn.
 *
 * A flat table, worst first. The text filter matches the component's name or
 * its provider's, which is also how "eu-west" is found: components carry no
 * region of their own, only the provider's name for them. The filter and the
 * status chip ride the address, so a filtered list is a link.
 */
export function Components() {
  const { t, i18n } = useTranslation();
  const { data: status } = useStatus();
  const [tier, setTier] = useViewParam<Tier>("components", "status", "all", parseTier);
  const [queryParam, setQueryParam] = useViewParam<string>("components", "q", "", parseQuery);
  // What is on screen echoes every keystroke; the address hears of it once
  // typing pauses, so history is not one entry per character.
  const [search, setSearch] = useState(queryParam);
  const pause = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // From the address only when it says something else — a link followed, Back
  // pressed — never as the echo of what was just typed, or a trailing space
  // the address trimmed off would vanish from under the cursor.
  useEffect(() => setSearch((current) => (current.trim() === queryParam ? current : queryParam)), [queryParam]);
  useEffect(() => () => clearTimeout(pause.current), []);

  const rows: Row[] = (status?.providers ?? [])
    .filter((provider) => provider.enabled)
    .flatMap((provider) =>
      provider.components.map((component) => ({
        providerId: provider.id,
        providerName: provider.name,
        baseUrl: provider.baseUrl,
        componentId: component.id,
        name: component.name,
        status: component.status,
        tier: statusTier(component.status),
      })),
    )
    .sort(
      (a, b) =>
        drawOrder(b.tier) - drawOrder(a.tier) ||
        a.providerName.localeCompare(b.providerName, i18n.language) ||
        a.name.localeCompare(b.name, i18n.language),
    );

  const needle = search.trim().toLocaleLowerCase(i18n.language);
  const matching = needle === ""
    ? rows
    : rows.filter(
        (row) =>
          row.name.toLocaleLowerCase(i18n.language).includes(needle) ||
          row.providerName.toLocaleLowerCase(i18n.language).includes(needle),
      );
  const counts = Object.fromEntries(
    TIERS.map((entry) => [entry.value, entry.value === "all" ? matching.length : matching.filter((row) => row.tier === entry.value).length]),
  ) as Record<Tier, number>;
  const shown = tier === "all" ? matching : matching.filter((row) => row.tier === tier);
  const countWidth = useCountWidth(rows.length);

  // No `/status` yet: the page's shape, never its empty state.
  if (status === undefined) return <ViewSkeleton rows={8} />;

  const configured = status.providers.length > 0;
  const tierLabel = t(TIERS.find((entry) => entry.value === tier)?.labelKey ?? "");
  const clear = () => {
    clearTimeout(pause.current);
    setSearch("");
    setQueryParam("");
    setTier("all");
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="anim-rise anim-rise-column flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-xs uppercase tracking-widest text-primary">{t("components.kicker")}</span>
          <p className="text-sm text-muted-foreground">{t("components.subtitle")}</p>
        </div>
        {rows.length > 0 && (
          <span className="font-mono text-xs text-muted-foreground">
            {t("components.total", { count: rows.length, providers: new Set(rows.map((row) => row.providerId)).size })}
          </span>
        )}
      </div>

      {!configured ? (
        <EmptyFleet />
      ) : rows.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-start gap-3">
            <h3 className="text-base font-semibold">{t("components.none.title")}</h3>
            <p className="max-w-[60ch] text-sm text-muted-foreground">{t("components.none.body")}</p>
            <Button asChild size="sm">
              <Link to={ROUTE_PATHS.providers}>{t("components.none.action")}</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="anim-rise flex flex-wrap items-center gap-3" style={{ animationDelay: "60ms" }}>
            <div className="relative w-full max-w-xs">
              <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                className="pl-8"
                aria-label={t("components.search.label")}
                placeholder={t("components.search.placeholder")}
                value={search}
                onChange={(event) => {
                  const next = event.target.value;
                  setSearch(next);
                  clearTimeout(pause.current);
                  pause.current = setTimeout(() => setQueryParam(next.trim()), QUERY_PAUSE_MS);
                }}
              />
            </div>
            <ToggleGroup
              className="max-w-full flex-wrap"
              type="single"
              aria-label={t("components.filter.label")}
              value={tier}
              onValueChange={(next) => {
                if (next !== "") setTier(next as Tier);
              }}
            >
              {TIERS.map((entry) => (
                <ToggleGroupItem key={entry.value} value={entry.value}>
                  <span className={cn(entry.value === "danger" && counts.danger > 0 && "text-destructive")}>
                    {t(entry.labelKey)}
                  </span>
                  <span
                    className="ml-1.5 inline-block text-right font-mono text-xs text-muted-foreground"
                    style={{ minWidth: countWidth }}
                  >
                    {counts[entry.value]}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {/* What a filter left, said: the chips change silently otherwise. */}
            <p role="status" className="sr-only">
              {t("components.shown", { count: shown.length })}
            </p>
          </div>

          {shown.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-start gap-3">
                <p className="text-sm text-muted-foreground">
                  {needle === ""
                    ? t("components.filtered.status", { status: tierLabel })
                    : tier === "all"
                      ? t("components.filtered.query", { query: search.trim() })
                      : t("components.filtered.both", { query: search.trim(), status: tierLabel })}
                </p>
                <Button type="button" size="sm" variant="outline" onClick={clear}>
                  {t("components.filtered.clear")}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="anim-rise gap-0 p-0" style={{ animationDelay: "120ms" }}>
              <Table aria-label={t("components.table")}>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-44">{t("components.column.status")}</TableHead>
                    <TableHead>{t("components.column.component")}</TableHead>
                    <TableHead>{t("components.column.provider")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((row) => (
                    <TableRow key={`${row.providerId}#${row.componentId}`} data-tier={row.tier}>
                      <TableCell>
                        {/* Word beside the dot: status is never colour alone. */}
                        <span className="flex items-center gap-2">
                          <StatusDot status={row.status} />
                          <span className={cn("text-sm", row.tier !== "ok" && "font-medium")}>
                            {t(statusLabelKey(row.status))}
                          </span>
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[28rem] truncate text-sm">{row.name}</TableCell>
                      <TableCell>
                        <Link
                          to={ROUTE_PATHS.providerDetail.replace(":providerId", row.providerId)}
                          className="flex items-center gap-2 text-sm hover:underline"
                        >
                          <ProviderIcon name={row.providerName} baseUrl={row.baseUrl} />
                          {row.providerName}
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
