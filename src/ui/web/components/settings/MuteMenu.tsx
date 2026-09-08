import { useTranslation } from "react-i18next";
import { BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button.tsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.tsx";
import { useServiceMutations } from "@/hooks/queries.ts";
import { isMuted } from "@/lib/mute.ts";
import type { ServiceDefinition } from "@/lib/types.ts";

/**
 * The durations offered. Short enough to cover "I am already looking at it",
 * long enough to cover "this provider is having a week" — an operator who
 * wants longer than a day is really asking to disable the provider, which the
 * switch beside this menu already does.
 */
const DURATIONS: { minutes: number; labelKey: string }[] = [
  { minutes: 30, labelKey: "mute.for-30" },
  { minutes: 120, labelKey: "mute.for-120" },
  { minutes: 480, labelKey: "mute.for-480" },
  { minutes: 1440, labelKey: "mute.for-1440" },
];

/**
 * "I know, stop telling me, for two hours."
 *
 * A mute is written as a timestamp on the service, which is what makes it a
 * diff-engine input rather than a filter on the way out: while it runs, the
 * engine reports nothing for the provider, and the dashboard can show that the
 * silence was asked for. Lifting it early is the same write with `null`.
 */
export function MuteMenu({ service }: { service: ServiceDefinition }) {
  const { t } = useTranslation();
  const { patch } = useServiceMutations();
  const muted = isMuted(service.mutedUntil);

  const setMute = (minutes: number | null): void => {
    patch.mutate({
      id: service.id,
      patch: {
        mutedUntil: minutes === null ? null : new Date(Date.now() + minutes * 60_000).toISOString(),
      },
    });
  };

  if (muted) {
    return (
      <Button type="button" variant="secondary" size="sm" onClick={() => setMute(null)}>
        <BellRing className="size-3" />
        {t("action.unmute")}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="secondary" size="sm">
          <BellOff className="size-3" />
          {t("action.mute")}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {/* The label is a literal key per duration rather than one built from
            the number: a key reached only through interpolation is invisible to
            the catalog's own dead-key scan. */}
        {DURATIONS.map(({ minutes, labelKey }) => (
          <DropdownMenuItem key={minutes} onSelect={() => setMute(minutes)}>
            {t(labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
