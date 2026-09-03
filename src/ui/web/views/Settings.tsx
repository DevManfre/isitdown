import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ChevronRight, Hash, MessagesSquare, MonitorSmartphone, Send, Webhook } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { BentoTile } from "@/components/BentoTile.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import {
  useChannelMutations,
  useConfig,
  usePreferences,
  usePreferencesMutation,
  usePushDevices,
  usePushMutations,
  useServiceMutations,
  useSettingsMutation,
} from "@/hooks/queries.ts";
import { useBusyControls, useFieldProps } from "@/hooks/useBusy.tsx";
import { getPushKey } from "@/lib/api.ts";
import { hostOf } from "@/lib/format.ts";
import { pushSupported, subscribeThisBrowser } from "@/lib/push.ts";
import { stagger } from "@/lib/stagger.ts";
import { cn } from "@/lib/utils.ts";
import type { DescribedChannel, MapView, ServiceDefinition } from "@/lib/types.ts";

/**
 * A small yes/no dialog for removing a service, on the same `Dialog` the
 * service form uses — a port of `confirmModal` (modal.js), never the
 * browser's own `window.confirm`.
 *
 * Owns its own trigger (the row's Remove button) inside the same `Dialog`,
 * same reason as `ServiceDialog`: Radix only returns focus to a real
 * `DialogTrigger` it rendered, never to an arbitrary button elsewhere that
 * merely flips an externally-lifted open flag.
 */
