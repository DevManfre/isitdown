import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { ComponentPicker, type ComponentPickerEntry, type ComponentPickerSelection } from "@/components/ComponentPicker.tsx";
import { useCatalog, useConfig, useServiceMutations } from "@/hooks/queries.ts";
import { useBusyControls, useFieldProps } from "@/hooks/useBusy.tsx";
import { detectAdapter, previewComponents } from "@/lib/api.ts";
import { slugify } from "@/lib/slugify.ts";
import type { CatalogProvider, ServiceDefinition } from "@/lib/types.ts";

const ADAPTERS = [
  "statuspage",
  "instatus",
  "betterstack",
  "rss",
  "html",
  "slack",
  "aws",
  "gcp",
  "azure",
  "http",
  "custom",
] as const;

/** The stored interval as a form value; empty when the provider follows the global cadence. */
const intervalValue = (service: ServiceDefinition | undefined): string =>
  service?.intervalMinutes == null ? "" : String(service.intervalMinutes);

/**
 * What the base URL means differs per adapter — Statuspage appends a path to
 * it, the feed adapter reads it verbatim — so the hint is keyed per adapter
 * rather than built from the adapter id at render time.
 */
const ADAPTER_NOTES: Record<string, string> = {
  statuspage: "add.note.statuspage",
  instatus: "add.note.instatus",
  betterstack: "add.note.betterstack",
  rss: "add.note.rss",
  html: "add.note.html",
  slack: "add.note.slack",
  aws: "add.note.aws",
  gcp: "add.note.gcp",
  azure: "add.note.azure",
  http: "add.note.http",
  custom: "add.note.custom",
};

/**
 * The adapter that reads a page's markup instead of a machine-readable
 * endpoint. It is the one adapter whose configuration cannot be inferred from a
 * base URL — an operator has to say which element to read and, when the page
 * uses unusual wording, which words mean what — so it is also the one adapter
 * this dialog grows fields for.
 */
const SCRAPE_ADAPTER = "html";

/** Worst first, the order the reading itself resolves them in. */
const SCRAPE_SEVERITIES: { key: string; label: string; example: string }[] = [
  { key: "major_outage", label: "status.major-outage", example: "major outage, down" },
  { key: "partial_outage", label: "status.partial-outage", example: "partial outage" },
  { key: "degraded", label: "status.degraded", example: "degraded, slow" },
  { key: "operational", label: "status.operational", example: "all systems operational" },
];

/**
 * The probe (roadmap 1.8): the adapter that reads the operator's own endpoint
 * rather than a page a provider publishes. Like the scraper, its configuration
 * cannot be inferred from a URL — only the operator knows which answer counts
 * as healthy — so it is the second adapter this dialog grows fields for.
 */
const PROBE_ADAPTER = "http";

/** Only the two methods a poller may safely repeat; the adapter refuses the rest. */
const PROBE_METHODS = ["GET", "HEAD"] as const;

/** The prefix an option carrying a request header is stored under. */
const HEADER_PREFIX = "header.";

/** Drops the fields the operator left empty, so a blank never travels as a mapping. */
const usedOptions = (options: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(options).filter(([, value]) => value.trim() !== ""));

/**
 * The probe's stored header, read back into the two fields that edit it. The
 * option key carries the header's own name (`header.Authorization`), so a
 * half-typed name would otherwise keep renaming the key it is stored under.
 */
const storedHeader = (options: Record<string, string> | undefined): { name: string; value: string } => {
  const entry = Object.entries(options ?? {}).find(([key]) => key.startsWith(HEADER_PREFIX));
  return entry === undefined
    ? { name: "", value: "" }
    : { name: entry[0].slice(HEADER_PREFIX.length), value: entry[1] };
};

