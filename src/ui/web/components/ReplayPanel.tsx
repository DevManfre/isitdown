import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { useNotificationReplay } from "@/hooks/queries.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { formatDateTime } from "@/lib/format.ts";
import type { NotificationReplay, OverallStatus, ReplayStep } from "@/lib/types.ts";

/**
 * Why did I get this alert? — roadmap 5.12. Lives in a delivery log row's
 * expanded area, one click from the message it explains, and asks nothing until
 * it is clicked: the log is read far more often than any one row is questioned.
 *
 * It says what it cannot tell. The replay runs on today's settings, so it
 * announces that (`replay.with-today`), says so when those settings would not
 * have sent the alert at all, and says when the readings behind it have been
 * trimmed — three different "I don't know"s, none of which is a made-up path.
 */
export function ReplayPanel({ notificationId }: { notificationId: number | undefined }) {
  const { t } = useTranslation();
  const [asked, setAsked] = useState(false);
  const replay = useNotificationReplay(notificationId, asked);

  // A row from before the log carried ids has nothing to ask by.
  if (notificationId === undefined) return null;

  return (
    <div className="flex flex-col gap-2">
      {!asked && (
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setAsked(true)}>
          {t("replay.action")}
        </Button>
      )}
      {asked && replay.isPending && <p className="text-sm text-muted-foreground">{t("replay.loading")}</p>}
      {asked && replay.isError && (
        <div className="flex flex-wrap items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {t("replay.error", { error: replay.error instanceof Error ? replay.error.message : String(replay.error) })}
          </p>
          <Button type="button" variant="outline" size="sm" onClick={() => void replay.refetch()}>
            {t("replay.action")}
          </Button>
        </div>
      )}
      {asked && replay.data !== undefined && <ReplayResult replay={replay.data} />}
    </div>
  );
}

function ReplayResult({ replay }: { replay: NotificationReplay }) {
  const { t, i18n } = useTranslation();
  const status = (value: OverallStatus | null | undefined): string => (value === null || value === undefined ? "" : t(statusLabelKey(value)));
  const when = (iso: string): string => formatDateTime(i18n.language, iso);

  const line = (step: ReplayStep): string[] => {
    const d = step.detail;
    switch (step.step) {
      case "diff":
        return [
          t("replay.step.diff", {
            when: replay.trigger === null ? "" : when(replay.trigger.fetchedAt),
            from: status(d["from"] as OverallStatus | null),
            to: status(d["to"] as OverallStatus),
          }),
        ];
      case "damping": {
        const held = (d["held"] as string[]).map(when);
        return step.outcome === "off"
          ? [t("replay.step.damping-off")]
          : [
              t("replay.step.damping-confirmed", { required: d["required"] as number }),
              ...(held.length === 0 ? [] : [t("replay.step.damping-held", { held: held.join(", ") })]),
            ];
      }
      case "routing": {
        if (step.outcome === "no-rule") return [t("replay.step.routing-none")];
        const rule = d["rule"] as { provider: string; minSeverity: string; channels: string[] };
        const channels = rule.channels.includes("*")
          ? t("replay.channels.all")
          : rule.channels.length === 0
            ? t("replay.channels.none")
            : rule.channels.join(", ");
        return [
          t("replay.step.routing-rule", {
            number: (d["winner"] as number) + 1,
            target: rule.provider === "*" ? t("replay.target.any") : rule.provider,
            channels,
          }),
          t("replay.step.routing-floor", {
            severity: status(d["severity"] as OverallStatus),
            floor: rule.minSeverity === "any" ? t("status.unknown") : status(rule.minSeverity as OverallStatus),
          }),
        ];
      }
      case "channel":
        return [t(step.outcome === "included" ? "replay.step.channel-included" : "replay.step.channel-not-included", { channel: d["channel"] as string })];
      case "quiet-hours": {
        const window = { start: d["start"] as string, end: d["end"] as string, zone: d["timeZone"] as string, floor: status(d["minSeverity"] as OverallStatus) };
        const key =
          step.outcome === "off"
            ? "replay.step.quiet-off"
            : step.outcome === "suppressed"
              ? "replay.step.quiet-suppressed"
              : step.outcome === "passed-floor"
                ? "replay.step.quiet-passed"
                : "replay.step.quiet-outside";
        return [t(key, window)];
      }
      case "cap":
        return [
          t(step.outcome === "off" ? "replay.step.cap-off" : step.outcome === "at-limit" ? "replay.step.cap-at-limit" : "replay.step.cap-under", {
            count: d["alertsInPreviousHour"] as number,
            max: d["maxPerHour"] as number,
          }),
        ];
    }
  };

  const note = !replay.replayable
    ? "replay.not-replayable"
    : !replay.available
      ? "replay.unavailable"
      : !replay.reproduced
        ? "replay.not-reproduced"
        : null;

  return (
    <section aria-label={t("replay.title")} className="flex flex-col gap-2 rounded-md bg-muted/40 px-3 py-3">
      <span className="text-sm font-medium">{t("replay.title")}</span>
      {note !== null ? (
        <p className="text-sm text-muted-foreground">{t(note)}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("replay.with-today")}</p>
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm marker:text-muted-foreground">
            {replay.path.map((step) => (
              <li key={step.step}>
                {line(step).map((text, index) => (
                  <span key={text} className={index === 0 ? undefined : "block text-muted-foreground"}>
                    {text}
                  </span>
                ))}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
