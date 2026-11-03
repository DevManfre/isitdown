import { crc32, deflateSync } from "node:zlib";
import type { OverallStatus } from "../core/types.ts";
import { GLYPH_ADVANCE, GLYPH_HEIGHT, GLYPH_WIDTH, glyphFor } from "./fleetFont.ts";

/**
 * The fleet as a still picture — roadmap 4.25. Black on white and nothing else,
 * for an e-ink frame, a TRMNL, a kiosk Kindle, or a chat that wants one image.
 *
 * Status is told by words and by shape, never by colour: a panel with sixteen
 * greys (or two) has no red to show. A provider that is not operational is drawn
 * inverted, white on a black bar, so the problem is the thing the eye lands on,
 * and the worst rows come first so a fleet too long for the panel loses its
 * healthy tail rather than its outage.
 */

export interface FleetImageRow {
  name: string;
  status: OverallStatus;
}

export const DEFAULT_WIDTH = 800;
export const DEFAULT_HEIGHT = 480;
const MIN_SIDE = 200;
const MAX_SIDE = 2000;

const WORD: Record<OverallStatus, string> = {
  operational: "OK",
  degraded: "DEGRADED",
  partial_outage: "PARTIAL OUTAGE",
  major_outage: "DOWN",
  unknown: "UNKNOWN",
};

const SEVERITY: Record<OverallStatus, number> = {
  major_outage: 4,
  partial_outage: 3,
  degraded: 2,
  unknown: 1,
  operational: 0,
};

/** A requested side, clamped; anything that is not a whole number is the default. */
export function clampSide(raw: unknown, fallback: number): number {
  if (typeof raw !== "string" || !/^\d{1,5}$/.test(raw)) return fallback;
  return Math.min(MAX_SIDE, Math.max(MIN_SIDE, Number(raw)));
}

/** Worst first, then by name, so two renders of the same fleet are the same picture. */
export function arrange(rows: readonly FleetImageRow[]): FleetImageRow[] {
  return [...rows].sort((a, b) => SEVERITY[b.status] - SEVERITY[a.status] || a.name.localeCompare(b.name));
}

interface Layout {
  scale: number;
  margin: number;
  rowHeight: number;
  headerHeight: number;
  capacity: number;
  columns: number;
}

const layoutAt = (width: number, height: number, scale: number): Layout => {
  const margin = 4 * scale;
  const rowHeight = (GLYPH_HEIGHT + 5) * scale;
  const headerHeight = rowHeight * 2;
  const capacity = Math.max(0, Math.floor((height - headerHeight - margin) / rowHeight));
  const columns = Math.floor((width - margin * 2) / (GLYPH_ADVANCE * scale));
  return { scale, margin, rowHeight, headerHeight, capacity, columns };
};

/** The largest scale at which the whole fleet fits and names keep room; the smallest if none does. */
const layoutFor = (width: number, height: number, rowCount: number): Layout => {
  for (let scale = 6; scale > 1; scale -= 1) {
    const layout = layoutAt(width, height, scale);
    if (layout.capacity >= rowCount && layout.columns >= 28) return layout;
  }
  return layoutAt(width, height, 1);
};

/** What the picture says, as text lines — shared by the PNG and the SVG so they cannot disagree. */
export interface Plan {
  title: string;
  summary: string;
  lines: { left: string; right: string; alarm: boolean }[];
  more: number;
  layout: Layout;
}

export function plan(rows: readonly FleetImageRow[], width: number, height: number): Plan {
  const layout = layoutFor(width, height, rows.length);
  const ordered = arrange(rows);
  const broken = ordered.filter((row) => row.status !== "operational").length;
  const summary =
    ordered.length === 0 ? "NO PROVIDERS" : broken === 0 ? `ALL ${ordered.length} OK` : `${broken} OF ${ordered.length} NOT OK`;

  // One line of the capacity goes to "+N MORE" when the fleet does not fit.
  const fits = ordered.length <= layout.capacity;
  const shown = fits ? ordered : ordered.slice(0, Math.max(0, layout.capacity - 1));
  const lines = shown.map((row) => {
    const right = WORD[row.status];
    const room = Math.max(0, layout.columns - right.length - 4);
    const name = row.name.length > room ? `${row.name.slice(0, Math.max(0, room - 1))}.` : row.name;
    return { left: name, right, alarm: row.status !== "operational" };
  });
  return { title: "ISITDOWN", summary, lines, more: ordered.length - shown.length, layout };
}

// ---------------------------------------------------------------- SVG