/**
 * Add/edit dialog for a monitored service, on shadcn's Radix `Dialog`. Port of
 * `openAddServiceDialog`/`editButton` (src/ui/public/js/views/providers.js)
 * riding modal.js's keyboard contract — Escape closes, Tab stays trapped,
 * focus returns to the trigger — which Radix already provides, proven here
 * rather than merely assumed (ServiceDialog.test.tsx).
 *
 * The `trigger` renders inside this same `Dialog`, as a real `DialogTrigger`
 * — not a button elsewhere calling into some externally-lifted open state.
 * Radix's own "return focus on close" behaviour is wired to the trigger *it*
 * renders (`context.triggerRef`, set only by an actual `DialogTrigger`), so
 * a button that merely toggles an external prop rather than sitting inside
 * this `Dialog` never gets focus back — Radix silently no-ops instead.
 *
 * `id` is never typed by hand: in add mode it is derived from the name
 * (`slugify`), in edit mode it is immutable. Either way the field is shown
 * read-only — vanilla's own edit dialog does not even offer it, but the brief
 * for this port asks that it stay visible so an operator can always see which
 * id they are adding or editing.
 */
export function ServiceDialog({
  mode, service, trigger,
}: {
  mode: "add" | "edit";
  service?: ServiceDefinition;
  trigger: ReactNode;
}) {
  const { t } = useTranslation();
  const { setDialogOpen, setEditing } = useBusyControls();
  const fieldProps = useFieldProps();
  const { add, patch, test } = useServiceMutations();

  const [open, setOpen] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [name, setName] = useState(service?.name ?? "");
  const [adapter, setAdapter] = useState<string>(ADAPTERS[0]);
  const [baseUrl, setBaseUrl] = useState(service?.baseUrl ?? "");
  const [selection, setSelection] = useState<ComponentPickerSelection[]>(service?.components ?? []);
  const [scopeToComponents, setScopeToComponents] = useState(service?.scopeToComponents ?? false);
  // Kept as the typed string, not a number: an empty field is what "follow the
  // global cadence" looks like, and 0/NaN cannot express it.
  const [intervalMinutes, setIntervalMinutes] = useState(intervalValue(service));
  // "My stack" (roadmap 2.6). A free-text slug rather than a picker: the first
  // group has to be creatable, and a select with nothing in it cannot do that.
  const [group, setGroup] = useState(service?.group ?? "");
  // Adapter-specific extras, of which the scrape adapter is so far the only
  // user. Kept as the raw record the service definition carries, rather than as
  // named fields, so an adapter that grows an option later needs no new state.
  const [options, setOptions] = useState<Record<string, string>>(service?.options ?? {});
  // The probe's single header, held apart from `options` and folded back in on
  // save: see `storedHeader`.
  const [headerName, setHeaderName] = useState(storedHeader(service?.options).name);
  const [headerValue, setHeaderValue] = useState(storedHeader(service?.options).value);
  const [preview, setPreview] = useState<
    { supported: boolean; components: ComponentPickerEntry[] } | undefined
  >(undefined);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // Only while adding, and only while the dialog is open: an edit already has
  // every answer the menu would offer.
  const { data: catalog } = useCatalog(open && mode === "add");
  const { data: config } = useConfig();
  const existingGroups = [
    ...new Set(
      (config?.services ?? [])
        .map((entry) => entry.group)
        .filter((entry): entry is string => typeof entry === "string" && entry !== ""),
    ),
  ].sort();

  // Hand-typing the id was busywork with a failure mode: the schema only
  // accepts `/^[a-z0-9][a-z0-9-]*$/`, so anything an operator typed naturally
  // ("Google Cloud") came back as a rejected write. Derive it from the name
  // instead — one field to fill, and the value is valid by construction.
  const id = mode === "add" ? slugify(name) : (service?.id ?? "");
  // The adapter is only choosable while adding; an edit shows the fields of the
  // adapter the service already has.
  const activeAdapter = mode === "add" ? adapter : (service?.adapter ?? "");
  const scraping = activeAdapter === SCRAPE_ADAPTER;
  const probing = activeAdapter === PROBE_ADAPTER;
  const setOption = (key: string, value: string): void => {
    setOptions((current) => ({ ...current, [key]: value }));
  };

  /**
   * What a probe saves: the plain fields, plus the header pair put back under
   * the key the adapter reads. A header with no name is dropped rather than
   * stored under an empty one, which the adapter rejects on the next poll.
   */
  const probeOptions = (): Record<string, string> => {
    const base = Object.fromEntries(
      Object.entries(usedOptions(options)).filter(([key]) => !key.startsWith(HEADER_PREFIX)),
    );
    const name = headerName.trim();
    return name === "" || headerValue.trim() === ""
      ? base
      : { ...base, [`${HEADER_PREFIX}${name}`]: headerValue.trim() };
  };

  /** The options block a save carries, or nothing for the adapters that take none. */
  const savedOptions = (): { options?: Record<string, string> } =>
    scraping ? { options: usedOptions(options) } : probing ? { options: probeOptions() } : {};

  // Claim-it-release-it: every close path above releases the busy state this
  // dialog claimed on open, but an unmount is not a close path — it runs no
  // click handler and fires neither `onOpenChange` nor a mutation callback.
  // An operator who opens this dialog and then navigates away via the Rail
  // without closing it first would otherwise strand `dialogOpen`/`editing`
  // `true` in the global `BusyContext` for the rest of the session, with
  // nothing on screen to say why the poll has gone stale. React always runs
  // an unmount's cleanup regardless of why the component is going away, so
  // this covers that path (and any other future one) that the four close
  // paths above cannot.
  useEffect(() => {
    return () => {
      setDialogOpen(false);
      setEditing(false);
    };
  }, [setDialogOpen, setEditing]);

  // The dialog stays mounted between opens (its own trigger lives inside it
  // now), so a fresh open needs its own reset — otherwise a cancelled edit's
  // half-typed field would still be sitting there next time.
  const resetForm = (): void => {
    setCatalogQuery("");
    setName(service?.name ?? "");
    setAdapter(ADAPTERS[0]);
    setBaseUrl(service?.baseUrl ?? "");
    setSelection(service?.components ?? []);
    setScopeToComponents(service?.scopeToComponents ?? false);
    setIntervalMinutes(intervalValue(service));
    setGroup(service?.group ?? "");
    setOptions(service?.options ?? {});
    setHeaderName(storedHeader(service?.options).name);
    setHeaderValue(storedHeader(service?.options).value);
    setPreview(undefined);
    setMessage(undefined);
    setSaving(false);
    setDetecting(false);
  };

  // Radix's own `onOpenChange` only fires from its wrapped setter — Escape,
  // outside-click, `DialogClose`/`Trigger` — never merely because the `open`
  // prop changed on a re-render. Every other close (Cancel, a successful
  // save, this dialog also closing itself after add+test) calls `setOpen`
  // directly, bypassing that setter. That split is exactly what let
  // `dialogOpen`/`editing` strand `true` forever through the paths
  // `onOpenChange` never saw. One `close()`, used by every path (including
  // `onOpenChange`'s own close branch), makes that structurally impossible
  // rather than relying on each call site to remember both flags.
  const close = (): void => {
    setOpen(false);
    setDialogOpen(false);
    setEditing(false);
  };

  const openDialog = (): void => {
    setOpen(true);
    setDialogOpen(true);
    resetForm();
  };

  const loadPreview = async (): Promise<void> => {
    setPreviewLoading(true);
    try {
      const result = await previewComponents({ adapter, baseUrl: baseUrl.trim() });
      // Keep `supported` alongside the (possibly empty) component list —
      // ComponentPicker needs both to tell "this adapter can't list
      // components at all" apart from "it can, and there are just none".
      setPreview({ supported: result.supported, components: result.components });
    } finally {
      setPreviewLoading(false);
    }
  };

  /**
   * A catalog pick fills in the three fields an operator cannot be expected to
   * know (roadmap 5.11): the adapter, the base url that adapter wants, and the
   * name the id is derived from. Nothing is saved by picking — the form is the
   * same form, filled in, so an operator can still change any of it before
   * adding.
   */
  const pick = (entry: CatalogProvider): void => {
    setName(entry.name);
    setAdapter(entry.adapter);
    setBaseUrl(entry.baseUrl);
    // The component list belongs to the adapter it was loaded for, the way a
    // detection invalidates it.
    setPreview(undefined);
    setMessage(undefined);
  };

  const catalogMatches = (catalog?.providers ?? []).filter((entry) =>
    catalogQuery.trim() === ""
      ? true
      : `${entry.name} ${entry.id}`.toLowerCase().includes(catalogQuery.trim().toLowerCase()),
  );

  /**
   * Asks the pasted url which adapter reads it, and fills in both fields from
   * the answer (roadmap 1.14). Nine adapters and nine base-url conventions are
   * only obvious to whoever wrote them; the page itself knows.
   *
   * A page nothing recognised leaves the form exactly as it was: the operator
   * was going to pick by hand anyway, and clearing their typing would be the
   * one outcome worse than not helping.
   */
  const runDetect = async (): Promise<void> => {
    setDetecting(true);
    setMessage(undefined);
    try {
      const result = await detectAdapter(baseUrl.trim());
      if (result.adapter === null || result.baseUrl === null) {
        setMessage({ text: t("add.detect-none"), tone: "error" });
        return;
      }
      setAdapter(result.adapter);
      setBaseUrl(result.baseUrl);
      // The component list belongs to the adapter that was selected when it was
      // loaded, so a detection that changes the adapter invalidates it.
      setPreview(undefined);
      setMessage({ text: t("add.detect-ok", { adapter: result.adapter }), tone: "info" });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), tone: "error" });
    } finally {
      setDetecting(false);
    }
  };

  const runConnectionTest = async (): Promise<void> => {
    if (service === undefined) return;
    const result = await test.mutateAsync(service.id);
    setMessage(
      result.ok
        ? { text: t("add.test-ok", { status: result.overallStatus }), tone: "info" }
        : { text: t("add.test-failed", { error: result.error }), tone: "error" },
    );
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setSaving(true);
    setMessage(undefined);
    try {
      if (mode === "add") {
        await add.mutateAsync({
          id, name, adapter, baseUrl, enabled: true, components: selection, scopeToComponents,
          // Omitted rather than empty: "in no group" is the field being absent,
          // and an empty string is not a slug the schema would take.
          ...(slugify(group) === "" ? {} : { group: slugify(group) }),
          // Omitted entirely for the adapters that take none: an empty record
          // would be stored as one, and `undefined` is what "this adapter has
          // no extras" looks like everywhere else.
          ...savedOptions(),
          // Omitted rather than null on an add: the schema behind the POST takes
          // the field as optional, and absent already means the global cadence.
          ...(intervalMinutes.trim() === "" ? {} : { intervalMinutes: Number(intervalMinutes) }),
        });
        const result = await test.mutateAsync(id);
        if (!result.ok) {
          // The service was added; it simply did not answer. Say so rather
          // than closing as if the whole action had failed — and, unlike
          // vanilla's near-invisible flash before an unconditional auto-close,
          // stay open so the message is actually readable.
          setMessage({ text: t("add.test-failed", { error: result.error }), tone: "error" });
          setSaving(false);
          return;
        }
      } else if (service !== undefined) {
        await patch.mutateAsync({
          id: service.id,
          patch: {
            name, baseUrl, components: selection, scopeToComponents,
            // Null, not omitted: a cleared field has to travel as an instruction
            // to forget the interval, or the row keeps the one it had.
            intervalMinutes: intervalMinutes.trim() === "" ? null : Number(intervalMinutes),
            // Same rule for the group: cleared means "out of the group", which
            // only null can say (roadmap 2.6).
            group: slugify(group) === "" ? null : slugify(group),
            ...savedOptions(),
          },
        });
      }
      close();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), tone: "error" });
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : close())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <form className="flex min-h-0 flex-1 flex-col gap-4" onSubmit={(event) => void save(event)}>
          <DialogHeader>
            <DialogTitle>{mode === "add" ? t("add.title") : name}</DialogTitle>
            {mode === "add" && <DialogDescription>{t("add.subtitle")}</DialogDescription>}
          </DialogHeader>
          <DialogBody>
            {/* The menu the first run starts from: a bundled list is the half
                of "add a provider" that detection cannot cover, since
                detection needs a url and this needs only a name. Above the
                fields rather than behind a tab, because filling them in by
                hand is the fallback now, not the default. */}
            {mode === "add" && (
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between gap-2">
                  <Label id="catalog-label">{t("catalog.label")}</Label>
                  <Input
                    id="catalog-search"
                    type="search"
                    className="h-8 w-40"
                    value={catalogQuery}
                    placeholder={t("catalog.search-placeholder")}
                    aria-label={t("catalog.search-label")}
                    onChange={(event) => setCatalogQuery(event.target.value)}
                  />
                </div>
                <div
                  role="group"
                  aria-labelledby="catalog-label"
                  className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto rounded-md border border-dashed border-border p-2"
                >
                  {catalogMatches.length === 0 ? (
                    <span className="text-xs text-muted-foreground">{t("catalog.empty")}</span>
                  ) : (
                    catalogMatches.map((entry) => (
                      <Button
                        key={entry.id}
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-7"
                        // Already watched: still listed, so the menu never
                        // looks like it forgot a provider, but adding it again
                        // would only earn a 409.
                        disabled={entry.configured}
                        onClick={() => pick(entry)}
                      >
                        {entry.name}
                      </Button>
                    ))
                  )}
                </div>
                <span className="text-xs text-muted-foreground">{t("catalog.hint")}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-name">{t("field.name")}</Label>
                <Input id="service-name" value={name} onChange={(event) => setName(event.target.value)} {...fieldProps} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-id">{t("field.id")}</Label>
                <Input id="service-id" className="font-mono" value={id} readOnly />
              </div>
            </div>

            {mode === "add" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("field.adapter")}</Label>
                {/* Ten adapters do not fit one line of a dialog: unwrapped,
                    the row ran under the dialog's own edge and the last three
                    were unreachable. Wrapped *and* spaced — a segmented bar
                    broken over two lines shows square corners where the rows
                    break, while spaced items are individually rounded chips
                    that read the same on every line. */}
                <ToggleGroup
                  type="single"
                  spacing={1}
                  className="w-full flex-wrap"
                  value={adapter}
                  onValueChange={(next) => {
                    if (next !== "") setAdapter(next);
                  }}
                >
                  {ADAPTERS.map((option) => (
                    <ToggleGroupItem key={option} value={option}>
                      {option}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="service-base-url">{t("field.base-url")}</Label>
                {/* Add mode only: an existing service already has both answers,
                    and re-detecting one would offer to overwrite them. */}
                {mode === "add" && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={detecting || baseUrl.trim() === ""}
                    onClick={() => void runDetect()}
                  >
                    {t("action.detect-adapter")}
                  </Button>
                )}
              </div>
              <Input
                id="service-base-url"
                className="font-mono"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                {...fieldProps}
              />
              {mode === "add" && <span className="font-mono text-xs text-muted-foreground">{t(ADAPTER_NOTES[adapter] ?? "add.note.custom")}</span>}
            </div>

            {scraping && (
              <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
                <p className="text-xs text-muted-foreground">{t("scrape.warning")}</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="service-selector">{t("scrape.selector")}</Label>
                  <Input
                    id="service-selector"
                    className="font-mono"
                    value={options["selector"] ?? ""}
                    onChange={(event) => setOption("selector", event.target.value)}
                    {...fieldProps}
                  />
                  <span className="text-xs text-muted-foreground">{t("scrape.selector-hint")}</span>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t("scrape.words")}</Label>
                  {SCRAPE_SEVERITIES.map((severity) => (
                    <div key={severity.key} className="grid grid-cols-[8rem_1fr] items-center gap-2">
                      <Label className="text-xs font-normal text-muted-foreground" htmlFor={`service-words-${severity.key}`}>
                        {t(severity.label)}
                      </Label>
                      <Input
                        id={`service-words-${severity.key}`}
                        className="font-mono"
                        placeholder={t("scrape.words-placeholder", { example: severity.example })}
                        value={options[severity.key] ?? ""}
                        onChange={(event) => setOption(severity.key, event.target.value)}
                        {...fieldProps}
                      />
                    </div>
                  ))}
                  <span className="text-xs text-muted-foreground">{t("scrape.words-hint")}</span>
                </div>
              </div>
            )}

            {probing && (
              <div className="flex flex-col gap-3 rounded-md border border-dashed border-border p-3">
                <p className="text-xs text-muted-foreground">{t("probe.warning")}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>{t("probe.method")}</Label>
                    <ToggleGroup
                      type="single"
                      spacing={1}
                      className="w-full"
                      value={options["method"] ?? "GET"}
                      onValueChange={(next) => {
                        if (next !== "") setOption("method", next);
                      }}
                    >
                      {PROBE_METHODS.map((option) => (
                        <ToggleGroupItem key={option} value={option}>
                          {option}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="service-probe-path">{t("probe.path")}</Label>
                    <Input
                      id="service-probe-path"
                      className="font-mono"
                      value={options["path"] ?? ""}
                      onChange={(event) => setOption("path", event.target.value)}
                      {...fieldProps}
                    />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{t("probe.path-hint")}</span>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="service-probe-status">{t("probe.expect-status")}</Label>
                  <Input
                    id="service-probe-status"
                    className="font-mono"
                    placeholder={t("probe.expect-status-placeholder")}
                    value={options["expectStatus"] ?? ""}
                    onChange={(event) => setOption("expectStatus", event.target.value)}
                    {...fieldProps}
                  />
                  <span className="text-xs text-muted-foreground">{t("probe.expect-status-hint")}</span>
                </div>

                {/* Only a GET downloads a body to match against, so the two
                    body fields are not offered against a HEAD the adapter
                    would reject the moment it polled. */}
                {(options["method"] ?? "GET") === "GET" && (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="service-probe-expect-body">{t("probe.expect-body")}</Label>
                      <Input
                        id="service-probe-expect-body"
                        className="font-mono"
                        value={options["expectBody"] ?? ""}
                        onChange={(event) => setOption("expectBody", event.target.value)}
                        {...fieldProps}
                      />
                      <span className="text-xs text-muted-foreground">{t("probe.expect-body-hint")}</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="service-probe-absent-body">{t("probe.absent-body")}</Label>
                      <Input
                        id="service-probe-absent-body"
                        className="font-mono"
                        value={options["absentBody"] ?? ""}
                        onChange={(event) => setOption("absentBody", event.target.value)}
                        {...fieldProps}
                      />
                      <span className="text-xs text-muted-foreground">{t("probe.absent-body-hint")}</span>
                    </div>
                  </>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="service-probe-slow">{t("probe.slow-ms")}</Label>
                  <Input
                    id="service-probe-slow"
                    type="number"
                    min={1}
                    value={options["slowMs"] ?? ""}
                    onChange={(event) => setOption("slowMs", event.target.value)}
                    {...fieldProps}
                  />
                  <span className="text-xs text-muted-foreground">{t("probe.slow-ms-hint")}</span>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="service-probe-tls">{t("probe.tls-warn-days")}</Label>
                  <Input
                    id="service-probe-tls"
                    type="number"
                    min={1}
                    value={options["tlsWarnDays"] ?? ""}
                    onChange={(event) => setOption("tlsWarnDays", event.target.value)}
                    {...fieldProps}
                  />
                  <span className="text-xs text-muted-foreground">{t("probe.tls-warn-days-hint")}</span>
                </div>

                <div className="flex items-center gap-2">
                  {/* Stored only when switched off: following is the default,
                      and an option repeating the default is noise in the
                      exported config file. */}
                  <Switch
                    id="service-probe-redirects"
                    checked={(options["followRedirects"] ?? "yes") !== "no"}
                    onCheckedChange={(next) => setOption("followRedirects", next ? "" : "no")}
                  />
                  <Label htmlFor="service-probe-redirects">{t("probe.follow-redirects")}</Label>
                </div>

                <div className="grid grid-cols-[1fr_1fr] gap-2">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="service-probe-header-name">{t("probe.header-name")}</Label>
                    <Input
                      id="service-probe-header-name"
                      className="font-mono"
                      value={headerName}
                      onChange={(event) => setHeaderName(event.target.value)}
                      {...fieldProps}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="service-probe-header-value">{t("probe.header-value")}</Label>
                    <Input
                      id="service-probe-header-value"
                      className="font-mono"
                      placeholder={t("probe.header-value-placeholder")}
                      value={headerValue}
                      onChange={(event) => setHeaderValue(event.target.value)}
                      {...fieldProps}
                    />
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">{t("probe.header-hint")}</span>
              </div>
            )}

            {/* Roadmap 2.6. Typed, not picked: the first group has to be
                creatable, and a select with nothing in it cannot create one.
                Slugified on the way out, the way the id is, so "Deploy path"
                is a legal group rather than a rejected write. */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-group">{t("field.group")}</Label>
              <Input
                id="service-group"
                list="service-group-options"
                placeholder={t("field.group-placeholder")}
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                {...fieldProps}
              />
              {/* The groups that already exist, offered rather than imposed:
                  an operator adding the fifth provider to a stack should not
                  have to remember how they spelled it. */}
              <datalist id="service-group-options">
                {existingGroups.map((option) => (
                  <option key={option} value={option} />
                ))}
              </datalist>
              <span className="text-xs text-muted-foreground">{t("field.group-hint")}</span>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="service-interval">{t("field.provider-interval")}</Label>
              <Input
                id="service-interval"
                type="number"
                min={1}
                max={1440}
                placeholder={t("field.provider-interval-placeholder")}
                value={intervalMinutes}
                onChange={(event) => setIntervalMinutes(event.target.value)}
                {...fieldProps}
              />
              <span className="text-xs text-muted-foreground">{t("field.provider-interval-hint")}</span>
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t("components.field")}</Label>
                <Button type="button" variant="ghost" size="sm" disabled={previewLoading} onClick={() => void loadPreview()}>
                  {t("components.load")}
                </Button>
              </div>
              {preview !== undefined && (
                <ComponentPicker
                  available={preview.components}
                  supported={preview.supported}
                  value={selection}
                  onChange={setSelection}
                  loading={previewLoading}
                  scopeToComponents={scopeToComponents}
                  onScopeChange={setScopeToComponents}
                />
              )}
            </div>

            {mode === "edit" && (
              <div className="flex items-center gap-2">
                <Button type="button" variant="ghost" size="sm" disabled={test.isPending} onClick={() => void runConnectionTest()}>
                  {t("action.test-connection")}
                </Button>
              </div>
            )}

            {message !== undefined && (
              <p className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                {message.text}
              </p>
            )}
          </DialogBody>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={close}>
              {t("action.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {mode === "add" ? t("action.add") : t("action.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
