/* =====================================================================
   qr.js — Bağımlılıksız QR kodu üreteci
   Byte modu, sürüm 1–40, hata düzeltme L/M/Q/H, otomatik maske seçimi.
   ISO/IEC 18004 referans algoritması. Çıktı: modül matrisi + SVG.
   ===================================================================== */
window.QR = (function () {
  'use strict';

  /* Sürüm başına blok başına EC kod sözcüğü sayısı (index = sürüm) */
  const ECC_PER_BLOCK = {
    L: [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    M: [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
    Q: [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
    H: [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30]
  };
  /* Sürüm başına EC blok sayısı */
  const NUM_BLOCKS = {
    L: [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
    M: [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
    Q: [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
    H: [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 57, 60, 63, 66, 70, 74, 77, 81, 85]
  };
  const ECL_BITS = { L: 1, M: 0, Q: 3, H: 2 };

  /* ---------------- Galois cismi (GF(256), 0x11D) ---------------- */
  function gfMul(a, b) {
    let z = 0;
    for (let i = 7; i >= 0; i--) {
      z = (z << 1) ^ ((z >>> 7) * 0x11D);
      z ^= ((b >>> i) & 1) * a;
    }
    return z & 0xFF;
  }
  function rsDivisor(degree) {
    const result = new Uint8Array(degree);
    result[degree - 1] = 1;
    let root = 1;
    for (let i = 0; i < degree; i++) {
      for (let j = 0; j < degree; j++) {
        result[j] = gfMul(result[j], root);
        if (j + 1 < degree) result[j] ^= result[j + 1];
      }
      root = gfMul(root, 0x02);
    }
    return result;
  }
  function rsRemainder(data, divisor) {
    const result = new Uint8Array(divisor.length);
    for (const b of data) {
      const factor = b ^ result[0];
      result.copyWithin(0, 1);
      result[result.length - 1] = 0;
      for (let i = 0; i < result.length; i++) result[i] ^= gfMul(divisor[i], factor);
    }
    return result;
  }

  /* ---------------- Kapasite hesapları ---------------- */
  function rawDataModules(ver) {
    let result = (16 * ver + 128) * ver + 64;
    if (ver >= 2) {
      const numAlign = Math.floor(ver / 7) + 2;
      result -= (25 * numAlign - 10) * numAlign - 55;
      if (ver >= 7) result -= 36;
    }
    return result;
  }
  function dataCodewords(ver, ecl) {
    return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver] * NUM_BLOCKS[ecl][ver];
  }
  const charCountBits = ver => (ver <= 9 ? 8 : 16);

  /** Byte modunda, verilen sürüm/EC ile kaç bayt sığar? */
  function capacity(ver, ecl) {
    return dataCodewords(ver, ecl) - 1 - Math.floor(charCountBits(ver) / 8) - (ver <= 9 ? 0 : 0);
  }

  function alignPositions(ver) {
    if (ver === 1) return [];
    const numAlign = Math.floor(ver / 7) + 2;
    const step = Math.floor((ver * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2;
    const result = [6];
    for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) result.splice(1, 0, pos);
    return result;
  }

  /* ---------------- Kodlama ---------------- */
  function encode(text, ecl, minVersion) {
    ecl = ecl || 'M';
    const bytes = new TextEncoder().encode(text);
    let ver = minVersion || 1;
    for (; ver <= 40; ver++) {
      const usable = dataCodewords(ver, ecl) * 8 - 4 - charCountBits(ver);
      if (bytes.length * 8 <= usable) break;
    }
    if (ver > 40) throw new Error('Veri tek bir QR koda sığmıyor (' + bytes.length + ' bayt).');

    /* Bit dizisi */
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(4, 4);                               // byte modu
    push(bytes.length, charCountBits(ver));
    for (const b of bytes) push(b, 8);

    const capacityBits = dataCodewords(ver, ecl) * 8;
    push(0, Math.min(4, capacityBits - bits.length));      // sonlandırıcı
    push(0, (8 - bits.length % 8) % 8);                    // bayta hizala
    for (let pad = 0xEC; bits.length < capacityBits; pad ^= 0xEC ^ 0x11) push(pad, 8);

    const dataCw = new Uint8Array(bits.length / 8);
    bits.forEach((bit, i) => { dataCw[i >>> 3] |= bit << (7 - (i & 7)); });

    return new QrCode(ver, ecl, addEccAndInterleave(dataCw, ver, ecl));
  }

  function addEccAndInterleave(data, ver, ecl) {
    const numBlocks = NUM_BLOCKS[ecl][ver];
    const blockEccLen = ECC_PER_BLOCK[ecl][ver];
    const rawCodewords = Math.floor(rawDataModules(ver) / 8);
    const numShortBlocks = numBlocks - rawCodewords % numBlocks;
    const shortBlockLen = Math.floor(rawCodewords / numBlocks);

    /* Tüm bloklar aynı uzunlukta tutulur: kısa bloklara bir dolgu baytı
       eklenir, birleştirme sırasında bu bayt atlanır. */
    const blocks = [];
    const divisor = rsDivisor(blockEccLen);
    for (let i = 0, k = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
      const dat = data.slice(k, k + datLen);
      k += datLen;
      const ecc = rsRemainder(dat, divisor);
      const block = new Uint8Array(shortBlockLen + 1);
      block.set(dat, 0);
      if (i < numShortBlocks) { block[datLen] = 0; block.set(ecc, datLen + 1); }
      else block.set(ecc, datLen);
      blocks.push(block);
    }

    const result = new Uint8Array(rawCodewords);
    let idx = 0;
    for (let i = 0; i < blocks[0].length; i++) {
      blocks.forEach((block, j) => {
        // kısa blokların veri kısmında son bayt yoktur
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) result[idx++] = block[i];
      });
    }
    return result;
  }

  /* ---------------- Matris ---------------- */
  function QrCode(version, ecl, codewords) {
    this.version = version;
    this.ecl = ecl;
    this.size = version * 4 + 17;
    this.modules = [];
    this.isFunction = [];
    for (let i = 0; i < this.size; i++) {
      this.modules.push(new Array(this.size).fill(false));
      this.isFunction.push(new Array(this.size).fill(false));
    }
    this.drawFunctionPatterns();
    this.drawCodewords(codewords);

    // En düşük ceza puanlı maskeyi seç
    let bestMask = 0, minPenalty = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask);
      this.drawFormatBits(mask);
      const p = this.penalty();
      if (p < minPenalty) { minPenalty = p; bestMask = mask; }
      this.applyMask(mask);            // geri al (XOR)
    }
    this.applyMask(bestMask);
    this.drawFormatBits(bestMask);
    this.mask = bestMask;
  }

  QrCode.prototype.setFn = function (x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  };

  QrCode.prototype.drawFunctionPatterns = function () {
    const size = this.size;
    for (let i = 0; i < size; i++) {          // zamanlama desenleri
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3); this.drawFinder(size - 4, 3); this.drawFinder(3, size - 4);

    const align = alignPositions(this.version);
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1) ||
                       (i === align.length - 1 && j === 0);
        if (!corner) this.drawAlign(align[i], align[j]);
      }
    }
    this.drawFormatBits(0);
    this.drawVersion();
  };

  QrCode.prototype.drawFinder = function (x, y) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFn(xx, yy, dist !== 2 && dist !== 4);
        }
      }
    }
  };

  QrCode.prototype.drawAlign = function (x, y) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFn(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
      }
    }
  };

  QrCode.prototype.drawFormatBits = function (mask) {
    const data = ECL_BITS[this.ecl] << 3 | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = i => (bits >>> i) & 1;

    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));

    const size = this.size;
    for (let i = 0; i < 8; i++) this.setFn(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, size - 15 + i, bit(i));
    this.setFn(8, size - 8, true);            // daima koyu modül
  };

  QrCode.prototype.drawVersion = function () {
    if (this.version < 7) return;
    let rem = this.version;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1F25);
    const bits = (this.version << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const b = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + i % 3, bb = Math.floor(i / 3);
      this.setFn(a, bb, b);
      this.setFn(bb, a, b);
    }
  };

  QrCode.prototype.drawCodewords = function (data) {
    let i = 0;
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? this.size - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) !== 0;
            i++;
          }
        }
      }
    }
  };

  QrCode.prototype.applyMask = function (mask) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = x * y % 2 + x * y % 3 === 0; break;
          case 6: invert = (x * y % 2 + x * y % 3) % 2 === 0; break;
          case 7: invert = ((x + y) % 2 + x * y % 3) % 2 === 0; break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  };

  QrCode.prototype.penalty = function () {
    const size = this.size, m = this.modules;
    let result = 0;
    const N1 = 3, N2 = 3, N3 = 40, N4 = 10;

    // Kural 1 & 3: satır/sütun dizileri
    for (const isRow of [true, false]) {
      for (let a = 0; a < size; a++) {
        let runColor = false, runLen = 0;
        const history = [0, 0, 0, 0, 0, 0, 0];
        for (let b = 0; b < size; b++) {
          const c = isRow ? m[a][b] : m[b][a];
          if (c === runColor) {
            runLen++;
            if (runLen === 5) result += N1;
            else if (runLen > 5) result++;
          } else {
            addHistory(history, runLen, b === runLen ? 0 : 1);
            if (!runColor) result += finderPenalty(history) * N3;
            runColor = c; runLen = 1;
          }
        }
        addHistory(history, runLen, 1);
        if (runColor) addHistory(history, 0, 0);
        result += finderPenalty(history) * N3;
      }
    }
    // Kural 2: 2x2 bloklar
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) result += N2;
      }
    }
    // Kural 4: koyu modül oranı
    let dark = 0;
    for (const row of m) for (const c of row) if (c) dark++;
    const total = size * size;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    result += k * N4;
    return result;
  };

  function addHistory(history, runLen, pad) {
    if (history[0] === 0 && pad) runLen += size0Pad(history);
    history.pop(); history.unshift(runLen);
  }
  const size0Pad = () => 0;   // kenar boşluğu telafisi (basitleştirilmiş)

  function finderPenalty(h) {
    const n = h[1];
    const core = n > 0 && h[2] === n && h[3] === n * 3 && h[4] === n && h[5] === n;
    return (core && h[0] >= n * 4 && h[6] >= n ? 1 : 0) + (core && h[6] >= n * 4 && h[0] >= n ? 1 : 0);
  }

  /* ---------------- Görselleştirme ---------------- */
  function toSVG(qr, opts) {
    opts = opts || {};
    const border = opts.border == null ? 3 : opts.border;
    const dark = opts.dark || '#0b1533';
    const light = opts.light || '#ffffff';
    const dim = qr.size + border * 2;
    let path = '';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) path += `M${x + border} ${y + border}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}"
      shape-rendering="crispEdges" role="img" aria-label="${opts.aria || 'QR kodu'}"
      style="width:100%;height:auto;display:block;border-radius:10px">
      <rect width="${dim}" height="${dim}" fill="${light}"/>
      <path d="${path}" fill="${dark}"/></svg>`;
  }

  function toCanvas(qr, canvas, scale, border) {
    border = border == null ? 3 : border;
    scale = scale || 4;
    const dim = (qr.size + border * 2) * scale;
    canvas.width = dim; canvas.height = dim;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, dim, dim);
    ctx.fillStyle = '#000';
    for (let y = 0; y < qr.size; y++) {
      for (let x = 0; x < qr.size; x++) {
        if (qr.modules[y][x]) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
      }
    }
    return canvas;
  }

  return { encode, toSVG, toCanvas, capacity, dataCodewords };
})();
