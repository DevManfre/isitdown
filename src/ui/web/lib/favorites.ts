/**
 * One page of the wallboard (roadmap 5.14). Starred providers are on every page
 * and the rest rotate through the places they leave, so the screen left on all
 * day always shows what the operator said matters.
 *
 * When the stars would take the whole page there is no place left to rotate
 * into, and pinning them would hide everyone else for good. That case is plain
 * pagination with the starred first: nobody drops out of the rotation.
 */
export function wallboardPage<T extends { favorite?: boolean | undefined }>(
  providers: T[],
  page: number,
  perPage: number,
): { shown: T[]; pages: number } {
  const starred = providers.filter((provider) => provider.favorite === true);
  const rest = providers.filter((provider) => provider.favorite !== true);
  const places = perPage - starred.length;

  if (starred.length === 0 || places < 1) {
    const ordered = [...starred, ...rest];
    return {
      shown: ordered.slice(page * perPage, page * perPage + perPage),
      pages: Math.max(1, Math.ceil(ordered.length / perPage)),
    };
  }
  return {
    shown: [...starred, ...rest.slice(page * places, page * places + places)],
    pages: Math.max(1, Math.ceil(rest.length / places)),
  };
}
