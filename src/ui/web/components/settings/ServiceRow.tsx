import { useTranslation } from "react-i18next";
import { ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible.tsx";
import { Switch } from "@/components/ui/switch.tsx";
import { ServiceDialog } from "@/components/ServiceDialog.tsx";
import { AdapterDebugDialog } from "@/components/settings/AdapterDebugDialog.tsx";
import { MuteMenu } from "@/components/settings/MuteMenu.tsx";
import { RemoveServiceDialog } from "@/components/settings/RemoveServiceDialog.tsx";
import { useSettingVisible } from "@/components/settings/SettingsChrome.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import { formatRelative, hostOf } from "@/lib/format.ts";
import { isMuted } from "@/lib/mute.ts";
import { cn } from "@/lib/utils.ts";
import type { ServiceDefinition } from "@/lib/types.ts";

/**
 * One monitored provider, collapsed to a row: dot, name, where its status is
 * read from, what state it is in, and the switch.
 *
 * Every provider used to carry five controls on one line — a switch, Mute,
 * Diagnose, Edit and a full-weight destructive Remove — repeated down the whole
 * list, so six providers put thirty controls on screen and the row that was
 * actually reached for (the switch) had to be found among them. Only the switch
 * stays out: it is the one action taken often, it is the only place in the
 * dashboard that sets the flag, and it answers a different question from the
 * rest ("is this provider polled" vs "change this provider").
 *
 * The other four live in the expansion, kept as the buttons they already were
 * rather than moved into a dropdown menu: three of them own a `Dialog`, and
 * Radix only returns focus to a `DialogTrigger` it rendered itself — a menu
 * item that unmounts as the dialog opens strands focus on the page. Same reason
 * `ServiceDialog` and `RemoveServiceDialog` take a trigger instead of an open
 * flag, and the same disclosure the channel rows beneath already use.
 */
export function ServiceRow({
  service,
  open,
  onOpenChange,
}: {
  service: ServiceDefinition;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const { patch } = useServiceMutations();
  const host = hostOf(service.baseUrl);
  const muted = isMuted(service.mutedUntil);
  const visible = useSettingVisible(`${service.name} ${service.adapter} ${host} ${service.group ?? ""}`);

  if (!visible) return null;

  // A live mute outranks "enabled": both describe whether the provider will say
  // anything, and the mute is the one with an end the operator wants to read.
  const state = muted
    ? { text: t("service.muted-until", { when: formatRelative(i18n.language, service.mutedUntil ?? "") }), color: "var(--status-degraded)" }
    : service.enabled
      ? { text: t("service.enabled"), color: "var(--status-operational)" }
      : { text: t("service.disabled"), color: "var(--color-neutral-500)" };

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="service-row">
      <div className="flex items-center gap-2.5 px-4 py-3">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{
            background: service.enabled ? "var(--status-operational-fill)" : "var(--color-neutral-700)",
          }}
        />
        <CollapsibleTrigger className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          {/* One glyph rotated, as in ChannelRow: Radix owns the state, and a
              second icon is a second thing that can disagree with it. */}
          <ChevronRight
            className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span className="truncate text-sm">{service.name}</span>
            <span className="truncate text-xs text-muted-foreground">
              {service.adapter} · {host}
            </span>
          </span>
        </CollapsibleTrigger>
        <span className="shrink-0 font-mono text-xs" style={{ color: state.color }}>
          {state.text}
        </span>
        {/* Taking a provider out of the rotation is not deleting it: the poller
            already skips a disabled service, and this is the only place in the
            dashboard that can set the flag. */}
        <Switch
          aria-label={`${service.name} — ${t(service.enabled ? "service.enabled" : "service.disabled")}`}
          checked={service.enabled}
          onCheckedChange={(next) => patch.mutate({ id: service.id, patch: { enabled: next } })}
        />
      </div>

      <CollapsibleContent>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pl-10">
          <MuteMenu service={service} />
          {/* Beside Edit rather than in the Providers table: an operator
              looking at why a page will not parse is already in this row. */}
          <AdapterDebugDialog service={service} />
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
      </CollapsibleContent>
    </Collapsible>
  );
}
