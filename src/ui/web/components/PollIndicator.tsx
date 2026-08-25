import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { usePollNow, useStatus } from "@/hooks/queries.ts";
import { cn } from "@/lib/utils.ts";

export function PollIndicator() {
  const { t } = useTranslation();
  const { data: status } = useStatus();
  const poll = usePollNow();
  // Re-renders once a second so the countdown ticks without refetching.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const nextAt = status?.nextPollAt ?? null;
  const secondsLeft = nextAt === null ? null : Math.max(0, Math.round((Date.parse(nextAt) - Date.now()) / 1000));
  const due = secondsLeft !== null && secondsLeft === 0;

  // meta.countdown's template needs both {minutes} and {seconds} — matches
  // the vanilla renderCountdown() split, not a single rounded-up minute count.
  const minutesLeft = secondsLeft === null ? 0 : Math.floor(secondsLeft / 60);
  const remainderSeconds = secondsLeft === null ? 0 : secondsLeft % 60;

  const label =
    secondsLeft === null
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
            className={cn("poll-next-dot size-1.5 rounded-full bg-primary", due && "dot-pulse")}
          />
          <span className="poll-next-time font-mono text-sm">{label}</span>
        </span>
      </div>
      <Button type="button" disabled={poll.isPending} onClick={() => poll.mutate()}>
        {t("action.poll-now")}
      </Button>
    </div>
  );
}
