// Tiny dependency-free RGBA rasterizer + PNG encoder for generated placeholder art and icons.
import { deflateSync } from 'node:zlib';

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(data).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

export function parseColor(c) {
  if (Array.isArray(c)) return [c[0], c[1], c[2], c[3] ?? 255];
  const h = c.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((x) => x + x).join('') : h.slice(0, 6), 16);
  const a = h.length === 8 ? parseInt(h.slice(6), 16) : 255;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
}

export class Raster {
  constructor(width, height, bg = [0, 0, 0, 0]) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
    if (bg) this.fill(bg);
  }

  fill(color) {
    const [r, g, b, a] = parseColor(color);
    for (let i = 0; i < this.data.length; i += 4) this.data.set([r, g, b, a], i);
  }

  blend(x, y, [r, g, b, a], cover = 1) {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const sa = (a / 255) * cover;
    const da = this.data[i + 3] / 255;
    const oa = sa + da * (1 - sa);
    if (oa <= 0) return;
    for (let k = 0; k < 3; k++) {
      const s = [r, g, b][k];
      this.data[i + k] = (s * sa + this.data[i + k] * da * (1 - sa)) / oa;
    }
    this.data[i + 3] = oa * 255;
  }

  verticalGradient(top, bottom, y0 = 0, y1 = this.height) {
    const a = parseColor(top);
    const b = parseColor(bottom);
    for (let y = y0; y < y1; y++) {
      const t = (y - y0) / Math.max(1, y1 - y0 - 1);
      const c = a.map((v, k) => v + (b[k] - v) * t);
      for (let x = 0; x < this.width; x++) this.blend(x, y, c);
    }
  }

  rect(x, y, w, h, color) {
    const c = parseColor(color);
    for (let j = Math.max(0, Math.floor(y)); j < Math.min(this.height, y + h); j++)
      for (let i = Math.max(0, Math.floor(x)); i < Math.min(this.width, x + w); i++)
        this.blend(i, j, c);
  }

  /** Anti-aliased filled ellipse. */
  ellipse(cx, cy, rx, ry, color) {
    const c = parseColor(color);
    for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
      for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        const edge = (1 - d) * Math.min(rx, ry);
        const cover = Math.max(0, Math.min(1, edge + 0.5));
        if (cover > 0) this.blend(x, y, c, cover);
      }
    }
  }

  circle(cx, cy, r, color) {
    this.ellipse(cx, cy, r, r, color);
  }

  /** Filled polygon (even-odd, 4x vertical supersampling). */
  polygon(points, color) {
    const c = parseColor(color);
    const ys = points.map((p) => p[1]);
    const minY = Math.max(0, Math.floor(Math.min(...ys)));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(...ys)));
    const cover = new Float32Array(this.width);
    for (let y = minY; y <= maxY; y++) {
      cover.fill(0);
      for (let s = 0; s < 4; s++) {
        const sy = y + (s + 0.5) / 4;
        const xs = [];
        for (let i = 0; i < points.length; i++) {
          const [x1, y1] = points[i];
          const [x2, y2] = points[(i + 1) % points.length];
          if ((y1 <= sy && y2 > sy) || (y2 <= sy && y1 > sy))
            xs.push(x1 + ((sy - y1) / (y2 - y1)) * (x2 - x1));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          for (
            let x = Math.max(0, Math.floor(xs[k]));
            x < Math.min(this.width, Math.ceil(xs[k + 1]));
            x++
          ) {
            const l = Math.max(x, xs[k]);
            const r = Math.min(x + 1, xs[k + 1]);
            if (r > l) cover[x] += (r - l) / 4;
          }
        }
      }
      for (let x = 0; x < this.width; x++)
        if (cover[x] > 0) this.blend(x, y, c, Math.min(1, cover[x]));
    }
  }

  /** Thick line as a polygon. */
  line(x1, y1, x2, y2, width, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.hypot(dx, dy) || 1;
    const nx = (-dy / len) * (width / 2);
    const ny = (dx / len) * (width / 2);
    this.polygon(
      [
        [x1 + nx, y1 + ny],
        [x2 + nx, y2 + ny],
        [x2 - nx, y2 - ny],
        [x1 - nx, y1 - ny],
      ],
      color,
    );
  }

  /** Text in a 5x7 bitmap font; `scale` = pixel size of one font dot. */
  text(str, x, y, scale, color) {
    const c = parseColor(color);
    let cx = x;
    for (const ch of str.toUpperCase()) {
      const glyph = FONT[ch] ?? FONT['?'];
      glyph.forEach((row, j) => {
        for (let i = 0; i < 5; i++) {
          if (row[i] === '#') {
            for (let yy = 0; yy < scale; yy++)
              for (let xx = 0; xx < scale; xx++)
                this.blend(Math.round(cx + i * scale + xx), Math.round(y + j * scale + yy), c);
          }
        }
      });
      cx += 6 * scale;
    }
  }

  static textWidth(str, scale) {
    return str.length * 6 * scale - scale;
  }

  png() {
    const raw = Buffer.alloc((this.width * 4 + 1) * this.height);
    for (let y = 0; y < this.height; y++) {
      raw[y * (this.width * 4 + 1)] = 0;
      Buffer.from(this.data.buffer, y * this.width * 4, this.width * 4).copy(
        raw,
        y * (this.width * 4 + 1) + 1,
      );
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.width, 0);
    ihdr.writeUInt32BE(this.height, 4);
    ihdr[8] = 8;
    ihdr[9] = 6; // RGBA
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

// prettier-ignore
const FONT = {
  'A': [' ### ','#   #','#   #','#####','#   #','#   #','#   #'],
  'B': ['#### ','#   #','#   #','#### ','#   #','#   #','#### '],
  'C': [' ### ','#   #','#    ','#    ','#    ','#   #',' ### '],
  'D': ['#### ','#   #','#   #','#   #','#   #','#   #','#### '],
  'E': ['#####','#    ','#    ','#### ','#    ','#    ','#####'],
  'F': ['#####','#    ','#    ','#### ','#    ','#    ','#    '],
  'G': [' ### ','#   #','#    ','# ###','#   #','#   #',' ####'],
  'H': ['#   #','#   #','#   #','#####','#   #','#   #','#   #'],
  'I': [' ### ','  #  ','  #  ','  #  ','  #  ','  #  ',' ### '],
  'J': ['  ###','   # ','   # ','   # ','   # ','#  # ',' ##  '],
  'K': ['#   #','#  # ','# #  ','##   ','# #  ','#  # ','#   #'],
  'L': ['#    ','#    ','#    ','#    ','#    ','#    ','#####'],
  'M': ['#   #','## ##','# # #','# # #','#   #','#   #','#   #'],
  'N': ['#   #','##  #','# # #','#  ##','#   #','#   #','#   #'],
  'O': [' ### ','#   #','#   #','#   #','#   #','#   #',' ### '],
  'P': ['#### ','#   #','#   #','#### ','#    ','#    ','#    '],
  'Q': [' ### ','#   #','#   #','#   #','# # #','#  # ',' ## #'],
  'R': ['#### ','#   #','#   #','#### ','# #  ','#  # ','#   #'],
  'S': [' ####','#    ','#    ',' ### ','    #','    #','#### '],
  'T': ['#####','  #  ','  #  ','  #  ','  #  ','  #  ','  #  '],
  'U': ['#   #','#   #','#   #','#   #','#   #','#   #',' ### '],
  'V': ['#   #','#   #','#   #','#   #','#   #',' # # ','  #  '],
  'W': ['#   #','#   #','#   #','# # #','# # #','# # #',' # # '],
  'X': ['#   #','#   #',' # # ','  #  ',' # # ','#   #','#   #'],
  'Y': ['#   #','#   #',' # # ','  #  ','  #  ','  #  ','  #  '],
  'Z': ['#####','    #','   # ','  #  ',' #   ','#    ','#####'],
  '0': [' ### ','#   #','#  ##','# # #','##  #','#   #',' ### '],
  '1': ['  #  ',' ##  ','  #  ','  #  ','  #  ','  #  ',' ### '],
  '2': [' ### ','#   #','    #','   # ','  #  ',' #   ','#####'],
  '3': ['#####','   # ','  #  ','   # ','    #','#   #',' ### '],
  '4': ['   # ','  ## ',' # # ','#  # ','#####','   # ','   # '],
  '5': ['#####','#    ','#### ','    #','    #','#   #',' ### '],
  '6': ['  ## ',' #   ','#    ','#### ','#   #','#   #',' ### '],
  '7': ['#####','    #','   # ','  #  ',' #   ',' #   ',' #   '],
  '8': [' ### ','#   #','#   #',' ### ','#   #','#   #',' ### '],
  '9': [' ### ','#   #','#   #',' ####','    #','   # ',' ##  '],
  ' ': ['     ','     ','     ','     ','     ','     ','     '],
  '-': ['     ','     ','     ','#####','     ','     ','     '],
  '.': ['     ','     ','     ','     ','     ',' ##  ',' ##  '],
  ':': ['     ',' ##  ',' ##  ','     ',' ##  ',' ##  ','     '],
  '/': ['    #','    #','   # ','  #  ',' #   ','#    ','#    '],
  '?': [' ### ','#   #','    #','   # ','  #  ','     ','  #  '],
  "'": ['  #  ','  #  ',' #   ','     ','     ','     ','     '],
};
