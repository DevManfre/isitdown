import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useTrust } from "@/hooks/queries.ts";
import { formatDuration } from "@/lib/format.ts";
import type { TrustCardData } from "@/lib/types.ts";

/**
 * How closely a provider's status page tracked what a probe observed —
 * roadmap 8.1.
 *
 * Not the same claim as the uptime charts beside it. Those say how often the
 * vendor was up; this says how honest the vendor's own page was about it, which
 * is the more inflammatory number and therefore the one that has to be built
 * the most carefully.
 *
 * Three decisions are visible in the markup, and each of them is the feature:
 *
 *  - **Three axes, never one grade.** A page that always admits but ninety
 *    minutes late and one that admits instantly half the time fail differently,
 *    and a single letter would print them the same. Colour lives on an axis;
 *    there is no combined verdict to colour.
 *  - **Provenance travels with the numbers.** The window, what was excluded and
 *    why, the error bar the poll cadence imposes, and the fact that all of it
 *    was seen from one container on one network. The card is exportable, so it
 *    will be quoted at somebody — and a median with no error bar and no
 *    exclusion count reads like a measurement rather than an observation.
 *  - **Silence below the floor.** Under ten counted episodes the axes are
 *    absent, not zeroed, and the card says how far short it is instead.
 *
 * Absent entirely for a provider nothing cross-checks: without a probe pointed
 * at the real service there is no second opinion to compare the page against,
 * and an empty card would imply one exists.
 */
export function TrustCard({ providerId }: { providerId: string }) {
  const { t, i18n } = useTranslation();
  const [days, setDays] = useState(90);
  const { data } = useTrust(days);

  const cards = (data?.cards ?? []).filter((card) => card.pair.pageId === providerId);
  if (cards.length === 0) return null;

  return (
    <>
      {cards.map((card) => (
        <TrustPairCard
          key={card.key}
          card={card}
          days={days}
          windows={data?.windows ?? [30, 90, 365]}
          onWindow={setDays}
          locale={i18n.language}
          t={t}
        />
      ))}
    </>
  );
}

function TrustPairCard({
  card,
  days,
  windows,
  onWindow,
  locale,
  t,
}: {
  card: TrustCardData;
  days: number;
  windows: number[];
  onWindow: (days: number) => void;
  locale: string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  // A pair with a component is a different measurement from the same pair
  // without one, so the heading says which — never an average of the two.
  const subject =
    card.pair.componentId === ""
      ? card.pair.pageId
      : `${card.pair.pageId}#${card.pair.componentId}`;

  return (
    <section
      aria-label={t("trust.title")}
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs uppercase tracking-widest text-primary">{t("trust.title")}</span>
        <div className="flex gap-1" role="group" aria-label={t("trust.window-label")}>
          {windows.map((window) => (
            <button
              key={window}
              type="button"
              aria-pressed={window === days}
              onClick={() => onWindow(window)}
              className={`rounded px-2 py-0.5 font-mono text-xs ${
                window === days ? "bg-muted text-foreground" : "text-muted-foreground"
              }`}
            >
              {t("trust.window-days", { days: window })}
            </button>
          ))}
        </div>
      </div>

      <p className="font-mono text-xs text-muted-foreground">
        {t("trust.pair", { probe: card.pair.probeId, page: subject })}
      </p>

      {card.floor !== undefined ? (
        <div className="flex flex-col gap-1">
          <p className="text-sm">{t("trust.floor.title")}</p>
          <p className="text-xs text-muted-foreground">
            {t("trust.floor.body", { counted: card.counted, days, floor: card.floor })}
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Axis
              label={t("trust.delay.label")}
              value={
                card.delay === null || card.delay === undefined
                  ? t("trust.delay.none")
                  : t("trust.delay.value", { minutes: card.delay.medianMinutes })
              }
              detail={
                card.delay === null || card.delay === undefined
                  ? t("trust.delay.none-detail")
                  : t("trust.delay.p90", { minutes: card.delay.p90Minutes })
              }
              note={t("trust.resolution", { minutes: card.resolutionMinutes ?? 0 })}
            />
            <Axis
              label={t("trust.coverage.label")}
              value={
                card.coverage === null || card.coverage === undefined
                  ? "—"
                  : `${card.coverage.percent}%`
              }
              detail={t("trust.coverage.detail")}
              note={
                card.coverage === null || card.coverage === undefined
                  ? ""
                  : t("trust.coverage.minutes", {
                      observed: formatDuration(locale, card.coverage.observedMinutes),
                      admitted: formatDuration(locale, card.coverage.admittedMinutes),
                    })
              }
            />
            <Axis
              label={t("trust.never.label")}
              value={t("trust.never.value", { never: card.never ?? 0, counted: card.counted })}
              detail={t("trust.never.detail")}
              note={t("trust.after-recovery", { count: card.afterRecovery ?? 0 })}
            />
          </div>

          {/* Not decoration: what a card leaves out is part of what it claims. */}
          <div className="flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground">
            <span>{t("trust.window-summary", { days, counted: card.counted })}</span>
            <span>
              {t("trust.excluded", {
                count: (card.excluded?.maintenance ?? 0) + (card.excluded?.fleetBlind ?? 0),
                maintenance: card.excluded?.maintenance ?? 0,
                blind: card.excluded?.fleetBlind ?? 0,
              })}
            </span>
            <span>{t("trust.vantage")}</span>
          </div>
        </>
      )}
    </section>
  );
}

function Axis({
  label,
  value,
  detail,
  note,
}: {
  label: string;
  value: string;
  detail: string;
  note: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-mono text-2xl leading-none">{value}</span>
      <span className="text-xs text-muted-foreground">{detail}</span>
      {note === "" ? null : <span className="font-mono text-[11px] text-muted-foreground">{note}</span>}
    </div>
  );
}
