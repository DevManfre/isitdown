import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { StepPanel, Stepper } from "@/components/ui/stepper.tsx";
import { ComponentPicker, type ComponentPickerEntry, type ComponentPickerSelection } from "@/components/ComponentPicker.tsx";
import {
  AdapterOptions, DNS_ADAPTER, hasAdapterOptions, PROBE_ADAPTER, SCRAPE_ADAPTER, TCP_ADAPTER,
} from "@/components/service-dialog/AdapterOptions.tsx";
import { DEFAULT_ADAPTER, SourceStep, type ServiceSource } from "@/components/service-dialog/SourceStep.tsx";
import { ServiceIdentity } from "@/components/service-dialog/ServiceIdentity.tsx";
import { useSettingsToastReport } from "@/components/settings/SettingsToasts.tsx";
import { useCatalog, useConfig, useServiceMutations } from "@/hooks/queries.ts";
import { useBusyControls, useFieldProps } from "@/hooks/useBusy.tsx";
import { detectAdapter, previewComponents } from "@/lib/api.ts";
import { slugify } from "@/lib/slugify.ts";
import type { CatalogProvider, ServiceDefinition } from "@/lib/types.ts";

/** The stored interval as a form value; empty when the provider follows the global cadence. */
const intervalValue = (service: ServiceDefinition | undefined): string =>
  service?.intervalMinutes == null ? "" : String(service.intervalMinutes);

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
  return entry === undefined ? { name: "", value: "" } : { name: entry[0].slice(HEADER_PREFIX.length), value: entry[1] };
};