export function RemoveServiceDialog({ service, trigger }: { service: ServiceDefinition; trigger: ReactNode }) {
  const { t } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const [open, setOpen] = useState(false);
  const remove = useServiceMutations().remove;

  // Same defect class as ServiceDialog's close paths: `onOpenChange` only
  // fires from Radix's own wrapped setter (Escape, outside-click), never
  // from Cancel or the mutation's own `onSuccess` calling `setOpen` directly
  // — either of which would otherwise strand `dialogOpen` at `true` and hold
  // the poll forever. One `close()`, used by every path, closes that gap.
  const close = (): void => {
    setOpen(false);
    setDialogOpen(false);
  };

  // Claim-it-release-it, same as ServiceDialog: an unmount runs no click
  // handler and fires neither `onOpenChange` nor `remove`'s `onSuccess`, so
  // navigating away via the Rail while this dialog is open would otherwise
  // strand `dialogOpen` `true` for the rest of the session.
  useEffect(() => {
    return () => {
      setDialogOpen(false);
    };
  }, [setDialogOpen]);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setOpen(true);
          setDialogOpen(true);
        } else {
          close();
        }
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("action.remove")}</DialogTitle>
          <DialogDescription>{t("providers.remove-confirm", { name: service.name })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={close}>
            {t("action.cancel")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => {
              remove.mutate(service.id, { onSuccess: close });
            }}
          >
            {t("action.remove")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Reason codes `subscribeThisBrowser` throws, mapped to copy that says what to
// do about them; anything else falls back to push.failed with the raw text.
const PUSH_FAILURE_KEYS: Record<string, string> = {
  denied: "push.denied",
  "push-service": "push.push-service",
  "push-service-brave": "push.push-service-brave",
};

/**
 * Browser push is the one channel whose target is the machine looking at the
 * dashboard, so enabling it needs a click *here* — the env vars alone cannot
 * deliver anything until a browser has subscribed.
 */
function PushDevices({
  channelEnabled, testAction, testMessage,
}: {
  channelEnabled: boolean;
  testAction: ReactNode;
  testMessage: ReactNode;
}) {
  const { t } = useTranslation();
  const devices = usePushDevices();
  const { add, remove } = usePushMutations();
  const [message, setMessage] = useState<string | undefined>(undefined);
  const supported = pushSupported();

  const enable = async (): Promise<void> => {
    try {
      const { publicKey } = await getPushKey();
      add.mutate(await subscribeThisBrowser(publicKey), {
        // The seeded webpush channel is disabled: registering a device while
        // the channel is off is the likeliest first run (set the two env
        // vars, click this button, never touch the switch), and it must not
        // promise delivery that will not happen.
        onSuccess: () => setMessage(channelEnabled ? t("push.enabled") : t("push.registered-channel-off")),
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const key = PUSH_FAILURE_KEYS[reason];
      setMessage(key !== undefined ? t(key) : t("push.failed", { error: reason }));
    }
  };

  if (!supported) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          {testAction}
          {testMessage}
        </div>
        <p className="text-xs text-muted-foreground">{t("push.unsupported")}</p>
      </div>
    );
  }

  const registered = devices.data?.devices ?? [];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {/* The channel asks for no settings, so these two are its whole action
            row: enabling this browser is the primary move, sending a test the
            secondary one — the same pair, in the same order, a channel with
            fields shows as Save and Send test. */}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="secondary" disabled={add.isPending} onClick={() => void enable()}>
            {t("push.enable")}
          </Button>
          {testAction}
          {testMessage}
        </div>
        {message !== undefined && <p className="text-xs leading-relaxed text-muted-foreground">{message}</p>}
      </div>

      {/* The heading was a muted line of the same size as the device rows it
          labels, so the two read as one flat list. Kicker styling plus a
          bordered list gives the rows something to sit inside. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-xs uppercase tracking-widest text-muted-foreground">{t("push.devices")}</span>
        {registered.length === 0 ? (
          <span className="text-xs text-muted-foreground">{t("push.no-devices")}</span>
        ) : (
          <div className="divide-y divide-border rounded-md border border-border">
            {registered.map((device) => (
              <div key={device.id} className="flex items-center justify-between gap-2 py-1 pl-3 pr-1">
                <span className="font-mono text-xs">{device.label}</span>
                <Button type="button" size="sm" variant="ghost" onClick={() => remove.mutate(device.id)}>
                  {t("action.remove")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Which icon and which name a channel shows. Keyed by channel id, exhaustively
 * — a key built at runtime would be invisible to the catalog parity test — and
 * both lookups fall back to the id, so a channel this dashboard has never heard
 * of still renders a readable row instead of a blank one.
 */
const CHANNEL_ICONS: Record<string, typeof Bell> = {
  discord: MessagesSquare,
  slack: Hash,
  telegram: Send,
  webhook: Webhook,
  webpush: MonitorSmartphone,
};

const CHANNEL_NAME_KEYS: Record<string, string> = {
  discord: "channel.name.discord",
  slack: "channel.name.slack",
  telegram: "channel.name.telegram",
  webhook: "channel.name.webhook",
  webpush: "channel.name.webpush",
};

/** Configured means every environment variable the channel needs resolves. */
const isConfigured = (channel: DescribedChannel): boolean =>
  channel.fields.every((field) => field.isSet);

/**
 * Active first, then configured but off, then anything whose environment is
 * incomplete. Within a band the server's order is kept, so a list does not
 * reshuffle for reasons the operator cannot see.
 */
const channelRank = (channel: DescribedChannel): number =>
  channel.enabled ? 0 : isConfigured(channel) ? 1 : 2;

/**
 * One notification channel, collapsed to a single row: dot, icon, name, a badge
 * for the state its environment is in, and the enable switch. Everything that
 * used to be permanently on screen — the env-var-name fields, Save, Send test,
 * and browser push's device list — lives in the expansion.
 *
 * The switch sits *outside* the disclosure trigger: a control inside a button
 * is invalid, and the two answer different questions anyway ("is it on" vs
 * "what is it set to").
 */
function ChannelRow({
  channel, open, onOpenChange,
}: {
  channel: DescribedChannel;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const fieldProps = useFieldProps();
  const { patch, saveSecrets, clearSecret, test } = useChannelMutations();
  // Only what is being *changed* lives here: each field renders empty with the
  // stored variable name as its placeholder, so the hint can never be mistaken
  // for something the operator typed.
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  // The credential itself, held only until it is saved. Nothing reads one back
  // — the server never sends a value — so an emptied input is the whole state
  // an operator gets to see afterwards.
  const [secretValues, setSecretValues] = useState<Record<string, string>>({});
  // Which environment variable carries which credential is a detail an operator
  // rarely touches, so it is asked for rather than shown.
  const [showEnvVars, setShowEnvVars] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | undefined>(undefined);
  const fieldless = channel.fields.length === 0;
  const Icon = CHANNEL_ICONS[channel.id] ?? Bell;
  const nameKey = CHANNEL_NAME_KEYS[channel.id];
  const name = nameKey === undefined ? channel.id : t(nameKey);
  const configured = isConfigured(channel);

  const failed = (error: unknown): void =>
    setMessage({
      text: t("channel.secret-failed", { error: error instanceof Error ? error.message : String(error) }),
      tone: "error",
    });

  const save = (): void => {
    const fields = Object.fromEntries(
      Object.entries(envValues)
        .map(([name, value]) => [`${name}Env`, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    const secrets = Object.fromEntries(
      Object.entries(secretValues)
        .map(([name, value]) => [name, value.trim()] as const)
        .filter(([, value]) => value !== ""),
    );
    // An untouched row is not an instruction to blank every reference.
    if (Object.keys(fields).length === 0 && Object.keys(secrets).length === 0) return;
    setMessage(undefined);

    // A credential is written to whichever variable the channel names *now*, so
    // a click that renames the reference and fills it in one go has to land the
    // rename first or the value would go to the old variable.
    const saveSecretValues = (): void => {
      if (Object.keys(secrets).length === 0) return;
      saveSecrets.mutate(
        { id: channel.id, fields: secrets },
        {
          onSuccess: () => {
            setSecretValues({});
            setMessage({ text: t("channel.secret-saved"), tone: "info" });
          },
          onError: failed,
        },
      );
    };

    if (Object.keys(fields).length === 0) {
      saveSecretValues();
      return;
    }
    patch.mutate(
      { id: channel.id, patch: { fields } },
      {
        onSuccess: () => {
          setEnvValues({});
          saveSecretValues();
        },
        onError: failed,
      },
    );
  };

  const sendTest = async (): Promise<void> => {
    const result = await test.mutateAsync(channel.id);
    setMessage(
      result.ok
        ? { text: t("channel.test-ok"), tone: "info" }
        : { text: t("channel.test-failed", { error: result.error }), tone: "error" },
    );
  };

  // Built here and handed down, because browser push shows the same button in
  // its own action row — next to "enable on this browser", where the two
  // things an operator can do to a channel with no settings belong together.
  const testButton = (
    <Button type="button" variant="ghost" size="sm" disabled={test.isPending} onClick={() => void sendTest()}>
      {t("action.send-test")}
    </Button>
  );
  const testMessage =
    message === undefined ? null : (
      <span className={message.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {message.text}
      </span>
    );

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="panel-channel">
      <div className="flex items-center gap-2 py-2">
        <CollapsibleTrigger className="flex flex-1 items-center gap-2.5 text-left">
          {/* One glyph rotated, as in FleetGroups: Radix owns the state, and a
              second icon is a second thing that can disagree with it. */}
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span
            className="size-1.5 shrink-0 rounded-full"
            style={{ background: channel.enabled ? "var(--status-operational-fill)" : "var(--color-neutral-700)" }}
          />
          <Icon className={cn("size-4 shrink-0", channel.enabled ? "text-foreground" : "text-muted-foreground")} />
          <span className="text-sm font-medium">{name}</span>
          {/* With the fields shut, this badge is the only thing left saying a
              channel cannot actually send — so it says which of the two
              reasons applies rather than repeating the switch. */}
          <span
            className="ml-auto font-mono text-xs"
            style={{
              color: channel.enabled
                ? "var(--status-operational)"
                : configured
                  ? "var(--color-neutral-500)"
                  : "var(--status-degraded)",
            }}
          >
            {channel.enabled
              ? t("channel.enabled")
              : configured
                ? t("channel.ready")
                : t("channel.env-incomplete")}
          </span>
        </CollapsibleTrigger>
        <Switch
          aria-label={`${name} — ${t(channel.enabled ? "channel.enabled" : "channel.disabled")}`}
          checked={channel.enabled}
          onCheckedChange={(next) => patch.mutate({ id: channel.id, patch: { enabled: next } })}
        />
      </div>

      <CollapsibleContent>
        <div className="flex flex-col gap-3 pb-3 pl-6 pr-1">
        {channel.fields.map((field) => {
          const inputId = `channel-${channel.id}-${field.name}`;
          const valueId = `${inputId}-value`;
          return (
            <div key={field.name} className="flex flex-col gap-1.5">
              {/* The credential is the field: one box, because which variable
                  carries it is a detail almost nobody changes. Typing here saves
                  the value beside the database and puts it in this process's
                  environment, so the channel is live without a restart, and the
                  input renders empty whatever is stored — no route ever sends a
                  credential back. */}
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={valueId}>{field.name}</Label>
                <span
                  className="font-mono text-xs"
                  style={{ color: field.isSet ? "var(--status-operational)" : "var(--status-degraded)" }}
                >
                  {field.isSet ? t("channel.env-set") : t("channel.env-missing")}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  id={valueId}
                  type="password"
                  autoComplete="new-password"
                  className="font-mono"
                  value={secretValues[field.name] ?? ""}
                  onChange={(event) => setSecretValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
                  {...fieldProps}
                />
                {field.isSet && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={clearSecret.isPending}
                    onClick={() =>
                      clearSecret.mutate(
                        { id: channel.id, field: field.name },
                        {
                          onSuccess: () => setMessage({ text: t("channel.secret-cleared"), tone: "info" }),
                          onError: failed,
                        },
                      )
                    }
                  >
                    {t("action.clear")}
                  </Button>
                )}
              </div>

              {/* Which variable the value is read from: still editable, but out
                  of the way until asked for — an operator who has never heard
                  of it can configure a channel without meeting it. */}
              {showEnvVars && (
                <div className="flex flex-col gap-1.5 pt-1">
                  <Label htmlFor={inputId} className="text-xs text-muted-foreground">
                    {t("field.env-var")}
                  </Label>
                  <Input
                    id={inputId}
                    className="font-mono"
                    placeholder={field.envVar}
                    value={envValues[field.name] ?? ""}
                    onChange={(event) => setEnvValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
                    {...fieldProps}
                  />
                </div>
              )}
            </div>
          );
        })}

        {!fieldless && (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={patch.isPending || saveSecrets.isPending} onClick={save}>
              {t("action.save")}
            </Button>
            {testButton}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              aria-expanded={showEnvVars}
              onClick={() => setShowEnvVars((previous) => !previous)}
            >
              {t("channel.env-var-toggle")}
            </Button>
            {testMessage}
          </div>
        )}

        {channel.id === "webpush" && (
          <PushDevices channelEnabled={channel.enabled} testAction={testButton} testMessage={testMessage} />
        )}

        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * What the list would otherwise make the operator count: how many channels are
 * on, and which. With every row shut, this is the only line that answers "would
 * a status change reach anyone at all".
 */
function ChannelSummary({ channels }: { channels: DescribedChannel[] }) {
  const { t } = useTranslation();
  const active = channels.filter((channel) => channel.enabled);
  const names = active.map((channel) => {
    const key = CHANNEL_NAME_KEYS[channel.id];
    return key === undefined ? channel.id : t(key);
  });

  return (
    <div className="flex flex-col gap-1 pb-1">
      <span className="font-mono text-xs text-muted-foreground">
        {t("channel.summary.count", { active: active.length, total: channels.length })}
      </span>
      <span className="text-xs text-muted-foreground">
        {active.length === 0
          ? t("channel.summary.none")
          : t("channel.summary.sending", { channels: names.join(" · ") })}
      </span>
    </div>
  );
}

/** The tiles enter in reading order, after the view's own frame has landed. */
const TILE_CASCADE = { base: 60, step: 60 };

/**
 * Design 3a's Settings as a bento: polling wide beside the geographic view on
 * the top row, the monitored services and the notification channels sharing the
 * one below. Port of src/ui/public/js/views/settings.js.
 *
 * A secret can be typed here but never read back: a channel field is one box
 * for the credential, and a save sends it one way — to the secrets file beside
 * the database and into the server's environment, so the channel works without
 * a restart. The value never appears again, because no route sends one. Which
 * environment variable carries it is behind the row's own toggle, along with
 * whether that variable currently resolves.
 */
export function Settings() {
  const { t } = useTranslation();
  const { data: config } = useConfig();
  const { data: preferences } = usePreferences();
  const patchPreferences = usePreferencesMutation();
  const settingsMutation = useSettingsMutation();
  const servicePatch = useServiceMutations().patch;
  // Above the early return below: a hook cannot be called conditionally.
  const fieldProps = useFieldProps();

  const [interval_, setInterval_] = useState<number | undefined>(undefined);
  const [timeout_, setTimeout_] = useState<number | undefined>(undefined);
  const [retries, setRetries] = useState<number | undefined>(undefined);
  const [pollingMessage, setPollingMessage] = useState<string | undefined>(undefined);
  const [openChannel, setOpenChannel] = useState<string | undefined>(undefined);

  if (config === undefined) return null;

  const interval = interval_ ?? config.polling.intervalMinutes;
  const timeout = timeout_ ?? config.polling.requestTimeoutSeconds;
  const maxRetries = retries ?? config.polling.maxRetries;

  const savePolling = (): void => {
    setPollingMessage(undefined);
    settingsMutation.mutate(
      { intervalMinutes: interval, requestTimeoutSeconds: timeout, maxRetries },
      { onError: (error) => setPollingMessage(error instanceof Error ? error.message : String(error)) },
    );
  };

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-6">
      <BentoTile
        title={t("settings.polling")}
        note={t("settings.jitter-note")}
        delay={stagger(0, TILE_CASCADE)}
        className="md:col-span-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="polling-interval">{t("field.interval")}</Label>
            <Input
              id="polling-interval"
              type="number"
              className="font-mono"
              value={interval}
              onChange={(event) => setInterval_(Number(event.target.value))}
              {...fieldProps}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="polling-timeout">{t("field.timeout")}</Label>
            <Input
              id="polling-timeout"
              type="number"
              className="font-mono"
              value={timeout}
              onChange={(event) => setTimeout_(Number(event.target.value))}
              {...fieldProps}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="polling-retries">{t("field.retries")}</Label>
            <Input
              id="polling-retries"
              type="number"
              className="font-mono"
              value={maxRetries}
              onChange={(event) => setRetries(Number(event.target.value))}
              {...fieldProps}
            />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={settingsMutation.isPending} onClick={savePolling}>
            {t("action.save")}
          </Button>
          <span className="text-xs text-muted-foreground">{pollingMessage ?? t("settings.hot-note")}</span>
        </div>
      </BentoTile>

      <BentoTile
        title={t("settings.map-view")}
        note={t("settings.map-view.hint")}
        delay={stagger(1, TILE_CASCADE)}
        className="md:col-span-2"
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="map-view">{t("settings.map-view.label")}</Label>
          <Select
            value={preferences?.mapView ?? "off"}
            onValueChange={(value) => patchPreferences.mutate({ mapView: value as MapView })}
          >
            <SelectTrigger id="map-view">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="off">{t("settings.map-view.off")}</SelectItem>
              <SelectItem value="map">{t("settings.map-view.map")}</SelectItem>
              <SelectItem value="globe">{t("settings.map-view.globe")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </BentoTile>

      <BentoTile
        title={t("settings.services")}
        action={
          <ServiceDialog mode="add" trigger={<Button type="button" size="sm">{t("action.add-service")}</Button>} />
        }
        delay={stagger(2, TILE_CASCADE)}
        className="md:col-span-3"
      >
        {config.services.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("providers.empty")}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {config.services.map((service) => (
              <div
                key={service.id}
                className="service-row flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{
                      background: service.enabled ? "var(--status-operational-fill)" : "var(--color-neutral-700)",
                    }}
                  />
                  {/* The name and its state hold their width and the meta
                      line gives way: with the toggle taking its place on the
                      right there is no longer room for all three, and a
                      clipped adapter reads better than a clipped provider
                      name or a row gone to two lines. */}
                  <span className="max-w-48 shrink-0 truncate text-sm">{service.name}</span>
                  {/* The state word beside the dot, as a channel row carries
                      it: colour alone does not say which of the two states a
                      muted dot means. */}
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {t(service.enabled ? "service.enabled" : "service.disabled")}
                  </span>
                  <span className="truncate font-mono text-[10.5px] text-muted-foreground">
                    {`${service.adapter} · ${hostOf(service.baseUrl)}`}
                  </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {/* Taking a provider out of the rotation is not deleting it:
                      the poller already skips a disabled service, and this is
                      the only place in the dashboard that can set the flag. */}
                  <Switch
                    aria-label={`${service.name} — ${t(service.enabled ? "service.enabled" : "service.disabled")}`}
                    checked={service.enabled}
                    onCheckedChange={(next) =>
                      servicePatch.mutate({ id: service.id, patch: { enabled: next } })
                    }
                  />
                  <ServiceDialog
                    mode="edit"
                    service={service}
                    trigger={
                      <Button type="button" variant="secondary" size="sm">
                        {t("action.edit")}
                      </Button>
                    }
                  />
                  <RemoveServiceDialog
                    service={service}
                    trigger={
                      <Button type="button" variant="destructive" size="sm">
                        {t("action.remove")}
                      </Button>
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </BentoTile>

      {/* The note the channel panels used to repeat one apiece is said once
          here: it is the same sentence about the same environment, and three
          channels made it three claims. */}
      <BentoTile
        title={t("settings.channels")}
        note={t("settings.secret-note")}
        delay={stagger(3, TILE_CASCADE)}
        className="md:col-span-3"
      >
        {config.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty.no-data")}</p>
        ) : (
          <div className="flex flex-col">
            <ChannelSummary channels={config.channels} />
            {/* One row open at a time: the panel exists to be scannable, and
                every row expanded is the layout this replaced. */}
            <div className="divide-y divide-border border-t border-border">
              {[...config.channels]
                .sort((a, b) => channelRank(a) - channelRank(b))
                .map((channel) => (
                  <ChannelRow
                    key={channel.id}
                    channel={channel}
                    open={openChannel === channel.id}
                    onOpenChange={(next) => setOpenChannel(next ? channel.id : undefined)}
                  />
                ))}
            </div>
          </div>
        )}
      </BentoTile>
    </div>
  );
}
