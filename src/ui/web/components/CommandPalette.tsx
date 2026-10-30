import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { generatePath, useNavigate } from "react-router";
import {
  Activity,
  BellOff,
  BellRing,
  Blocks,
  FileText,
  Flag,
  LayoutGrid,
  MessageSquarePlus,
  MonitorCog,
  Plus,
  RefreshCw,
  Send,
  Server,
  Stethoscope,
  StickyNote,
  TriangleAlert,
  Tv,
  Upload,
  History,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command.tsx";
import { NAV_ROUTES, ROUTE_PATHS } from "../../routePaths.ts";
import {
  useAnnotationEdits,
  useConfigChrome,
  useDashboards,
  usePollNow,
  useServiceMutations,
  useStatusChrome,
} from "@/hooks/queries.ts";
import { AdapterDebugDialog } from "@/components/settings/AdapterDebugDialog.tsx";
import * as api from "@/lib/api.ts";
import { useSearch } from "@/hooks/queries.ts";
import { isMuted } from "@/lib/mute.ts";
import type { ServiceDefinition } from "@/lib/types.ts";
import { dashboardCommand, dashboardPath, MAX_DASHBOARDS } from "@/components/dashboards/DashboardActions.tsx";
import { useTheme } from "@/hooks/useTheme.tsx";

/**
 * The command palette — roadmap 5.4. ⌘K, or Ctrl+K.
 *
 * The console shell was already built for it: the rail has the views, the
 * header has the poll button and the theme toggle, and the fleet is a list of
 * providers with names. This puts all three behind one keystroke rather than
 * inventing a fourth place to look.
 *
 * Mounted in `App`, beside `Rail` and `Header` rather than inside a view: the
 * shortcut has to work on every screen, and a palette that unmounted with the
 * view would take its own listener with it.
 *
 * A provider opens the History view's drawer, which is where a provider's
 * detail lives today — passed as route state rather than as a url, because
 * there is no per-provider route yet (roadmap 5.6 is where that goes). The
 * effect is what a click on that row does, reached from the keyboard.
 */
/** What the header's search button dispatches to open the palette. */
export const PALETTE_EVENT = "isitdown:open-palette";

/** Opens the palette from anywhere in the shell. */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(PALETTE_EVENT));
}

/** The durations the Mute action offers — the same four the Settings menu does. */
const MUTE_DURATIONS: { minutes: number; labelKey: string }[] = [
  { minutes: 30, labelKey: "mute.for-30" },
  { minutes: 120, labelKey: "mute.for-120" },
  { minutes: 480, labelKey: "mute.for-480" },
  { minutes: 1440, labelKey: "mute.for-1440" },
];

/**
 * Roadmap 4.7. An action that needs a target asks for it on a second page of
 * the same palette, so the keyboard path is "action, provider, Enter" and
 * Backspace on an empty input steps back.
 */
type Page =
  | { kind: "root" }
  | { kind: "provider"; action: "mute" | "diagnose" }
  | { kind: "duration"; providerId: string }
  | { kind: "annotate" }
  | { kind: "channel" };

const ROOT: Page = { kind: "root" };

/** How long typing pauses before the text search asks the server. */
const SEARCH_DEBOUNCE_MS = 200;
/** Component names are matched here, so they are capped here: one provider can carry hundreds. */
const COMPONENT_HITS = 8;

interface Notice {
  text: string;
  tone: "ok" | "error";
}

