/* =====================================================================
   transfer.js — QR ile cihazdan cihaza veri aktarımı
   Gönderen cihaz portföyü sıkıştırıp base64'e çevirir ve QR kare(ler)i
   olarak gösterir; alan cihaz kamerayla okuyup birleştirir.
   Veri internete çıkmaz — aktarım tamamen iki ekran arasında olur.
   ===================================================================== */
window.Transfer = (function () {
  'use strict';

  const PROTO = 'SVT1';
  const CHUNK = 480;          // kare başına base64 karakteri (~sürüm 15 QR)
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ---------------- base64url yardımcıları ---------------- */
  function toB64(bytes) {
    let bin = '';
    const CH = 0x8000;
    for (let i = 0; i < bytes.length; i += CH) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64(str) {
    const s = str.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deflate(bytes) {
    if (typeof CompressionStream === 'undefined') return null;
    const cs = new CompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(cs);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function inflate(bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /* ---------------- Kareleri hazırla ---------------- */
  async function buildFrames(text) {
    const raw = new TextEncoder().encode(text);
    let flag = 'p', payload = raw;
    const z = await deflate(raw);
    if (z && z.length < raw.length) { flag = 'z'; payload = z; }

    const b64 = toB64(payload);
    const sid = Math.random().toString(36).slice(2, 7).toUpperCase();
    const total = Math.max(1, Math.ceil(b64.length / CHUNK));
    const frames = [];
    for (let i = 0; i < total; i++) {
      frames.push(`${PROTO}:${sid}:${i + 1}:${total}:${flag}:` + b64.slice(i * CHUNK, (i + 1) * CHUNK));
    }
    return { frames, sid, total, bytes: raw.length, packed: payload.length, flag };
  }

  function parseFrame(text) {
    if (typeof text !== 'string' || !text.startsWith(PROTO + ':')) return null;
    const p = text.split(':');
    if (p.length < 6) return null;
    const [, sid, i, n, flag] = p;
    const idx = Number(i), total = Number(n);
    if (!(idx >= 1) || !(total >= 1) || idx > total) return null;
    return { sid, idx, total, flag, data: p.slice(5).join(':') };
  }

  /* ================= GÖNDER ================= */
  async function openExport(ui) {
    const json = Store.exportJSON();
    let built;
    try { built = await buildFrames(json); }
    catch (e) { ui.toast('Veri hazırlanamadı: ' + e.message, 'err'); return; }

    const { frames, total, bytes, packed, flag } = built;
    const back = ui.openModal(`
      <div class="modal-head"><h2>📤 QR ile Gönder</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <p class="hl">Diğer cihazda <b>Ayarlar → QR ile veri al</b>'ı açıp kamerayı bu ekrana tutun.
          ${total > 1 ? `Veri <b>${total} kareye</b> bölündü; kareler sırayla döner, hepsi okunana kadar bekleyin.`
                      : 'Tüm veri tek karede.'}</p>
        <div style="display:grid;justify-items:center;gap:12px">
          <div id="qrBox" style="width:min(360px,100%);background:#fff;padding:10px;border-radius:14px"></div>
          <div class="chip-row" style="justify-content:center">
            <button class="chip" data-nav="-1">‹ Önceki</button>
            <span class="pill" id="frameInfo"><span class="dot"></span>1 / ${total}</span>
            <button class="chip" data-nav="1">Sonraki ›</button>
            ${total > 1 ? '<button class="chip active" id="playBtn">⏸ Duraklat</button>' : ''}
          </div>
          <ul class="stat-list" style="width:100%;max-width:380px">
            <li><span>Portföy</span><b>${Store.assets.length} varlık · ${Store.transactions.length} hareket</b></li>
            <li><span>Veri boyutu</span><b>${(bytes / 1024).toFixed(1)} KB → ${(packed / 1024).toFixed(1)} KB${flag === 'z' ? ' (sıkıştırıldı)' : ''}</b></li>
            <li><span>Kare sayısı</span><b>${total}</b></li>
          </ul>
        </div>
        <p class="muted" style="font-size:12px;margin:0">
          Kamera okuyamıyorsa ekran parlaklığını artırın veya cihazı 15–25 cm uzaklıkta tutun.
          Alternatif olarak Ayarlar → <b>JSON yedek al</b> ile dosya paylaşabilirsiniz.</p>
      </div>
      <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Kapat</button></div>`,
      { title: 'QR ile gönder' });

    let cur = 0, timer = null, playing = total > 1;
    const box = $('#qrBox', back), info = $('#frameInfo', back);

    function draw() {
      try {
        const qr = QR.encode(frames[cur], 'L');
        box.innerHTML = QR.toSVG(qr, { border: 2, aria: `Kare ${cur + 1} / ${total}` });
        info.innerHTML = `<span class="dot"></span>${cur + 1} / ${total}`;
      } catch (e) {
        box.innerHTML = `<p style="color:#b00;padding:12px;font-size:13px">QR üretilemedi: ${esc(e.message)}</p>`;
      }
    }
    function tick() { cur = (cur + 1) % total; draw(); }
    function setPlaying(on) {
      playing = on;
      clearInterval(timer);
      if (on) timer = setInterval(tick, 900);
      const b = $('#playBtn', back);
      if (b) { b.textContent = on ? '⏸ Duraklat' : '▶ Oynat'; b.classList.toggle('active', on); }
    }

    back.addEventListener('click', e => {
      const nav = e.target.closest('[data-nav]');
      if (nav) { setPlaying(false); cur = (cur + Number(nav.dataset.nav) + total) % total; draw(); }
      if (e.target.closest('#playBtn')) setPlaying(!playing);
    });
    back.addEventListener('modal:closed', () => clearInterval(timer));
    draw();
    if (total > 1) setPlaying(true);
    return () => clearInterval(timer);
  }

  /* ================= AL ================= */
  async function openImport(ui) {
    const supported = typeof BarcodeDetector !== 'undefined';
    const back = ui.openModal(`
      <div class="modal-head"><h2>📥 QR ile Al</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <p class="hl">Diğer cihazda <b>Ayarlar → QR ile gönder</b>'i açın ve kamerayı o ekrana tutun.
          Bu işlem buradaki mevcut verilerin <b>üzerine yazar</b>; önce yedek almanız önerilir.</p>
        <div id="scanArea" style="display:grid;justify-items:center;gap:12px">
          <div style="position:relative;width:min(360px,100%);aspect-ratio:1;border-radius:16px;overflow:hidden;background:#000;border:1px solid var(--line)">
            <video id="scanVideo" playsinline muted style="width:100%;height:100%;object-fit:cover"></video>
            <div style="position:absolute;inset:12%;border:2px solid var(--gold);border-radius:12px;opacity:.7"></div>
          </div>
          <div class="pill" id="scanStatus"><span class="dot"></span>Kamera başlatılıyor…</div>
          <div class="chip-row" id="frameChips" style="justify-content:center"></div>
        </div>
        <details>
          <summary class="muted" style="font-size:12.5px;cursor:pointer">Kamera çalışmıyor mu? Metinle aktar</summary>
          <div class="field" style="margin-top:10px">
            <label for="manualIn">QR içeriğini yapıştırın (her kare ayrı satır)</label>
            <textarea id="manualIn" rows="3" placeholder="SVT1:AB12:1:3:z:..."></textarea>
            <span class="hint">Kareleri okuyup metnini buraya yapıştırabilirsiniz.</span>
          </div>
          <button class="btn btn-sm" id="manualAdd">Ekle</button>
        </details>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" id="applyBtn" disabled>Verileri aktar</button>
      </div>`, { title: 'QR ile al' });

    const status = $('#scanStatus', back);
    const chips = $('#frameChips', back);
    const applyBtn = $('#applyBtn', back);
    let session = null;      // {sid, total, parts:Map, flag}
    let stream = null, scanning = false, detector = null;

    const setStatus = (txt, ok) => {
      status.innerHTML = `<span class="dot" style="background:${ok ? 'var(--up)' : 'var(--gold)'}"></span>${esc(txt)}`;
    };

    function renderChips() {
      if (!session) { chips.innerHTML = ''; return; }
      let html = '';
      for (let i = 1; i <= session.total; i++) {
        const got = session.parts.has(i);
        html += `<span class="chip ${got ? 'active' : ''}" style="pointer-events:none">${got ? '✓' : ''} ${i}</span>`;
      }
      chips.innerHTML = html;
      const have = session.parts.size;
      setStatus(`${have} / ${session.total} kare alındı`, have === session.total);
      applyBtn.disabled = have !== session.total;
    }

    function accept(text) {
      const f = parseFrame(text);
      if (!f) return false;
      if (!session || session.sid !== f.sid) {
        session = { sid: f.sid, total: f.total, flag: f.flag, parts: new Map() };
      }
      const isNew = !session.parts.has(f.idx);
      session.parts.set(f.idx, f.data);
      renderChips();
      if (isNew && navigator.vibrate) navigator.vibrate(40);
      return isNew;
    }

    /* --- Kamera --- */
    const video = $('#scanVideo', back);
    async function startCamera() {
      if (!supported) {
        setStatus('Bu tarayıcı QR okumayı desteklemiyor — metin veya dosya kullanın');
        $('#scanArea', back).style.opacity = '.5';
        return;
      }
      try {
        detector = new BarcodeDetector({ formats: ['qr_code'] });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false
        });
        video.srcObject = stream;
        await video.play();
        setStatus('Kamerayı diğer ekrandaki QR koda tutun');
        scanning = true;
        loop();
      } catch (e) {
        setStatus('Kamera açılamadı: ' + (e.name === 'NotAllowedError' ? 'izin verilmedi' : e.message));
      }
    }

    async function loop() {
      if (!scanning) return;
      try {
        const codes = await detector.detect(video);
        for (const c of codes) accept(c.rawValue);
      } catch (e) { /* kare atlandı */ }
      if (scanning) setTimeout(loop, 120);
    }

    function stop() {
      scanning = false;
      if (stream) stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    back.addEventListener('modal:closed', stop);

    $('#manualAdd', back).addEventListener('click', () => {
      const lines = $('#manualIn', back).value.split(/[\r\n]+/).map(x => x.trim()).filter(Boolean);
      const ok = lines.filter(accept).length;
      $('#manualIn', back).value = '';
      ui.toast(ok ? ok + ' kare eklendi.' : 'Geçerli kare bulunamadı.', ok ? 'ok' : 'err');
    });

    applyBtn.addEventListener('click', async () => {
      if (!session || session.parts.size !== session.total) return;
      applyBtn.disabled = true;
      try {
        let b64 = '';
        for (let i = 1; i <= session.total; i++) b64 += session.parts.get(i);
        let bytes = fromB64(b64);
        if (session.flag === 'z') bytes = await inflate(bytes);
        const text = new TextDecoder().decode(bytes);
        const n = Store.importJSON(text);
        stop();
        ui.closeModal();
        ui.toast(n + ' varlık bu cihaza aktarıldı.', 'ok');
        ui.afterImport();
      } catch (e) {
        applyBtn.disabled = false;
        ui.toast('Aktarım başarısız: ' + e.message + '. Kareleri yeniden okutun.', 'err');
        session = null; renderChips();
      }
    });

    startCamera();
  }

  return { openExport, openImport, buildFrames, parseFrame, CHUNK };
})();
