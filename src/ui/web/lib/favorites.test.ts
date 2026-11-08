import { describe, expect, it } from "vitest";
import { wallboardPage } from "./favorites.ts";

const fleet = (count: number, starred: number[] = []) =>
  Array.from({ length: count }, (_, index) => ({ id: `p${index}`, favorite: starred.includes(index) }));

const ids = (providers: { id: string }[]) => providers.map((provider) => provider.id);

describe("wallboardPage", () => {
  it("is plain pagination while nothing is starred", () => {
    const first = wallboardPage(fleet(10), 0, 4);
    const last = wallboardPage(fleet(10), 2, 4);
    expect(first.pages).toBe(3);
    expect(ids(first.shown)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(ids(last.shown)).toEqual(["p8", "p9"]);
  });

  it("keeps a starred provider on every page and rotates the rest through the remaining places", () => {
    const providers = fleet(10, [7]);
    const pages = [0, 1, 2].map((page) => wallboardPage(providers, page, 4));

    expect(pages.map((entry) => entry.pages)).toEqual([3, 3, 3]);
    for (const { shown } of pages) expect(ids(shown)[0]).toBe("p7");
    // Nine others across three places a page: nobody drops out of the rotation.
    expect(pages.flatMap(({ shown }) => ids(shown).slice(1)).sort()).toEqual(
      ids(providers).filter((id) => id !== "p7").sort(),
    );
  });

  it("puts the starred ones first on the page, in the order the fleet lists them", () => {
    expect(ids(wallboardPage(fleet(6, [4, 1]), 0, 4).shown).slice(0, 2)).toEqual(["p1", "p4"]);
  });

  it("needs one page when everything fits, starred or not", () => {
    const { shown, pages } = wallboardPage(fleet(3, [2]), 0, 8);
    expect(pages).toBe(1);
    expect(ids(shown)).toEqual(["p2", "p0", "p1"]);
  });

  it("falls back to plain pagination, starred first, when the stars leave no place for the rest", () => {
    const providers = fleet(10, [0, 1, 2, 3]);
    const pages = [0, 1, 2].map((page) => wallboardPage(providers, page, 4));
    expect(pages.map((entry) => entry.pages)).toEqual([3, 3, 3]);
    expect(ids(pages[0]?.shown ?? [])).toEqual(["p0", "p1", "p2", "p3"]);
    expect(pages.flatMap(({ shown }) => ids(shown)).sort()).toEqual(ids(providers).sort());
  });

  it("shows nothing, on one page, for an empty fleet", () => {
    expect(wallboardPage([], 0, 8)).toEqual({ shown: [], pages: 1 });
  });
});
