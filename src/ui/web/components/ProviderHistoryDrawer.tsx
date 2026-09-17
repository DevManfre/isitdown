import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet.tsx";
import { ProviderDetailPanel } from "@/components/ProviderDetailPanel.tsx";
import { StatusDot } from "@/components/charts/StatusDot.tsx";
import type { ComponentStatus, MaintenanceWindow } from "@/lib/types.ts";
import type { HistoryWindow } from "@/lib/api.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";

/**
 * One provider's history in a drawer: the panel, and a heading over it.
 *
 * This is where everything the list stopped showing went. The list answers
 * "which provider, and which way is it going"; this answers "what happened",
 * and costs a click rather than 1400px of always-open component rows. Since
 * roadmap 5.6 the same panel is also a page of its own, which a deep link can
 * reach — the drawer stays the one-click look from a list, not the only way in.
 *
 * `providerId` is null while the drawer is closed, which is also what keeps the
 * queries inside the panel from firing: they are gated on it. The panel is
 * mounted either way and unmounts with the Sheet, so a closed drawer fetches
 * nothing.
 */
export function ProviderHistoryDrawer({
  providerId, name, status, components, selection, historyWindow, upcoming, onClose,
}: {
  providerId: string | null;
  name: string;
  status: string;
  components: ComponentStatus[];
  selection: { id: string; name: string }[];
  /**
   * The window the page is showing — a fixed span, or a picked range (5.5).
   * Named in full rather than `window`, which would shadow the global one.
   */
  historyWindow: HistoryWindow;
  /** Declared windows that haven't started yet — `ProviderStatus.maintenance.upcoming`. */
  upcoming: MaintenanceWindow[];
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <Sheet open={providerId !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* No background override here, deliberately: `SheetContent` paints
          `bg-background`, and the daily bars draw an unsampled day in
          `--status-unknown`, which reads on that token and disappears on
          `--card`. Painting this on the surface token loses the whole
          unmeasured stretch of every bar row — do not "tidy" it to `bg-card`. */}
      <SheetContent side="right" className="w-full gap-4 overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            {/* The drawer's heading is the provider's name and this dot; the
                status is nowhere else on it, so the dot carries it in words. */}
            <StatusDot status={status} label={t(statusLabelKey(status))} />
            {name}
          </SheetTitle>
        </SheetHeader>

        <ProviderDetailPanel
          providerId={providerId}
          components={components}
          selection={selection}
          historyWindow={historyWindow}
          upcoming={upcoming}
        />
      </SheetContent>
    </Sheet>
  );
}
