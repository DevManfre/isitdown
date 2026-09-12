import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog.tsx";
import { useAdapterDebug, useAdapterProbe } from "@/hooks/queries.ts";
import { useBusyControls } from "@/hooks/useBusy.tsx";
import { formatDateTime } from "@/lib/format.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import type { AdapterProbeResult, ServiceDefinition } from "@/lib/types.ts";

/**
 * Why a provider's page is not being read the way it should be — roadmap 5.18.
 *
 * Nine adapters, one of them a CSS-selector scrape that is documented as
 * fragile, and until this existed the only way to see a parse failure was to
 * tail the container's logs. That is a shell away from a dashboard the operator
 * already has open, which is the whole reason this panel is worth its space.
 *
 * Two halves, because they answer different questions. The recent reads say
 * whether reads are failing at all, how often, and whether the provider is
 * answering 304s — a page that has stopped changing and a page we have stopped
 * asking about look identical without that. The live read says what the adapter
 * makes of the page *now*, which is the only way a selector that no longer
 * matches becomes visible: the fetch succeeds, and the reading comes back
 * `unknown` with nothing in it.
 *
 * It sits beside the provider's own Edit and Remove buttons rather than in the
 * Providers table: an operator fixing a selector is already in this row.
 */
export function AdapterDebugDialog({ service }: { service: ServiceDefinition }) {
  const { t, i18n } = useTranslation();
  const { setDialogOpen } = useBusyControls();
  const [open, setOpen] = useState(false);
  // Fetched only while the dialog is open: a panel nobody is looking at has no
  // business on the polling interval.
  const { data } = useAdapterDebug(open);
  const probe = useAdapterProbe();

  useEffect(() => {
    return () => {
      setDialogOpen(false);
    };
  }, [setDialogOpen]);

  const provider = data?.providers.find((entry) => entry.id === service.id);
  const probes = provider?.probes ?? [];
  const options = Object.entries(provider?.options ?? service.options ?? {});
  const result: AdapterProbeResult | undefined = probe.data;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setDialogOpen(next);
        // The previous provider's reading must not be sitting there when the
        // dialog opens again — least of all a stale success next to a page that
        // has since broken.
        if (!next) probe.reset();
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          {t("action.debug-adapter")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[min(44rem,calc(100vw-2rem))]">
        <DialogHeader>
          <DialogTitle>{t("adapter.debug.title")}</DialogTitle>
          <DialogDescription>{t("adapter.debug.description")}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 rounded-md bg-muted/40 p-3 text-xs">
            <span className="font-mono">
              {service.adapter} · {service.baseUrl}
            </span>
            <span className="text-muted-foreground">
              {t("adapter.debug.options")}:{" "}
              {options.length === 0
                ? t("adapter.debug.no-options")
                : options.map(([key, value]) => `${key}=${value}`).join(" · ")}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-widest text-muted-foreground">
              {t("adapter.debug.recent")}
            </span>
            {probes.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("adapter.debug.empty")}</p>
            ) : (
              <div className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto">
                {probes.map((entry) => (
                  <div key={entry.at} className="flex flex-col gap-0.5 py-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono text-muted-foreground">
                        {formatDateTime(i18n.language, entry.at)}
                      </span>
                      <Badge variant={entry.ok ? "secondary" : "destructive"}>
                        {t(entry.ok ? "adapter.debug.ok" : "adapter.debug.failed")}
                      </Badge>
                      <span className="font-mono text-muted-foreground">
                        {entry.durationMs} ms · {t("adapter.debug.attempts", { count: entry.attempts })}
                      </span>
                      {entry.notModified === true && (
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {t("adapter.debug.not-modified")}
                        </span>
                      )}
                    </div>
                    {/* The error itself, in full and unwrapped: it is the one
                        thing the container logs were being read for. */}
                    {entry.error !== undefined && (
                      <span className="font-mono text-[11px] break-words text-destructive">{entry.error}</span>
                    )}
                    {/* A read that worked and still did not say "operational".
                        Not destructive-coloured: nothing failed here, the
                        answer itself was the problem. */}
                    {entry.note !== undefined && (
                      <span className="font-mono text-[11px] break-words text-muted-foreground">{entry.note}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <div>
              <Button
                type="button"
                size="sm"
                disabled={probe.isPending}
                onClick={() => probe.mutate(service.id)}
              >
                {t(probe.isPending ? "adapter.debug.probing" : "adapter.debug.probe")}
              </Button>
            </div>

            {result !== undefined && (
              <div data-testid="adapter-probe-result" className="flex flex-col gap-1 text-xs">
                {result.ok && result.status !== undefined ? (
                  <>
                    <span>
                      {t("adapter.debug.probe-status")}:{" "}
                      <span className="font-mono">{t(statusLabelKey(result.status.overallStatus))}</span>
                    </span>
                    <span className="text-muted-foreground">
                      {t("adapter.debug.probe-incidents")}: {result.status.activeIncidents.length} ·{" "}
                      {t("adapter.debug.probe-components")}: {result.status.components.length} ·{" "}
                      {t("adapter.debug.probe-maintenances")}: {result.status.maintenances.length}
                    </span>
                    {/* The failure this panel exists for: the page was read and
                        the adapter recognised nothing in it. */}
                    {result.status.overallStatus === "unknown" &&
                      result.status.activeIncidents.length === 0 && (
                        <span className="text-destructive">{t("adapter.debug.unknown-warning")}</span>
                      )}
                  </>
                ) : (
                  <span className="font-mono break-words text-destructive">
                    {t("adapter.debug.probe-failed", { error: result.error ?? "" })}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
