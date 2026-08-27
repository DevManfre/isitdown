import { UptimeRing } from "@/components/charts/UptimeRing.tsx";
import type { ProviderStatus } from "@/lib/types.ts";
import { cn } from "@/lib/utils.ts";

/**
 * The fleet as rings, in the two shapes that still draw them.
 *
 * `compact` keeps the 80px tiles beside the hero copy as one wrapping row —
 * not a fixed column count, which left an empty cell at four providers and a
 * ragged 3+1 at five. Six fixed-width tiles are 752px, so they sit on one line
 * next to the copy on any normal window and wrap only when it narrows. `band` takes
 * the full width under the copy at 56px and hands the column count to
 * `auto-fit`: the viewport decides how many fit, which is why no threshold in
 * `overviewShape` mentions columns. `auto-fit`, not `auto-fill`: the latter
 * keeps its empty tracks, which put the dead space back on the right.
 *
 * Entry delays step at 80ms in compact and 40ms in band — same cascade, but
 * fourteen tiles at 80ms would still be arriving a second after the hero.
 */
export function FleetRings({
  providers, shape,
}: {
  providers: ProviderStatus[];
  shape: "compact" | "band";
}) {
  const compact = shape === "compact";

  return (
    <div
      className={cn(
        "ring-grid",
        compact
          ? "flex flex-wrap justify-end gap-4"
          : "grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-3",
      )}
    >
      {providers.map((provider, index) => (
        <UptimeRing
          key={provider.id}
          provider={provider}
          size={compact ? 80 : 56}
          delay={`${120 + index * (compact ? 80 : 40)}ms`}
        />
      ))}
    </div>
  );
}
