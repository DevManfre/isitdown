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
// node_modules/dotted-map/dist/without-countries.mjs). Recovering { lat, lon }
// from { x, y } would normally need the inverse of whatever map projection
// generated the grid — but requesting the "equirectangular" projection (the
// same one `projectEquirect` in mapProjection.ts already uses) makes that
// inverse pure linear interpolation: x is linear in longitude, y is linear in
// latitude, so no trigonometry and no extra dependency (proj4, which
// dotted-map itself depends on for the general case) is needed here.
//
// getMapJSON() — a plain function, not a class method — returns the same
// generation output a class instance's getPoints() would, but as the
// publicly-typed MapData shape (points, width, height, region, ...), so this
// reads real numbers off documented fields instead of reaching into a class
// instance's fields that the .d.ts marks `private` (they are plain enumerable
// properties at runtime, but getMapJSON's shape is the supported way to get
// them and won't break on a patch release the way reading `private` fields
// could).
//
// The region is passed explicitly rather than left at dotted-map's default:
// the default DEFAULT_WORLD_REGION only reaches lat -56..71 / lng -168..168,
// well short of what `projectEquirect` treats as the full map (-90..90 is
// unusable at the poles for a linear projection, so -60..84 covers the
// inhabited world without the extreme pole distortion; -180..180 is the full
// longitude range `projectEquirect` projects onto). Without this, a real PoP
// near either edge (e.g. Auckland, lon 174.76) would render past the last
// drawn land dot, floating in blank space — the grid's extent and the
// renderer's projection domain must agree by construction.
//
// Run: node --experimental-strip-types scripts/genMapGrid.ts
import { writeFileSync } from "node:fs";
import { getMapJSON } from "dotted-map";

const OUT = new URL("../src/ui/web/lib/mapGrid.generated.json", import.meta.url);

interface RawMapData {
  points: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

// Inhabited latitudes only, and the same full longitude span projectEquirect
// projects onto — see the header comment for why.
const REGION = { lat: { min: -60, max: 84 }, lng: { min: -180, max: 180 } };

// 60 rows of dots over the inhabited latitudes. Settled against the prototype
// in `design/`: denser reads as noise behind the status markers, sparser stops
// reading as a world.
const raw = JSON.parse(
  getMapJSON({ height: 60, grid: "diagonal", projection: { name: "equirectangular" }, region: REGION }),
) as RawMapData;

const points = Object.values(raw.points)
  .map(({ x, y }) => ({
    lat: Math.round((REGION.lat.max - (y / raw.height) * (REGION.lat.max - REGION.lat.min)) * 100) / 100,
    lon: Math.round((REGION.lng.min + (x / raw.width) * (REGION.lng.max - REGION.lng.min)) * 100) / 100,
  }))
  // Antarctica hosts nothing anyone monitors.
  .filter((point) => point.lat > -60);

writeFileSync(
  OUT,
  `${JSON.stringify({ width: 1000, height: 500, points })}\n`,
);
console.log(`wrote ${points.length} base points`);
