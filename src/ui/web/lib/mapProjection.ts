/**
 * Equirectangular projection: longitude maps linearly to x, latitude linearly
 * to y. It is the projection the generated base grid is sampled on, so base
 * dots and status markers are placed by this one function and cannot drift out
 * of alignment.
 *
 * Not a general-purpose map projection, and not trying to be: nothing here
 * measures distance or area, and a card three hundred pixels tall gains nothing
 * from a conformal one.
 */
export function projectEquirect(
  lat: number,
  lon: number,
  width: number,
  height: number,
): { x: number; y: number } {
  return {
    x: ((lon + 180) / 360) * width,
    y: ((90 - lat) / 180) * height,
  };
}
