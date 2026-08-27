// scripts/genMapGrid.ts
//
// One-time dev step, not part of `npm run build`: reduces dotted-map's land
// grid to the { lat, lon } list the dashboard renders. The package's only job
// is knowing which grid cells are land — placing them is
// `src/ui/web/lib/mapProjection.ts`, so the 729 KB of borders never has to
// reach a browser.
//
// dotted-map@3.1.0's getPoints() returns only { x, y } pixel coordinates for
// the base land grid — lat/lng is populated only on pins added via addPin(),
// never on the grid itself (see
// node_modules/dotted-map/dist/without-countries.mjs). To get the
// { lat, lon } this script actually needs, it replays the same inverse
// projection dotted-map runs internally to decide land vs. water in the
// first place (node_modules/dotted-map/dist/index.mjs, getMap()'s sampling
// loop), reading the map instance's X_MIN/Y_MAX/X_RANGE/Y_RANGE/proj4String.
// Those fields are typed `private` in dotted-map's .d.ts, but there is no
// real (`#`) private field backing them — they are plain enumerable
// properties at runtime, verified by inspecting the instance directly — so
// the cast below is a deliberate read of that runtime shape, not a guess.
// That's also why proj4 is a direct devDependency here: it's the exact
// library dotted-map itself uses for this projection.
//
// Run: node --experimental-strip-types scripts/genMapGrid.ts
import { writeFileSync } from "node:fs";
import DottedMap from "dotted-map";
import proj4 from "proj4";

const OUT = new URL("../src/ui/web/lib/mapGrid.generated.json", import.meta.url);

interface MapInternals {
  readonly X_MIN: number;
  readonly Y_MAX: number;
  readonly X_RANGE: number;
  readonly Y_RANGE: number;
  readonly width: number;
  readonly height: number;
  readonly proj4String: string;
}

// 60 rows of dots over the inhabited latitudes. Settled against the prototype
// in `design/`: denser reads as noise behind the status markers, sparser stops
// reading as a world.
const map = new DottedMap({ height: 60, grid: "diagonal" });
const internals = map as unknown as MapInternals;

const points = map
  .getPoints()
  .map(({ x, y }) => {
    const [lon, lat] = proj4(internals.proj4String, "WGS84", [
      (x / internals.width) * internals.X_RANGE + internals.X_MIN,
      internals.Y_MAX - (y / internals.height) * internals.Y_RANGE,
    ]);
    return {
      lat: Math.round(lat * 100) / 100,
      lon: Math.round(lon * 100) / 100,
    };
  })
  // Antarctica hosts nothing anyone monitors. dotted-map's default world
  // region already stops at lat -56 (see DEFAULT_WORLD_REGION in
  // node_modules/dotted-map/dist/index.mjs), so this ends up a no-op with
  // today's settings — kept as a guard in case that default ever reaches
  // further south.
  .filter((point) => point.lat > -60);

writeFileSync(
  OUT,
  `${JSON.stringify({ width: 1000, height: 500, points })}\n`,
);
console.log(`wrote ${points.length} base points`);
