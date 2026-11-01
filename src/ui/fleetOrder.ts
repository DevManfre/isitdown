/**
 * The operator's own fleet order — roadmap 4.24.
 *
 * An empty order is the automatic one: the order the fleet has always been
 * listed in. A non-empty one ranks what it names first, in its order, and lets
 * everything it does not name follow in the automatic order — so a provider
 * added after the fleet was arranged lands at the end instead of vanishing,
 * and an id left behind by a removed provider simply ranks nothing.
 */
export function applyOrder<T extends { id: string }>(items: readonly T[], order: readonly string[]): T[] {
  if (order.length === 0) return [...items];
  const rank = new Map(order.map((id, index) => [id, index]));
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const left = rank.get(a.item.id) ?? order.length + a.index;
      const right = rank.get(b.item.id) ?? order.length + b.index;
      return left - right;
    })
    .map(({ item }) => item);
}
