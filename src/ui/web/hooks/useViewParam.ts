import { useCallback, useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { forget, recall, remember } from "@/lib/viewMemory.ts";

/**
 * One filter, sort or window of a view, carried by the address and remembered —
 * roadmap 4.16.
 *
 * Which of the three answers wins is the whole design:
 *
 * 1. the address, when it names the key — a link someone sent, or one the
 *    Overview built (roadmap 4.3), is what the operator just asked for;
 * 2. else what this browser last left the view on;
 * 3. else the default.
 *
 * Choosing writes both places: the address, so the page is a link; and the
 * memory, so the next visit through the rail is the same page. A choice equal to
 * the default is *removed* from both, which keeps links short and means a
 * cleared filter does not come back.
 *
 * `parse` returns null for anything that is not a legal value. The address and
 * the memory are both text somebody else could have written, and a view must
 * not render a state it has no control for.
 */
export function useViewParam<T extends string>(
  view: string,
  key: string,
  fallback: T,
  parse: (raw: string) => T | null,
): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  // Read once, at mount: what the browser held when the view opened. After the
  // operator's first choice it is spent — the address is the truth from then on.
  const [stored, setStored] = useState<T | null>(() => {
    const raw = recall(view)[key];
    return raw === undefined ? null : parse(raw);
  });

  const asked = params.get(key);
  const fromAddress = asked === null ? null : parse(asked);
  const value = fromAddress ?? stored ?? fallback;

  // A view opened with no word in the address puts the remembered one there, so
  // what is on screen is also what a copied link says.
  useEffect(() => {
    if (asked !== null || stored === null || stored === fallback) return;
    setParams(
      (current) => {
        if (current.has(key)) return current;
        const next = new URLSearchParams(current);
        next.set(key, stored);
        return next;
      },
      { replace: true },
    );
  }, [asked, stored, fallback, key, setParams]);

  const set = useCallback(
    (next: T) => {
      setStored(null);
      remember(view, key, next === fallback ? null : next);
      setParams(
        (current) => {
          const updated = new URLSearchParams(current);
          if (next === fallback) updated.delete(key);
          else updated.set(key, next);
          return updated;
        },
        { replace: true },
      );
    },
    [view, key, fallback, setParams],
  );

  return [value, set];
}

/** Forgets what a view remembered; for a "reset" control. */
export const forgetView = forget;
