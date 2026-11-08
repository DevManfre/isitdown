import { useState } from "react";
import { useViewParam } from "@/hooks/useViewParam.ts";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Card } from "@/components/ui/card.tsx";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { useCountWidth } from "@/hooks/useCountWidth.ts";
import { ProviderIcon } from "@/components/ProviderIcon.tsx";
import { ReplayPanel } from "@/components/ReplayPanel.tsx";
import { NumberTicker } from "@/components/ui/number-ticker.tsx";
import { StatTiles } from "@/components/StatTiles.tsx";
import { useConfig, useDeliveryLog, useStatus } from "@/hooks/queries.ts";
import { formatDateTime, notificationHeadline } from "@/lib/format.ts";
import { pageWindow } from "@/lib/incidents.ts";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";
import type { DeliveryState, SentRecord } from "@/lib/types.ts";

/** Rows per page. The server caps anything larger. */
const PAGE_SIZE = 25;

/**
 * Failed leads, deliberately: the log's job is to answer "is my alerting
 * working" before it answers "what was sent".
 */
const STATES = [
  { value: "failed", labelKey: "delivery.state.failed" },
  { value: "sent", labelKey: "delivery.state.sent" },
  { value: "all", labelKey: "delivery.state.all" },
] as const;

/** Every channel a send could have gone to, plus the unfiltered option. */
const ALL_CHANNELS = "";
/** "Every channel" as the select's own value (Radix refuses an empty one). */
const ANY_CHANNEL = "*";

const rowKey = (record: SentRecord, index: number): string =>
  `${record.providerId}-${record.channel}-${record.sentAt}-${index}`;

/**
 * A failed send that was retried is a dead letter: the attempts were spent and
 * the alert is gone. It gets its own word on the badge, because "failed" reads
 * like something that might still arrive.
 *
 * A missing count is a row written before retries existed (roadmap 3.14), so it
 * is never treated as one attempt or as many — it simply says nothing extra.
 */
const isDeadLetter = (record: SentRecord): boolean => !record.ok && (record.attempts ?? 1) > 1;

/**
 * The delivery log (roadmap 3.17), built on the `design/` prototype of the same
 * name.
 *
 * The `notifications` table has recorded every send since day one and nothing
 * had ever shown two of its columns: `ok` and `error`. The Incidents view's
 * feed panel shows the first line of the text and nothing else, so a bot token
 * that went stale was invisible until somebody noticed they had stopped being
 * paged. That is what this view is for, which is why the failure count is the
 * first thing on it and why a row expands in place to the payload and the
 * provider's own error string, verbatim — anything behind a hover fails the
 * operator reading this at 3am on a phone.
 *
 * The filter and the pager are server-side, like the incident list's: a page
 * filtered in the browser would filter that page and report the result as the
 * whole log.
 */
