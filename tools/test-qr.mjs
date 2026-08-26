/* =====================================================================
   test-qr.mjs — QR kodlayıcı testleri
   Çalıştırma:  node tools/test-qr.mjs
   jsQR kuruluysa (npm i jsqr) üretilen kodlar bağımsız bir çözücüyle
   okunur; kurulu değilse yapısal doğrulamalar yapılır.
   ===================================================================== */
import fs from 'node:fs';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* qr.js'i tarayıcı dışında yükle */
const ctx = { window: {}, TextEncoder, console, Math, performance };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(resolve(ROOT, 'js/qr.js'), 'utf8'), ctx);
const QR = ctx.window.QR;

/* jsQR isteğe bağlı */
let jsQR = null;
try { jsQR = (await import('jsqr')).default; } catch { /* kurulu değil */ }

let passed = 0, failed = 0;
const check = (name, cond, detail) => {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
};
const group = n => console.log('\n' + n);

/* Modül matrisini gri tonlamalı piksel dizisine çevir (jsQR için) */
function rasterize(qr, scale = 5, border = 4) {
  const dim = (qr.size + border * 2) * scale;
  const data = new Uint8ClampedArray(dim * dim * 4).fill(255);
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = (((y + border) * scale + dy) * dim + ((x + border) * scale + dx)) * 4;
          data[px] = data[px + 1] = data[px + 2] = 0;
        }
      }
    }
  }
  return { data, dim };
}

/* ---------- 1) Kodla → çöz turu ---------- */
group(jsQR ? 'Kodlama → çözme turu (jsQR ile doğrulanıyor)'
           : 'Kodlama (jsQR kurulu değil — yapısal doğrulama)');
const cases = [
  ['kısa metin', 'SVT1:AB12:1:1:p:kısa test'],
  ['120 bayt', 'A'.repeat(120)],
  ['aktarım karesi (480)', 'SVT1:XY99:3:7:z:' + Array.from({ length: 480 }, (_, i) => 'ABCdef0123456789-_'[i % 18]).join('')],
  ['Türkçe + emoji', 'Türkçe: şğüöçİI ₺ 🪙 ' + 'x'.repeat(300)],
  ['1200 bayt', 'B'.repeat(1200)]
];
for (const [name, text] of cases) {
  for (const ecl of ['L', 'M', 'Q']) {
    const qr = QR.encode(text, ecl);
    if (jsQR) {
      const { data, dim } = rasterize(qr);
      const res = jsQR(data, dim, dim);
      check(`${name} · EC ${ecl} · sürüm ${qr.version}`, res && res.data === text,
        res ? 'okunan farklı' : 'çözülemedi');
    } else {
      const expected = qr.version * 4 + 17;
      const ok = qr.size === expected && qr.modules.length === expected &&
        qr.modules[0][0] === true && qr.modules[6][6] === true;   // bulucu desenler
      check(`${name} · EC ${ecl} · sürüm ${qr.version}`, ok);
    }
  }
}

/* ---------- 2) Sürüm seçimi ---------- */
group('Sürüm seçimi ve kapasite');
check('kısa veri sürüm 1-3 arası', QR.encode('merhaba', 'L').version <= 3);
check('uzun veri yüksek sürüm', QR.encode('C'.repeat(1800), 'L').version >= 28);
check('daha güçlü EC daha yüksek sürüm gerektirir',
  QR.encode('D'.repeat(500), 'Q').version > QR.encode('D'.repeat(500), 'L').version);
let threw = false;
try { QR.encode('E'.repeat(3200), 'H'); } catch { threw = true; }
check('kapasite aşımında anlamlı hata verir', threw);

/* ---------- 3) Aktarım protokolü ile uyum ---------- */
group('Transfer protokolü kareleri');
{
  const CHUNK = 480;
  const frame = 'SVT1:ZZ01:2:5:z:' + 'Q'.repeat(CHUNK);
  const qr = QR.encode(frame, 'L');
  check('480 karakterlik kare tek QR’a sığıyor', qr.version <= 20, 'sürüm ' + qr.version);
  if (jsQR) {
    const { data, dim } = rasterize(qr);
    const res = jsQR(data, dim, dim);
    check('kare içeriği bozulmadan okunuyor', res && res.data === frame);
  }
}

/* ---------- 4) SVG çıktısı ---------- */
group('SVG çıktısı');
{
  const qr = QR.encode('test', 'M');
  const svg = QR.toSVG(qr, { border: 2 });
  check('geçerli svg etiketi', svg.startsWith('<svg') && svg.includes('</svg>'));
  check('viewBox kenar boşluğunu içeriyor', svg.includes(`0 0 ${qr.size + 4} ${qr.size + 4}`));
  check('modüller path olarak çizilmiş', (svg.match(/M\d+ \d+h1v1h-1z/g) || []).length > 10);
}

console.log(`\n${passed} test geçti, ${failed} başarısız.` +
  (jsQR ? '' : '\n(Tam doğrulama için: npm i jsqr)'));
process.exit(failed ? 1 : 0);
