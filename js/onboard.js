/* =====================================================================
   onboard.js — Kurulum testi (ilk açılış sihirbazı)
   "Nelere yatırım yapıyorsunuz?" sorusundan başlayarak portföyü adım adım
   kurar; böylece kullanıcı yoğun varlık formuyla tek seferde uğraşmaz.
   Ayarlar → "Kurulum testini tekrar çalıştır" ile yeniden açılabilir.
   ===================================================================== */
window.Onboard = (function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* Teste dahil edilen varlık türleri (sık kullanılanlar önce) */
  const CHOICES = ['gold', 'cash', 'stock', 'crypto', 'deposit', 'etf', 'fund',
                   'silver', 'realestate', 'vehicle', 'bond', 'collectible', 'other'];

  let ui = null, step = 0, picked = [], drafts = [], idx = 0;

  function open(appUI, opts) {
    ui = appUI;
    step = 0; picked = []; drafts = []; idx = 0;
    if (opts && opts.keepAssets === false) picked = [];
    render();
  }

  /* ---------------- Çerçeve ---------------- */
  function render() {
    const total = 3;
    const pct = Math.min(100, (step / total) * 100);
    const back = ui.openModal(`
      <div class="modal-head">
        <h2 id="obTitle"></h2>
        <button class="icon-btn" id="obSkip" title="Şimdilik geç" aria-label="Kapat">✕</button>
      </div>
      <div class="ob-progress"><i style="width:${pct}%"></i></div>
      <div class="modal-body" id="obBody"></div>
      <div class="modal-foot" id="obFoot"></div>`, { title: 'Kurulum testi' });

    back.addEventListener('click', e => {
      if (e.target.closest('#obSkip')) finish(true);
    });

    if (step === 0) stepWelcome(back);
    else if (step === 1) stepPick(back);
    else if (step === 2) stepDetails(back);
    else stepSummary(back);
  }

  const setHead = (back, title, bodyHTML, footHTML) => {
    $('#obTitle', back).textContent = title;
    $('#obBody', back).innerHTML = bodyHTML;
    $('#obFoot', back).innerHTML = footHTML;
  };

  /* ---------------- 1) Karşılama ---------------- */
  function stepWelcome(back) {
    const p = Store.state.profile;
    setHead(back, '👋 Hoş geldiniz', `
      <div class="ob-hero">
        <div class="ob-badge">SER<span>VET</span></div>
        <p>Birkaç soruyla portföyünüzü birlikte kuralım. Uzun formu doldurmanıza gerek yok —
           sadece <b>nelere yatırım yaptığınızı</b> seçin, gerisini adım adım soralım.</p>
      </div>
      <div class="form-grid">
        <div class="field">
          <label for="obName">Size nasıl hitap edelim?</label>
          <input id="obName" value="${esc(p.name)}" placeholder="Adınız (isteğe bağlı)" maxlength="40">
        </div>
        <div class="field">
          <label for="obCur">Raporlama para birimi</label>
          <select id="obCur">
            ${DATA.CURRENCIES.filter(c => c.code !== 'GAU').map(c =>
              `<option value="${c.code}" ${Store.settings.baseCurrency === c.code ? 'selected' : ''}>${c.code} — ${esc(c.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="hl">Verileriniz yalnızca bu cihazda saklanır. İstediğiniz an Ayarlar'dan bu testi
        yeniden çalıştırabilir veya elle varlık ekleyebilirsiniz.</p>`,
      `<button class="btn btn-ghost" id="obLater">Şimdilik geç</button>
       <div style="flex:1"></div>
       <button class="btn btn-gold" id="obNext">Başlayalım →</button>`);

    $('#obLater', back).onclick = () => finish(true);
    $('#obNext', back).onclick = () => {
      Store.state.profile.name = $('#obName', back).value.trim();
      Store.settings.baseCurrency = $('#obCur', back).value;
      Store.save();
      step = 1; ui.closeModal(); render();
    };
  }

  /* ---------------- 2) Yatırım türleri ---------------- */
  function stepPick(back) {
    setHead(back, '🎯 Nelere yatırım yapıyorsunuz?', `
      <p class="muted" style="margin:0;font-size:13.5px">Birden fazla seçebilirsiniz. Seçtikleriniz için
        sırayla kısa sorular soracağız; istemediğinizi atlayabilirsiniz.</p>
      <div class="ob-grid" id="obChoices">
        ${CHOICES.map(id => {
          const t = DATA.assetType(id);
          return `<button type="button" class="ob-card ${picked.includes(id) ? 'on' : ''}" data-type="${id}">
            <span class="ob-ico">${t.icon}</span>
            <span class="ob-name">${esc(t.name)}</span>
            <span class="ob-group">${esc(t.group)}</span>
            <span class="ob-check">✓</span></button>`;
        }).join('')}
      </div>`,
      `<button class="btn btn-ghost" id="obBack">← Geri</button>
       <div style="flex:1"></div>
       <span class="pill" id="obCount"><span class="dot"></span>${picked.length} seçili</span>
       <button class="btn btn-gold" id="obNext">Devam →</button>`);

    $('#obChoices', back).addEventListener('click', e => {
      const c = e.target.closest('[data-type]');
      if (!c) return;
      const id = c.dataset.type;
      const i = picked.indexOf(id);
      if (i >= 0) picked.splice(i, 1); else picked.push(id);
      c.classList.toggle('on', picked.includes(id));
      $('#obCount', back).innerHTML = `<span class="dot"></span>${picked.length} seçili`;
    });
    $('#obBack', back).onclick = () => { step = 0; ui.closeModal(); render(); };
    $('#obNext', back).onclick = () => {
      if (!picked.length) { ui.toast('En az bir yatırım türü seçin veya “Şimdilik geç” deyin.', 'err'); return; }
      drafts = picked.map(type => ({
        type, symbol: '', name: '', quantity: '', unitPrice: '', unitCost: '',
        currency: DATA.assetType(type).defaultCurrency, unit: DATA.assetType(type).unit,
        location: { kind: 'physical', name: '', account: '' }, skip: false
      }));
      idx = 0; step = 2; ui.closeModal(); render();
    };
  }

  /* ---------------- 3) Her tür için kısa form ---------------- */
  function stepDetails(back) {
    const d = drafts[idx];
    const t = DATA.assetType(d.type);
    const needsSymbol = ['gold', 'silver', 'crypto', 'stock', 'etf'].includes(d.type);
    const q = DATA.metalQuote(d.symbol);

    setHead(back, `${t.icon} ${t.name}`, `
      <p class="ob-step">${idx + 1} / ${drafts.length} · ${esc(t.name)} hakkında birkaç bilgi</p>
      ${needsSymbol ? `
        <div class="field">
          <label>${d.type === 'crypto' ? 'Hangi kripto para?' :
                   d.type === 'gold' || d.type === 'silver' ? 'Hangi ürün?' : 'Hangi şirket / fon?'}</label>
          <button type="button" class="picker-btn" id="obSym">
            <span class="pk-main">${d.symbol ? esc(symLabel(d)) :
              `<span class="pk-empty">Aramak için dokunun</span>`}</span>
            <span class="pk-arrow">▼</span></button>
        </div>` : ''}
      <div class="panel"><div class="form-grid">
        <div class="field">
          <label for="obAssetName">Adı</label>
          <input id="obAssetName" value="${esc(d.name)}" placeholder="${esc(defaultName(d))}">
        </div>
        <div class="field">
          <label for="obQty">Miktar (${esc(d.unit)})</label>
          <input id="obQty" type="text" inputmode="decimal" value="${esc(d.quantity)}" placeholder="0">
        </div>
        <div class="field">
          <label for="obPrice">Güncel birim değer (${esc(d.currency)})</label>
          <input id="obPrice" type="text" inputmode="decimal" value="${esc(d.unitPrice)}"
            placeholder="${q ? 'otomatik çekilecek' : '0'}">
          <span class="hint">${q ? 'Kapalıçarşı fiyatı yenilemede otomatik gelir; boş bırakabilirsiniz.'
                                 : 'Bilmiyorsanız yaklaşık bir değer girin, sonra düzeltebilirsiniz.'}</span>
        </div>
        <div class="field">
          <label for="obCost">Alış maliyeti (birim)</label>
          <input id="obCost" type="text" inputmode="decimal" value="${esc(d.unitCost)}" placeholder="isteğe bağlı">
          <span class="hint">Kâr/zarar hesabı için.</span>
        </div>
      </div></div>
      <div class="panel">
        <p class="section-label">Nerede tutuyorsunuz?</p>
        <div class="chip-row" id="obKinds">
          ${DATA.LOCATION_KINDS.map(k => `<button type="button" class="chip sel-lg ${d.location.kind === k.id ? 'active' : ''}"
            data-kind="${k.id}">${k.icon} ${esc(k.name)}</button>`).join('')}
        </div>
        <div class="field" id="obLocField" style="margin-top:12px">
          <label>Kurum / yer</label>
          <button type="button" class="picker-btn" id="obLoc">
            <span class="pk-main">${d.location.name ? esc(d.location.name) :
              `<span class="pk-empty">Seçmek için dokunun</span>`}</span>
            <span class="pk-arrow">▼</span></button>
        </div>
      </div>`,
      `<button class="btn btn-ghost" id="obBack">← Geri</button>
       <button class="btn btn-ghost" id="obSkipOne">Bunu atla</button>
       <div style="flex:1"></div>
       <button class="btn btn-gold" id="obNext">${idx + 1 < drafts.length ? 'Sonraki →' : 'Özete geç →'}</button>`);

    const kindField = () => {
      const k = DATA.locationKind(d.location.kind);
      $('#obLocField', back).style.display = k.needsName || d.location.kind === 'physical' ? '' : 'none';
    };
    kindField();

    if (needsSymbol) {
      $('#obSym', back).onclick = () => ui.openSymbolPicker(d.type, d.symbol, item => {
        save(back);                       // önce formdaki girdileri koru
        d.symbol = item.value;
        const mq = DATA.metalQuote(item.value);
        if (mq) { d.unit = mq.unit; d.currency = 'TRY'; }
        if (!d.name && item.name && !item.custom) d.name = item.name;   // sonra adı doldur
        ui.closeModal(); render();
      });
    }
    $('#obLoc', back).onclick = () => ui.openLocationPicker(d.location.kind, d.location.name, item => {
      d.location.name = item.value;
      $('#obLoc', back).querySelector('.pk-main').textContent = item.value;
    });
    $('#obKinds', back).addEventListener('click', e => {
      const c = e.target.closest('[data-kind]');
      if (!c) return;
      d.location.kind = c.dataset.kind;
      d.location.name = '';
      $$('#obKinds .chip', back).forEach(x => x.classList.toggle('active', x === c));
      $('#obLoc', back).querySelector('.pk-main').innerHTML = '<span class="pk-empty">Seçmek için dokunun</span>';
      kindField();
    });

    $('#obBack', back).onclick = () => {
      save(back);
      if (idx > 0) { idx--; ui.closeModal(); render(); }
      else { step = 1; ui.closeModal(); render(); }
    };
    $('#obSkipOne', back).onclick = () => {
      d.skip = true;
      advance(back);
    };
    $('#obNext', back).onclick = () => {
      save(back);
      if (!d.quantity || !(Store.parseNum(d.quantity) > 0)) {
        ui.toast('Miktar girin ya da “Bunu atla” deyin.', 'err');
        return;
      }
      advance(back);
    };
  }

  function advance(back) {
    if (idx + 1 < drafts.length) { idx++; ui.closeModal(); render(); }
    else { step = 3; ui.closeModal(); render(); }
  }

  function save(back) {
    const d = drafts[idx];
    const g = id => { const el = $(id, back); return el ? el.value : ''; };
    d.name = g('#obAssetName').trim();
    d.quantity = g('#obQty');
    d.unitPrice = g('#obPrice');
    d.unitCost = g('#obCost');
  }

  const symLabel = d => {
    const q = DATA.metalQuote(d.symbol);
    if (q) return q.name;
    const s = SYMBOLS.find(d.symbol);
    if (s) return s.code + ' · ' + s.name;
    return d.symbol;
  };

  const defaultName = d => {
    const q = DATA.metalQuote(d.symbol);
    if (q) return q.name;
    const s = SYMBOLS.find(d.symbol);
    if (s) return s.name;
    return DATA.assetType(d.type).name;
  };

  /* ---------------- 4) Özet ---------------- */
  function stepSummary(back) {
    const ready = drafts.filter(d => !d.skip && Store.parseNum(d.quantity) > 0);
    setHead(back, '✅ Son kontrol', `
      <p class="muted" style="margin:0;font-size:13.5px">
        ${ready.length ? `${ready.length} varlık oluşturulacak. Sonrasında hepsini düzenleyebilir,
          yenisini ekleyebilirsiniz.` : 'Henüz varlık girmediniz. İsterseniz geri dönüp ekleyebilirsiniz.'}</p>
      <div class="timeline">
        ${ready.map(d => `
          <div class="tl-item">
            <div class="tl-dot">${DATA.assetType(d.type).icon}</div>
            <div class="tl-main">
              <div class="tl-title"><strong>${esc(d.name || defaultName(d))}</strong>
                <span class="pill">${esc(DATA.assetType(d.type).name)}</span></div>
              <p class="tl-desc">${esc(Store.fmtNum(Store.parseNum(d.quantity), 6))} ${esc(d.unit)}
                ${d.unitPrice ? ' · ' + esc(Store.fmtMoney(Store.parseNum(d.quantity) * Store.parseNum(d.unitPrice), d.currency)) : ''}
                · ${esc(DATA.locationKind(d.location.kind).name)}${d.location.name ? ' · ' + esc(d.location.name) : ''}</p>
            </div></div>`).join('') || '<p class="muted" style="font-size:13px">Liste boş.</p>'}
      </div>
      <p class="hl">Fiyatı otomatik çekilebilen varlıklar (altın ürünleri, kripto) ilk yenilemede
        güncel değerine oturur.</p>`,
      `<button class="btn btn-ghost" id="obBack">← Geri</button>
       <div style="flex:1"></div>
       <button class="btn btn-gold" id="obDone">${ready.length ? 'Portföyümü oluştur' : 'Bitir'}</button>`);

    $('#obBack', back).onclick = () => { idx = Math.max(0, drafts.length - 1); step = 2; ui.closeModal(); render(); };
    $('#obDone', back).onclick = () => {
      let n = 0;
      for (const d of ready) {
        const mq = DATA.metalQuote(d.symbol);
        Store.addAsset({
          name: d.name || defaultName(d), type: d.type, symbol: d.symbol,
          quantity: d.quantity, unit: d.unit,
          unitPrice: d.unitPrice === '' ? 0 : d.unitPrice,
          unitCost: d.unitCost, currency: d.currency,
          acquiredAt: Store.todayISO(),
          autoPrice: !!(mq || (d.symbol && ['crypto', 'stock', 'etf'].includes(d.type))),
          notes: 'Kurulum testiyle eklendi.',
          location: d.location
        });
        n++;
      }
      finish(false, n);
    };
  }

  function finish(skipped, n) {
    Store.settings.onboarded = true;
    // Seçilen türler yeni varlık formunda gösterilecek listeyi belirler.
    // Hiç seçim yapılmadıysa (test atlandıysa) liste boş kalır = tüm türler.
    if (picked.length) Store.settings.assetTypes = picked.slice();
    Store.save();
    Store.takeSnapshot(true);
    ui.closeModal();
    if (n) ui.toast(n + ' varlık oluşturuldu. Fiyatları yenilemek için ↻ düğmesini kullanın.', 'ok');
    else if (skipped) ui.toast('Kurulum testini Ayarlar → Kurulum bölümünden tekrar açabilirsiniz.');
    ui.afterImport();
  }

  return { open };
})();
