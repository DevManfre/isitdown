import { useEffect, useState } from "react";

/**
 * The current time, re-read every `everyMs` — for figures that age on their own
 * ("open for 38 min", "last ping 12 min ago") between polls. Aligned to the
 * interval boundary, so every widget on the page ticks on the same beat rather
 * than each at its own offset from mount.
 */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(
        () => {
          setNow(Date.now());
          schedule();
        },
        everyMs - (Date.now() % everyMs),
      );
    };
    schedule();
    return () => clearTimeout(timer);
  }, [everyMs]);
  return now;
}
