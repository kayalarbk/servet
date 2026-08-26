/* =====================================================================
   make-icons.mjs — Bağımlılıksız PNG ikon üreteci
   Node 18+ ile:  node tools/make-icons.mjs
   Lacivert zemin + altın gradyanlı altıgen ve "S" markası üretir.
   Web (favicon/PWA) ve telefon (Android maskable, iOS apple-touch) boyutları.
   ===================================================================== */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
mkdirSync(OUT, { recursive: true });

/* ---------------- PNG kodlayıcı ---------------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = buf => {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------------- Basit rasterleyici (4x4 süper örnekleme) ---------------- */
const SS = 4;
const mix = (a, b, t) => a + (b - a) * t;

function makeCanvas(size) {
  const w = size * SS;
  const px = new Float64Array(w * w * 4);
  return {
    size, w, px,
    set(x, y, r, g, b, a) {
      if (x < 0 || y < 0 || x >= w || y >= w || a <= 0) return;
      const i = (y * w + x) * 4;
      const ia = px[i + 3];
      const na = a + ia * (1 - a);
      px[i]     = (r * a + px[i]     * ia * (1 - a)) / (na || 1);
      px[i + 1] = (g * a + px[i + 1] * ia * (1 - a)) / (na || 1);
      px[i + 2] = (b * a + px[i + 2] * ia * (1 - a)) / (na || 1);
      px[i + 3] = na;
    },
    // SS x SS örnekleri tek piksele indir
    toRGBA() {
      const out = Buffer.alloc(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          let r = 0, g = 0, b = 0, a = 0;
          for (let sy = 0; sy < SS; sy++) {
            for (let sx = 0; sx < SS; sx++) {
              const i = ((y * SS + sy) * this.w + x * SS + sx) * 4;
              r += px[i] * px[i + 3]; g += px[i + 1] * px[i + 3];
              b += px[i + 2] * px[i + 3]; a += px[i + 3];
            }
          }
          const n = SS * SS, o = (y * size + x) * 4;
          out[o]     = a ? Math.round(r / a) : 0;
          out[o + 1] = a ? Math.round(g / a) : 0;
          out[o + 2] = a ? Math.round(b / a) : 0;
          out[o + 3] = Math.round(a / n * 255);
        }
      }
      return out;
    }
  };
}

/* Renk yardımcıları — koordinatlar 0..120 birimlik tasarım ızgarasında */
const NAVY_A = [16, 32, 78], NAVY_B = [5, 11, 30];
const CREAM_A = [253, 250, 242], CREAM_B = [238, 227, 198];
const NAVY_INK = [11, 21, 51];
const GOLD_A = [246, 226, 122], GOLD_B = [212, 175, 55], GOLD_C = [154, 110, 8];

function goldAt(t) {                        // t: 0..1 diyagonal konum
  const c = t < 0.5
    ? GOLD_A.map((v, i) => mix(v, GOLD_B[i], t / 0.5))
    : GOLD_B.map((v, i) => mix(v, GOLD_C[i], (t - 0.5) / 0.5));
  return c;
}

/* Zemin: yuvarlatılmış kare + radyal lacivert gradyan */
function drawBackground(cv, radiusPct, bleed) {
  const w = cv.w, R = w * radiusPct;
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      let inside = 1;
      if (!bleed) {
        const dx = Math.max(R - x, x - (w - R), 0);
        const dy = Math.max(R - y, y - (w - R), 0);
        const d = Math.hypot(dx, dy);
        inside = d <= R ? 1 : Math.max(0, 1 - (d - R));
        if (dx === 0 && dy === 0) inside = 1;
      }
      if (inside <= 0) continue;
      const t = Math.min(1, Math.hypot(x - w * 0.35, y - w * 0.28) / (w * 0.85));
      const c = CREAM_A.map((v, i) => mix(v, CREAM_B[i], t));
      cv.set(x, y, c[0], c[1], c[2], inside);
    }
  }
}

/* Kalın çizgi (polyline) — yuvarlak uç ve birleşimlerle, altın gradyan */
function strokePolyline(cv, pts, width, alpha, color) {
  const S = cv.w / 120;
  const P = pts.map(p => [p[0] * S, p[1] * S]);
  const hw = width * S / 2;
  let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
  for (const [x, y] of P) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const x0 = Math.max(0, Math.floor(minX - hw - 2)), x1 = Math.min(cv.w - 1, Math.ceil(maxX + hw + 2));
  const y0 = Math.max(0, Math.floor(minY - hw - 2)), y1 = Math.min(cv.w - 1, Math.ceil(maxY + hw + 2));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let d = 1e9;
      for (let i = 1; i < P.length; i++) d = Math.min(d, segDist(x + .5, y + .5, P[i - 1], P[i]));
      const a = Math.min(1, Math.max(0, hw - d + 0.5)) * (alpha == null ? 1 : alpha);
      if (a <= 0) continue;
      const c = color === 'navy'
        ? NAVY_INK
        : goldAt(Math.min(1, Math.max(0, (x / cv.w * 0.55 + y / cv.w * 0.45))));
      cv.set(x, y, c[0], c[1], c[2], a);
    }
  }
}

