import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { CircleCheck, NotebookPen, X } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Textarea } from "@/components/ui/textarea.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ConfirmDialog } from "@/components/ConfirmDialog.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import { useQuery } from "@tanstack/react-query";
import { useIncidentNotes } from "@/hooks/queries.ts";
import * as api from "@/lib/api.ts";
import { useNow } from "@/hooks/useNow.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { formatDuration, formatList, formatTime } from "@/lib/format.ts";
import { incidentStatusKey } from "@/lib/incidents.ts";
import type { Incident, ProviderStatus } from "@/lib/types.ts";
import { ROUTE_PATHS } from "../../routePaths.ts";

/** How long the "resolved" strip stays once the outage is over. */
export const RESOLVED_STRIP_MS = 10 * 60_000;
/** How many updates and annotations the band carries; the incident page has the rest. */
const UPDATES_SHOWN = 3;
const ANNOTATIONS_SHOWN = 2;

const DISMISSED_KEY = "isitdown.incident-mode.dismissed";
const LAST_KEY = "isitdown.incident-mode.last";

/** What the strip needs once the incident itself is gone from `/status`. */
interface Ended {
  providerId: string;
  providerName: string;
  incidentId: string | null;
  name: string;
  startedAt: string;
  /** When this browser saw it end; set once, on the first render without it. */
  endedAt?: string;
}

// localStorage is a per-browser convenience here, never state anything else
// depends on: a blocked or cleared one only means the band reappears, or the
// "resolved" strip does not.
function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* see `read` */
  }
}

/**
 * The providers that put the Overview into incident mode: a major outage the
 * operator has not silenced and the provider has not announced as planned
 * work. A muted provider was muted so that it would stop asking for
 * attention, and a declared maintenance window is not an incident.
 */
export function incidentProviders(providers: readonly ProviderStatus[]): ProviderStatus[] {
  return providers.filter(
    (provider) =>
      provider.enabled &&
      provider.overallStatus === "major_outage" &&
      provider.mutedUntil == null &&
      (provider.maintenance?.active.length ?? 0) === 0,
  );
}

/*
 * The band's own reads, on the same cache keys as `useIncident` and
 * `useAnnotations` (so a note added here refreshes the incident page, and the
 * other way round) but never thrown to the view's error boundary: the band is
 * an addition to the Overview, and one of its reads failing must not take the
 * operator's whole dashboard down with it. A failed read simply leaves its
 * part of the band out.
 */
const useBandIncident = (providerId: string, incidentId: string) =>
  useQuery({
    queryKey: ["incident", providerId, incidentId],
    queryFn: () => api.getIncident(providerId, incidentId),
    throwOnError: false,
  });
const useBandAnnotations = () =>
  useQuery({
    // The shortest window `/annotations` takes is a week; the band wants the day.
    queryKey: ["annotations", 7, null],
    queryFn: () => api.getAnnotations({ days: 7 }),
    throwOnError: false,
  });

const keyOf = (provider: ProviderStatus, incident: Incident | undefined) => `${provider.id}/${incident?.id ?? ""}`;

/**
 * Incident mode — roadmap 4.22, direction B of its prototype: a band above
 * the operator's own dashboard rather than a takeover of it, so a layout
 * arranged with care (4.1) is still there, one scroll down, while the band
 * says what is wrong, what changed last, and offers a note.
 *
 * "Back to normal view" hides it for this incident only: the next major
 * outage brings it back. When the outage ends, a one-line strip says how long
 * it lasted for ten minutes, or until dismissed.
 */
