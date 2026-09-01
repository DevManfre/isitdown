/**
 * Orthographic projection onto a rotating sphere, in the same convention cobe
 * uses for its own `phi` (rotation about the polar axis) and `theta` (tilt).
 *
 * This exists because cobe's marker API exposes a single `markerColor` for
 * every marker, so status-coloured dots cannot go through it. The markers are
 * an SVG overlay above the canvas instead, and an overlay has to do its own
 * projection — including deciding which markers are on the hemisphere facing
 * away from the viewer and must not be drawn at all.
 *
 * Returns coordinates relative to the globe's centre: the caller adds its own
 * centre offset, so the same numbers serve any canvas size.
 */
export function projectGlobe(
  lat: number,
  lon: number,
  phi: number,
  theta: number,
  radius: number,
): { x: number; y: number; facing: boolean } {
  const latRad = (lat * Math.PI) / 180;
  const lonRad = (lon * Math.PI) / 180 + phi;

  // Unit vector on the sphere, y up.
  const x0 = Math.cos(latRad) * Math.sin(lonRad);
  const y0 = Math.sin(latRad);
  const z0 = Math.cos(latRad) * Math.cos(lonRad);

  // Tilt about the x axis.
  const y1 = y0 * Math.cos(theta) - z0 * Math.sin(theta);
  const z1 = y0 * Math.sin(theta) + z0 * Math.cos(theta);

  return {
    x: x0 * radius,
    // SVG's y grows downward, the sphere's grows upward.
    y: -y1 * radius,
    // z1 > 0 is the hemisphere pointing at the viewer. A marker at exactly the
    // limb counts as hidden: half a dot bleeding over the edge reads as a
    // rendering fault.
    facing: z1 > 0,
  };
}
