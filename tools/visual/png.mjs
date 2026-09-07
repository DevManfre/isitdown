import { inflateSync } from "node:zlib";

/**
 * Just enough PNG to compare two screenshots.
 *
 * Playwright's screenshot CLI writes 8-bit RGB/RGBA PNGs, and comparing them
 * needs pixels rather than bytes: two runs of the same page produce different
 * compressed streams for identical images, so a byte comparison reports a
 * difference on every run and is worse than no check at all.
 *
 * A real image library would be a dependency this project does not want for a
 * dev-only check (see CLAUDE.md on the three-runtime-dependency rule), and PNG
 * decoding is inflate plus one unfilter pass, so it lives here.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Bytes per pixel per PNG colour type. Only the two Playwright emits are supported. */
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Reverses the per-scanline filter PNG applies before compression. */
function unfilter(raw, width, height, bpp) {
  const stride = width * bpp;
  const out = Buffer.alloc(stride * height);
  let offset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[offset];
    offset += 1;
    const line = raw.subarray(offset, offset + stride);
    offset += stride;
    const target = out.subarray(row * stride, (row + 1) * stride);
    const previous = row === 0 ? null : out.subarray((row - 1) * stride, row * stride);

    for (let index = 0; index < stride; index += 1) {
      const left = index >= bpp ? target[index - bpp] : 0;
      const up = previous === null ? 0 : previous[index];
      const upLeft = previous === null || index < bpp ? 0 : previous[index - bpp];
      const value = line[index];
      switch (filter) {
        case 0:
          target[index] = value;
          break;
        case 1:
          target[index] = (value + left) & 0xff;
          break;
        case 2:
          target[index] = (value + up) & 0xff;
          break;
        case 3:
          target[index] = (value + ((left + up) >> 1)) & 0xff;
          break;
        case 4:
          target[index] = (value + paeth(left, up, upLeft)) & 0xff;
          break;
        default:
          throw new Error(`unsupported PNG filter ${filter} on row ${row}`);
      }
    }
  }
  return out;
}

/** Decodes a PNG buffer to `{ width, height, bpp, pixels }`. */
export function decodePng(buffer) {
  if (!buffer.subarray(0, 8).equals(SIGNATURE)) throw new Error("not a PNG");

  let offset = 8;
  let header;
  const idat = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === "IHDR") {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
      if (header.depth !== 8) throw new Error(`unsupported PNG bit depth ${header.depth}`);
      if (header.interlace !== 0) throw new Error("interlaced PNGs are not supported");
      if (CHANNELS[header.colorType] === undefined) {
        throw new Error(`unsupported PNG colour type ${header.colorType}`);
      }
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
  }
  if (header === undefined) throw new Error("PNG has no IHDR");

  const bpp = CHANNELS[header.colorType];
  const pixels = unfilter(inflateSync(Buffer.concat(idat)), header.width, header.height, bpp);
  return { width: header.width, height: header.height, bpp, pixels };
}

/**
 * Compares two decoded images, counting two kinds of difference.
 *
 * `differing` is every pixel that moved at all beyond `threshold`, which is
 * what catches a layout change — something shifted, appeared or vanished, and
 * that redraws a large share of the frame.
 *
 * `recoloured` counts only the pixels that moved *a lot* (`strongThreshold`),
 * which is what catches a colour change: a status colour is a handful of dots
 * and a few words, far too small a share of a 1440×900 frame to trip a
 * whole-frame ratio, but a change nobody asked for all the same. Both are
 * reported, and the caller decides.
 *
 * `threshold` is per channel, in 0–255: sub-pixel antialiasing differs by a
 * point or two between runs of the same page, and calling that a regression
 * would make the check unusable.
 */
export function comparePng(left, right, threshold = 8, strongThreshold = 64) {
  if (left.width !== right.width || left.height !== right.height) {
    const total = left.width * left.height;
    return { sizeChanged: true, differing: total, recoloured: total, total, ratio: 1 };
  }

  const total = left.width * left.height;
  let differing = 0;
  let recoloured = 0;
  for (let pixel = 0; pixel < total; pixel += 1) {
    const l = pixel * left.bpp;
    const r = pixel * right.bpp;
    let worst = 0;
    // Compares the channels both images have; an RGB and an RGBA screenshot of
    // the same page still compare on colour.
    for (let channel = 0; channel < Math.min(left.bpp, right.bpp); channel += 1) {
      const delta = Math.abs(left.pixels[l + channel] - right.pixels[r + channel]);
      if (delta > worst) worst = delta;
    }
    if (worst > threshold) differing += 1;
    if (worst > strongThreshold) recoloured += 1;
  }

  return { sizeChanged: false, differing, recoloured, total, ratio: differing / total };
}
