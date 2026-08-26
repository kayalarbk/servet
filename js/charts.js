/* =====================================================================
   charts.js — Bağımlılıksız SVG grafik motoru
   Halka (donut), alan/çizgi, sütun ve yığılmış sütun grafikleri üretir.
   Tüm çıktı responsive (viewBox) ve tema renkleriyle uyumludur.
   ===================================================================== */
window.Charts = (function () {
  'use strict';

  const P = () => DATA.PALETTE;
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const color = i => P()[i % P().length];

  /* ---------------- Halka grafik ---------------- */
  function donut(items, opts) {
    opts = opts || {};
    const size = 200, r = 78, ir = 54, cx = size / 2, cy = size / 2;
    const total = items.reduce((s, x) => s + x.value, 0);
    if (!total) return placeholder('Veri yok');

    let a0 = -Math.PI / 2, out = '';
    items.forEach((it, i) => {
      const frac = it.value / total;
      const a1 = a0 + frac * Math.PI * 2;
      out += `<path d="${arcPath(cx, cy, r, ir, a0, a1 - (items.length > 1 ? 0.014 : 0))}"
                fill="${it.color || color(i)}" opacity="0" >
                <animate attributeName="opacity" to="1" dur="0.45s" begin="${i * 0.05}s" fill="freeze"/>
                <title>${esc(it.label)}: ${esc(opts.fmt ? opts.fmt(it.value) : it.value)} (${(frac * 100).toFixed(1)}%)</title>
              </path>`;
      a0 = a1;
    });
    return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(opts.aria || 'Dağılım grafiği')}">${out}</svg>`;
  }

  function arcPath(cx, cy, r, ir, a0, a1) {
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
    const [x0, y0] = p(r, a0), [x1, y1] = p(r, a1), [x2, y2] = p(ir, a1), [x3, y3] = p(ir, a0);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}
            L${x2.toFixed(2)} ${y2.toFixed(2)} A${ir} ${ir} 0 ${large} 0 ${x3.toFixed(2)} ${y3.toFixed(2)} Z`;
  }

  /* ---------------- Alan / çizgi grafik ---------------- */
  function area(points, opts) {
    opts = opts || {};
    const W = 720, H = opts.height || 240, pad = { t: 16, r: 12, b: 26, l: 54 };
    if (!points || points.length < 2) return placeholder('En az iki gün veri gerekli');

    const vals = points.map(p => p.value);
    let min = Math.min(...vals), max = Math.max(...vals);
    if (min === max) { min = min * 0.98; max = max * 1.02 || 1; }
    const span = max - min || 1;
    min -= span * 0.08; max += span * 0.08;

    const x = i => pad.l + i * (W - pad.l - pad.r) / (points.length - 1);
    const y = v => pad.t + (1 - (v - min) / (max - min)) * (H - pad.t - pad.b);

    const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' ');
    const fill = `${line} L${x(points.length - 1).toFixed(1)} ${H - pad.b} L${pad.l} ${H - pad.b} Z`;

    // Yatay ızgara + eksen etiketleri
    let grid = '';
    for (let g = 0; g <= 4; g++) {
      const v = min + (max - min) * g / 4, yy = y(v);
      grid += `<line x1="${pad.l}" y1="${yy.toFixed(1)}" x2="${W - pad.r}" y2="${yy.toFixed(1)}"
                 style="stroke:var(--grid)" stroke-width="1"/>
               <text x="${pad.l - 8}" y="${(yy + 4).toFixed(1)}" text-anchor="end"
                 font-size="10" style="fill:var(--text-mute)">${esc(opts.fmtY ? opts.fmtY(v) : Math.round(v))}</text>`;
    }
    // X etiketleri (baş, orta, son)
    let xl = '';
    [0, Math.floor(points.length / 2), points.length - 1].forEach(i => {
      xl += `<text x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}"
              font-size="10" style="fill:var(--text-mute)">${esc(points[i].label)}</text>`;
    });

    const last = points[points.length - 1];
    const up = last.value >= points[0].value;
    const stroke = up ? '#d4af37' : '#ff6b6b';

    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:${H}px"
              role="img" aria-label="${esc(opts.aria || 'Zaman serisi grafiği')}">
      <defs>
        <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="${stroke}" stop-opacity=".34"/>
          <stop offset="1" stop-color="${stroke}" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${fill}" fill="url(#areaG)"/>
      <path d="${line}" fill="none" stroke="${stroke}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"
            stroke-dasharray="4000" stroke-dashoffset="4000">
        <animate attributeName="stroke-dashoffset" to="0" dur="1.1s" fill="freeze"/>
      </path>
      <circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.value).toFixed(1)}" r="4" fill="${stroke}"/>
      ${xl}
    </svg>`;
  }

  /* ---------------- Sütun grafik ---------------- */
  function bars(items, opts) {
    opts = opts || {};
    const W = 720, H = opts.height || 220, pad = { t: 14, r: 10, b: 42, l: 54 };
    if (!items.length) return placeholder('Veri yok');
    const vals = items.map(i => i.value);
    const max = Math.max(0, ...vals), min = Math.min(0, ...vals);
    const span = (max - min) || 1;
    const plotH = H - pad.t - pad.b;
    const y0 = pad.t + (max / span) * plotH;              // sıfır çizgisi
    const bw = (W - pad.l - pad.r) / items.length;
    let out = min < 0
      ? `<line x1="${pad.l}" y1="${y0.toFixed(1)}" x2="${W - pad.r}" y2="${y0.toFixed(1)}"
           style="stroke:var(--grid)" stroke-width="1.4"/>` : '';
    items.forEach((it, i) => {
      const h = Math.abs(it.value) / span * plotH;
      const xx = pad.l + i * bw + bw * 0.18, w = bw * 0.64;
      const yy = it.value >= 0 ? y0 - h : y0;
      out += `<rect x="${xx.toFixed(1)}" y="${yy.toFixed(1)}" width="${w.toFixed(1)}" height="0"
                rx="5" fill="${it.color || color(i)}">
                <animate attributeName="height" to="${h.toFixed(1)}" dur=".6s" begin="${i * .05}s" fill="freeze"/>
                <animate attributeName="y" to="${yy.toFixed(1)}" dur=".6s" begin="${i * .05}s" fill="freeze"/>
                <title>${esc(it.label)}: ${esc(opts.fmt ? opts.fmt(it.value) : it.value)}</title>
              </rect>
              <text x="${(xx + w / 2).toFixed(1)}" y="${H - 24}" text-anchor="middle" font-size="10"
                style="fill:var(--text-dim)">${esc(short(it.label, 12))}</text>
              <text x="${(xx + w / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle" font-size="9.5" style="fill:var(--text-mute)">${esc(opts.fmtShort ? opts.fmtShort(it.value) : '')}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" style="height:${H}px" role="img"
             aria-label="${esc(opts.aria || 'Sütun grafik')}">${out}</svg>`;
  }

  /* ---------------- Yatay oranlı bar ---------------- */
  function stackedBar(items, opts) {
    const total = items.reduce((s, x) => s + x.value, 0);
    if (!total) return placeholder('Veri yok');
    let x = 0, out = '';
    items.forEach((it, i) => {
      const w = it.value / total * 100;
      out += `<rect x="${x}%" y="0" width="${Math.max(w - 0.35, 0.2)}%" height="26" rx="4"
                fill="${it.color || color(i)}"><title>${esc(it.label)}: %${w.toFixed(1)}</title></rect>`;
      x += w;
    });
    return `<svg viewBox="0 0 100 26" preserveAspectRatio="none" style="height:26px;width:100%"
             role="img" aria-label="${esc((opts && opts.aria) || 'Oran grafiği')}">${out}</svg>`;
  }

  function legend(items, fmt) {
    const total = items.reduce((s, x) => s + x.value, 0) || 1;
    return '<ul class="legend">' + items.map((it, i) =>
      `<li><span class="sw" style="background:${it.color || color(i)}"></span>
        <span>${esc(it.label)}</span>
        <span class="val">${esc(fmt ? fmt(it.value) : it.value)} · %${(it.value / total * 100).toFixed(1)}</span></li>`
    ).join('') + '</ul>';
  }

  const short = (s, n) => (String(s).length > n ? String(s).slice(0, n - 1) + '…' : String(s));

  function placeholder(msg) {
    return `<div class="empty" style="padding:32px 12px">
      <svg viewBox="0 0 24 24"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>
      <p>${esc(msg)}</p></div>`;
  }

  return { donut, area, bars, stackedBar, legend, color, placeholder };
})();
