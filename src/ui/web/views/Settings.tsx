import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import {
  useChannelMutations,
  useConfig,
  usePreferences,
  usePreferencesMutation,
  useServiceMutations,
  useSettingsMutation,
} from "@/hooks/queries.ts";
import { useBusyControls, useFieldProps } from "@/hooks/useBusy.tsx";
import { hostOf } from "@/lib/format.ts";
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

/**
 * One notification channel: enable switch, its env-var-name fields (never the
 * secret itself — settings.secret-note says so), and a send-test action that
 * reports inline. Port of `channelCard` (settings.js).
 */
function ChannelCard({ channel }: { channel: DescribedChannel }) {
  const { t } = useTranslation();
  const fieldProps = useFieldProps();
  const { patch, test } = useChannelMutations();
  const [envValues, setEnvValues] = useState<Record<string, string>>(
    Object.fromEntries(channel.fields.map((field) => [field.name, field.envVar])),
  );
  const [message, setMessage] = useState<{ text: string; tone: "error" | "info" } | undefined>(undefined);

  const save = (): void => {
    patch.mutate({
      id: channel.id,
      patch: {
        fields: Object.fromEntries(
          Object.entries(envValues).map(([name, value]) => [`${name}Env`, value.trim()]),
        ),
      },
    });
  };

  const sendTest = async (): Promise<void> => {
    const result = await test.mutateAsync(channel.id);
    setMessage(
      result.ok
        ? { text: t("channel.test-ok"), tone: "info" }
        : { text: t("channel.test-failed", { error: result.error }), tone: "error" },
    );
  };

  return (
    <Card className="flex flex-col gap-3 px-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className="size-1.5 rounded-full"
            style={{ background: channel.enabled ? "var(--status-operational-fill)" : "var(--color-neutral-700)" }}
          />
          <span className="text-sm font-medium">{channel.id}</span>
          {/* Vanilla's own state word (settings.js:124) next to the dot — dropped
              when the toggle became a Switch, restored here. */}
          <span className="font-mono text-xs text-muted-foreground">
            {t(channel.enabled ? "channel.enabled" : "channel.disabled")}
          </span>
        </div>
        <Switch
          aria-label={`${channel.id} — ${t(channel.enabled ? "channel.enabled" : "channel.disabled")}`}
          checked={channel.enabled}
          onCheckedChange={(next) => patch.mutate({ id: channel.id, patch: { enabled: next } })}
        />
      </div>

      {channel.fields.map((field) => {
        const inputId = `channel-${channel.id}-${field.name}`;
        return (
          <div key={field.name} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor={inputId}>{`${field.name} — ${t("field.env-var")}`}</Label>
              <span
                className="font-mono text-xs"
                style={{ color: field.isSet ? "var(--status-operational)" : "var(--status-degraded)" }}
              >
                {field.isSet ? t("channel.env-set") : t("channel.env-missing")}
              </span>
            </div>
            <Input
              id={inputId}
              className="font-mono"
              value={envValues[field.name] ?? ""}
              onChange={(event) => setEnvValues((prev) => ({ ...prev, [field.name]: event.target.value }))}
              {...fieldProps}
            />
          </div>
        );
      })}

      <span className="text-xs text-muted-foreground">{t("settings.secret-note")}</span>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" disabled={patch.isPending} onClick={save}>
          {t("action.save")}
        </Button>
        <Button type="button" variant="ghost" size="sm" disabled={test.isPending} onClick={() => void sendTest()}>
          {t("action.send-test")}
        </Button>
        {message !== undefined && (
          <span className={message.tone === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
            {message.text}
          </span>
        )}
      </div>
    </Card>
  );
}

/**
 * Design 3a's Settings: polling and the monitored services on the left,
 * notification channels on the right. Port of src/ui/public/js/views/settings.js.
 *
 * A secret is never typed, stored or displayed here: a channel field shows
 * only the *name* of the environment variable that carries its credential,
 * and whether that variable currently resolves — the name is editable, the
 * value never appears, because the server never sends it.
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
    <div className="flex flex-col gap-8 lg:flex-row">
      <div className="flex flex-1 flex-col gap-6">
        <section className="flex flex-col gap-3">
          <span className="text-xs uppercase tracking-widest text-primary">{t("settings.polling")}</span>
          <Card className="grid grid-cols-3 gap-4 px-4">
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
          </Card>
          <span className="text-xs text-muted-foreground">{t("settings.jitter-note")}</span>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" disabled={settingsMutation.isPending} onClick={savePolling}>
              {t("action.save")}
            </Button>
            <span className="text-xs text-muted-foreground">{pollingMessage ?? t("settings.hot-note")}</span>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex flex-col gap-2">
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
            <p className="text-xs text-muted-foreground">{t("settings.map-view.hint")}</p>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest text-primary">{t("settings.services")}</span>
            <ServiceDialog mode="add" trigger={<Button type="button" size="sm">{t("action.add-service")}</Button>} />
          </div>
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
        </section>
      </div>

      <div className="flex flex-1 flex-col gap-3">
        <span className="text-xs uppercase tracking-widest text-primary">{t("settings.channels")}</span>
        {config.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("empty.no-data")}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {config.channels.map((channel) => (
              <ChannelCard key={channel.id} channel={channel} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