const failure = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const poll = usePollNow();
  const { cycle } = useTheme();
  // Chrome-safe, like everything else mounted in the shell: a throw here would
  // escape the view's error boundary and take the console down with it. With no
  // data the palette still opens, with its views and its two actions.
  const { data: status } = useStatusChrome();
  const { data: config } = useConfigChrome();
  const { patch } = useServiceMutations();
  const { add: addAnnotation } = useAnnotationEdits();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<Page>(ROOT);
  const [search, setSearch] = useState("");
  // Where an action's answer goes: the palette is not a Settings page, so there
  // is no toast stack to land in, and a closed palette would swallow it.
  const [notice, setNotice] = useState<Notice | null>(null);
  const [diagnosing, setDiagnosing] = useState<ServiceDefinition | null>(null);

  // Roadmap 4.15. Only the top page searches text: the others are pickers for a
  // target, where what is typed narrows a list rather than asking a question.
  const [asked, setAsked] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAsked(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);
  const term = page.kind === "root" ? asked : "";
  const { data: found } = useSearch(term);

  const goTo = (next: Page): void => {
    setPage(next);
    setSearch("");
    setNotice(null);
  };

  // A palette reopened later starts from the top, not from a half-done action.
  useEffect(() => {
    if (!open) goTo(ROOT);
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "k" || !(event.metaKey || event.ctrlKey)) return;
      // The browser's own ⌘K (the address bar's search, on some) would
      // otherwise take the keystroke before this ever sees it.
      event.preventDefault();
      setOpen((current) => !current);
    };
    window.addEventListener("keydown", onKeyDown);
    // The header carries a search affordance that says "⌘K" on it, and a
    // keystroke nobody can discover is a keystroke most operators never use.
    // The button asks for the palette through an event rather than through a
    // lifted state: the palette is a sibling of the header in `App`, and
    // hoisting `open` into the shell would put a re-render of the whole console
    // behind every keystroke typed into the palette's own input.
    const onRequest = (): void => setOpen(true);
    window.addEventListener(PALETTE_EVENT, onRequest);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(PALETTE_EVENT, onRequest);
    };
  }, []);

  /** Every item closes the palette first: the action it runs changes the screen. */
  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  const providers = (status?.providers ?? []).filter((provider) => provider.enabled);
  const componentHits =
    term.length < 2
      ? []
      : providers
          .flatMap((provider) =>
            (provider.components ?? [])
              .filter((component) => component.name.toLowerCase().includes(term.toLowerCase()))
              .map((component) => ({ provider, component })),
          )
          .slice(0, COMPONENT_HITS);
  const { data: dashboards = [] } = useDashboards();
  const channels = (config?.channels ?? []).filter((channel) => channel.enabled);
  const channelName = (id: string): string => t(`channel.name.${id}`, { defaultValue: id });

  /** An answer the operator reads in place: the palette stays open on the top page. */
  const answer = (next: Notice): void => {
    setPage(ROOT);
    setSearch("");
    setNotice(next);
  };

  const setMute = (providerId: string, minutes: number | null): void => {
    const name = providers.find((provider) => provider.id === providerId)?.name ?? providerId;
    patch.mutate(
      {
        id: providerId,
        patch: {
          mutedUntil: minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString(),
        },
      },
      {
        onSuccess: () =>
          answer({ text: t(minutes === null ? "toast.service.unmuted" : "toast.service.muted", { name }), tone: "ok" }),
        onError: (error) => answer({ text: t("toast.failed", { error: failure(error) }), tone: "error" }),
      },
    );
  };

  const jumpToLastIncident = (): void => {
    api.getIncidents({ pageSize: 1 }).then(
      ({ page: { items } }) => {
        const latest = items[0];
        if (latest === undefined) {
          answer({ text: t("palette.no-incident"), tone: "error" });
          return;
        }
        setOpen(false);
        void navigate(generatePath(ROUTE_PATHS.incidentDetail, {
            providerId: latest.providerId,
            incidentId: latest.incidentId,
          }));
      },
      (error: unknown) => answer({ text: t("toast.failed", { error: failure(error) }), tone: "error" }),
    );
  };

  const addMarker = (label: string): void => {
    addAnnotation.mutate(
      { at: new Date().toISOString(), label, colour: "accent" },
      {
        onSuccess: () => answer({ text: t("palette.marker-added"), tone: "ok" }),
        onError: (error) => answer({ text: t("toast.failed", { error: failure(error) }), tone: "error" }),
      },
    );
  };

  const sendTest = (channelId: string): void => {
    api.testChannel(channelId).then(
      (result) =>
        answer(
          result.ok
            ? { text: t("channel.test-ok"), tone: "ok" }
            : { text: t("channel.test-failed", { error: result.error ?? "" }), tone: "error" },
        ),
      (error: unknown) => answer({ text: t("channel.test-failed", { error: failure(error) }), tone: "error" }),
    );
  };

  const diagnose = (providerId: string): void => {
    const service = config?.services.find((entry) => entry.id === providerId);
    if (service === undefined) return;
    setOpen(false);
    setDiagnosing(service);
  };

  const placeholders: Record<Page["kind"], string> = {
    root: "palette.placeholder",
    provider: "palette.pick-provider",
    duration: "palette.pick-duration",
    annotate: "palette.annotate-placeholder",
    channel: "palette.pick-channel",
  };

  return (
    <>
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={t("palette.title")}
      description={t("palette.description")}
    >
      <CommandInput
        placeholder={t(placeholders[page.kind])}
        value={search}
        onValueChange={setSearch}
        onKeyDown={(event) => {
          // Backspace on an empty input is "back", as it is in every
          // two-step picker; anywhere else it is just a Backspace.
          if (event.key === "Backspace" && search === "" && page.kind !== "root") {
            event.preventDefault();
            goTo(ROOT);
          }
        }}
      />
      <CommandList>
        <CommandEmpty>{t("palette.empty")}</CommandEmpty>

        {page.kind === "provider" && (
          <CommandGroup heading={t("palette.providers")}>
            {providers.map((provider) => {
              const muted = page.action === "mute" && isMuted(provider.mutedUntil);
              return (
                <CommandItem
                  key={provider.id}
                  value={`${provider.name} ${provider.id}`}
                  onSelect={() => {
                    if (page.action === "diagnose") diagnose(provider.id);
                    else if (muted) setMute(provider.id, null);
                    else goTo({ kind: "duration", providerId: provider.id });
                  }}
                >
                  {muted ? <BellRing aria-hidden="true" /> : <Server aria-hidden="true" />}
                  {muted ? t("palette.unmute-provider", { name: provider.name }) : provider.name}
                </CommandItem>
              );
            })}
          </CommandGroup>
        )}

        {page.kind === "duration" && (
          <CommandGroup heading={t("palette.mute-for")}>
            {MUTE_DURATIONS.map(({ minutes, labelKey }) => (
              <CommandItem key={minutes} value={t(labelKey)} onSelect={() => setMute(page.providerId, minutes)}>
                <BellOff aria-hidden="true" />
                {t(labelKey)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {page.kind === "channel" && (
          <CommandGroup heading={t("palette.channels")}>
            {channels.map((channel) => (
              <CommandItem key={channel.id} value={`${channelName(channel.id)} ${channel.id}`} onSelect={() => sendTest(channel.id)}>
                <Send aria-hidden="true" />
                {channelName(channel.id)}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {page.kind === "annotate" && search.trim() !== "" && (
          <CommandGroup>
            {/* The input is the marker's text, so cmdk's own filter must not hide
                the one item that submits it. */}
            <CommandItem forceMount value={search} onSelect={() => addMarker(search.trim())}>
              <MessageSquarePlus aria-hidden="true" />
              {t("palette.annotate-submit", { label: search.trim() })}
            </CommandItem>
          </CommandGroup>
        )}

        {page.kind === "root" && (<>
        {/* Roadmap 4.15. `forceMount` on the items and on their groups: cmdk would
            otherwise filter these by its own fuzzy score over the label, and
            hide a group none of whose items pass — but they already matched on
            the server, or for components above, by what the operator typed. A
            group is only here once it has something, so a bare heading never
            shows. */}
        {term.length >= 2 && (found?.incidents.length ?? 0) > 0 && (
          <CommandGroup forceMount heading={t("palette.incidents")}>
            {found?.incidents.map((incident) => (
              <CommandItem
                key={`${incident.providerId}/${incident.incidentId}`}
                forceMount
                value={`incident ${incident.providerId} ${incident.incidentId} ${incident.name}`}
                onSelect={run(() =>
                  void navigate(generatePath(ROUTE_PATHS.incidentDetail, {
                    providerId: incident.providerId,
                    incidentId: incident.incidentId,
                  })),
                )}
              >
                <TriangleAlert aria-hidden="true" />
                {incident.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {term.length >= 2 && (found?.notes.length ?? 0) > 0 && (
          <CommandGroup forceMount heading={t("palette.notes")}>
            {found?.notes.map((note) => (
              <CommandItem
                key={note.id}
                forceMount
                value={`note ${note.id} ${note.body}`}
                onSelect={run(() =>
                  void navigate(generatePath(ROUTE_PATHS.incidentDetail, {
                    providerId: note.providerId,
                    incidentId: note.incidentId,
                  })),
                )}
              >
                <StickyNote aria-hidden="true" />
                <span className="truncate">{note.body}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {term.length >= 2 && (found?.annotations.length ?? 0) > 0 && (
          <CommandGroup forceMount heading={t("palette.annotations")}>
            {found?.annotations.map((annotation) => (
              <CommandItem
                key={annotation.id}
                forceMount
                value={`annotation ${annotation.id} ${annotation.label}`}
                onSelect={run(() => void navigate(ROUTE_PATHS.history))}
              >
                <Flag aria-hidden="true" />
                {annotation.label}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {componentHits.length > 0 && (
          <CommandGroup forceMount heading={t("palette.components")}>
            {componentHits.map(({ provider, component }) => (
              <CommandItem
                key={`${provider.id}/${component.id}`}
                forceMount
                value={`component ${provider.id} ${component.id} ${component.name}`}
                onSelect={run(() =>
                  void navigate(ROUTE_PATHS.history, { state: { openProvider: provider.id } }),
                )}
              >
                <Blocks aria-hidden="true" />
                {component.name}
                <span className="ml-auto text-xs text-muted-foreground">{provider.name}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        <CommandGroup heading={t("palette.views")}>
          {NAV_ROUTES.map((route) => (
            <CommandItem
              key={route.name}
              value={t(route.labelKey)}
              onSelect={run(() => void navigate(ROUTE_PATHS[route.name]))}
            >
              <Activity aria-hidden="true" />
              {t(route.labelKey)}
            </CommandItem>
          ))}
        </CommandGroup>

        {/* Roadmap 4.2. Only once there is a choice to make. */}
        {dashboards.length > 1 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("palette.dashboards")}>
              {dashboards.map((dashboard) => (
                <CommandItem
                  key={dashboard.id}
                  value={`${t("dashboards.switcher")} ${dashboard.name} ${dashboard.id}`}
                  onSelect={run(() => void navigate(dashboardPath(dashboard.id)))}
                >
                  <LayoutGrid aria-hidden="true" />
                  {dashboard.home ? t("dashboards.home-suffix", { name: dashboard.name }) : dashboard.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        {providers.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading={t("palette.providers")}>
              {providers.map((provider) => (
                <CommandItem
                  key={provider.id}
                  // Searchable by the name an operator reads and by the id they
                  // configured, since either is what comes to mind first.
                  value={`${provider.name} ${provider.id}`}
                  onSelect={run(() =>
                    void navigate(ROUTE_PATHS.history, { state: { openProvider: provider.id } }),
                  )}
                >
                  <Server aria-hidden="true" />
                  {provider.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading={t("palette.actions")}>
          <CommandItem
            value={t("action.poll-now")}
            disabled={poll.isPending}
            onSelect={run(() => poll.mutate())}
          >
            <RefreshCw aria-hidden="true" />
            {t("action.poll-now")}
          </CommandItem>
          {/* Roadmap 4.1: straight into the Overview's edit mode. */}
          <CommandItem
            value={t("palette.customise-overview")}
            onSelect={run(() => void navigate({ pathname: ROUTE_PATHS.overview, search: "?edit=1" }))}
          >
            <LayoutGrid aria-hidden="true" />
            {t("palette.customise-overview")}
          </CommandItem>
          <CommandItem
            value={t("dashboards.new")}
            disabled={dashboards.length >= MAX_DASHBOARDS}
            onSelect={run(() => dashboardCommand({ kind: "create" }))}
          >
            <Plus aria-hidden="true" />
            {t("dashboards.new")}
          </CommandItem>
          <CommandItem
            value={t("palette.import-dashboard")}
            disabled={dashboards.length >= MAX_DASHBOARDS}
            onSelect={run(() => dashboardCommand({ kind: "import" }))}
          >
            <Upload aria-hidden="true" />
            {t("palette.import-dashboard")}
          </CommandItem>
          <CommandItem value={t("palette.cycle-theme")} onSelect={run(() => cycle())}>
            <MonitorCog aria-hidden="true" />
            {t("palette.cycle-theme")}
          </CommandItem>
          {/* Roadmap 5.8. An action rather than a rail entry: the wallboard is
              somewhere you send a screen, not somewhere you navigate between
              tasks, and a sixth rail item would say otherwise every day. */}
          <CommandItem
            value={t("palette.wallboard")}
            onSelect={run(() => void navigate(ROUTE_PATHS.wallboard))}
          >
            <Tv aria-hidden="true" />
            {t("palette.wallboard")}
          </CommandItem>
          {/* Roadmap 4.7. Each is one step from the keyboard; the four that
              need a target ask for it on the next page. */}
          <CommandItem value={t("palette.mute")} onSelect={() => goTo({ kind: "provider", action: "mute" })}>
            <BellOff aria-hidden="true" />
            {t("palette.mute")}
          </CommandItem>
          <CommandItem value={t("palette.diagnose")} onSelect={() => goTo({ kind: "provider", action: "diagnose" })}>
            <Stethoscope aria-hidden="true" />
            {t("palette.diagnose")}
          </CommandItem>
          <CommandItem value={t("palette.last-incident")} onSelect={jumpToLastIncident}>
            <History aria-hidden="true" />
            {t("palette.last-incident")}
          </CommandItem>
          <CommandItem value={t("palette.annotate")} onSelect={() => goTo({ kind: "annotate" })}>
            <MessageSquarePlus aria-hidden="true" />
            {t("palette.annotate")}
          </CommandItem>
          <CommandItem
            value={t("palette.send-test")}
            disabled={channels.length === 0}
            onSelect={() => goTo({ kind: "channel" })}
          >
            <Send aria-hidden="true" />
            {t("palette.send-test")}
          </CommandItem>
          {/* No `month=`: the server's default is the current one, and a month
              still running is reported as far as today. */}
          <CommandItem
            value={t("palette.export-month")}
            onSelect={run(() => window.location.assign("/export/monthly.md"))}
          >
            <FileText aria-hidden="true" />
            {t("palette.export-month")}
          </CommandItem>
        </CommandGroup>
        </>)}
      </CommandList>
      {notice !== null && (
        <p
          role="status"
          className={`border-t px-3 py-2 text-xs ${notice.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
        >
          {notice.text}
        </p>
      )}
    </CommandDialog>
    {diagnosing !== null && (
      <AdapterDebugDialog
        service={diagnosing}
        open
        onOpenChange={(next) => {
          if (!next) setDiagnosing(null);
        }}
      />
    )}
    </>
  );
}
