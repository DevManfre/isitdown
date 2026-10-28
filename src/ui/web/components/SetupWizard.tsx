import { useEffect, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { StepPanel, Stepper } from "@/components/ui/stepper.tsx";
import { startGuidedTour } from "@/components/GuidedTour.tsx";
import {
  useCatalog,
  useChannelMutations,
  useConfigChrome,
  usePreferences,
  usePreferencesMutation,
  useServiceMutations,
  useStatusChrome,
} from "@/hooks/queries.ts";
import { useBusyControls } from "@/hooks/useBusy.tsx";
import { stagger } from "@/lib/stagger.ts";
import * as api from "@/lib/api.ts";

type Step = 1 | 2 | 3 | 4;
type Work = { (): Promise<void> };

/** Literal keys per step rather than built ones, so the catalog's dead-key scan sees them. */
const COPY: Record<Step, { title: string; description: string }> = {
  1: { title: "wizard.title.1", description: "wizard.description.1" },
  2: { title: "wizard.title.2", description: "wizard.description.2" },
  3: { title: "wizard.title.3", description: "wizard.description.3" },
  4: { title: "wizard.title.4", description: "wizard.description.4" },
};
type Test = { state: "idle" } | { state: "sending" } | { state: "ok" } | { state: "failed"; error: string };

/**
 * Browser push is on from the start and has no field to fill: it reaches the
 * browsers that subscribed in Settings, so "enabled" says nothing about whether
 * anyone has been set up, and a test sent to it arrives nowhere. The wizard
 * neither counts it nor offers it.
 */
const DEVICE_CHANNEL = "webpush";

/** Names too long for a four-column tile, as the operator would write them. */
const SHORT_NAMES: Record<string, string> = {
  "Amazon Web Services": "AWS",
  "Microsoft Azure": "Azure",
  "Jira Service Management": "Jira Service Mgmt",
  "Microsoft Advertisement": "Microsoft Ads",
  "CockroachDB Cloud": "CockroachDB",
  "Twilio SendGrid": "SendGrid",
};

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * First start in sixty seconds — roadmap 4.5. Providers from the catalog, one
 * channel, and a real notification: a monitor that has never notified anyone is
 * not installed yet, so the last step cannot be reached without a delivery.
 *
 * It opens by itself on an installation that has never been given a channel
 * (wizard not yet done). Providers are optional in step 1 — a fresh install is
 * seeded with some. "Set up later" counts as done.
 */
export function SetupWizard() {
  const { t } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const { data: preferences } = usePreferences();
  const patchPreferences = usePreferencesMutation();
  const { data: status } = useStatusChrome();
  const { data: config } = useConfigChrome();
  const { add } = useServiceMutations();
  const { patch: patchChannel, saveSecrets } = useChannelMutations();
  const [step, setStepRaw] = useState<Step>(1);
  const [back, setBack] = useState(false);
  const setStep = (next: Step): void => {
    setBack(next < step);
    setStepRaw(next);
  };
  const [dismissed, setDismissed] = useState(false);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [test, setTest] = useState<Test>({ state: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A fresh installation is seeded with a few providers, so "empty" cannot be
  // the test: what an installation that has never notified anyone lacks is a
  // channel. Latched, because enabling one in step 2 must not close the wizard
  // under the operator before its last step.
  const [needed, setNeeded] = useState(false);
  useEffect(() => {
    if (config !== undefined && !config.channels.some((entry) => entry.enabled && entry.id !== DEVICE_CHANNEL)) {
      setNeeded(true);
    }
  }, [config]);

  const open = !dismissed && preferences?.wizardDone === false && needed;
  const { data: catalog } = useCatalog(open);

  useEffect(() => {
    setDialogOpen(open);
    return () => setDialogOpen(false);
  }, [open, setDialogOpen]);

  if (!open) return null;

  const channels = (config?.channels ?? []).filter((entry) => entry.id !== DEVICE_CHANNEL);
  const channel = channels.find((entry) => entry.id === channelId);
  const channelName = (id: string): string => t(`channel.name.${id}`, { defaultValue: id });
  const entries = (catalog?.providers ?? []).filter(
    (provider) =>
      !provider.configured && `${provider.name} ${provider.id}`.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const missingField =
    channel?.fields.some((field) => !field.isSet && field.optional !== true && (secrets[field.name] ?? "").trim() === "") ?? true;

  const finish = (): void => {
    setDismissed(true);
    patchPreferences.mutate({ wizardDone: true });
  };

  const run = async (work: Work, next: Step): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setStep(next);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  const addProviders = () =>
    run(async () => {
      for (const id of picked) {
        const provider = catalog?.providers.find((entry) => entry.id === id);
        if (provider === undefined) continue;
        try {
          await add.mutateAsync({
            id: provider.id,
            name: provider.name,
            adapter: provider.adapter,
            baseUrl: provider.baseUrl,
            enabled: true,
          });
        } catch (failure) {
          // Already watched — added by an earlier attempt, or from another
          // browser — is what the operator asked for, not an error to stop on.
          if (!/already exists/i.test(message(failure))) throw failure;
        }
        // Added ones leave the picker, so a retry after a failure never repeats them.
        setPicked((current) => current.filter((entry) => entry !== id));
      }
    }, 2);

  const saveChannel = () =>
    run(async () => {
      if (channel === undefined) return;
      const filled = Object.fromEntries(Object.entries(secrets).filter(([, value]) => value.trim() !== ""));
      if (Object.keys(filled).length > 0) await saveSecrets.mutateAsync({ id: channel.id, fields: filled });
      await patchChannel.mutateAsync({ id: channel.id, patch: { enabled: true } });
      setSecrets({});
      setTest({ state: "idle" });
    }, 3);

  const sendTest = async (): Promise<void> => {
    if (channel === undefined) return;
    setTest({ state: "sending" });
    try {
      const result = await api.testChannel(channel.id);
      setTest(result.ok ? { state: "ok" } : { state: "failed", error: result.error ?? "" });
    } catch (failure) {
      setTest({ state: "failed", error: message(failure) });
    }
  };

  return (
    <Dialog open onOpenChange={(next) => !next && finish()}>
      <DialogContent className="max-w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <Stepper
            currentStep={step}
            steps={[
              { label: t("wizard.step.providers") },
              { label: t("wizard.step.channel") },
              { label: t("wizard.step.test") },
              { label: t("wizard.step.done") },
            ]}
          />
          <DialogTitle>{t(COPY[step].title)}</DialogTitle>
          <DialogDescription>{t(COPY[step].description)}</DialogDescription>
        </DialogHeader>

        <DialogBody>
          {/* Measured height, so the dialog grows and shrinks between steps
              instead of jumping; the step itself slides in from the side it
              is reached from. */}
          <StepPanel className="shrink-0">
            <div key={step} className={`flex flex-col gap-4 ${back ? "anim-step-back" : "anim-step"}`}>
          {step === 1 && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="wizard-search">{t("wizard.search")}</Label>
                <Input
                  id="wizard-search"
                  value={query}
                  placeholder={t("wizard.search-placeholder")}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
              <ul className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
                {entries.map((provider, index) => {
                  const selected = picked.includes(provider.id);
                  return (
                    <li key={provider.id} className="anim-tile" style={{ animationDelay: stagger(index) }}>
                      <Button
                        type="button"
                        variant={selected ? "default" : "outline"}
                        aria-pressed={selected}
                        className="h-auto min-h-14 w-full relative items-start justify-start whitespace-normal px-2.5 py-2 text-[13px] text-left transition-colors"
                        onClick={() =>
                          setPicked((current) =>
                            selected ? current.filter((id) => id !== provider.id) : [...current, provider.id],
                          )
                        }
                      >
                        <span className="min-w-0 break-words">{SHORT_NAMES[provider.name] ?? provider.name}</span>
                        {/* Drawn in the bottom corner and faded, not inserted in the flow (it would take width from the name): a
                            caption under the name made the picked tile taller than its
                            neighbours and shoved the whole row. The pressed state
                            carries the meaning for a screen reader. */}
                        <Check
                          aria-hidden="true"
                          className={`absolute bottom-1.5 right-1.5 size-3.5 transition-opacity duration-200 ${selected ? "opacity-100" : "opacity-0"}`}
                        />
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {catalog !== undefined && entries.length === 0 && (
                <p className="text-sm text-muted-foreground">{t("palette.empty")}</p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {channels.map((entry, index) => (
                  <li key={entry.id} className="anim-tile" style={{ animationDelay: stagger(index) }}>
                    <Button
                      type="button"
                      variant={entry.id === channelId ? "default" : "outline"}
                      aria-pressed={entry.id === channelId}
                      className="w-full transition-colors"
                      onClick={() => {
                        setChannelId(entry.id);
                        setSecrets({});
                      }}
                    >
                      {channelName(entry.id)}
                    </Button>
                  </li>
                ))}
              </ul>
              {channel?.fields.map((field) => (
                <div key={field.name} className="anim-panel flex flex-col gap-1.5">
                  <Label htmlFor={`wizard-${field.name}`}>{field.name}</Label>
                  <Input
                    id={`wizard-${field.name}`}
                    type="password"
                    autoComplete="off"
                    value={secrets[field.name] ?? ""}
                    placeholder={field.isSet ? t("wizard.secret-set") : ""}
                    onChange={(event) => setSecrets((current) => ({ ...current, [field.name]: event.target.value }))}
                  />
                </div>
              ))}
              {channel !== undefined && <p className="text-xs text-muted-foreground">{t("wizard.secret-hint")}</p>}
            </>
          )}

          {step === 3 && (
            <>
              <p className="text-sm">{t("wizard.test-body", { channel: channelName(channelId ?? "") })}</p>
              {test.state === "ok" && (
                <p role="status" className="anim-panel text-sm text-status-operational">
                  {t("wizard.test-ok")}
                </p>
              )}
              {test.state === "failed" && (
                <p role="alert" className="anim-panel text-sm text-destructive">
                  {t("channel.test-failed", { error: test.error })}
                </p>
              )}
            </>
          )}

          {step === 4 && (
            <ul className="flex flex-col gap-2 text-sm">
              <li className="anim-tile">{t("wizard.summary-providers", { count: status?.providers.length ?? 0 })}</li>
              <li className="anim-tile" style={{ animationDelay: stagger(1) }}>{t("wizard.summary-channel", { channel: channelName(channelId ?? "") })}</li>
            </ul>
          )}

          {error !== null && (
            <p role="alert" className="anim-panel text-sm text-destructive">
              {t("toast.failed", { error })}
            </p>
          )}
            </div>
          </StepPanel>
        </DialogBody>

        <DialogFooter>
          {step < 4 && (
            <Button type="button" variant="ghost" onClick={finish}>
              {t("wizard.later")}
            </Button>
          )}
          {step === 1 && (
            <Button type="button" disabled={(picked.length === 0 && (status?.providers.length ?? 0) === 0) || busy} onClick={() => void addProviders()}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {t("action.continue")}
            </Button>
          )}
          {step === 2 && (
            <Button type="button" disabled={missingField || busy} onClick={() => void saveChannel()}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              {t("wizard.save-continue")}
            </Button>
          )}
          {step === 3 && (
            <>
              <Button type="button" variant="outline" disabled={test.state === "sending"} onClick={() => void sendTest()}>
                {test.state === "sending" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                {t(test.state === "idle" ? "action.send-test" : "wizard.send-again")}
              </Button>
              <Button type="button" disabled={test.state !== "ok"} onClick={() => setStep(4)}>
                {t("wizard.arrived")}
              </Button>
            </>
          )}
          {step === 4 && (
            <>
              <Button type="button" variant="outline" onClick={finish}>
                {t("wizard.open-dashboard")}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  finish();
                  startGuidedTour();
                }}
              >
                {t("wizard.take-tour")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