export function IncidentBand({ providers }: { providers: readonly ProviderStatus[] }) {
  const [dismissed, setDismissed] = useState<string | null>(() => read<string>(DISMISSED_KEY));
  const [ended, setEnded] = useState<Ended | null>(() => read<Ended>(LAST_KEY));
  const now = useNow();

  const major = incidentProviders(providers);
  const primary = major[0];
  const incident = primary?.activeIncidents[0];
  const key = primary === undefined ? null : keyOf(primary, incident);

  // While the band is up, remember what it is about; once it is gone, stamp
  // when this browser noticed — the strip's clock starts there.
  useEffect(() => {
    if (primary !== undefined) {
      const current = read<Ended>(LAST_KEY);
      if (current?.providerId === primary.id && current.incidentId === (incident?.id ?? null) && current.endedAt === undefined) return;
      const next: Ended = {
        providerId: primary.id,
        providerName: primary.name,
        incidentId: incident?.id ?? null,
        name: incident?.name ?? "",
        startedAt: current?.providerId === primary.id && current.endedAt === undefined ? current.startedAt : new Date().toISOString(),
      };
      write(LAST_KEY, next);
      setEnded(null);
      return;
    }
    const last = read<Ended>(LAST_KEY);
    if (last !== null && last.endedAt === undefined) {
      const stamped = { ...last, endedAt: new Date().toISOString() };
      write(LAST_KEY, stamped);
      setEnded(stamped);
    }
  }, [primary, incident?.id, incident?.name]);

  if (primary !== undefined && key !== dismissed) {
    return (
      <ActiveBand
        primary={primary}
        incident={incident}
        others={major.slice(1)}
        alsoHit={providers.filter(
          (provider) => provider.enabled && provider.id !== primary.id && provider.overallStatus !== "operational" && provider.overallStatus !== "unknown" && !major.includes(provider),
        )}
        onDismiss={() => {
          write(DISMISSED_KEY, key);
          setDismissed(key);
        }}
      />
    );
  }
  if (primary === undefined && ended?.endedAt !== undefined && now - Date.parse(ended.endedAt) < RESOLVED_STRIP_MS) {
    return (
      <ResolvedStrip
        ended={ended}
        onDismiss={() => {
          write(LAST_KEY, null);
          setEnded(null);
        }}
      />
    );
  }
  return null;
}