const escapeXml = (text: string): string =>
  text.replace(/[<>&"']/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[character] ?? character);

/** The same picture as vector text, for a chat or a browser that would rather not decode a bitmap. */
export function renderFleetSvg(rows: readonly FleetImageRow[], width: number, height: number): string {
  const { title, summary, lines, more, layout } = plan(rows, width, height);
  const { scale, margin, rowHeight, headerHeight } = layout;
  const size = GLYPH_HEIGHT * scale + scale;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(`${title}: ${summary}`)}">`,
    `<rect width="${width}" height="${height}" fill="#fff"/>`,
    `<g font-family="DejaVu Sans Mono,Menlo,Consolas,monospace" font-size="${size}" font-weight="bold" fill="#000">`,
    `<text x="${margin}" y="${margin + size}">${escapeXml(title)}</text>`,
    `<text x="${width - margin}" y="${margin + size}" text-anchor="end">${escapeXml(summary)}</text>`,
    `<rect x="${margin}" y="${headerHeight - scale * 3}" width="${width - margin * 2}" height="${scale}"/>`,
  ];
  lines.forEach((line, index) => {
    const top = headerHeight + index * rowHeight;
    const ink = line.alarm ? "#fff" : "#000";
    if (line.alarm) parts.push(`<rect x="${margin}" y="${top}" width="${width - margin * 2}" height="${rowHeight - scale}"/>`);
    parts.push(
      `<text x="${margin + scale * 2}" y="${top + size}" fill="${ink}">${escapeXml(line.left)}</text>`,
      `<text x="${width - margin - scale * 2}" y="${top + size}" text-anchor="end" fill="${ink}">${escapeXml(line.right)}</text>`,
    );
  });
  if (more > 0) {
    parts.push(`<text x="${margin + scale * 2}" y="${headerHeight + lines.length * rowHeight + size}">+${more} MORE</text>`);
  }
  parts.push("</g>", "</svg>", "");
  return parts.join("\n");
}

// ---------------------------------------------------------------- PNG

/** A 1-bit canvas: `true` is ink. */
class Canvas {
  readonly pixels: Uint8Array;
  readonly width: number;
  readonly height: number;
  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  fill(x: number, y: number, w: number, h: number, ink: boolean): void {
    for (let row = Math.max(0, y); row < Math.min(this.height, y + h); row += 1) {
      for (let column = Math.max(0, x); column < Math.min(this.width, x + w); column += 1) {
        this.pixels[row * this.width + column] = ink ? 1 : 0;
      }
    }
  }

  text(x: number, y: number, value: string, scale: number, ink: boolean): void {
    [...value].forEach((character, index) => {
      const glyph = glyphFor(character);
      for (let row = 0; row < GLYPH_HEIGHT; row += 1) {
        for (let column = 0; column < GLYPH_WIDTH; column += 1) {
          if (glyph[row]?.[column]) this.fill(x + (index * GLYPH_ADVANCE + column) * scale, y + row * scale, scale, scale, ink);
        }
      }
    });
  }
}

const chunk = (type: string, data: Buffer): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** Pack the canvas as an 8-bit-free, 1-bit greyscale PNG: black ink on white paper. */
function encodePng(canvas: Canvas): Buffer {
  const stride = Math.ceil(canvas.width / 8);
  const raw = Buffer.alloc((stride + 1) * canvas.height, 0);
  for (let row = 0; row < canvas.height; row += 1) {
    const base = row * (stride + 1);
    raw[base] = 0; // filter: none
    for (let column = 0; column < canvas.width; column += 1) {
      // In greyscale 1-bit, 1 is white — so paper sets the bit and ink leaves it clear.
      if (canvas.pixels[row * canvas.width + column] === 0) {
        raw[base + 1 + (column >> 3)] = (raw[base + 1 + (column >> 3)] ?? 0) | (0x80 >> (column & 7));
      }
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(canvas.width, 0);
  header.writeUInt32BE(canvas.height, 4);
  header[8] = 1; // bit depth
  header[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function renderFleetPng(rows: readonly FleetImageRow[], width: number, height: number): Buffer {
  const { title, summary, lines, more, layout } = plan(rows, width, height);
  const { scale, margin, rowHeight, headerHeight } = layout;
  const canvas = new Canvas(width, height);
  const textTop = (rowTop: number): number => rowTop + Math.floor((rowHeight - GLYPH_HEIGHT * scale) / 2) - scale;

  canvas.text(margin, textTop(margin), title, scale, true);
  canvas.text(width - margin - summary.length * GLYPH_ADVANCE * scale + scale, textTop(margin), summary, scale, true);
  canvas.fill(margin, headerHeight - scale * 3, width - margin * 2, scale, true);

  lines.forEach((line, index) => {
    const top = headerHeight + index * rowHeight;
    if (line.alarm) canvas.fill(margin, top, width - margin * 2, rowHeight - scale, true);
    const ink = !line.alarm;
    canvas.text(margin + scale * 2, textTop(top), line.left, scale, ink);
    canvas.text(width - margin - scale * 2 - line.right.length * GLYPH_ADVANCE * scale + scale, textTop(top), line.right, scale, ink);
  });
  if (more > 0) canvas.text(margin + scale * 2, textTop(headerHeight + lines.length * rowHeight), `+${more} MORE`, scale, true);
  return encodePng(canvas);
}
