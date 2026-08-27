import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import createGlobe, { type COBEOptions } from "cobe";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { statusLabelKey, statusTier, tierFill, type StatusTier } from "@/lib/chartConfig.ts";
import { projectGlobe } from "@/lib/globeProjection.ts";
import { tokenRgb } from "@/lib/tokenRgb.ts";
import { markerRadius, type MapCell } from "@/lib/mapCells.ts";

/** Same order the flat map uses, same reason: a fault must never be painted
 * under an operational neighbour. */
const DRAW_ORDER: Record<StatusTier, number> = { ok: 0, unknown: 1, warn: 2, danger: 3 };

/**
 * cobe 2.0.1's shipped `COBEOptions` (`node_modules/cobe/dist/index.d.ts`)
 * omits `onRender`, even though the runtime reads it and the package's own
 * README documents it as the way to drive rotation frame by frame. That is a
 * gap in the upstream `.d.ts`, not a real API limitation, so this patches the
 * type locally rather than casting the whole options object to `any`.
 */
type GlobeOptions = COBEOptions & {
  onRender?: (state: Record<string, number>) => void;
};

const SIZE = 480;
const RADIUS = SIZE / 2 - 8;
const THETA = 0.25;

/**
 * How often the marker overlay catches up to the canvas.
 *
 * cobe's `onRender` fires every animation frame. Calling `setState` there
 * would re-render ~80 markers 60 times a second on a dashboard an operator
 * leaves open all day. The rotation lives in a ref that `onRender` writes,
 * and the overlay re-reads it on this interval instead: at 0.002 rad/frame
 * the markers lag the globe by under a degree, invisible, for a sixth of the
 * renders that a per-frame `setState` would have cost.
 */
const OVERLAY_MS = 100;

/**
 * The rotating-globe view of the located fleet.
 *
 * cobe draws the earth; it does not draw the status markers. Its marker API
 * exposes a single `markerColor` for all markers, so it cannot express "this
 * PoP is down and this one is not" — so the markers are an SVG overlay above
 * the canvas, positioned by `projectGlobe`, with roughly half of them
 * correctly invisible at any rotation because they are on the far side.
 *
 * That last part is the honest cost of this view over the flat map, and the
 * reason the flat map is the one this dashboard reaches for by default when
 * the question is "where is the fleet degraded" — this view is an operator's
 * deliberate opt-in, never the default.
 */
export function StatusGlobe({
  cells,
  onSelect,
}: {
  cells: MapCell[];
  onSelect: (cell: MapCell) => void;
}) {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The canvas's live rotation. A ref, not state: `onRender` writes it every
  // frame, and a state write there would re-render the whole overlay 60
  // times a second. `phi` below is the sampled copy the markers are actually
  // drawn from.
  const rotationRef = useRef(0);
  const [phi, setPhi] = useState(0);
  // Bumped on a theme change so the effect below re-reads its tokens and
  // rebuilds the globe.
  const [themeEpoch, setThemeEpoch] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setPhi(rotationRef.current), OVERLAY_MS);
    return () => clearInterval(timer);
  }, []);

  // Tokens resolve differently per theme, so a theme flip has to rebuild the
  // globe rather than just re-render it. `data-theme` is how `useTheme`
  // stamps an explicit choice; a `system` choice instead follows the OS
  // media query, so both are watched.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setThemeEpoch((epoch) => epoch + 1));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onScheme = () => setThemeEpoch((epoch) => epoch + 1);
    media.addEventListener("change", onScheme);
    return () => {
      observer.disconnect();
      media.removeEventListener("change", onScheme);
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;

    // Typed as `GlobeOptions`, not inlined into the call: an object literal
    // passed straight to `createGlobe` would be checked against cobe's own
    // (incomplete) `COBEOptions` and rejected for the `onRender` it doesn't
    // declare. Going through a typed variable first is what lets the patched
    // type take effect without casting to `any`.
    const options: GlobeOptions = {
      devicePixelRatio: window.devicePixelRatio || 1,
      width: SIZE * 2,
      height: SIZE * 2,
      phi: 0,
      theta: THETA,
      dark: 1,
      diffuse: 1.2,
      mapSamples: 16000,
      mapBrightness: 6,
      // Resolved tokens, never literals: `tokens.css` stays the one place a
      // colour is decided, including in this WebGL uniform.
      baseColor: tokenRgb("--muted"),
      markerColor: tokenRgb("--status-accent"),
      glowColor: tokenRgb("--background"),
      markers: [],
      onRender: (state) => {
        rotationRef.current += 0.002;
        state["phi"] = rotationRef.current;
        // Deliberately no setState here — see OVERLAY_MS above. This
        // callback runs every frame; the overlay samples the ref on its own
        // interval instead.
      },
    };
    const globe = createGlobe(canvas, options);

    return () => globe.destroy();
  }, [themeEpoch]);

  // Worst-last, same reason as the flat map: a fault must not be painted
  // under an operational neighbour. Facing is filtered here too, so a marker
  // on the far side of the globe is never mounted at all — not hidden with
  // CSS, which would still take a tooltip's hover and a keyboard tab stop.
  const markers = useMemo(
    () =>
      cells
        .map((cell) => ({ cell, projected: projectGlobe(cell.lat, cell.lon, phi, THETA, RADIUS) }))
        .filter((entry) => entry.projected.facing)
        .sort(
          (a, b) => DRAW_ORDER[statusTier(a.cell.worst)] - DRAW_ORDER[statusTier(b.cell.worst)],
        ),
    [cells, phi],
  );

  return (
    <div className="relative mx-auto" style={{ width: SIZE, height: SIZE }}>
      <canvas ref={canvasRef} width={SIZE} height={SIZE} className="h-full w-full" aria-hidden="true" />
      <svg
        viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
        className="absolute inset-0 h-full w-full"
        role="img"
        aria-label={t("map.aria.globe")}
      >
        {markers.map(({ cell, projected }) => {
          const radius = markerRadius(cell.count);
          const tier = statusTier(cell.worst);
          const label = t("map.cell.aria", {
            count: cell.count,
            locations: cell.points.map((point) => point.name).join(", "),
            status: t(statusLabelKey(cell.worst)),
          });

          return (
            <Tooltip key={`${cell.lat},${cell.lon}`}>
              <TooltipTrigger asChild>
                <circle
                  role="button"
                  tabIndex={0}
                  aria-label={label}
                  cx={projected.x}
                  cy={projected.y}
                  r={radius}
                  fill={tierFill(tier)}
                  className="cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onSelect(cell)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(cell);
                    }
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-medium">{t(statusLabelKey(cell.worst))}</p>
                <p className="text-xs text-muted-foreground">
                  {cell.points
                    .slice(0, 6)
                    .map((point) => point.name)
                    .join(", ")}
                  {cell.points.length > 6 ? t("map.cell.more", { count: cell.points.length - 6 }) : ""}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </svg>
    </div>
  );
}
