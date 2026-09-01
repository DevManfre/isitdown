import { useEffect, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { usePollNow, useStatusChrome } from "@/hooks/queries.ts";
import { msUntilNextPoll } from "@/lib/statusRefetch.ts";
import { cn } from "@/lib/utils.ts";

export function PollIndicator() {
  const { t } = useTranslation();
  const { data: status, dataUpdatedAt } = useStatusChrome();
  const poll = usePollNow();
  // Re-renders once a second so the countdown ticks without refetching.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Corrected for any disagreement between the browser's clock and the
  // container's — see msUntilNextPoll. Comparing the server's timestamp
  // against a drifted browser clock pins the countdown at zero indefinitely.
  const msLeft = msUntilNextPoll(status, dataUpdatedAt, Date.now());
  const secondsLeft = msLeft === null ? null : Math.max(0, Math.round(msLeft / 1000));
  const due = secondsLeft !== null && secondsLeft === 0;
  // A spent deadline means the server's own cycle is due or already running,
  // which is indistinguishable from a manual one to everything downstream —
  // both are a poll in flight, and neither leaves anything to count down to.
  const polling = due || poll.isPending;

  // meta.countdown's template needs both {minutes} and {seconds} — matches
  // the vanilla renderCountdown() split, not a single rounded-up minute count.
  const minutesLeft = secondsLeft === null ? 0 : Math.floor(secondsLeft / 60);
  const remainderSeconds = secondsLeft === null ? 0 : secondsLeft % 60;

  const label = polling
    ? t("meta.polling")
    : secondsLeft === null
      ? t("meta.never-polled")
      : minutesLeft > 0
        ? t("meta.countdown", { minutes: minutesLeft, seconds: remainderSeconds })
        : t("meta.countdown-seconds", { seconds: remainderSeconds });

  return (
    <div className="header-poll flex items-center gap-4">
      <div className="poll-next flex flex-col">
        <span className="text-xs text-muted-foreground">{t("meta.next-poll-label")}</span>
        <span className="flex items-center gap-1.5">
          <span
            className={cn("poll-next-dot size-1.5 rounded-full bg-primary", polling && "dot-pulse")}
          />
          <span className="poll-next-time font-mono text-sm">{label}</span>
        </span>
      </div>
      <Button type="button" disabled={polling} aria-busy={polling} onClick={() => poll.mutate()}>
        {polling && <LoaderCircle className="animate-spin" aria-hidden="true" />}
        {t("action.poll-now")}
      </Button>
    </div>
  );
}
