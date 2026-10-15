import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import type { CoincidentPair, ServiceDefinition } from "@/lib/types.ts";

const STORAGE_KEY = "isitdown.coincidence.dismissed";

const pairKey = (pair: CoincidentPair): string => `${pair.providerId}|${pair.otherId}`;

/** Pairs dismissed on this browser. Storage can be blocked: then nothing is remembered. */
function readDismissed(): string[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(keys: string[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(keys));
  } catch {
    // Nothing to do: the pair simply comes back next time.
  }
}

/**
 * Providers that break together, offered as dependencies — roadmap 2.10.
 *
 * A shortlist, not a verdict: the hint says a pattern is not a cause. Declaring
 * one writes the same `dependsOn` the form does, so the empirical graph and the
 * declared one end up as one thing. Absent entirely when there is nothing to
 * propose.
 */
export function BreakTogetherCard({
  pairs,
  services,
  nameOf,
}: {
  pairs: CoincidentPair[];
  services: ServiceDefinition[];
  nameOf: (providerId: string) => string;
}) {
  const { t } = useTranslation();
  const { patch } = useServiceMutations();
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);
  const [error, setError] = useState<string | undefined>(undefined);

  const shown = pairs.filter((pair) => !pair.declared && !dismissed.includes(pairKey(pair)));
  if (shown.length === 0) return null;

  const dismiss = (pair: CoincidentPair): void => {
    const next = [...dismissed, pairKey(pair)];
    setDismissed(next);
    writeDismissed(next);
  };

  const declare = async (pair: CoincidentPair): Promise<void> => {
    const current = services.find((service) => service.id === pair.providerId)?.dependsOn ?? [];
    setError(undefined);
    try {
      await patch.mutateAsync({
        id: pair.providerId,
        patch: { dependsOn: [...new Set([...current, pair.otherId])] },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <section
      aria-label={t("coincidence.title")}
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4"
    >
      <span className="text-xs uppercase tracking-widest text-primary">{t("coincidence.title")}</span>
      <p className="max-w-prose text-sm text-muted-foreground">{t("coincidence.hint")}</p>
      <ul className="flex flex-col">
        {shown.map((pair) => (
          <li
            key={pairKey(pair)}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-border py-3"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium">
                {t("coincidence.row", {
                  a: nameOf(pair.providerId),
                  b: nameOf(pair.otherId),
                  together: pair.together,
                  of: pair.incidents,
                })}
              </span>
              <span className="font-mono text-xs text-muted-foreground">
                {t("coincidence.lift", { lift: pair.lift })}
              </span>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={patch.isPending}
                onClick={() => void declare(pair)}
              >
                {t("coincidence.declare")}
              </Button>
              <Button type="button" variant="ghost" onClick={() => dismiss(pair)}>
                {t("coincidence.dismiss")}
              </Button>
            </div>
          </li>
        ))}
      </ul>
      {error !== undefined && (
        <span role="alert" className="text-xs text-destructive">
          {t("coincidence.declare-failed", { error })}
        </span>
      )}
    </section>
  );
}
