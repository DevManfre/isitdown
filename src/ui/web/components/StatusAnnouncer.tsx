import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useStatusChrome } from "@/hooks/queries.ts";
import { statusLabelKey } from "@/lib/chartConfig.ts";
import { statusById, statusChanges } from "@/lib/statusChanges.ts";

/** How many providers are named before the rest are counted — a long list read aloud helps nobody. */
const NAMED = 3;

/**
 * Says out loud what the page shows silently — roadmap 4.20.
 *
 * A status page driven by a live stream is exactly where a screen reader fails:
 * a dot changes colour, a count ticks, and nothing is announced, because the
 * operator did nothing to cause it. This is one visually hidden polite region in
 * the shell that names the providers whose status moved since the last read.
 *
 * Polite rather than assertive: the page is not interrupting something the
 * operator said, and a flapping provider must not talk over whatever they are
 * reading. Nothing is said for the first read (there is no "before"), and the
 * text clears itself so the same sentence, said twice, is announced twice.
 *
 * Chrome-safe like everything mounted in the shell: it reads through
 * `useStatusChrome`, which never throws, so a failed status read leaves it quiet.
 */
export function StatusAnnouncer() {
  const { t } = useTranslation();
  const { data } = useStatusChrome();
  const previous = useRef<Map<string, string> | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (data === undefined) return;
    const before = previous.current;
    previous.current = statusById(data.providers);
    if (before === null) return;
    const changes = statusChanges(before, data.providers);
    if (changes.length === 0) return;

    const named = changes
      .slice(0, NAMED)
      .map((change) => t("announce.status-changed", { provider: change.name, status: t(statusLabelKey(change.status)) }));
    const rest = changes.length - NAMED;
    setMessage(rest > 0 ? [...named, t("announce.status-more", { count: rest })].join(". ") : named.join(". "));
  }, [data, t]);

  // Cleared after it has been read, so an identical message later is a change
  // of text and is spoken again.
  useEffect(() => {
    if (message === "") return;
    const timer = setTimeout(() => setMessage(""), 6_000);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-slot="status-announcer" className="sr-only">
      {message}
    </div>
  );
}
