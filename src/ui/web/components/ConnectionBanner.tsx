import { WifiOff } from "lucide-react";
import { useTranslation } from "react-i18next";

import { useStreamLost } from "@/hooks/useLive.tsx";

/**
 * Says so when the live stream has been down long enough that the tab may be
 * showing old state with full confidence (roadmap 4.9). Nothing renders while
 * the stream is healthy, and the banner leaves by itself once it is back — the
 * provider re-reads every query at that moment, so it never has to be dismissed.
 */
export function ConnectionBanner() {
  const { t } = useTranslation();
  if (!useStreamLost()) return null;
  return (
    <div
      role="status"
      data-slot="connection-banner"
      className="flex items-center gap-2 border-b border-[var(--status-degraded-border)] bg-[var(--status-degraded-tint)] px-4 py-2 text-xs"
    >
      <WifiOff aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{t("connection.lost")}</span>
    </div>
  );
}