export function DeliveryLog() {
  const { t, i18n } = useTranslation();
  // Roadmap 4.3: a delivery count on the Overview arrives with its state in the
  // address. Failures stay the default — they are what this view is for.
  // Roadmap 4.16: carried by the address and remembered, with the same
  // precedence as everywhere else — the address, then what was left, then the
  // failures this view is for.
  const [state, setState] = useViewParam<DeliveryState>("delivery-log", "state", "failed", (raw) =>
    raw === "all" || raw === "sent" || raw === "failed" ? raw : null,
  );
  const [channel, setChannel] = useState<string>(ALL_CHANNELS);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data } = useDeliveryLog({ state, channel, page, pageSize: PAGE_SIZE });
  const { data: status } = useStatus();
  const { data: config } = useConfig();

  const nameOf = (providerId: string): string =>
    status?.providers.find((provider) => provider.id === providerId)?.name ?? providerId;
  const baseUrlOf = (providerId: string): string =>
    status?.providers.find((provider) => provider.id === providerId)?.baseUrl ?? "";

  const rows = data?.page.items ?? [];
  const counts = data?.counts ?? { all: 0, sent: 0, failed: 0 };
  const total = data?.page.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // The channels the installation knows about, not the ones this page happens
  // to carry: a channel whose every send failed off this page must still be
  // selectable.
  const channels = (config?.channels ?? []).map((entry) => entry.id);

  // Share of attempts that landed. Zero sends is not 0% delivered — nothing
  // has been tried — so it reads as a dash rather than as a failure.
  const deliveredShare =
    counts.all === 0
      ? "—"
      : `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format((counts.sent / counts.all) * 100)}%`;

  const countWidth = useCountWidth(counts.all);

  const pick = (next: DeliveryState): void => {
    setState(next);
    setPage(1);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* No eyebrow or subtitle (dashboard-design-direction): the header names
          the view, and the first tile already counts every send. */}
      {/* The three counts the state filter already carries, read as figures
          rather than as numbers beside a pill: the filter says which rows are
          on screen, these say whether the alerting works at all. The delivered
          share is the one figure neither the filter nor a row can state — a log
          full of green rows and a log with four dead letters in it look the
          same from a page of rows. */}
      <StatTiles
        className="anim-rise"
        stats={[
          {
            id: "recorded",
            label: t("delivery.stat.recorded"),
            value: <NumberTicker locale={i18n.language} value={counts.all} />,
            note: t("delivery.stat.recorded-note"),
          },
          {
            id: "sent",
            label: t("delivery.state.sent"),
            value: <NumberTicker locale={i18n.language} value={counts.sent} />,
            note: t("delivery.stat.delivered-share", { share: deliveredShare }),
            accent: "var(--status-operational)",
          },
          {
            id: "failed",
            label: t("delivery.state.failed"),
            value: <NumberTicker locale={i18n.language} value={counts.failed} />,
            note: t("delivery.stat.failed-note"),
            accent: "var(--status-major-outage)",
          },
          {
            id: "channels",
            label: t("nav.channels"),
            value: <NumberTicker locale={i18n.language} value={channels.length} />,
            note: t("delivery.stat.channels-note"),
            accent: "var(--color-accent)",
          },
        ]}
      />

      <div className="anim-rise flex flex-wrap items-center gap-3">
        <ToggleGroup className="max-w-full flex-wrap" type="single" aria-label={t("delivery.filter.state")} value={state} onValueChange={(next) => {
          if (next !== "") pick(next as DeliveryState);
        }}>
          {STATES.map((entry) => (
            <ToggleGroupItem key={entry.value} value={entry.value}>
              <span className={cn(entry.value === "failed" && counts.failed > 0 && "text-destructive")}>
                {t(entry.labelKey)}
              </span>
              {/* Held to the widest tally, for the reason the Incidents chips
                  are: picking a channel re-counts all three, and a digit
                  arriving moved the chips beside it. */}
              <span
                className="ml-1.5 inline-block text-right font-mono text-xs text-muted-foreground"
                style={{ minWidth: countWidth }}
              >
                {counts[entry.value]}
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        {channels.length > 0 && (
          /* A select, not a row of chips (dashboard-design-direction: a
             segmented filter stops at five). Thirty-one channels as chips took
             three lines of the page before a single send was on it. */
          <Select
            // Radix reads "" as "nothing chosen" and would show a blank
            // trigger, so "every channel" is "*" here and "" on the wire.
            value={channel === ALL_CHANNELS ? ANY_CHANNEL : channel}
            onValueChange={(next) => {
              setChannel(next === ANY_CHANNEL ? ALL_CHANNELS : next);
              setPage(1);
            }}
          >
            <SelectTrigger aria-label={t("delivery.filter.channel")} className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ANY_CHANNEL}>{t("delivery.channel.all")}</SelectItem>
              {channels.map((entry) => (
                <SelectItem key={entry} value={entry}>
                  <span className="font-mono">{entry}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* `gap-0` is not cosmetic: the stock Card ships `gap-6`, and `p-0` alone
          left 24px of card background showing between rows — a striped list
          whose row tint stopped short of the divider under it. The rows carry
          their own `border-t`, so they need no gap at all. */}
      <Card
        role="region"
        aria-label={t("delivery.rows")}
        className="anim-rise flex flex-col gap-0 overflow-hidden p-0 shadow-none"
        style={{ animationDelay: "30ms" }}
      >
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted-foreground">
            {t(state === "failed" ? "delivery.empty-failed" : "delivery.empty")}
          </p>
        ) : (
          rows.map((record, index) => {
            const key = rowKey(record, index);
            const open = expanded === key;
            return (
              <div key={key} className="flex flex-col border-t border-border first:border-t-0">
                <button
                  type="button"
                  // Wraps below `md`: the two fixed columns plus the timestamp
                  // are already wider than a 358px screen, so the headline —
                  // the only part that can take a line of its own — does.
                  className="delivery-row anim-rise anim-rise-row flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1.5 px-5 py-3 text-left lg:flex-nowrap"
                  style={{ animationDelay: stagger(index) }}
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : key)}
                >
                  <ProviderIcon
                    name={nameOf(record.providerId)}
                    baseUrl={baseUrlOf(record.providerId)}
                    className="translate-y-0.5"
                  />
                  <span className="w-28 shrink-0 truncate text-sm font-medium">{nameOf(record.providerId)}</span>
                  <span className="w-20 shrink-0 truncate font-mono text-xs text-muted-foreground">
                    {record.channel}
                  </span>
                  <span className="order-last min-w-0 basis-full truncate text-sm lg:order-none lg:flex-1 lg:basis-auto">
                    {notificationHeadline(record.text)}
                  </span>
                  <Badge variant={record.ok ? "muted" : "destructive"}>
                    {t(
                      record.ok
                        ? "delivery.result.sent"
                        : isDeadLetter(record)
                          ? "delivery.result.dead"
                          : "delivery.result.failed",
                    )}
                  </Badge>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground lg:ml-0">
                    {formatDateTime(i18n.language, record.sentAt)}
                  </span>
                </button>

                {open && (
                  <div className="anim-fade flex flex-col gap-2 px-5 pb-4 pl-14">
                    {/* The payload as delivered, not a summary of it: this is the
                        text the channel actually carried. */}
                    <pre className="whitespace-pre-wrap rounded-md bg-muted/40 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                      {record.text}
                    </pre>
                    {/* What the retries cost, in the order an operator asks it:
                        how many tries, then what the channel said each time. */}
                    {(record.attempts ?? 1) > 1 && (
                      <span className="font-mono text-xs text-muted-foreground">
                        {t(record.ok ? "delivery.attempts.recovered" : "delivery.attempts.dead", {
                          attempts: record.attempts,
                        })}
                      </span>
                    )}
                    {record.error !== undefined && (
                      <span className="font-mono text-xs text-destructive">{record.error}</span>
                    )}
                    {/* Roadmap 5.12: why this one was sent. Behind the row's own
                        disclosure, so the log stays one line per alert. */}
                    <ReplayPanel notificationId={record.id} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </Card>

      {pages > 1 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-mono text-xs text-muted-foreground">{t("delivery.showing", { count: total })}</span>
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  disabled={page === 1}
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                />
              </PaginationItem>
              {pageWindow(page, pages).map((slot, index) => (
                <PaginationItem key={slot === "gap" ? `gap-${index}` : slot}>
                  {slot === "gap" ? (
                    <PaginationEllipsis />
                  ) : (
                    <PaginationLink isActive={slot === page} onClick={() => setPage(slot)}>
                      {slot}
                    </PaginationLink>
                  )}
                </PaginationItem>
              ))}
              <PaginationItem>
                <PaginationNext
                  disabled={page === pages}
                  onClick={() => setPage((current) => Math.min(pages, current + 1))}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
      )}
    </div>
  );
}