function ActiveBand({
  primary,
  incident,
  others,
  alsoHit,
  onDismiss,
}: {
  primary: ProviderStatus;
  incident: Incident | undefined;
  others: ProviderStatus[];
  alsoHit: ProviderStatus[];
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const title = incident?.name ?? t("incident-mode.no-incident", { provider: primary.name });
  const href = incident === undefined ? ROUTE_PATHS.providerDetail.replace(":providerId", primary.id) : `/incidents/${primary.id}/${incident.id}`;

  return (
    // Announced by the shell's `StatusAnnouncer` (4.20), which names the
    // provider whose status moved; this is the landmark to jump to after it.
    <section
      aria-labelledby="incident-band-title"
      data-testid="incident-band"
      className="anim-rise mt-6 flex flex-col gap-4 rounded-xl border border-[var(--status-major-outage)]/40 bg-[var(--status-major-outage)]/[0.07] p-4 md:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-[1_1_24rem] flex-col gap-1.5">
          <span className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-[var(--status-major-outage)]">
            <StatusDot status="major_outage" pulse />
            {incident === undefined ? (
              t("incident-mode.kicker", { provider: primary.name })
            ) : (
              <OpenFor provider={primary} incidentId={incident.id} />
            )}
          </span>
          <h2 id="incident-band-title" className="text-lg font-semibold text-balance">
            {title}
          </h2>
          {alsoHit.length > 0 && (
            <p className="text-sm text-muted-foreground">
              {t("incident-mode.also-hitting", {
                providers: formatList(
                  i18n.language,
                  alsoHit.map((provider) => t("incident-mode.provider-status", { provider: provider.name, status: t(statusLabelKey(provider.overallStatus)) })),
                ),
              })}
            </p>
          )}
          {others.map((other) => (
            <p key={other.id} className="text-sm">
              <Link className="text-primary hover:underline" to={other.activeIncidents[0] === undefined ? ROUTE_PATHS.providerDetail.replace(":providerId", other.id) : `/incidents/${other.id}/${other.activeIncidents[0].id}`}>
                {t("incident-mode.also-open", { provider: other.name, title: other.activeIncidents[0]?.name ?? t(statusLabelKey(other.overallStatus)) })}
              </Link>
            </p>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm">
            <Link to={href}>{t("incident-mode.open")}</Link>
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
            <X aria-hidden="true" />
            {t("incident-mode.dismiss")}
          </Button>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {incident !== undefined && <Updates providerId={primary.id} incidentId={incident.id} href={href} />}
        <RecentAnnotations providerIds={[primary.id, ...alsoHit.map((provider) => provider.id)]} />
      </div>
    </section>
  );
}

/**
 * "Major outage · Cloudflare · open 47 min", from the incident's own start —
 * and that start handed to the strip, so "lasted" is not measured from
 * whenever this browser happened to open the page.
 */
function OpenFor({ provider, incidentId }: { provider: ProviderStatus; incidentId: string }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { data: detail } = useBandIncident(provider.id, incidentId);
  const startedAt = detail?.incident.startedAt;
  useEffect(() => {
    const last = read<Ended>(LAST_KEY);
    if (startedAt === undefined || last === null || last.incidentId !== incidentId || last.startedAt === startedAt) return;
    write(LAST_KEY, { ...last, startedAt });
  }, [startedAt, incidentId]);
  if (startedAt === undefined) return <>{t("incident-mode.kicker", { provider: provider.name })}</>;
  return (
    <>
      {t("incident-mode.kicker-open", {
        provider: provider.name,
        duration: formatDuration(i18n.language, Math.max(0, (now - Date.parse(startedAt)) / 60_000)),
      })}
    </>
  );
}

/** The incident's last few moves, newest first, with the note field under them. */
function Updates({ providerId, incidentId, href }: { providerId: string; incidentId: string; href: string }) {
  const { t, i18n } = useTranslation();
  const { data: detail, isError, refetch } = useBandIncident(providerId, incidentId);
  const notes = useIncidentNotes(providerId, incidentId);
  const [writing, setWriting] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  /** A typed note is asked about before it is thrown away; an empty one just closes. */
  const cancel = () => {
    if (draft.trim() === "") setWriting(false);
    else setConfirmDiscard(true);
  };
  const entries = [
    ...(detail?.timeline ?? []).map((entry) => ({
      at: entry.at,
      text:
        entry.status === undefined
          ? t(`incident.timeline.${entry.label}`)
          : `${t(`incident.timeline.${entry.label}`)} · ${t(incidentStatusKey(entry.status))}`,
    })),
    ...(detail?.notes ?? []).map((note) => ({ at: note.createdAt, text: t("incident-mode.note", { body: note.body }) })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const save = () => {
    const body = draft.trim();
    if (body === "") return;
    notes.add.mutate(body, {
      onSuccess: () => {
        setDraft("");
        setWriting(false);
      },
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{t("incident-mode.updates")}</h3>
      {isError ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {t("incident-mode.updates-failed")}
          <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={() => void refetch()}>
            {t("action.retry")}
          </Button>
        </p>
      ) : detail === undefined ? (
        // Shaped like the rows it stands for, so the band does not jump.
        <div role="status" aria-busy="true" aria-label={t("view.loading")} className="flex flex-col gap-1">
          {Array.from({ length: UPDATES_SHOWN }, (_, index) => (
            <Skeleton key={index} className="h-5 w-full max-w-md" />
          ))}
        </div>
      ) : (
        <ol className="flex flex-col gap-1">
          {entries.slice(0, UPDATES_SHOWN).map((entry) => (
            <li key={`${entry.at}-${entry.text}`} className="grid grid-cols-[4.75rem_1fr] items-baseline gap-2 text-sm">
              <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatTime(i18n.language, entry.at)}</span>
              <span className="min-w-0 truncate">{entry.text}</span>
            </li>
          ))}
        </ol>
      )}
      {entries.length > UPDATES_SHOWN && (
        <Link to={href} className="text-sm text-primary hover:underline">
          {t("incident-mode.all-updates", { count: entries.length })}
        </Link>
      )}
      {writing ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            autoFocus
            value={draft}
            maxLength={2000}
            rows={2}
            aria-label={t("incident.notes.add")}
            placeholder={t("incident.notes.placeholder")}
            className="text-sm"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") cancel();
            }}
          />
          <div className="flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={cancel}>
              {t("action.cancel")}
            </Button>
            <Button type="button" size="sm" disabled={draft.trim() === "" || notes.add.isPending} onClick={save}>
              {t("incident.notes.add")}
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" size="sm" variant="outline" className="self-start" onClick={() => setWriting(true)}>
          <NotebookPen aria-hidden="true" />
          {t("incident-mode.add-note")}
        </Button>
      )}
      {writing && notes.add.isError && (
        <p role="alert" className="text-sm text-[var(--status-major-outage)]">
          {t("incident-mode.note-failed")}
        </p>
      )}
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t("incident-mode.discard.title")}
        description={t("incident-mode.discard.body")}
        confirmLabel={t("incident-mode.discard.confirm")}
        onConfirm={() => {
          setDraft("");
          setWriting(false);
        }}
      />
    </div>
  );
}

/** The fleet's own markers from the last day — a deploy is the usual suspect. */
function RecentAnnotations({ providerIds }: { providerIds: string[] }) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const { data } = useBandAnnotations();
  const recent = (data?.annotations ?? [])
    .filter((annotation) => now - Date.parse(annotation.at) < 86_400_000)
    .filter((annotation) => annotation.providerId === null || providerIds.includes(annotation.providerId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, ANNOTATIONS_SHOWN);
  if (recent.length === 0) return null;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">{t("incident-mode.annotations")}</h3>
      <ul className="flex flex-col gap-1">
        {recent.map((annotation) => (
          <li key={annotation.id} className="grid grid-cols-[4.75rem_1fr] items-baseline gap-2 text-sm">
            <span className="font-mono text-xs whitespace-nowrap text-muted-foreground">{formatTime(i18n.language, annotation.at)}</span>
            <span className="min-w-0 truncate">{annotation.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ResolvedStrip({ ended, onDismiss }: { ended: Ended; onDismiss: () => void }) {
  const { t, i18n } = useTranslation();
  const lasted = Math.max(0, (Date.parse(ended.endedAt ?? ended.startedAt) - Date.parse(ended.startedAt)) / 60_000);
  return (
    // No live region of its own: the shell's `StatusAnnouncer` (4.20) already
    // says the provider recovered, and a second region would say it twice.
    <section
      aria-label={t("incident-mode.resolved-label")}
      data-testid="incident-resolved"
      className="anim-fade mt-6 flex flex-wrap items-center gap-3 rounded-xl border border-[var(--status-operational)]/40 bg-[var(--status-operational)]/[0.07] px-4 py-3"
    >
      <CircleCheck aria-hidden="true" className="size-4 text-[var(--status-operational)]" />
      <span className="min-w-0 flex-1 text-sm">
        {t("incident-mode.resolved", {
          duration: formatDuration(i18n.language, lasted),
          title: ended.name === "" ? ended.providerName : ended.name,
        })}
      </span>
      {ended.incidentId !== null && (
        <Link to={`/incidents/${ended.providerId}/${ended.incidentId}`} className="text-sm text-primary hover:underline">
          {t("incident-mode.post-mortem")}
        </Link>
      )}
      <Button type="button" size="icon-sm" variant="ghost" aria-label={t("incident-mode.resolved-dismiss")} onClick={onDismiss}>
        <X aria-hidden="true" />
      </Button>
    </section>
  );
}
