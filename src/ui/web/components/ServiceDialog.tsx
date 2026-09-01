import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { ComponentPicker, type ComponentPickerEntry, type ComponentPickerSelection } from "@/components/ComponentPicker.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import { useBusyControls, useFieldProps } from "@/hooks/useBusy.tsx";
import { previewComponents } from "@/lib/api.ts";
import type { ServiceDefinition } from "@/lib/types.ts";

const ADAPTERS = ["statuspage", "custom"] as const;

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
 * `id` is immutable once a service exists: shown, never editable, in edit
 * mode — vanilla's own edit dialog does not even offer the field, but the
 * brief for this port asks that it stay visible, just disabled, so an
 * operator can always see which id they are editing.
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
  const [name, setName] = useState(service?.name ?? "");
  const [id, setId] = useState(service?.id ?? "");
  const [adapter, setAdapter] = useState<string>(ADAPTERS[0]);
  const [baseUrl, setBaseUrl] = useState(service?.baseUrl ?? "");
  const [selection, setSelection] = useState<ComponentPickerSelection[]>(service?.components ?? []);
  const [scopeToComponents, setScopeToComponents] = useState(service?.scopeToComponents ?? false);
  const [preview, setPreview] = useState<
    { supported: boolean; components: ComponentPickerEntry[] } | undefined
  >(undefined);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | undefined>(undefined);
  const [saving, setSaving] = useState(false);

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
    setName(service?.name ?? "");
    setId(service?.id ?? "");
    setAdapter(ADAPTERS[0]);
    setBaseUrl(service?.baseUrl ?? "");
    setSelection(service?.components ?? []);
    setScopeToComponents(service?.scopeToComponents ?? false);
    setPreview(undefined);
    setMessage(undefined);
    setSaving(false);
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
          patch: { name, baseUrl, components: selection, scopeToComponents },
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
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-name">{t("field.name")}</Label>
                <Input id="service-name" value={name} onChange={(event) => setName(event.target.value)} {...fieldProps} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="service-id">{t("field.id")}</Label>
                {mode === "add" ? (
                  <Input
                    id="service-id"
                    className="font-mono"
                    value={id}
                    onChange={(event) => setId(event.target.value)}
                    {...fieldProps}
                  />
                ) : (
                  <Input id="service-id" className="font-mono" value={service?.id ?? ""} readOnly />
                )}
              </div>
            </div>

            {mode === "add" && (
              <div className="flex flex-col gap-1.5">
                <Label>{t("field.adapter")}</Label>
                <ToggleGroup
                  type="single"
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
              <Label htmlFor="service-base-url">{t("field.base-url")}</Label>
              <Input
                id="service-base-url"
                className="font-mono"
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                {...fieldProps}
              />
              {mode === "add" && <span className="font-mono text-xs text-muted-foreground">{t("add.note")}</span>}
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