/**
 * Add/edit dialog for a monitored service, on shadcn's Radix `Dialog`. Port of
 * `openAddServiceDialog`/`editButton` (src/ui/public/js/views/providers.js)
 * riding modal.js's keyboard contract — Escape closes, Tab stays trapped,
 * focus returns to the trigger — which Radix already provides, proven here
 * rather than merely assumed (ServiceDialog.test.tsx).
 *
 * `trigger` renders inside this same `Dialog`, as a real `DialogTrigger` —
 * not as a button elsewhere calling into an externally-lifted open state.
 * Radix's own "return focus on close" behaviour is wired to the trigger *it*
 * renders (`context.triggerRef`, set only by an actual `DialogTrigger`), so a
 * button that merely toggles an external prop rather than sitting inside this
 * `Dialog` never gets focus back — Radix silently no-ops instead.
 *
 * **Add is two steps; edit is one.** They were one form for both, and the form
 * asked everything at once: a chip row of catalog names, name, id, sixteen
 * adapter ids, base URL, then whatever that adapter needed, all at the same
 * volume in one scroll. But adding is one decision (where does the status come
 * from?) followed by paperwork that the decision mostly fills in — so step one
 * asks only that, and step two is the paperwork with the answer carried in at
 * the top. Editing is neither of those: the service exists, its adapter is
 * fixed, and what is left is tuning, so it stays the single page it was.
 *
 * `id` is never typed by hand: in add mode it is derived from the name
 * (`slugify`), in edit mode it is immutable. Either way the field is shown
 * read-only — vanilla's own edit dialog does not even offer it, but the brief
 * for the port asks that it stay visible so an operator can always see the id
 * they are adding or editing.
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
  const toast = useSettingsToastReport();

  const [open, setOpen] = useState(false);
  // Which half of an add is on screen, and which way it last travelled — the
  // direction is what tells the entry animation whether to arrive from the
  // right (going on) or from the left (going back).
  const [step, setStep] = useState<1 | 2>(1);
  const [stepBack, setStepBack] = useState(false);
  const [source, setSource] = useState<ServiceSource>("catalog");
  const [picked, setPicked] = useState<string | undefined>(undefined);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [name, setName] = useState(service?.name ?? "");
  const [adapter, setAdapter] = useState<string>(DEFAULT_ADAPTER);
  const [baseUrl, setBaseUrl] = useState(service?.baseUrl ?? "");
  const [selection, setSelection] = useState<ComponentPickerSelection[]>(service?.components ?? []);
  const [scopeToComponents, setScopeToComponents] = useState(service?.scopeToComponents ?? false);
  // Kept as the typed string, not a number: an empty field is what "follow the
  // global cadence" looks like, and 0/NaN cannot express it.
  const [intervalMinutes, setIntervalMinutes] = useState(intervalValue(service));
  // "My stack" (roadmap 2.6). A free-text slug rather than a picker: the first
  // group has to be creatable, and a select with nothing in it cannot do that.
  const [group, setGroup] = useState(service?.group ?? "");
  // Roadmap 4.13. A string rather than a number, like the interval above: a
  // half-typed "99." is a state the input has to be allowed to be in.
  const [slaTarget, setSlaTarget] = useState(service?.slaTarget == null ? "" : String(service.slaTarget));
  // Adapter-specific extras, of which the scrape adapter is so far the only
  // user. Kept as the raw record the service definition carries, rather than as
  // named fields, so an adapter that grows an option later needs no new state.
  const [options, setOptions] = useState<Record<string, string>>(service?.options ?? {});
  // The probe's single header, held apart from `options` and folded back in on
  // save: see `storedHeader`.
  const [header, setHeader] = useState(storedHeader(service?.options));
  const [advanced, setAdvanced] = useState(false);
  const [preview, setPreview] = useState<
    { supported: boolean; components: ComponentPickerEntry[] } | undefined
  >(undefined);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  // Only while adding, and only while the dialog is open: an edit already has
  // every answer the catalog would offer.
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
  const probing = activeAdapter === PROBE_ADAPTER;
  const scraping = activeAdapter === SCRAPE_ADAPTER;
  const tcpProbing = activeAdapter === TCP_ADAPTER;
  const dnsProbing = activeAdapter === DNS_ADAPTER;
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
    const headerName = header.name.trim();
    return headerName === "" || header.value.trim() === ""
      ? base
      : { ...base, [`${HEADER_PREFIX}${headerName}`]: header.value.trim() };
  };

  /** The options block a save carries, or nothing for the adapters that take none. */
  const savedOptions = (): { options?: Record<string, string> } =>
    probing
      ? { options: probeOptions() }
      : scraping || tcpProbing || dnsProbing
        ? { options: usedOptions(options) }
        : {};

  // Claim-it-release-it: every close path below releases the busy state this
  // dialog claimed on open, but an unmount is not a close path — it runs no
  // click handler and fires neither `onOpenChange` nor a mutation callback.
  // An operator who opens this dialog and then navigates away via the Rail
  // without closing it first would otherwise strand `dialogOpen`/`editing`
  // `true` in the global `BusyContext` for the rest of the session, with
  // nothing on screen to say why the poll has gone stale. React always runs
  // an unmount's cleanup regardless of why the component is going away, so
  // this covers that path (and any other future one) that the close paths
  // below cannot.
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
    setStep(1);
    setStepBack(false);
    setSource("catalog");
    setPicked(undefined);
    setAdvanced(false);
    setCatalogQuery("");
    setName(service?.name ?? "");
    setAdapter(DEFAULT_ADAPTER);
    setBaseUrl(service?.baseUrl ?? "");
    setSelection(service?.components ?? []);
    setScopeToComponents(service?.scopeToComponents ?? false);
    setIntervalMinutes(intervalValue(service));
    setGroup(service?.group ?? "");
    setSlaTarget(service?.slaTarget == null ? "" : String(service.slaTarget));
    setOptions(service?.options ?? {});
    setHeader(storedHeader(service?.options));
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
      const result = await previewComponents({ adapter: activeAdapter, baseUrl: baseUrl.trim() });
      // Keep `supported` alongside the (possibly empty) component list —
      // ComponentPicker needs both to tell "this adapter can't list
      // components at all" apart from "it can, and there are just none".
      setPreview({ supported: result.supported, components: result.components });
    } catch (error) {
      // Reaching step two is not a request the operator made, so a failed
      // preload says so where every other failure in this dialog says it,
      // and leaves the button below to retry rather than blocking the save.
      setMessage({ text: error instanceof Error ? error.message : String(error), tone: "error" });
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
    setPicked(entry.id);
    setName(entry.name);
    setAdapter(entry.adapter);
    setBaseUrl(entry.baseUrl);
    // The component list belongs to the adapter it was loaded for, the way a
    // detection invalidates it.
    setPreview(undefined);
    setMessage(undefined);
  };

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

  /**
   * Stepping forward also fetches the component list, which used to wait
   * behind a button an operator had to know to press: arriving at the fields
   * is the moment the list is wanted, and asking for it then is the difference
   * between a picker that is there and one that has to be summoned.
   */
  const goToDetails = (): void => {
    setStepBack(false);
    setStep(2);
    setMessage(undefined);
    if (preview === undefined && baseUrl.trim() !== "") void loadPreview();
  };

  const goToSource = (): void => {
    setStepBack(true);
    setStep(1);
    setMessage(undefined);
  };

  const save = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    // Step one has no submit button, but a form with a text field in it still
    // submits on Enter — which posted a service with no name at all and came
    // back with the schema's own complaint about the id and the name. Worse
    // than noise: the rejection landed *after* the operator had stepped on,
    // so step two opened carrying an error about fields it had not yet been
    // given. The form is only submittable from the step that can fill it in.
    if (mode === "add" && step === 1) return;
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
          // Omitted rather than null, like the interval: absent means nobody
          // promised anything about this provider (roadmap 4.13).
          ...(slaTarget.trim() === "" ? {} : { slaTarget: Number(slaTarget) }),
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
        toast("services", { text: t("toast.service.added", { name }), tone: "ok" });
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
            // And null again for the target: cleared means the promise is off,
            // which only null can say.
            slaTarget: slaTarget.trim() === "" ? null : Number(slaTarget),
            ...savedOptions(),
          },
        });
        toast("services", { text: t("toast.service.saved", { name }), tone: "ok" });
      }
      close();
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : String(error), tone: "error" });
      setSaving(false);
    }
  };

  const adding = mode === "add";
  const onSource = adding && step === 1;
  // Nothing downstream of step one works without a base URL — the catalog
  // fills one in, detection answers with one, and a hand-picked adapter needs
  // one typed — so it is the single condition on going on.
  const ready = baseUrl.trim() !== "";

  /**
   * The fields both an add's second step and an edit put on screen.
   *
   * Grouped rather than stacked. Run flat they were eight labels of the same
   * weight in one scroll, and the component picker — which brings its own
   * search box, its own select-all and its own group headings — read as more
   * of the same list rather than as a block with a job. Each block says what
   * it is for, so the eye can skip the two it does not need.
   */
  const details = (
    <>
      <Section title={t("add.section-identity")}>
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
        {mode === "edit" && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="service-base-url">{t("field.base-url")}</Label>
            <Input
              id="service-base-url"
              className="font-mono"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              {...fieldProps}
            />
          </div>
        )}
      </Section>

      <Section title={t("add.section-watching")}>
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

        {/* Roadmap 4.13. Empty is the normal state: most providers are watched
            without anybody having promised anything, and a default would invent
            a promise and then report against it. */}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="service-sla">{t("field.sla-target")}</Label>
          <Input
            id="service-sla"
            type="number"
            min={50}
            max={100}
            step={0.01}
            placeholder={t("field.sla-target-placeholder")}
            value={slaTarget}
            onChange={(event) => setSlaTarget(event.target.value)}
            {...fieldProps}
          />
          <span className="text-xs text-muted-foreground">{t("field.sla-target-hint")}</span>
        </div>
      </Section>

      <Section
        title={t("components.field")}
        action={
          <Button type="button" variant="ghost" size="sm" disabled={previewLoading} onClick={() => void loadPreview()}>
            {t("components.load")}
          </Button>
        }
      >
        {preview === undefined ? (
          <span className="text-xs text-muted-foreground">{t("components.hint")}</span>
        ) : (
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
      </Section>
    </>
  );

  const adapterFields = (
    <AdapterOptions
      adapter={activeAdapter}
      options={options}
      setOption={setOption}
      header={header}
      setHeader={setHeader}
      fieldProps={fieldProps}
    />
  );

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? openDialog() : close())}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className={adding ? "sm:max-w-2xl" : undefined}>
        <form
          className="flex min-h-0 flex-1 flex-col gap-4"
          onSubmit={(event) => void save(event)}
          // And Enter in a step-one field does what pressing it there means:
          // goes on. Only from a field — on a catalog tile or a source button
          // Enter is that control's own click, which must keep working.
          onKeyDown={(event) => {
            if (!onSource || event.key !== "Enter") return;
            if (!(event.target instanceof HTMLInputElement)) return;
            event.preventDefault();
            if (ready) goToDetails();
          }}
        >
          <DialogHeader>
            {adding ? (
              <>
                <DialogTitle>{t("add.title")}</DialogTitle>
                <DialogDescription>{t(onSource ? "add.subtitle-source" : "add.subtitle-details")}</DialogDescription>
                <StepRail step={step} onBack={goToSource} />
              </>
            ) : (
              <>
                <DialogTitle>{name}</DialogTitle>
                <DialogDescription className="font-mono">
                  {`${id} · ${activeAdapter}`}
                </DialogDescription>
              </>
            )}
          </DialogHeader>

          <DialogBody>
            {/* Every height change in here is animated rather than jumped:
                the step swap, the advanced disclosure opening, a message
                arriving. The panel is centred, so a jump moves the whole
                dialog under the pointer. */}
            {/* The panel carries an animated pixel height; as a flex child of
                the scrolling body it would otherwise be shrunk below that
                height, clipping its tail instead of scrolling to it. */}
            <StepPanel className="shrink-0">
              <div className="flex flex-col gap-4">
                {adding ? (
                  <div key={step} className={stepBack ? "anim-step-back" : "anim-step"}>
                    <div className="flex flex-col gap-4">
                      {onSource ? (
                        <SourceStep
                          source={source}
                          onSourceChange={setSource}
                          catalog={catalog?.providers}
                          query={catalogQuery}
                          onQueryChange={setCatalogQuery}
                          onPick={pick}
                          picked={picked}
                          baseUrl={baseUrl}
                          onBaseUrlChange={setBaseUrl}
                          onDetect={() => void runDetect()}
                          detecting={detecting}
                          adapter={adapter}
                          onAdapterChange={(next) => {
                            setAdapter(next);
                            // Choosing an adapter by hand is choosing something
                            // other than the catalog entry, so the grid stops
                            // claiming one is still picked.
                            setPicked(undefined);
                            setPreview(undefined);
                          }}
                          fieldProps={fieldProps}
                        />
                      ) : (
                        <>
                          <ServiceIdentity name={name} adapter={adapter} baseUrl={baseUrl} onChange={goToSource} />
                          {details}
                          {/* Everything only one adapter can use, folded away. For
                              a Statuspage site it is empty and stays shut; for the
                              http probe it is where ten extra fields live instead
                              of in the middle of the form. */}
                          {hasAdapterOptions(activeAdapter) && (
                            <Collapsible
                              className="panel-advanced rounded-md border border-border"
                              open={advanced}
                              onOpenChange={setAdvanced}
                            >
                              <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 rounded-md px-3.5 py-3 text-left">
                                <span className="flex flex-col gap-1">
                                  <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
                                    {t("add.advanced")}
                                  </span>
                                  <span className="text-xs text-muted-foreground">{t("add.advanced-hint")}</span>
                                </span>
                                <ChevronDown
                                  className={advanced ? "size-4 rotate-180 text-muted-foreground transition-transform" : "size-4 text-muted-foreground transition-transform"}
                                />
                              </CollapsibleTrigger>
                              <CollapsibleContent>
                                <div className="border-t border-border p-3">{adapterFields}</div>
                              </CollapsibleContent>
                            </Collapsible>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ) : (
                  <>
                    {details}
                    {/* No disclosure while editing: tuning these is most of why an
                        operator opens an existing service at all. */}
                    {hasAdapterOptions(activeAdapter) && <Section title={t("add.advanced")}>{adapterFields}</Section>}
                  </>
                )}

                {message !== undefined && (
                  <p className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
                    {message.text}
                  </p>
                )}
              </div>
            </StepPanel>
          </DialogBody>

          <DialogFooter className="sm:justify-between">
            <div className="flex items-center gap-2">
              {mode === "edit" && (
                <Button type="button" variant="outline" size="sm" disabled={test.isPending} onClick={() => void runConnectionTest()}>
                  {t("action.test-connection")}
                </Button>
              )}
              {adding && (
                <span className="text-xs text-muted-foreground">
                  {t(onSource ? (ready ? "add.foot-ready" : "add.foot-pick") : "add.foot-tested")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {adding && !onSource && (
                <Button type="button" variant="ghost" className="back-link" onClick={goToSource}>
                  {t("action.previous-step")}
                </Button>
              )}
              <Button type="button" variant="ghost" onClick={close}>
                {t("action.cancel")}
              </Button>
              {onSource ? (
                <Button type="button" disabled={!ready} onClick={goToDetails}>
                  {t("action.continue")}
                </Button>
              ) : (
                <Button type="submit" disabled={saving}>
                  {adding ? t("action.add") : t("action.save")}
                </Button>
              )}
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * One named block of the form. The dialog's second step is four of these, and
 * the naming is the point: an operator who only came to change the poll
 * interval should be able to find it without reading the component picker.
 */
function Section({
  title, action, children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-md border border-border p-3.5">
      <div className="flex min-h-7 items-center justify-between gap-2">
        <span className="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">{title}</span>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Two steps, and which one you are on — the whole of the wizard's chrome. */
function StepRail({ step, onBack }: { step: 1 | 2; onBack: () => void }) {
  const { t } = useTranslation();

  return (
    <Stepper
      className="pt-1"
      currentStep={step}
      // Backwards only: step two is reached by answering step one, never by
      // clicking its circle, which would skip the form it is built out of.
      onStepClick={step === 2 ? onBack : undefined}
      steps={[{ label: t("add.step-source") }, { label: t("add.step-details") }]}
    />
  );
}
