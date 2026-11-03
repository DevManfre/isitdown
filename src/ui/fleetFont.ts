/**
 * A 5x7 bitmap font — roadmap 4.25.
 *
 * The e-ink PNG is rasterised here rather than by a graphics library, because a
 * 1-bit picture of a list of names needs nothing a dependency would add and the
 * image has to render on an instance with no extra packages. Capitals, digits
 * and the punctuation a provider name carries; anything else draws as `?`.
 *
 * Each glyph is seven rows of five cells, `X` for ink.
 */
const GLYPH_SOURCE: Record<string, string> = {
  " ": ".....|.....|.....|.....|.....|.....|.....",
  A: ".XXX.|X...X|X...X|XXXXX|X...X|X...X|X...X",
  B: "XXXX.|X...X|X...X|XXXX.|X...X|X...X|XXXX.",
  C: ".XXX.|X...X|X....|X....|X....|X...X|.XXX.",
  D: "XXXX.|X...X|X...X|X...X|X...X|X...X|XXXX.",
  E: "XXXXX|X....|X....|XXXX.|X....|X....|XXXXX",
  F: "XXXXX|X....|X....|XXXX.|X....|X....|X....",
  G: ".XXX.|X...X|X....|X.XXX|X...X|X...X|.XXXX",
  H: "X...X|X...X|X...X|XXXXX|X...X|X...X|X...X",
  I: ".XXX.|..X..|..X..|..X..|..X..|..X..|.XXX.",
  J: "..XXX|...X.|...X.|...X.|...X.|X..X.|.XX..",
  K: "X...X|X..X.|X.X..|XX...|X.X..|X..X.|X...X",
  L: "X....|X....|X....|X....|X....|X....|XXXXX",
  M: "X...X|XX.XX|X.X.X|X.X.X|X...X|X...X|X...X",
  N: "X...X|XX..X|X.X.X|X..XX|X...X|X...X|X...X",
  O: ".XXX.|X...X|X...X|X...X|X...X|X...X|.XXX.",
  P: "XXXX.|X...X|X...X|XXXX.|X....|X....|X....",
  Q: ".XXX.|X...X|X...X|X...X|X.X.X|X..X.|.XX.X",
  R: "XXXX.|X...X|X...X|XXXX.|X.X..|X..X.|X...X",
  S: ".XXXX|X....|X....|.XXX.|....X|....X|XXXX.",
  T: "XXXXX|..X..|..X..|..X..|..X..|..X..|..X..",
  U: "X...X|X...X|X...X|X...X|X...X|X...X|.XXX.",
  V: "X...X|X...X|X...X|X...X|X...X|.X.X.|..X..",
  W: "X...X|X...X|X...X|X.X.X|X.X.X|XX.XX|X...X",
  X: "X...X|X...X|.X.X.|..X..|.X.X.|X...X|X...X",
  Y: "X...X|X...X|.X.X.|..X..|..X..|..X..|..X..",
  Z: "XXXXX|....X|...X.|..X..|.X...|X....|XXXXX",
  "0": ".XXX.|X...X|X..XX|X.X.X|XX..X|X...X|.XXX.",
  "1": "..X..|.XX..|..X..|..X..|..X..|..X..|.XXX.",
  "2": ".XXX.|X...X|....X|...X.|..X..|.X...|XXXXX",
  "3": "XXXXX|...X.|..X..|...X.|....X|X...X|.XXX.",
  "4": "...X.|..XX.|.X.X.|X..X.|XXXXX|...X.|...X.",
  "5": "XXXXX|X....|XXXX.|....X|....X|X...X|.XXX.",
  "6": "..XX.|.X...|X....|XXXX.|X...X|X...X|.XXX.",
  "7": "XXXXX|....X|...X.|..X..|.X...|.X...|.X...",
  "8": ".XXX.|X...X|X...X|.XXX.|X...X|X...X|.XXX.",
  "9": ".XXX.|X...X|X...X|.XXXX|....X|...X.|.XX..",
  ".": ".....|.....|.....|.....|.....|.XX..|.XX..",
  ",": ".....|.....|.....|.....|.XX..|..X..|.X...",
  "-": ".....|.....|.....|XXXXX|.....|.....|.....",
  _: ".....|.....|.....|.....|.....|.....|XXXXX",
  ":": ".....|.XX..|.XX..|.....|.XX..|.XX..|.....",
  "/": "....X|....X|...X.|..X..|.X...|X....|X....",
  "%": "XX..X|XX..X|...X.|..X..|.X...|X..XX|X..XX",
  "(": "...X.|..X..|.X...|.X...|.X...|..X..|...X.",
  ")": ".X...|..X..|...X.|...X.|...X.|..X..|.X...",
  "'": "..X..|..X..|.X...|.....|.....|.....|.....",
  "+": ".....|..X..|..X..|XXXXX|..X..|..X..|.....",
  "!": "..X..|..X..|..X..|..X..|..X..|.....|..X..",
  "?": ".XXX.|X...X|....X|...X.|..X..|.....|..X..",
  "#": ".X.X.|.X.X.|XXXXX|.X.X.|XXXXX|.X.X.|.X.X.",
  "&": ".XX..|X..X.|X.X..|.X...|X.X.X|X..X.|.XX.X",
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Advance of one character, in glyph cells: five of ink and one of air. */
export const GLYPH_ADVANCE = 6;

const parse = (source: string): boolean[][] => source.split("|").map((row) => [...row].map((cell) => cell === "X"));

const GLYPHS = new Map<string, boolean[][]>(Object.entries(GLYPH_SOURCE).map(([character, source]) => [character, parse(source)]));
const FALLBACK = GLYPHS.get("?") as boolean[][];

/** The glyph for a character, upper-cased; `?` for one the font does not carry. */
export function glyphFor(character: string): boolean[][] {
  return GLYPHS.get(character.toUpperCase()) ?? FALLBACK;
}