function segDist(px, py, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1];
  const wx = px - a[0], wy = py - a[1];
  const L = vx * vx + vy * vy;
  const t = L ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / L)) : 0;
  return Math.hypot(px - (a[0] + t * vx), py - (a[1] + t * vy));
}

/* ---------------- Harf geometrisi (120x120 ızgara) ----------------
   Monoline (tek çizgi) harfler: her harf polyline dizisidir.
   "SER" lacivert, "VET" altın renkte çizilir.                        */
function arcPts(cx, cy, r, from, to, steps) {
  const p = [];
  for (let i = 0; i <= steps; i++) {
    const a = (from + (to - from) * i / steps) * Math.PI / 180;
    p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return p;
}

/* Her harf, 0..10 genişlik / 0..14 yükseklik kutusuna çizilir */
const GLYPHS = {
  S: () => {
    const top = arcPts(5, 4, 3.4, -35, -225, 18);
    const bot = arcPts(5, 10, 3.4, -55, 145, 18);
    return [top.concat(bot)];
  },
  E: () => [
    [[8.4, 0.6], [1.6, 0.6], [1.6, 13.4], [8.4, 13.4]],
    [[1.6, 7], [7.2, 7]]
  ],
  R: () => [
    [[1.8, 13.4], [1.8, 0.6], [5.4, 0.6]].concat(arcPts(5.4, 3.6, 3, -90, 90, 12)).concat([[1.8, 6.6]]),
    [[5.2, 6.6], [8.6, 13.4]]
  ],
  V: () => [[[1.2, 0.6], [5, 13.4], [8.8, 0.6]]],
  T: () => [[[1, 0.6], [9, 0.6]], [[5, 0.6], [5, 13.4]]]
};

/* Kelimeyi ızgaraya yerleştir: iki satır — SER (üst), VET (alt) */
function wordLines(lines, opts) {
  const out = [];
  const gw = 10, gap = 1.4, lineH = 14;
  lines.forEach((line, li) => {
    const letters = line.text.split('');
    const totalW = letters.length * gw + (letters.length - 1) * gap;
    const sx = 60 - totalW / 2 * opts.scale;
    const sy = opts.top + li * (lineH + opts.lineGap) * opts.scale;
    letters.forEach((ch, i) => {
      const paths = GLYPHS[ch]();
      const ox = sx + i * (gw + gap) * opts.scale;
      paths.forEach(pl => out.push({
        color: line.color,
        pts: pl.map(([x, y]) => [ox + x * opts.scale, sy + y * opts.scale])
      }));
    });
  });
  return out;
}

/* ---------------- İkon çizimi ---------------- */
function drawIcon(size, opts) {
  opts = opts || {};
  const cv = makeCanvas(size);
  drawBackground(cv, opts.maskable ? 0 : 0.22, !!opts.maskable);

  const inner = opts.maskable ? 0.74 : 1;
  const scale = 3.0 * inner;
  const strokes = wordLines(
    [{ text: 'SER', color: 'navy' }, { text: 'VET', color: 'gold' }],
    { top: 60 - (14 * 2 + 3) / 2 * scale, lineGap: 3, scale }
  );
  const w = size >= 96 ? 1.55 : size >= 48 ? 1.9 : 2.3;
  for (const st of strokes) strokePolyline(cv, st.pts, w * scale, 1, st.color);
  return encodePNG(size, size, cv.toRGBA());
}

/* ---------------- Üretim ---------------- */
const SIZES = [16, 32, 48, 64, 72, 96, 128, 144, 152, 167, 180, 192, 256, 384, 512, 1024];
for (const s of SIZES) {
  writeFileSync(resolve(OUT, `icon-${s}.png`), drawIcon(s));
}
writeFileSync(resolve(OUT, 'apple-touch-icon.png'), drawIcon(180));
writeFileSync(resolve(OUT, 'favicon-32.png'), drawIcon(32));
for (const s of [192, 512]) {
  writeFileSync(resolve(OUT, `maskable-${s}.png`), drawIcon(s, { maskable: true }));
}
console.log('✔ ' + (SIZES.length + 4) + ' ikon üretildi →', OUT);
