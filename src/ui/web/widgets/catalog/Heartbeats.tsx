import { useEffect, useRef } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useConfigChrome, useHeartbeats } from "@/hooks/queries.ts";
import { useNow } from "@/hooks/useNow.ts";
import { formatDuration, formatRelative } from "@/lib/format.ts";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";
import { HEARTBEAT_ADAPTER_ID, heartbeatConfig } from "../../../../core/heartbeat.ts";
import { ROUTE_PATHS } from "../../../routePaths.ts";
import { MINUTE } from "./shared.ts";
import { LoadFailed, WidgetCard } from "./WidgetCard.tsx";

/** How often the elapsed bars are re-read; between reads each bar creeps there linearly (motion.css). */
const TICK_MS = 30_000;

type State = "ok" | "late" | "missed";
const COLOR: Record<State, string> = {
  ok: "var(--status-operational)",
  late: "var(--status-degraded)",
  missed: "var(--status-major-outage)",
};
const DOT: Record<State, string> = { ok: "operational", late: "degraded", missed: "major_outage" };
const RANK: Record<State, number> = { missed: 0, late: 1, ok: 2 };

/**
 * Every dead-man's switch and how close it is to going off. The bar is the
 * time since the job last called, against its period; the dashed tick is where
 * the grace runs out. Between polls the bar keeps moving, because the clock
 * does — a job that has gone quiet is watched creeping towards its deadline.
 */
