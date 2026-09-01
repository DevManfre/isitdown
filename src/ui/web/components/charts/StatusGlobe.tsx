import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import createGlobe, { type COBEOptions } from "cobe";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip.tsx";
import { drawOrder, statusLabelKey, statusTier, tierFill } from "@/lib/chartConfig.ts";
import { projectGlobe } from "@/lib/globeProjection.ts";
import { tokenRgb } from "@/lib/tokenRgb.ts";
import { describeLocations, markerRadius, type MapCell } from "@/lib/mapCells.ts";

const SIZE = 480;
/**
 * Radius of the marker overlay's circle, in the same pixel space as `SIZE`.
 *
 * Not a free choice: cobe draws the earth at a fixed radius relative to its
 * canvas, and the overlay has to land markers on that same sphere. Verified
 * directly against the installed package
 * (`node_modules/cobe/dist/index.esm.js`): its fragment shader tests the
 * sphere with `if(a<=.64)` and derives the surface normal via
 * `sqrt(.64-a)`, where `a` is the squared distance from centre in a
 * coordinate space that spans [-1, 1] across the canvas — so cobe's earth has
 * radius² = 0.64, i.e. radius = 0.8 of half-width. Its `scale` option
 * (`B = t.scale||1` in the same file) defaults to 1, and this component
 * passes none, so at `SIZE = 480` the earth is drawn at `0.8 * 240 = 192`px.
 *
 * `SIZE * 0.4` is exactly that: `0.8 * (SIZE / 2)`. The previous value here,
 * `SIZE / 2 - 8` = 232, assumed the earth nearly fills the canvas — it
 * doesn't — and put markers 20.8% further out than the globe's own edge,
 * landing roughly a third of them in the empty space beyond it. If a `scale`
 * option is ever passed to `createGlobe` below, this constant must be
 * multiplied by it too, or the mismatch comes back.
 */
const RADIUS = SIZE * 0.4;
const THETA = 0.25;

/**
 * How often the marker overlay catches up to the canvas.
 *
 * The rotation loop below (`requestAnimationFrame` driving `globe.update()`)
 * runs every animation frame. Calling `setState` there would re-render ~80
 * markers 60 times a second on a dashboard an operator leaves open all day.
 * The rotation lives in a ref that loop writes, and the overlay re-reads it
 * on this interval instead: at 0.002 rad/frame the markers lag the globe by
 * under a degree, invisible, for a sixth of the renders that a per-frame
 * `setState` would have cost.
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
  // The canvas's live rotation. A ref, not state: the rotation loop below
  // writes it every frame, and a state write there would re-render the whole
  // overlay 60 times a second. `phi` below is the sampled copy the markers
  // are actually drawn from.
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

    const options: COBEOptions = {
      devicePixelRatio: window.devicePixelRatio || 1,
      width: SIZE * 2,
      height: SIZE * 2,
      phi: 0,
      theta: THETA,
      // `dark: 1` selects cobe's "glowing dots on a black ocean" rendering
      // path rather than "flat-lit grey sphere" — the two are genuinely
      // different shader branches, not a brightness slider, so this can't be
      // eased up gradually. It reads correctly in both themes: verified with
      // a standalone cobe harness driving this exact value against both
      // `--muted` tones (the harness was needed because, as it turned out,
      // this value was never the bug — see the note right after the
      // `createGlobe` call below).
      dark: 1,
      // How sharply a dot's brightness falls off from the sphere's centre
      // toward its limb (`pow(facing, diffuse)`). 1.2 is cobe's own README
      // default; lower values (tried 0.4 in the harness) just wash out the
      // limb faster with no gain in legibility, so this was left alone.
      diffuse: 1.2,
      mapSamples: 16000,
      // Land dots are drawn several times over-bright on purpose and clip to
      // white (`baseColor * mapBrightness`, mapBrightness = 6): that's what
      // makes them read as crisp dots against the near-black ocean
      // (`baseColor * 0.1`) rather than a faint grey smudge. Confirmed
      // against both `--muted` tones in the harness; there was no need to
      // move off cobe's own README default here either.
      mapBrightness: 6,
      // Resolved tokens, never literals: `tokens.css` stays the one place a
      // colour is decided, including in this WebGL uniform.
      baseColor: tokenRgb("--muted"),
      markerColor: tokenRgb("--status-accent"),
      glowColor: tokenRgb("--background"),
      markers: [],
    };
    const globe = createGlobe(canvas, options);

    // cobe 2.0.1's actual runtime (`node_modules/cobe/dist/index.esm.js`) has
    // no `onRender` callback at all — the string does not appear anywhere in
    // it, despite the package's own README still documenting one. `createGlobe`
    // paints a single frame synchronously at construction time, using its 1x1
    // black placeholder texture (the real world-map `<img>` is still decoding
    // off a data: URI at that point), and never repaints again on its own.
    // That single stale frame is the entire "featureless black ball" bug: no
    // colour or brightness value could ever have fixed it, because the real
    // map texture was never painted in the first place. The fix is to drive
    // rendering ourselves, the way cobe's returned `update()` method actually
    // expects, on a real `requestAnimationFrame` loop — which also happens to
    // be what makes the earth rotate at all.
    let frame: number;
    const tick = () => {
      rotationRef.current += 0.002;
      globe.update({ phi: rotationRef.current });
      // Deliberately no setState here — see OVERLAY_MS above. This runs every
      // frame; the overlay samples the ref on its own interval instead.
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      globe.destroy();
    };
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
          (a, b) => drawOrder(statusTier(a.cell.worst)) - drawOrder(statusTier(b.cell.worst)),
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
          // Same cap as the tooltip below, via the same helper: before this,
          // the tooltip capped at 6 names and the aria-label did not, so a
          // screen-reader user heard every PoP a sighted one only saw six of.
          const { shown, more } = describeLocations(cell.points);
          const label = t("map.cell.aria", {
            count: cell.count,
            locations: shown.join(", ") + (more > 0 ? t("map.cell.more", { count: more }) : ""),
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
                  {shown.join(", ")}
                  {more > 0 ? t("map.cell.more", { count: more }) : ""}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </svg>
    </div>
  );
}
