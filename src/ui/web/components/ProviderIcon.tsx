import { useState } from "react";
import { faviconCandidates } from "@/lib/favicon.ts";
import { cn } from "@/lib/utils.ts";

/**
 * A provider's favicon at text size, with the same candidate walk UptimeRing
 * does (page favicon, then the DuckDuckGo icon service) and the same white
 * disc under it, so a dark mark stays visible on the dashboard's dark surface.
 * Falls back to the first letters of the name — never to nothing, since the
 * icon is what tells one row from the next.
 */
export function ProviderIcon({
  name, baseUrl, size = 16, className,
}: { name: string; baseUrl: string; size?: number; className?: string }) {
  const candidates = faviconCandidates(baseUrl);
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const icon = candidates[attempt];

  return (
    <span
      data-slot="provider-icon"
      className={cn("inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      {icon !== undefined && (
        <img
          role="presentation"
          alt=""
          src={icon}
          className={loaded ? "rounded-full bg-[var(--ring-icon-bg)] object-contain" : "hidden"}
          style={{ width: size, height: size, padding: Math.max(1, Math.round(size * 0.1)) }}
          onLoad={() => setLoaded(true)}
          onError={() => setAttempt((n) => n + 1)}
        />
      )}
      {!loaded && (
        <span className="font-mono text-[9px] leading-none text-muted-foreground">
          {name.slice(0, 2).toUpperCase()}
        </span>
      )}
    </span>
  );
}