export function Heartbeats() {
  const { t, i18n } = useTranslation();
  const now = useNow(TICK_MS);
  const { data, isError, refetch } = useHeartbeats();
  const { data: config, isError: configFailed, refetch: refetchConfig } = useConfigChrome();
  const title = t("dashboard.widget.heartbeats.title");
  /** Each job's elapsed time at the last render, to tell a clock running on from a ping that reset it. */
  const previous = useRef(new Map<string, number>());
  const latest = useRef(new Map<string, number>());
  useEffect(() => {
    previous.current = latest.current;
  });
  if (isError || configFailed) {
    return <LoadFailed title={title} retry={() => void (isError ? refetch() : refetchConfig())} />;
  }
  if (data === undefined || config === undefined) return <WidgetCard title={title} busy />;

  const services = config.services.filter((s) => s.adapter === HEARTBEAT_ADAPTER_ID && s.enabled);
  if (services.length === 0) {
    return (
      <WidgetCard title={title}>
        <p className="text-sm text-muted-foreground">{t("widget.heartbeats.none")}</p>
        <Link to={ROUTE_PATHS.settings} className="text-sm text-primary hover:underline">
          {t("widget.heartbeats.add")}
        </Link>
      </WidgetCard>
    );
  }

  const records = new Map(data.heartbeats.map((h) => [h.providerId, h]));
  const jobs = services
    .map((service) => {
      let every = 0;
      let grace = 0;
      try {
        const parsed = heartbeatConfig(service.options);
        every = parsed.everySeconds * 1000;
        grace = parsed.graceSeconds * 1000;
      } catch {
        // A misconfigured heartbeat is the Providers view's to explain; here it simply has no clock.
      }
      const last = records.get(service.id)?.lastPingAt ?? null;
      const since = last === null ? null : now - Date.parse(last);
      const state: State = since === null || every === 0 ? "missed" : since > every + grace ? "missed" : since > every ? "late" : "ok";
      return { id: service.id, name: service.name, every, grace, last, since, state };
    })
    .sort((a, b) => RANK[a.state] - RANK[b.state] || a.name.localeCompare(b.name));

  latest.current = new Map(jobs.flatMap((j) => (j.since === null ? [] : [[j.id, j.since] as const])));
  // A clock running on creeps linearly to its next reading; a ping that just
  // reset it drops straight back, or the bar would spend thirty seconds
  // draining while its own label already says "on time".
  const creeping = (j: (typeof jobs)[number]) => {
    const before = previous.current.get(j.id);
    return j.since !== null && (before === undefined || j.since >= before);
  };
  const fine = jobs.filter((j) => j.state === "ok").length;
  const worst = jobs[0]!;
  const duration = (ms: number) => formatDuration(i18n.language, ms / MINUTE);
  const word = (j: (typeof jobs)[number]) =>
    j.state === "ok"
      ? t("widget.heartbeats.ok")
      : j.state === "late"
        ? t("widget.heartbeats.late", { time: duration(j.since! - j.every) })
        : j.last === null
          ? t("widget.heartbeats.never")
          : t("widget.heartbeats.missed", { time: duration(j.since!) });
  const conclusion =
    worst.state === "ok"
      ? t("widget.heartbeats.all-ok", { count: jobs.length })
      : worst.state === "late"
        ? t("widget.heartbeats.conclusion-late", { job: worst.name, late: duration(worst.since! - worst.every), left: duration(worst.every + worst.grace - worst.since!) })
        : t("widget.heartbeats.conclusion-missed", { job: worst.name, time: worst.last === null ? t("widget.heartbeats.never") : duration(worst.since!) });
  const tone = worst.state === "missed" ? "alarm" : worst.state === "late" ? "warn" : undefined;
  const meta = t("widget.heartbeats.meta", { count: jobs.length, fine });

  return (
    <WidgetCard title={title} meta={meta} conclusion={conclusion} tone={tone} className="@container">
      <div className="flex items-baseline gap-2.5 @md:hidden">
        <span className="font-mono text-3xl">{fine}/{jobs.length}</span>
        <span className="font-mono text-xs text-muted-foreground">{t("widget.heartbeats.on-time")}</span>
      </div>

      <ul className="hidden flex-col @md:flex">
        {jobs.map((job, index) => {
          // The bar runs to the end of the grace, so the deadline tick sits on it.
          const window = job.every + job.grace;
          const share = job.since === null || window === 0 ? 1 : job.since / window;
          return (
            <li
              key={job.id}
              className="anim-rise anim-rise-row grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 border-t border-border py-2.5 @2xl:grid-cols-[11rem_7rem_minmax(0,1fr)_8rem_9rem]"
              style={{ animationDelay: stagger(index, { base: 120, step: 45 }) }}
            >
              <span className="flex min-w-0 items-center gap-2">
                <StatusDot status={DOT[job.state]} pulse={job.state !== "ok"} />
                <span className="truncate font-mono text-sm">{job.name}</span>
              </span>
              <span className="text-right font-mono text-xs @2xl:hidden" style={{ color: job.state === "ok" ? undefined : COLOR[job.state] }}>
                {word(job)}
              </span>
              <span className="hidden font-mono text-xs text-muted-foreground @2xl:block">
                {job.every === 0 ? "—" : t("widget.heartbeats.every", { every: duration(job.every), grace: duration(job.grace) })}
              </span>
              <div
                className="relative col-span-2 h-2 overflow-hidden rounded-full bg-muted @2xl:col-span-1"
                aria-hidden="true"
              >
                <span
                  data-live={creeping(job) || undefined}
                  className="widget-fill anim-fill absolute inset-0 origin-left rounded-full"
                  style={{
                    transform: `scaleX(${Math.min(1, share)})`,
                    background: COLOR[job.state],
                    animationDelay: stagger(index, { base: 220, step: 60 }),
                  }}
                />
                {job.every > 0 && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 border-l border-dashed border-foreground/50"
                    style={{ left: `${(job.every / window) * 100}%` }}
                  />
                )}
              </div>
              <span className="hidden font-mono text-xs text-muted-foreground @2xl:block">
                {job.last === null ? t("widget.heartbeats.never") : formatRelative(i18n.language, job.last)}
              </span>
              <span
                className={cn("widget-tone hidden text-right font-mono text-[0.68rem] tracking-wider uppercase @2xl:block")}
                style={{ color: COLOR[job.state] }}
              >
                {word(job)}
              </span>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}
