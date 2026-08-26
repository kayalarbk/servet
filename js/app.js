/* =====================================================================
   app.js — Arayüz, yönlendirme (router) ve etkileşim katmanı
   ===================================================================== */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const view = $('#view');
  const S = Store;

  /* ================= Bildirim (toast) ================= */
  function toast(msg, kind, action) {
    const t = document.createElement('div');
    t.className = 'toast ' + (kind || '');
    const span = document.createElement('span');
    span.className = 'toast-msg';
    span.textContent = msg;
    t.appendChild(span);
    if (action) {
      const b = document.createElement('button');
      b.className = 'btn btn-sm btn-gold toast-act';
      b.textContent = action.label;
      b.addEventListener('click', () => { action.run(); t.remove(); });
      t.appendChild(b);
    }
    $('#toastRoot').appendChild(t);
    if (!action || !action.sticky) {
      setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, action ? 12000 : 3600);
    }
  }
  window.addEventListener('servet:error', e => toast(e.detail, 'err'));
  window.addEventListener('servet:alert', e => toast('⚠ ' + e.detail));

  /* ================= Modal ================= */
  const focusStack = [];
  function openModal(html, opts) {
    focusStack.push(document.activeElement);
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${opts && opts.small ? 'sm' : ''}" role="dialog" aria-modal="true"
      aria-label="${esc((opts && opts.title) || 'İletişim kutusu')}">${html}</div>`;
    $('#modalRoot').appendChild(back);
    // Sayı alanından çıkınca girilen değeri yorumlandığı biçimde geri yaz;
    // böylece "7.200 → 7.200" mü "7,2" mi anlaşıldığı görünür olur.
    back.addEventListener('focusout', e => {
      const el = e.target;
      if (!el.matches || !el.matches('input[inputmode="decimal"]')) return;
      if (!el.value.trim()) return;
      const n = Store.parseNum(el.value);
      if (!isNaN(n)) el.value = Store.fmtNum(n);
    });
    back.addEventListener('mousedown', e => { if (e.target === back) closeModal(); });
    document.addEventListener('keydown', escClose);
    const f = back.querySelector('input,select,textarea,button');
    if (f) setTimeout(() => f.focus(), 60);

    // Odak tuzağı: Tab tuşu modal içinde döner, arkadaki sayfaya kaçmaz
    back.addEventListener('keydown', e => {
      if (e.key !== 'Tab') return;
      const items = [...back.querySelectorAll(
        'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
        .filter(el => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    return back;
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() {
    const m = $('#modalRoot').lastElementChild;      // yalnızca en üsttekini kapat
    if (m) { m.dispatchEvent(new CustomEvent('modal:closed')); m.remove(); }
    if (!$('#modalRoot').firstElementChild) document.removeEventListener('keydown', escClose);
    const prev = focusStack.pop();
    if (prev && prev.focus) prev.focus();
  }
  window.closeModal = closeModal;

  function confirmDialog(title, message, okLabel) {
    return new Promise(resolve => {
      const back = openModal(`
        <div class="modal-head"><h2>${esc(title)}</h2></div>
        <div class="modal-body"><p style="margin:0;line-height:1.6;color:var(--text-dim)">${message}</p></div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-x="no">Vazgeç</button>
          <button class="btn btn-danger" data-x="yes">${esc(okLabel || 'Onayla')}</button>
        </div>`, { small: true, title });
      back.addEventListener('click', e => {
        const b = e.target.closest('[data-x]');
        if (!b) return;
        closeModal(); resolve(b.dataset.x === 'yes');
      });
    });
  }

  /* ================= Giriş animasyonu ================= */
  function bootSplash() {
    const splash = $('#splash'), app = $('#app');
    const skip = !S.settings.showSplash || sessionStorage.getItem('servet.splashSeen');
    const reveal = () => {
      splash.classList.add('done');
      app.hidden = false;
      app.classList.add('ready');
      // Bitişte 'ready' kaldırılır (kalan transform, fixed öğeleri bozardı)
      const done = () => { app.classList.remove('ready'); app.classList.add('shown'); };
      app.addEventListener('animationend', done, { once: true });
      setTimeout(done, 1200);
      sessionStorage.setItem('servet.splashSeen', '1');
      setTimeout(() => { splash.style.display = 'none'; }, 800);
    };
    if (skip) { splash.style.transition = 'none'; reveal(); }
    else setTimeout(reveal, 2100);
    splash.addEventListener('click', reveal);
  }

  /* ================= Yönlendirme ================= */
  const routes = {
    dashboard: renderDashboard,
    assets: renderAssets,
    stats: renderStats,
    history: renderHistory,
    settings: renderSettings
  };
  const routeOf = () => {
    const h = (location.hash || '#/').replace(/^#\/?/, '').split('?')[0];
    return routes[h] ? h : 'dashboard';
  };

  function navigate() {
    if (typeof closeRowMenu === 'function') closeRowMenu();
    const r = routeOf();
    $$('.nav-item, .tabbar a').forEach(a => a.classList.toggle('active', a.dataset.route === r));
    view.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'view-in';
    view.appendChild(wrap);
    routes[r](wrap);
    view.scrollTop = 0; window.scrollTo(0, 0);
    closeNav();
    updateTopbar();
  }

  function updateTopbar() {
    const t = S.totals();
    $('#topbarTotal').textContent = S.fmtMoney(t.value);
  }

  /* ================= Ortak parçalar ================= */
  function pageHead(title, sub, actions) {
    return `<div class="page-head">
      <div><h1 class="page-title">${title}</h1><p class="page-sub">${sub}</p></div>
      <div class="chip-row">${actions || ''}</div>
    </div>`;
  }

  /* Ana sayfada gösterilen uyarı bantları: eksik kur ve yedek hatırlatması */
  function banners() {
    const out = [];
    const t = S.totals();
    const missing = S.missingRates();
    if (t.unknownFx > 0) {
      out.push(`<div class="banner warn" data-banner="fx">
        <span class="bn-ico">⚠️</span>
        <div class="bn-text"><b>${t.unknownFx} varlık toplama dahil edilmedi.</b>
          ${missing.length ? esc(missing.join(', ')) + ' kur' + (missing.length > 1 ? 'ları' : 'u') + ' alınamadı.' : 'Kur verisi eksik.'}
          Gösterilen toplam eksiktir.</div>
        <button class="btn btn-sm" data-act="fixRates">Kurları gir</button>
      </div>`);
    }
    const mat = S.maturities(7);
    if (mat.length) {
      const m0 = mat[0];
      out.push(`<div class="banner" data-banner="maturity">
        <span class="bn-ico">⏳</span>
        <div class="bn-text"><b>${m0.overdue ? 'Vade geçti' : (m0.days === 0 ? 'Bugün vade günü' : m0.days + ' gün içinde vade')}:</b>
          ${esc(m0.asset.name)} · ${esc(S.fmtMoney(m0.value, m0.asset.currency))}
          ${m0.expected ? ` · beklenen faiz ${esc(S.fmtMoney(m0.expected, m0.asset.currency))}` : ''}
          ${mat.length > 1 ? ` (+${mat.length - 1} kayıt daha)` : ''}</div>
        <a class="btn btn-sm" href="#/stats">Vadeleri gör</a>
      </div>`);
    }
    const zero = S.assets.filter(x => !x.unitPrice && DATA.assetType(x.type).priceable);
    if (zero.length) {
      out.push(`<div class="banner warn" data-banner="zero">
        <span class="bn-ico">💸</span>
        <div class="bn-text"><b>${zero.length} varlığın birim değeri 0.</b>
          ${esc(zero.slice(0, 3).map(x => x.name).join(', '))}${zero.length > 3 ? '…' : ''} —
          fiyatı çekilemedi veya elle girilmedi, bu yüzden toplama katkısı yok.</div>
        <button class="btn btn-sm btn-gold" data-act="fixZero">Fiyatları çek</button>
      </div>`);
    }
    const b = S.backupStatus();
    if (b.due && !sessionStorage.getItem('servet.backupDismissed')) {
      out.push(`<div class="banner" data-banner="backup">
        <span class="bn-ico">💾</span>
        <div class="bn-text"><b>${b.last ? b.days + ' gündür yedek almadınız.' : 'Henüz yedek almadınız.'}</b>
          Veriler yalnızca bu tarayıcıda; geçmişi temizlemek portföyü siler.</div>
        <button class="btn btn-sm btn-gold" data-act="backupNow">Yedek al</button>
        <button class="icon-btn" data-act="dismissBackup" aria-label="Kapat">✕</button>
      </div>`);
    }
    return out.join('');
  }

  function bannerActions(root) {
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b) return;
      if (b.dataset.act === 'fixRates') { location.hash = '#/settings'; }
      if (b.dataset.act === 'fixZero') {
        const zero = S.assets.filter(x => !x.unitPrice && DATA.assetType(x.type).priceable);
        (async () => {
          let ok = 0;
          for (const z of zero) {
            if (!z.autoPrice) { z.autoPrice = true; S.save(); }
            const r = await Market.fetchOne(z);
            if (r.ok) ok++;
            else if (r.needsStockToggle) {
              S.settings.stockPrices = true; S.save();
              const r2 = await Market.fetchOne(z);
              if (r2.ok) ok++;
            }
          }
          toast(ok ? `${ok} varlığın fiyatı çekildi.` : 'Fiyatlar çekilemedi — ürün/sembol seçili mi kontrol edin.',
            ok ? 'ok' : 'err');
          navigate();
        })();
      }
      if (b.dataset.act === 'backupNow') {
        download('servet-yedek-' + S.todayISO() + '.json', S.exportJSON(), 'application/json');
        S.markBackedUp();
        navigate();
      }
      if (b.dataset.act === 'dismissBackup') {
        sessionStorage.setItem('servet.backupDismissed', '1');
        b.closest('.banner').remove();
      }
    });
  }

  function emptyState(title, text, btn) {
    return `<div class="card"><div class="empty">
      <svg viewBox="0 0 24 24"><path d="M3 7h18v12H3zM3 7l3-4h12l3 4M9 12h6"/></svg>
      <h3>${esc(title)}</h3><p>${esc(text)}</p>${btn || ''}</div></div>`;
  }

  const deltaHtml = pct => {
    if (pct == null || isNaN(pct)) return '<span class="delta flat">—</span>';
    const c = pct > 0.005 ? 'up' : pct < -0.005 ? 'down' : 'flat';
    const arrow = c === 'up' ? '▲' : c === 'down' ? '▼' : '■';
    return `<span class="delta ${c}">${arrow} ${S.fmtPct(pct)}</span>`;
  };

  /* ================= 1) ANA SAYFA ================= */
  function renderDashboard(root) {
    const t = S.totals();
    const cur = t.currency;
    if (!S.assets.length) {
      root.innerHTML = pageHead('Hoş geldiniz', 'Portföyünüzü oluşturmak için ilk varlığınızı ekleyin.') +
        emptyState('Henüz varlık yok',
          'Altın, hisse, nakit, kripto, gayrimenkul… Tüm varlıklarınızı ve bunları nerede tuttuğunuzu (elde / bankada / Midas gibi platformlarda) tek yerde toplayın.',
          `<div class="chip-row" style="justify-content:center;margin-top:6px">
             <button class="btn btn-gold" data-act="add">İlk varlığı ekle</button>
             <button class="btn btn-ghost" data-act="demo">Örnek veriyle dene</button>
           </div>`);
      root.addEventListener('click', e => {
        if (e.target.closest('[data-act="add"]')) openAssetForm();
        if (e.target.closest('[data-act="demo"]')) { S.seedDemo(); toast('Örnek portföy yüklendi.', 'ok'); navigate(); }
      });
      return;
    }

    const p7 = S.performance(7), p30 = S.performance(30), pYtd = ytdPerf();
    const types = S.byType(cur), locs = S.byLocationKind(cur), places = S.byLocationName(cur);
    const ser = S.series(90);
    const top = [...S.assets].map(a => ({ a, v: S.assetValue(a, cur) }))
      .filter(x => !isNaN(x.v)).sort((x, y) => y.v - x.v).slice(0, 5);
    const movers = [...S.assets].map(a => {
      const v = S.assetValue(a, cur), c = S.assetCost(a, cur);
      return { a, v, pl: v - c, pct: c > 0 ? (v - c) / c * 100 : NaN };
    }).filter(x => !isNaN(x.pct)).sort((x, y) => y.pct - x.pct);

    root.innerHTML = `
      ${banners()}
      ${pageHead(`Merhaba${S.state.profile.name ? ', ' + esc(S.state.profile.name) : ''} 👋`,
        `${t.count} varlık · ${places.length} farklı saklama yeri · ${cur} bazında`)}

      <div class="grid g-kpi" style="margin-bottom:16px">
        <div class="card kpi">
          <p class="kpi-label">Toplam Portföy</p>
          <div class="kpi-value gold-text">${S.fmtMoney(t.value)}</div>
          <p class="kpi-foot">${deltaHtml(p30.pct)} <span>son 30 gün</span></p>
        </div>
        <div class="card kpi">
          <p class="kpi-label">Toplam Kâr / Zarar</p>
          <div class="kpi-value ${t.pl >= 0 ? 'delta up' : 'delta down'}">${S.fmtMoney(t.pl)}</div>
          <p class="kpi-foot">Maliyet ${S.fmtMoney(t.cost)} · ${deltaHtml(t.plPct)}</p>
        </div>
        <div class="card kpi">
          <p class="kpi-label">7 Günlük Değişim</p>
          <div class="kpi-value">${p7.abs == null ? '—' : S.fmtMoney(p7.abs)}</div>
          <p class="kpi-foot">${deltaHtml(p7.pct)} <span>haftalık</span></p>
        </div>
        <div class="card kpi">
          <p class="kpi-label">Yıl Başından Beri</p>
          <div class="kpi-value">${pYtd.abs == null ? '—' : S.fmtMoney(pYtd.abs)}</div>
          <p class="kpi-foot">${deltaHtml(pYtd.pct)} <span>YTD</span></p>
        </div>
      </div>

      ${ser.length < 2 ? `
      <div class="card card-slim" style="margin-bottom:16px">
        <div class="card-head" style="margin:0">
          <h2 class="card-title">📈 Portföy Değeri — Son 90 Gün</h2>
          <span class="pill"><span class="dot"></span>${ser.length} gün kayıt</span>
        </div>
        <p class="muted" style="font-size:12.5px;margin:6px 0 0">
          Grafik, ikinci günlük kayıt oluştuğunda burada açılacak. Kayıt her değişiklikte
          kendiliğinden alınır — bir şey yapmanız gerekmiyor.</p>
      </div>` : `
      <div class="card" style="margin-bottom:16px">
        <div class="card-head">
          <h2 class="card-title">Portföy Değeri — Son 90 Gün</h2>
          <span class="pill"><span class="dot"></span>${ser.length} gün kayıt</span>
        </div>
        <div class="chart-box">${Charts.area(
          ser.map(s => ({ label: shortDate(s.date), value: s.total })),
          { fmtY: v => S.fmtMoney(v, cur, { compact: true }), height: 250, aria: 'Portföy değeri zaman serisi' })}</div>
      </div>`}

      <div class="grid g-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2 class="card-title">Varlık Sınıfı Dağılımı</h2></div>
          <div class="donut-wrap">
            <div class="chart-box">
              ${Charts.donut(types, { fmt: v => S.fmtMoney(v, cur) })}
              <div class="donut-center"><b>${S.fmtMoney(t.value, cur, { compact: true })}</b><span>Toplam</span></div>
            </div>
            ${Charts.legend(types, v => S.fmtMoney(v, cur, { compact: true }))}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2 class="card-title">Nerede Duruyor?</h2></div>
          <div class="donut-wrap">
            <div class="chart-box">
              ${Charts.donut(locs, { fmt: v => S.fmtMoney(v, cur) })}
              <div class="donut-center"><b>${locs.length}</b><span>Saklama Türü</span></div>
            </div>
            ${Charts.legend(locs, v => S.fmtMoney(v, cur, { compact: true }))}
          </div>
        </div>
      </div>

      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><h2 class="card-title">En Büyük 5 Varlık</h2>
            <a class="link-btn" href="#/assets">Tümü →</a></div>
          <div class="bar-list">
            ${top.map(x => `
              <div class="bar-row">
                <div class="bar-top">
                  <span>${DATA.assetType(x.a.type).icon} ${esc(x.a.name)}</span>
                  <b class="num">${S.fmtMoney(x.v, cur, { compact: true })}</b>
                </div>
                <div class="bar-track"><i class="bar-fill" data-w="${(x.v / (top[0].v || 1) * 100).toFixed(1)}%"></i></div>
                <small class="muted">${esc(S.locLabel(x.a.location))}</small>
              </div>`).join('')}
          </div>
        </div>
        <div class="card">
          <div class="card-head"><h2 class="card-title">Son Hareketler</h2>
            <a class="link-btn" href="#/history">Geçmiş →</a></div>
          <div class="timeline">
            ${S.transactions.slice(0, 6).map(txRow).join('') ||
              '<p class="muted" style="font-size:13px">Henüz hareket yok.</p>'}
          </div>
        </div>
      </div>`;

    // Bar animasyonu: 0'dan hedef genişliğe
    requestAnimationFrame(() => $$('.bar-fill', root).forEach(b => { b.style.width = b.dataset.w; }));

    bannerActions(root);
  }

  const ytdPerf = () => S.performanceSince(new Date().getFullYear() + '-01-01');

  const shortDate = d => {
    const [y, m, dd] = d.split('-');
    return dd + '.' + m;
  };

  function txRow(t) {
    const tt = DATA.txType(t.type);
    return `<div class="tl-item">
      <div class="tl-dot">${tt.icon}</div>
      <div class="tl-main">
        <div class="tl-title"><strong>${esc(t.assetName || tt.name)}</strong>
          <span class="pill">${esc(tt.name)}</span>
          <span class="tl-time">${esc(S.relTime(t.at))}</span></div>
        <p class="tl-desc">${esc(t.note || '')}
          ${t.amount != null ? ' · <b>' + esc(S.fmtMoney(t.amount, t.currency)) + '</b>' : ''}
          ${t.locationTo ? ' · ' + esc(t.locationTo) : ''}</p>
      </div></div>`;
  }

  /* ================= 2) VARLIKLAR ================= */
  const assetFilter = { q: '', type: '', kind: '', sort: 'value', dir: -1, tab: 'active' };

  function renderAssets(root) {
    const cur = S.settings.baseCurrency;
    const rt = S.realizedTotals(cur);
    root.innerHTML = pageHead('Varlıklar',
      `${S.assets.length} aktif kayıt · toplam ${S.fmtMoney(S.totals().value)}` +
      (S.sales.length ? ` · ${S.sales.length} satış · gerçekleşen ${S.fmtMoney(rt.realized)}` : ''),
      `<button class="btn btn-sm" data-act="csv">CSV indir</button>
       <button class="btn btn-sm btn-gold" data-act="add">+ Yeni varlık</button>`) +
      `<div class="seg" style="margin-bottom:16px">
         <button class="${assetFilter.tab === 'active' ? 'on' : ''}" data-tab="active">Portföy (${S.assets.length})</button>
         <button class="${assetFilter.tab === 'sold' ? 'on' : ''}" data-tab="sold">Satılanlar (${S.sales.length})</button>
       </div>
      <div class="card">
        <div class="filters">
          <input id="fq" type="search" placeholder="🔍 Ara: ad, sembol, kurum…" value="${esc(assetFilter.q)}">
          <select id="ftype"><option value="">Tüm türler</option>
            ${DATA.ASSET_TYPES.map(t => `<option value="${t.id}" ${assetFilter.type === t.id ? 'selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select>
          <select id="fkind"><option value="">Tüm saklama yerleri</option>
            ${DATA.LOCATION_KINDS.map(k => `<option value="${k.id}" ${assetFilter.kind === k.id ? 'selected' : ''}>${k.icon} ${esc(k.name)}</option>`).join('')}</select>
          <select id="fsort">
            <option value="value">Değere göre</option>
            <option value="name">Ada göre</option>
            <option value="pl">Kâr/zarara göre</option>
            <option value="date">Edinme tarihine göre</option>
          </select>
        </div>
        <div id="assetTable"></div>
      </div>`;

    $('#fsort', root).value = assetFilter.sort;
    // Satılanlar sekmesinde tür/yer/sıralama filtreleri anlamsız — gizle
    ['#ftype', '#fkind', '#fsort'].forEach(sel => {
      const el = $(sel, root);
      if (el) el.style.display = assetFilter.tab === 'sold' ? 'none' : '';
    });
    if (assetFilter.tab === 'sold') $('#fq', root).placeholder = '🔍 Satılan varlıklarda ara…';
    drawAssetTable();

    root.addEventListener('input', e => {
      if (e.target.id === 'fq') { assetFilter.q = e.target.value; drawAssetTable(); }
    });
    root.addEventListener('change', e => {
      if (e.target.id === 'ftype') assetFilter.type = e.target.value;
      else if (e.target.id === 'fkind') assetFilter.kind = e.target.value;
      else if (e.target.id === 'fsort') assetFilter.sort = e.target.value;
      else return;
      drawAssetTable();
    });
    root.addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { assetFilter.tab = tab.dataset.tab; navigate(); return; }
      const mb = e.target.closest('[data-menu]');
      if (mb) { openRowMenu(mb.dataset.menu, mb); return; }
      const b = e.target.closest('[data-act]');
      if (!b) return;
      const id = b.dataset.id;
      if (b.dataset.act === 'income') openIncomeForm(S.getAsset(id));
      if (b.dataset.act === 'add') openAssetForm();
      if (b.dataset.act === 'edit') openAssetForm(S.getAsset(id));
      if (b.dataset.act === 'del') delAsset(id);
      if (b.dataset.act === 'sell') openSellForm(S.getAsset(id));
      if (b.dataset.act === 'buy') openBuyForm(S.getAsset(id));
      if (b.dataset.act === 'lots') openLotsView(S.getAsset(id));
      if (b.dataset.act === 'delSale') delSale(id);
      if (b.dataset.act === 'csv') {
        if (assetFilter.tab === 'sold') download('satislar.csv', S.exportSalesCSV(), 'text/csv');
        else download('varliklar.csv', S.exportAssetsCSV(), 'text/csv');
      }
    });

    function drawAssetTable() {
      if (assetFilter.tab === 'sold') return drawSalesTable();
      const rows = filtered();
      $('#assetTable', root).innerHTML = rows.length ? `
        <div class="table-wrap"><table>
          <thead><tr>
            <th>Varlık</th><th>Saklama Yeri</th><th class="num">Miktar</th>
            <th class="num">Birim Değer</th><th class="num">Toplam (${cur})</th>
            <th class="num">K/Z</th><th></th>
          </tr></thead><tbody>
          ${rows.map(a => {
            const v = S.assetValue(a, cur), c = S.assetCost(a, cur);
            const pl = isNaN(c) ? NaN : v - c;
            const pct = isNaN(c) || !c ? NaN : (v - c) / c * 100;
            const t = DATA.assetType(a.type), k = DATA.locationKind(a.location.kind);
            return `<tr>
              <td><div class="asset-name">
                <span class="asset-ico">${t.icon}</span>
                <span class="asset-meta"><strong>${esc(a.name)}</strong>
                  <small>${(a.lots || []).length > 1
                    ? `<button class="link-btn" data-act="lots" data-id="${a.id}">${a.lots.length} alım</button> · ` : ''}${esc(t.name)}${a.symbol ? ' · ' + esc(a.symbol) : ''}${
                    a.autoPrice
                      ? (a.symbol || a.type === 'cash'
                          ? ' · <span class="ok-tag">otomatik fiyat</span>'
                          : ' · <span class="warn-tag">ürün seçilmedi</span>')
                      : (t.priceable ? ' · <span class="dim-tag">elle</span>' : '')}</small></span>
              </div></td>
              <td><span class="pill">${k.icon} ${esc(a.location.name || k.name)}</span>
                ${a.location.account ? `<br><small class="muted">${esc(a.location.account)}</small>` : ''}</td>
              <td class="num">${S.fmtNum(a.quantity, 6)} <small class="muted">${esc(a.unit)}</small></td>
              <td class="num">${a.unitPrice ? S.fmtMoney(a.unitPrice, a.currency)
                : '<span class="warn-tag">fiyat bekleniyor</span>'}</td>
              <td class="num"><b>${S.fmtMoney(v, cur)}</b></td>
              <td class="num">${isNaN(pl) ? '<span class="muted">—</span>' :
                `<span class="delta ${pl >= 0 ? 'up' : 'down'}">${S.fmtMoney(pl, cur, { compact: true })}<br>
                 <small>${S.fmtPct(pct)}</small></span>`}</td>
              <td><div class="row-actions">
                <button class="btn btn-sm" data-act="buy" data-id="${a.id}">Alım</button>
                <button class="btn btn-sm" data-act="sell" data-id="${a.id}">Sat</button>
                <button class="btn btn-sm btn-ghost" data-menu="${a.id}"
                  aria-haspopup="menu" aria-expanded="false" aria-label="Diğer işlemler">⋯</button>
              </div></td></tr>`;
          }).join('')}
          </tbody></table></div>` :
        `<div class="empty"><h3>Sonuç bulunamadı</h3><p>Filtreleri değiştirip tekrar deneyin.</p></div>`;
    }

    function drawSalesTable() {
      const q = assetFilter.q.toLocaleLowerCase('tr');
      const rows = S.sales.filter(x => !q ||
        [x.name, x.symbol, x.location, DATA.assetType(x.type).name].join(' ').toLocaleLowerCase('tr').includes(q));
      const rt = S.realizedTotals(cur);
      $('#assetTable', root).innerHTML = S.sales.length ? `
        <div class="grid g-kpi" style="margin-bottom:16px">
          <div class="card kpi"><p class="kpi-label">Gerçekleşen Kâr / Zarar</p>
            <div class="kpi-value ${rt.realized >= 0 ? 'delta up' : 'delta down'}">${S.fmtMoney(rt.realized)}</div>
            <p class="kpi-foot">${rt.known} satışta maliyet biliniyor</p></div>
          <div class="card kpi"><p class="kpi-label">Toplam Satış Hasılatı</p>
            <div class="kpi-value">${S.fmtMoney(rt.proceeds)}</div>
            <p class="kpi-foot">${rt.count} satış işlemi</p></div>
          <div class="card kpi"><p class="kpi-label">Kapanan Pozisyon</p>
            <div class="kpi-value">${S.sales.filter(x => x.closed).length}</div>
            <p class="kpi-foot">${S.sales.filter(x => !x.closed).length} kısmi satış</p></div>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Varlık</th><th>Satış Tarihi</th><th class="num">Miktar</th>
            <th class="num">Satış Fiyatı</th><th class="num">Hasılat</th>
            <th class="num">Gerçekleşen K/Z</th><th>Durum</th><th></th></tr></thead><tbody>
          ${rows.map(x => {
            const t = DATA.assetType(x.type);
            const r = x.realized == null ? NaN : S.convert(x.realized, x.currency, cur);
            return `<tr>
              <td><div class="asset-name"><span class="asset-ico">${t.icon}</span>
                <span class="asset-meta"><strong>${esc(x.name)}</strong>
                  <small>${esc(t.name)}${x.symbol ? ' · ' + esc(x.symbol) : ''} · ${esc(x.location)}</small></span></div></td>
              <td>${esc(S.fmtDate(x.date))}<br><small class="muted">${esc(S.relTime(x.at))}</small></td>
              <td class="num">${S.fmtNum(x.quantity, 6)} <small class="muted">${esc(x.unit)}</small></td>
              <td class="num">${S.fmtMoney(x.unitPrice, x.currency)}</td>
              <td class="num">${S.fmtMoney(S.convert(x.proceeds, x.currency, cur), cur)}</td>
              <td class="num">${isNaN(r) ? '<span class="muted">maliyet yok</span>' :
                `<span class="delta ${r >= 0 ? 'up' : 'down'}">${S.fmtMoney(r, cur)}<br>
                 <small>${x.pct == null ? '' : S.fmtPct(x.pct)}</small></span>`}</td>
              <td><span class="sale-badge ${x.closed ? 'closed' : 'partial'}">${x.closed ? 'Kapandı' : 'Kısmi'}</span></td>
              <td><div class="row-actions">
                <button class="btn btn-sm btn-danger" data-act="delSale" data-id="${x.id}" aria-label="Kaydı sil">✕</button>
              </div></td></tr>`;
          }).join('')}
          </tbody></table></div>` :
        `<div class="empty">
          <svg viewBox="0 0 24 24"><path d="M3 3h18v6H3zM6 9v12h12V9M10 13h4"/></svg>
          <h3>Henüz satış yok</h3>
          <p>Bir varlığı sattığınızda “Sat” düğmesini kullanın; gerçekleşen kâr/zarar burada
             birikir ve geçmişe kaydedilir.</p></div>`;
    }

    function filtered() {
      const q = assetFilter.q.toLocaleLowerCase('tr');
      let rows = S.assets.filter(a => {
        if (assetFilter.type && a.type !== assetFilter.type) return false;
        if (assetFilter.kind && a.location.kind !== assetFilter.kind) return false;
        if (!q) return true;
        return [a.name, a.symbol, a.location.name, a.location.account, a.notes,
          DATA.assetType(a.type).name].join(' ').toLocaleLowerCase('tr').includes(q);
      });
      const key = {
        value: a => S.assetValue(a, cur) || 0,
        name: a => a.name.toLocaleLowerCase('tr'),
        pl: a => { const c = S.assetCost(a, cur); return isNaN(c) ? -Infinity : S.assetValue(a, cur) - c; },
        date: a => a.acquiredAt || a.createdAt
      }[assetFilter.sort];
      rows.sort((x, y) => {
        const kx = key(x), ky = key(y);
        return (kx < ky ? -1 : kx > ky ? 1 : 0) * (assetFilter.sort === 'name' ? 1 : -1);
      });
      return rows;
    }
  }

  /* Satır menüsü: tablo taşması kırpmasın diye body'ye eklenir ve
     düğmenin konumuna göre yerleştirilir (gerekirse yukarı açılır). */
  let openMenu = null;
  function closeRowMenu() {
    if (!openMenu) return;
    const { el, btn } = openMenu;
    el.remove();
    if (btn) btn.setAttribute('aria-expanded', 'false');
    openMenu = null;
    document.removeEventListener('click', onDocClick, true);
    document.removeEventListener('keydown', onMenuKey, true);
    window.removeEventListener('scroll', closeRowMenu, true);
    window.removeEventListener('resize', closeRowMenu);
  }
  const onDocClick = e => { if (openMenu && !openMenu.el.contains(e.target)) closeRowMenu(); };
  const onMenuKey = e => { if (e.key === 'Escape') { e.stopPropagation(); closeRowMenu(); } };

  function openRowMenu(assetId, btn) {
    const wasOpen = openMenu && openMenu.id === assetId;
    closeRowMenu();
    if (wasOpen) return;

    const asset = S.getAsset(assetId);
    if (!asset) return;
    const el = document.createElement('div');
    el.className = 'menu';
    el.setAttribute('role', 'menu');
    el.innerHTML = `
      <button role="menuitem" data-m="income">💰 Getiri ekle</button>
      <button role="menuitem" data-m="lots">📋 Alımları gör${(asset.lots || []).length ? ` (${asset.lots.length})` : ''}</button>
      <button role="menuitem" data-m="edit">✏️ Düzenle</button>
      <button role="menuitem" class="danger" data-m="del">🗑️ Sil</button>`;
    document.body.appendChild(el);

    const r = btn.getBoundingClientRect();
    const mw = el.offsetWidth, mh = el.offsetHeight;
    const aşağıSığar = r.bottom + 6 + mh <= window.innerHeight;
    const ham = aşağıSığar ? r.bottom + 6 : r.top - mh - 6;
    // Her hâlükârda görünür alanın içinde kal (satır ekranın dışındaysa bile)
    el.style.left = Math.max(8, Math.min(r.right - mw, window.innerWidth - mw - 8)) + 'px';
    el.style.top = Math.max(8, Math.min(ham, window.innerHeight - mh - 8)) + 'px';
    btn.setAttribute('aria-expanded', 'true');

    el.addEventListener('click', e => {
      const b = e.target.closest('[data-m]');
      if (!b) return;
      const act = b.dataset.m;
      closeRowMenu();
      if (act === 'income') openIncomeForm(asset);
      if (act === 'lots') openLotsView(asset);
      if (act === 'edit') openAssetForm(asset);
      if (act === 'del') delAsset(asset.id);
    });
    el.querySelector('button').focus();

    openMenu = { id: assetId, el, btn };
    setTimeout(() => {
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onMenuKey, true);
      window.addEventListener('scroll', closeRowMenu, true);
      window.addEventListener('resize', closeRowMenu);
    }, 0);
  }

  async function delAsset(id) {
    const a = S.getAsset(id);
    if (!a) return;
    const ok = await confirmDialog('Varlığı sil',
      `<b>${esc(a.name)}</b> portföyünüzden kalıcı olarak silinecek. Bu işlem geri alınamaz;
       yalnızca geçmiş kaydı olarak günlüğe yazılır.`, 'Evet, sil');
    if (!ok) return;
    S.removeAsset(id);
    toast('Varlık silindi.', 'ok');
    navigate();
  }

  /* ================= SEÇİCİ (aranabilir liste sayfası) =================
     Hisse, altın ürünü, kripto, banka ve platform seçimlerinin tamamı bu
     bileşenle yapılır: üstte arama kutusu, altında gruplanmış liste. */
  function openPicker(opts) {
    const items = [];
    opts.groups.forEach(g => g.items.forEach(it => items.push(Object.assign({ group: g.label }, it))));
    const norm = t => String(t || '').toLocaleLowerCase('tr').replace(/[İIıi]/g, 'i');
    let remote = [], remoteMsg = '', remoteTimer = null, remoteSeq = 0;

    const back = openModal(`
      <div class="modal-head">
        <h2>${esc(opts.title)}</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button>
      </div>
      <div class="picker-search">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="pkSearch" type="search" autocomplete="off" placeholder="${esc(opts.placeholder || 'Ara: kod veya isim…')}">
        </div>
        <div class="picker-count" id="pkCount"></div>
      </div>
      <div class="picker-list" id="pkList"></div>
      <div class="modal-foot"><button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button></div>`,
      { title: opts.title });

    const list = $('#pkList', back), count = $('#pkCount', back), search = $('#pkSearch', back);
    let shown = [], hi = -1;

    function render() {
      const q = norm(search.value.trim());
      const local = q ? items.filter(it => norm(it.code + ' ' + it.name + ' ' + (it.tag || '')).includes(q)) : items;
      // Çevrimiçi sonuçlar listenin altına eklenir; yereldekiler tekrarlanmaz.
      const seen = new Set(local.map(it => norm(it.value)));
      shown = local.concat(remote.filter(it => !seen.has(norm(it.value))));

      let html = '';
      let lastGroup = null;
      shown.forEach((it, i) => {
        if (it.group !== lastGroup) { html += `<div class="picker-group">${esc(it.group)}</div>`; lastGroup = it.group; }
        html += `<div class="picker-item ${it.value === opts.value ? 'sel' : ''}" data-i="${i}"
          style="animation-delay:${Math.min(i, 12) * 0.015}s">
          <span class="pi-code">${esc(it.code)}</span>
          <span class="pi-name">${esc(it.name)}</span>
          ${it.tag ? `<span class="pi-tag">${esc(it.tag)}</span>` : ''}</div>`;
      });
      // "Kendim yazayım" satırı en sonda durur ki gerçek eşleşmeler öne geçsin
      const exact = items.some(it => norm(it.code) === q || norm(it.name) === q);
      if (opts.allowCustom && q && !exact) {
        html += `<div class="picker-group">Listede yok mu?</div>
          <div class="picker-item custom" data-custom="1">
            <span class="pi-code">✎</span>
            <span class="pi-name">“${esc(search.value.trim())}” olarak kendim gireyim</span>
            <span class="pi-tag">özel</span></div>`;
      }
      if (!shown.length && !opts.allowCustom) {
        html += `<div class="picker-empty">Eşleşme yok. Farklı bir kelime deneyin.</div>`;
      }
      list.innerHTML = html;
      count.textContent = `${shown.length} sonuç${remoteMsg ? ' · ' + remoteMsg : ''}` +
        (opts.allowCustom ? ' · listede yoksa yazıp Enter’a basın' : '');
      hi = -1;
    }

    /* Paketlenmiş liste her borsayı kapsayamaz; opts.remote verilmişse yazdıkça
       çevrimiçi arama yapılır (350 ms bekleyip son isteği uygular). */
    function queryRemote() {
      if (!opts.remote) return;
      clearTimeout(remoteTimer);
      const q = search.value.trim();
      if (q.length < 2) { remote = []; remoteMsg = ''; return; }
      remoteTimer = setTimeout(async () => {
        const seq = ++remoteSeq;
        remoteMsg = 'internette aranıyor…';
        render();
        try {
          const res = await opts.remote(q);
          if (seq !== remoteSeq) return;                 // daha yeni bir arama var
          remote = res.map(x => Object.assign({ group: 'İnternet sonuçları (Yahoo Finance)' }, x));
          remoteMsg = remote.length ? remote.length + ' çevrimiçi sonuç' : 'çevrimiçi sonuç yok';
        } catch (e) {
          if (seq !== remoteSeq) return;
          remote = []; remoteMsg = 'çevrimiçi arama başarısız';
        }
        render();
      }, 350);
    }

    function choose(item) { closeModal(); opts.onPick(item); }

    search.addEventListener('input', () => { render(); queryRemote(); });
    search.addEventListener('keydown', e => {
      const rows = $$('.picker-item', list);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!rows.length) return;
        hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;
        rows.forEach((r, i) => r.classList.toggle('hi', i === hi));
        rows[hi].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = hi >= 0 ? $$('.picker-item', list)[hi] : $$('.picker-item', list)[0];
        if (row) row.click();
      }
    });
    list.addEventListener('click', e => {
      const row = e.target.closest('.picker-item');
      if (!row) return;
      if (row.dataset.custom) {
        const v = search.value.trim();
        choose({ value: v, code: v, name: v, custom: true });
      } else choose(shown[Number(row.dataset.i)]);
    });

    render();
    setTimeout(() => search.focus(), 80);
  }

  /* Seçici düğmesi (gizli input değeri korur) */
  function pickerButton(id, display, sub, placeholder) {
    return `<button type="button" class="picker-btn" data-picker="${id}">
      <span class="pk-main">${display ? esc(display) : `<span class="pk-empty">${esc(placeholder)}</span>`}
        ${sub ? `<br><span class="pk-sub">${esc(sub)}</span>` : ''}</span>
      <span class="pk-arrow">▼</span></button>`;
  }

  /* Sembol alanı, varlık türüne göre değişir:
     altın/gümüş -> kapalıçarşı ürün listesi, kripto -> bilinen semboller,
     hisse/ETF -> serbest sembol (BIST için .IS otomatik denenir). */
  function symbolFieldHTML(type, value) {
    const v = value || '';
    const hidden = `<input type="hidden" id="fSymbol" name="symbol" value="${esc(v)}">`;

    if (type === 'gold' || type === 'silver') {
      const q = DATA.metalQuote(v);
      return `<label>Ürün (otomatik fiyat)</label>
        ${pickerButton('symbol', q ? q.name : '', q ? 'Kapalıçarşı · ' + q.key : '', 'Ürün seçin — gram, çeyrek, tam altın…')}
        ${hidden}<span class="hint">Fiyat TRY olarak çekilir; birim otomatik ayarlanır.</span>`;
    }
    if (type === 'crypto') {
      return `<label>Kripto para</label>
        ${pickerButton('symbol', v, v ? coinName(v) : '', 'Kripto seçin — BTC, ETH…')}
        ${hidden}<span class="hint">CoinGecko üzerinden USD fiyatı çekilir.</span>`;
    }
    if (type === 'stock' || type === 'etf') {
      const found = SYMBOLS.find(v);
      return `<label>${type === 'etf' ? 'ETF / fon' : 'Hisse senedi'}</label>
        ${pickerButton('symbol', v, found ? found.name + ' · ' + found.market : (v ? 'Özel sembol' : ''),
          'Şirket veya sembol seçin — THYAO, AAPL…')}
        ${hidden}<span class="hint">Ayarlar → “Hisse / ETF fiyatlarını çek” açıkken otomatik güncellenir.</span>`;
    }
    return `<label for="fSymbol">Sembol / kod</label>
      <input id="fSymbol" name="symbol" value="${esc(v)}" placeholder="Serbest kod">
      <span class="hint">Bu tür için otomatik fiyat yoktur; değeri elle girin.</span>`;
  }

  /* "Fiyatı otomatik güncelle" anahtarının tür bazlı açıklaması */
  function autoHint(type) {
    if (type === 'gold' || type === 'silver')
      return 'Seçtiğiniz ürünün kapalıçarşı fiyatı (TRY) her yenilemede güncellenir.';
    if (type === 'crypto') return 'CoinGecko üzerinden anlık USD fiyatı çekilir, para biriminize çevrilir.';
    if (type === 'stock' || type === 'etf')
      return 'Yahoo Finance üzerinden fiyat çekilir. Ayarlar → “Hisse / ETF fiyatlarını çek” açık olmalıdır.';
    return 'Bu varlık türü için otomatik fiyat kaynağı yok; değeri elle girin.';
  }

  const coinName = sym => {
    const id = Market.COIN_IDS[sym];
    if (!id) return 'Özel sembol';
    return id.replace(/-\d+$/, '').split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ');
  };

  /* Varlık türüne göre sembol seçiciyi açar */
  function openSymbolPicker(type, current, onPick) {
    if (type === 'gold' || type === 'silver') {
      const qs = DATA.METAL_QUOTES.filter(q => q.type === type);
      const mk = unit => qs.filter(q => q.unit === unit)
        .map(q => ({ value: q.key, code: q.short || q.key, name: q.name, tag: q.unit }));
      const groups = [
        { label: 'Otomatik fiyat istemiyorum', items: [{ value: '', code: '—', name: 'Fiyatı elle gireceğim' }] },
        { label: 'Gram bazlı', items: mk('gram') }
      ];
      const coins = mk('adet');
      if (coins.length) groups.push({ label: 'Ziynet / sarrafiye (adet)', items: coins });
      return openPicker({
        title: type === 'gold' ? '🪙 Altın ürünü seç' : '🥈 Gümüş ürünü seç',
        placeholder: 'Ara: çeyrek, gram, ata…', value: current, groups, onPick
      });
    }
    if (type === 'crypto') {
      return openPicker({
        title: '₿ Kripto para seç', placeholder: 'Ara: BTC, Ethereum…', value: current, allowCustom: true,
        groups: [{
          label: 'Desteklenen kripto paralar',
          items: Object.keys(Market.COIN_IDS).map(k => ({ value: k, code: k, name: coinName(k) }))
        }],
        onPick
      });
    }
    const toItem = x => ({ value: x.code, code: x.code, name: x.name, tag: x.market === 'Borsa İstanbul' ? 'BIST' : '' });
    const g = [];
    if (type === 'etf') {
      g.push({ label: 'ETF / Endeks fonları', items: SYMBOLS.ETF.map(toItem) });
      g.push({ label: 'Borsa İstanbul', items: SYMBOLS.BIST.map(toItem) });
      g.push({ label: 'ABD borsaları', items: SYMBOLS.US.map(toItem) });
    } else {
      g.push({ label: 'Borsa İstanbul', items: SYMBOLS.BIST.map(toItem) });
      g.push({ label: 'ABD borsaları', items: SYMBOLS.US.map(toItem) });
      g.push({ label: 'ETF / Endeks fonları', items: SYMBOLS.ETF.map(toItem) });
    }
    openPicker({
      title: '📈 Hisse / ETF seç', placeholder: 'Ara: THYAO, GMSTR, Apple, S&P 500…',
      value: current, groups: g, allowCustom: true, onPick,
      /* Paketlenmiş liste BIST'in tamamını kapsayamaz; iki harften sonra
         Yahoo'nun arama ucundan tüm borsalarda arama yapılır. Servise yalnızca
         yazdığınız metin gider. */
      remote: async q => (await Market.searchSymbols(q, type)).map(x => ({
        value: x.value, code: x.code, name: x.name, currency: x.currency,
        tag: [x.market, x.kind].filter(Boolean).join(' · ')
      }))
    });
  }

  /* Saklama yeri (banka / platform / kasa) seçicisi */
  function openLocationPicker(kind, current, onPick) {
    const k = DATA.locationKind(kind);
    const names = Market.listFor(kind);
    const groups = [{
      label: kind === 'bank' ? 'Bankalar ve katılım bankaları'
        : kind === 'platform' ? 'Aracı kurumlar, uygulamalar ve borsalar'
        : kind === 'custody' ? 'Saklama seçenekleri' : 'Kayıtlı yerler',
      items: names.map(n => ({ value: n, code: n.slice(0, 2).toLocaleUpperCase('tr'), name: n }))
    }];
    openPicker({
      title: k.icon + ' ' + k.name + ' seç',
      placeholder: kind === 'bank' ? 'Ara: Ziraat, Garanti, Kuveyt Türk…' : 'Ara: Midas, Binance, kasa…',
      value: current, groups, allowCustom: true, onPick
    });
  }

  /* Formda gösterilecek varlık türleri: kurulum testinde seçilenler.
     Seçim yoksa (test atlandıysa) tüm türler gösterilir. Düzenlenen varlığın
     türü listede olmasa bile daima görünür — yoksa tür kaybolurdu. */
  function formTypes(current) {
    const picked = S.settings.assetTypes || [];
    if (!picked.length) return DATA.ASSET_TYPES.slice();
    const keep = new Set(picked);
    if (current) keep.add(current);
    return DATA.ASSET_TYPES.filter(t => keep.has(t.id));
  }

  function typeChipsHTML(current, all) {
    const list = all ? DATA.ASSET_TYPES : formTypes(current);
    const hidden = DATA.ASSET_TYPES.length - list.length;
    return list.map(t => `<button type="button" class="chip ${current === t.id ? 'active' : ''}"
        data-type="${t.id}">${t.icon} ${esc(t.name)}</button>`).join('') +
      (hidden > 0 ? `<button type="button" class="chip chip-more" data-more="1"
        title="Kurulum testinde seçmediğiniz türler">+${hidden} tür daha</button>` : '');
  }

  /* ================= Varlık formu ================= */
  function openAssetForm(asset) {
    const isEdit = !!asset;
    // Yeni varlıkta varsayılan tür, gösterilen listenin ilkidir; aksi halde
    // seçili tür gizli kalabilirdi (ör. kurulum testinde altın seçilmemişse).
    const firstType = formTypes()[0] || DATA.ASSET_TYPES[0];
    const a = asset || {
      name: '', type: firstType.id, symbol: '', quantity: '', unit: firstType.unit, unitPrice: '', unitCost: '',
      currency: S.settings.baseCurrency, acquiredAt: S.todayISO(), autoPrice: false, notes: '',
      location: { kind: 'physical', name: '', account: '' }
    };

    const back = openModal(`
      <div class="modal-head">
        <h2>${isEdit ? '✏️ Varlığı Düzenle' : '✨ Yeni Varlık Ekle'}</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button>
      </div>
      <form class="modal-body" id="assetForm" novalidate>
        <div class="panel">
          <p class="section-label">Varlık Türü</p>
          <div class="chip-row" id="typeChips">${typeChipsHTML(a.type, false)}</div>
        </div>

        <div class="panel">
        <p class="section-label">Ne ekliyorsunuz?</p>
        <div class="form-grid">
          <div id="symbolSlot" class="span-full"></div>
          <div class="field span-full" id="symbolWrap">${symbolFieldHTML(a.type, a.symbol)}</div>
          <div class="field span-full">
            <label for="fName">Varlık adı *</label>
            <input id="fName" name="name" maxlength="80" value="${esc(a.name)}" placeholder="Örn. Gram Altın, THYAO, Dolar Birikim">
            <span class="err">Varlık adı zorunludur.</span>
          </div>
          <div class="field">
            <label for="fQty">Miktar * <small class="unit-tag" id="qtyUnit">${esc(a.unit)}</small></label>
            <input id="fQty" name="quantity" type="text" inputmode="decimal" value="${esc(a.quantity)}">
            <span class="err">Geçerli bir miktar girin.</span>
          </div>
          <div class="field" id="costField">
            <label for="fCost">Alış maliyeti <small class="unit-tag" id="costCur">${esc(a.currency)}</small></label>
            <input id="fCost" name="unitCost" type="text" inputmode="decimal" value="${a.unitCost == null ? '' : esc(a.unitCost)}">
            <span class="hint">Birim başına. Kâr/zarar için — boş bırakılabilir.</span>
          </div>
          <div class="field" id="priceField">
            <label for="fPrice">Güncel birim değer <small class="unit-tag" id="priceCur">${esc(a.currency)}</small></label>
            <input id="fPrice" name="unitPrice" type="text" inputmode="decimal"
              value="${a.unitPrice ? esc(a.unitPrice) : ''}" placeholder="0">
            <span class="hint" id="priceHint">Bu tür için değeri siz belirlersiniz.</span>
            <span class="err">Geçerli bir değer girin.</span>
          </div>
          <div class="field" data-only="deposit,bond">
            <label for="fMaturity">Vade tarihi</label>
            <input id="fMaturity" type="date" value="${esc(a.maturityDate || '')}">
            <span class="hint">Vadeye 7 gün kalınca hatırlatılır.</span>
          </div>
          <div class="field" data-only="deposit,bond">
            <label for="fRate">Yıllık faiz (%)</label>
            <input id="fRate" type="text" inputmode="decimal" value="${a.interestRate == null ? '' : esc(a.interestRate)}" placeholder="örn. 45">
          </div>
        </div>
        </div>

        <div class="panel">
          <p class="section-label">Nerede Tutuyorsunuz?</p>
          <div class="chip-row" id="kindChips" style="margin-bottom:12px">
            ${DATA.LOCATION_KINDS.map(k => `<button type="button" class="chip sel-lg ${a.location.kind === k.id ? 'active' : ''}"
              data-kind="${k.id}">${k.icon} ${esc(k.name)}</button>`).join('')}
          </div>
          <p class="hl" id="kindHint">${esc(DATA.locationKind(a.location.kind).hint)}</p>
          <div class="form-grid" style="margin-top:12px">
            <div class="field" id="locNameField">
              <label>Kurum / yer adı</label>
              <div id="locBtnWrap">${pickerButton('loc', a.location.name, '', 'Seçmek için dokunun')}</div>
              <input type="hidden" id="fLocName" name="locName" value="${esc(a.location.name)}">
              <span class="hint" id="locSrc"></span>
              <span class="err">Kurum / yer adı gereklidir.</span>
            </div>

          </div>
        </div>

        <details class="panel adv" ${isEdit && (a.notes || a.location.account) ? 'open' : ''}>
          <summary><span class="adv-title">Detaylar</span>
            <span class="adv-sub">para birimi, birim, tarih, hesap notu, otomatik fiyat</span>
            <svg class="acc-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
          <div class="adv-body">
            <div class="switch-row">
              <div><strong style="font-size:13.5px">Fiyatı otomatik güncelle</strong>
                <p id="autoHint">${esc(autoHint(a.type))}</p></div>
              <label class="switch"><input type="checkbox" id="fAuto" ${a.autoPrice ? 'checked' : ''}><i></i></label>
            </div>
            <div class="form-grid" style="margin-top:14px">
              <div class="field">
                <label for="fCur">Para birimi *</label>
                <select id="fCur" name="currency">
                  ${DATA.CURRENCIES.map(c => `<option value="${c.code}" ${a.currency === c.code ? 'selected' : ''}>${c.code} — ${esc(c.name)}</option>`).join('')}
                </select>
              </div>
              <div class="field">
                <label for="fUnit">Birim</label>
                <input id="fUnit" name="unit" value="${esc(a.unit)}" list="unitList" placeholder="gram, adet, birim">
                <datalist id="unitList">${['gram', 'adet', 'birim', 'pay', 'lot', 'ons', 'm²'].map(u => `<option value="${u}">`).join('')}</datalist>
              </div>
              <div class="field">
                <label for="fDate">Edinme tarihi</label>
                <input id="fDate" name="acquiredAt" type="date" max="${S.todayISO()}" value="${esc(a.acquiredAt || '')}">
                <span class="err">Geçerli bir tarih girin.</span>
              </div>
              <div class="field">
                <label for="fAccount">Hesap / cüzdan notu</label>
                <input id="fAccount" name="account" value="${esc(a.location.account)}" placeholder="****1234, ana hesap">
                <span class="hint">Tam IBAN veya özel anahtar girmeyin.</span>
              </div>
              <div class="field span-full">
                <label for="fNotes">Not</label>
                <textarea id="fNotes" name="notes" rows="2" maxlength="500" placeholder="Seri no, poliçe, ek bilgi…">${esc(a.notes)}</textarea>
              </div>
            </div>
          </div>
        </details>
      </form>
      <div class="modal-foot">
        ${isEdit ? '<button class="btn btn-danger" data-x="del">Sil</button>' : ''}
        <div style="flex:1"></div>
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" data-x="save">${isEdit ? 'Değişiklikleri kaydet' : 'Varlığı ekle'}</button>
      </div>`, { title: isEdit ? 'Varlığı düzenle' : 'Yeni varlık' });

    let kind = a.location.kind, type = a.type;
    const form = $('#assetForm', back);

    /* Alan görünürlüğü: kullanıcının gerçekten girmesi gereken alanlar kalır.
       - Otomatik fiyat çekilecekse "güncel birim değer" gizlenir
       - Nakitte birim değer daima 1'dir, gösterilmez
       - Vade/faiz yalnızca mevduat ve tahvilde çıkar                        */
    function syncTypeFields() {
      $$('[data-only]', back).forEach(el => {
        el.style.display = el.dataset.only.split(',').includes(type) ? '' : 'none';
      });
      const sym = $('#fSymbol', back) ? $('#fSymbol', back).value : '';
      const auto = $('#fAuto', back) ? $('#fAuto', back).checked : false;
      const willFetch = auto && (sym || type === 'cash');
      const priceField = $('#priceField', back);
      if (priceField) {
        priceField.style.display = (type === 'cash' || willFetch) ? 'none' : '';
        const hint = $('#priceHint', back);
        if (hint) hint.textContent = 'Bu tür için değeri siz belirlersiniz.';
      }
      const unitTag = $('#qtyUnit', back);
      if (unitTag) unitTag.textContent = $('#fUnit', back) ? $('#fUnit', back).value : '';
      const cur = $('#fCur', back) ? $('#fCur', back).value : '';
      const cc = $('#costCur', back), pc = $('#priceCur', back);
      if (cc) cc.textContent = cur;
      if (pc) pc.textContent = cur;
      // Nakitte alış maliyeti anlamsız (1'e 1)
      const costField = $('#costField', back);
      if (costField) costField.style.display = type === 'cash' ? 'none' : '';

      /* Otomatik fiyatı olmayan türlerde "sembol / kod" alanı gürültüdür:
         alanı Detaylar bölümüne taşı (değer korunur), fiyatlanabilir
         türlerde tekrar öne al. */
      const wrap = $('#symbolWrap', back), slot = $('#symbolSlot', back), advBody = $('.adv-body', back);
      if (wrap && slot && advBody) {
        const priceable = DATA.assetType(type).priceable;
        const wantParent = priceable ? slot.parentElement : advBody;
        if (priceable && wrap.previousElementSibling !== slot) slot.after(wrap);
        else if (!priceable && wrap.parentElement !== advBody) advBody.prepend(wrap);
        wrap.classList.toggle('span-full', priceable);
        wrap.style.display = (priceable || type === 'other') ? '' : '';
      }
    }
    syncTypeFields();
    back.addEventListener('change', e => {
      if (['fAuto', 'fCur', 'fUnit', 'fSymbol'].includes(e.target.id)) syncTypeFields();
    });

    function refreshLocList() {
      const k = DATA.locationKind(kind);
      $('#kindHint', back).textContent = k.hint;
      $('#locNameField', back).style.display = k.needsName || kind === 'physical' ? '' : 'none';
      $('#fLocName', back).placeholder = k.placeholder;
      const list = Market.listFor(kind);
      $('#locBtnWrap', back).innerHTML = pickerButton('loc', $('#fLocName', back).value, '', k.placeholder);
      $('#locSrc', back).textContent = kind === 'bank'
        ? `${list.length} banka · kaynak: ${S.state.cache.banksSource}`
        : `${list.length} seçenek · listede yoksa arama kutusuna yazıp Enter'a basın`;
    }
    refreshLocList();

    $('#typeChips', back).addEventListener('click', e => {
      if (e.target.closest('[data-more]')) {
        $('#typeChips', back).innerHTML = typeChipsHTML(type, true);
        return;
      }
      const c = e.target.closest('[data-type]'); if (!c) return;
      type = c.dataset.type;
      $$('#typeChips .chip', back).forEach(x => x.classList.toggle('active', x === c));
      const t = DATA.assetType(type);
      $('#symbolWrap', back).innerHTML = symbolFieldHTML(type, '');
      $('#fSymbol', back) && ($('#fSymbol', back).value = '');
      if (!isEdit) {
        $('#fUnit', back).value = t.unit;
        $('#fCur', back).value = t.defaultCurrency;
      }
      if (t.id === 'cash') $('#fPrice', back).value = 1;
      $('#fAuto', back).disabled = !t.priceable;
      $('#fAuto', back).checked = t.priceable && !isEdit;
      $('#autoHint', back).textContent = autoHint(type);
      syncTypeFields();
    });

    // Maden ürünü seçilince birim ve para birimi kendiliğinden ayarlanır
    back.addEventListener('change', e => {
      if (e.target.id !== 'fSymbol') return;
      const q = DATA.metalQuote(e.target.value);
      if (!q) return;
      $('#fUnit', back).value = q.unit;
      $('#fCur', back).value = 'TRY';
      $('#fAuto', back).checked = true;
    });

    $('#kindChips', back).addEventListener('click', e => {
      const c = e.target.closest('[data-kind]'); if (!c) return;
      kind = c.dataset.kind;
      $$('#kindChips .chip', back).forEach(x => x.classList.toggle('active', x === c));
      $('#fLocName', back).value = '';
      refreshLocList();
    });

    // Seçici düğmeleri (sembol / kurum)
    back.addEventListener('click', e => {
      const p = e.target.closest('[data-picker]');
      if (!p) return;
      if (p.dataset.picker === 'symbol') {
        openSymbolPicker(type, $('#fSymbol', back).value, item => {
          $('#symbolWrap', back).innerHTML = symbolFieldHTML(type, item.value);
          const q = DATA.metalQuote(item.value);
          if (q) { $('#fUnit', back).value = q.unit; $('#fCur', back).value = 'TRY'; }
          // Çevrimiçi sonuçta borsanın para birimi biliniyorsa forma taşı
          else if (item.currency && $('#fCur', back).querySelector(`option[value="${item.currency}"]`)) {
            $('#fCur', back).value = item.currency;
          }
          if (item.value) $('#fAuto', back).checked = true;
          if (!$('#fName', back).value.trim() && item.name && !item.custom) $('#fName', back).value = item.name;
          syncTypeFields();
        });
      } else if (p.dataset.picker === 'loc') {
        openLocationPicker(kind, $('#fLocName', back).value, item => {
          $('#fLocName', back).value = item.value;
          $('#locBtnWrap', back).innerHTML = pickerButton('loc', item.value, '', 'Seçmek için dokunun');
        });
      }
    });

    back.addEventListener('click', async e => {
      const b = e.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'del') { closeModal(); delAsset(a.id); return; }
      if (b.dataset.x !== 'save') return;

      const payload = {
        name: $('#fName', back).value,
        type, symbol: $('#fSymbol', back).value,
        quantity: $('#fQty', back).value,
        unit: $('#fUnit', back).value.trim() || DATA.assetType(type).unit,
        unitPrice: type === 'cash' ? 1 : $('#fPrice', back).value,
        unitCost: $('#fCost', back).value,
        currency: $('#fCur', back).value,
        acquiredAt: $('#fDate', back).value || null,
        autoPrice: $('#fAuto', back).checked,
        notes: $('#fNotes', back).value,
        maturityDate: $('#fMaturity', back) ? ($('#fMaturity', back).value || null) : null,
        interestRate: $('#fRate', back) ? $('#fRate', back).value : null,
        location: { kind, name: $('#fLocName', back).value, account: $('#fAccount', back).value }
      };

      const errors = S.validateAsset(payload);
      $$('.field', form).forEach(f => f.classList.remove('invalid'));
      const map = { name: '#fName', quantity: '#fQty', unitPrice: '#fPrice', unitCost: '#fCost',
                    acquiredAt: '#fDate', locationName: '#fLocName' };
      const keys = Object.keys(errors);
      if (keys.length) {
        keys.forEach(k => {
          const sel = map[k]; if (!sel) return;
          const field = $(sel, back).closest('.field');
          field.classList.add('invalid');
          const err = $('.err', field); if (err) err.textContent = errors[k];
        });
        toast(errors[keys[0]], 'err');
        const first = map[keys[0]] && $(map[keys[0]], back);
        if (first) first.focus();
        return;
      }

      // Gizli listeden bir tür seçildiyse artık kullanıcının türlerinden sayılır.
      const picked = S.settings.assetTypes || [];
      if (picked.length && !picked.includes(type)) { picked.push(type); S.settings.assetTypes = picked; }

      const saved = isEdit ? S.updateAsset(a.id, payload) : S.addAsset(payload);
      toast(isEdit ? 'Varlık güncellendi.' : 'Varlık eklendi.', 'ok');
      closeModal();
      navigate();
      await fetchPriceFor(saved);
      S.takeSnapshot(true);
      updateTopbar();
    });
  }

  /* Kaydedilen varlığın fiyatını anında çeker; eksik ayar varsa çözüm önerir.
     Kullanıcının "0 TL" ile baş başa kalmasını engeller. */
  async function fetchPriceFor(asset) {
    if (!asset || !asset.autoPrice) {
      if (asset && !asset.unitPrice && DATA.assetType(asset.type).priceable) {
        toast(`${asset.name} için birim değer 0 — “Fiyatı otomatik güncelle”yi açın veya değeri elle girin.`, 'err');
      }
      return;
    }
    const isStock = asset.type === 'stock' || asset.type === 'etf';
    if (isStock && !S.settings.stockPrices) {
      const ok = await confirmDialog('Hisse fiyatı çekimi kapalı',
        `<b>${esc(asset.name)}</b> fiyatını çekebilmek için Ayarlar'daki “Hisse / ETF fiyatlarını çek”
         seçeneği açık olmalı. Bu, Yahoo Finance verisini bir okuma vekili üzerinden alır;
         servise yalnızca <b>sembol</b> gider, portföyünüz gitmez. Şimdi açalım mı?`, 'Aç ve çek');
      if (!ok) {
        toast('Hisse fiyatı çekilmedi — değeri elle girebilirsiniz.', 'err');
        return;
      }
      S.settings.stockPrices = true;
      S.save();
    }
    const r = await Market.fetchOne(asset);
    if (r.ok) {
      toast(`${asset.name}: ${S.fmtMoney(r.price, r.currency)} olarak alındı.`, 'ok');
      navigate();
    } else {
      toast(`${asset.name} fiyatı alınamadı (${r.reason}). Değeri elle girebilirsiniz.`, 'err');
    }
  }

  /* ================= Getiri (temettü / faiz / kira) ================= */
  function openIncomeForm(asset) {
    const cur = asset ? asset.currency : S.settings.baseCurrency;
    const inc = asset ? S.income.filter(x => x.assetId === asset.id) : S.income;
    const back = openModal(`
      <div class="modal-head"><h2>💰 ${asset ? esc(asset.name) + ' — Getiri' : 'Getiri Ekle'}</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <div class="panel"><div class="form-grid">
          <div class="field">
            <label for="iKind">Getiri türü *</label>
            <select id="iKind">${S.INCOME_KINDS.map(k =>
              `<option value="${k.id}" ${asset && ((asset.type === 'stock' && k.id === 'dividend') ||
                (['deposit','bond'].includes(asset.type) && k.id === 'interest') ||
                (asset.type === 'realestate' && k.id === 'rent')) ? 'selected' : ''}>${k.icon} ${esc(k.name)}</option>`).join('')}</select>
          </div>
          <div class="field">
            <label for="iAmount">Tutar (${esc(cur)}) *</label>
            <input id="iAmount" type="text" inputmode="decimal" placeholder="0">
            <span class="err"></span>
          </div>
          <div class="field">
            <label for="iDate">Tarih</label>
            <input id="iDate" type="date" max="${S.todayISO()}" value="${S.todayISO()}">
            <span class="err"></span>
          </div>
          <div class="field span-full">
            <label for="iTo">Nakde eklensin mi?</label>
            <select id="iTo">
              ${S.cashAssets().map(x => `<option value="a:${x.id}" ${x.currency === cur ? 'selected' : ''}>
                💵 ${esc(x.name)} — ${esc(x.currency)} hesabına ekle</option>`).join('')}
              <option value="new">➕ Yeni ${esc(cur)} nakit hesabı oluştur</option>
              <option value="none" ${S.cashAssets().length ? '' : 'selected'}>↗ Yalnızca kaydet (nakde ekleme)</option>
            </select>
            <span class="hint">Getiri, toplam getiri hesabına her hâlükârda dahil edilir.</span>
          </div>
          <div class="field span-full">
            <label for="iNote">Not</label>
            <input id="iNote" placeholder="Örn. 2026 1. çeyrek temettüsü">
          </div>
        </div></div>
        ${inc.length ? `<div class="panel">
          <p class="section-label">Kayıtlı getiriler${asset ? '' : ' (tümü)'}</p>
          <ul class="stat-list">${inc.slice(0, 8).map(r => `<li>
            <span>${S.INCOME_KINDS.find(k => k.id === r.kind).icon} ${esc(r.name)} · ${esc(S.fmtDate(r.date))}</span>
            <b>${S.fmtMoney(r.amount, r.currency)}
              <button class="link-btn danger" data-inc="${r.id}">sil</button></b></li>`).join('')}</ul>
          <p class="muted" style="font-size:12px;margin:10px 0 0">
            Toplam: <b>${S.fmtMoney(S.incomeTotals().total)}</b></p>
        </div>` : ''}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" id="iSave">Getiriyi kaydet</button></div>`, { title: 'Getiri' });

    back.addEventListener('click', async e => {
      const d = e.target.closest('[data-inc]');
      if (!d) return;
      if (!await confirmDialog('Getiri kaydını sil',
        'Kayıt silinecek; nakde eklenmiş tutar geri alınmaz.', 'Sil')) return;
      S.deleteIncome(d.dataset.inc);
      closeModal(); toast('Getiri kaydı silindi.', 'ok'); navigate();
    });

    $('#iSave', back).addEventListener('click', () => {
      const to = $('#iTo', back).value;
      const input = {
        kind: $('#iKind', back).value, amount: $('#iAmount', back).value,
        date: $('#iDate', back).value, note: $('#iNote', back).value, currency: cur,
        toCash: to === 'none' ? { mode: 'none' }
          : to === 'new' ? { mode: 'new' } : { mode: 'asset', id: to.slice(2) }
      };
      const errors = S.validateIncome(input);
      $$('.field', back).forEach(f => f.classList.remove('invalid'));
      const map = { amount: '#iAmount', date: '#iDate' };
      const keys = Object.keys(errors);
      if (keys.length) {
        keys.forEach(k => { const el = $(map[k], back); if (!el) return;
          el.closest('.field').classList.add('invalid');
          const er = $('.err', el.closest('.field')); if (er) er.textContent = errors[k]; });
        toast(errors[keys[0]], 'err');
        return;
      }
      S.addIncome(asset ? asset.id : null, input);
      S.takeSnapshot(true);
      closeModal(); toast('Getiri kaydedildi.', 'ok'); navigate();
    });
  }

  /* ================= Alım ekleme (yeni lot) ================= */
  function openBuyForm(asset) {
    if (!asset) return;
    const a2 = asset, cur = a2.currency;
    S.ensureLots(a2);
    const back = openModal(`
      <div class="modal-head"><h2>🟢 ${esc(a2.name)} — Yeni Alım</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <div class="panel"><ul class="stat-list">
          <li><span>Mevcut miktar</span><b>${S.fmtNum(a2.quantity, 6)} ${esc(a2.unit)}</b></li>
          <li><span>Ortalama maliyet</span><b>${a2.unitCost == null ? 'yok' : S.fmtMoney(a2.unitCost, cur)}</b></li>
          <li><span>Güncel birim değer</span><b>${S.fmtMoney(a2.unitPrice, cur)}</b></li>
          <li><span>Kayıtlı alım (lot)</span><b>${(a2.lots || []).length}</b></li>
        </ul></div>
        <div class="panel"><div class="form-grid">
          <div class="field">
            <label for="bQty">Alınan miktar (${esc(a2.unit)}) *</label>
            <input id="bQty" type="text" inputmode="decimal" placeholder="0">
            <span class="err"></span>
          </div>
          <div class="field">
            <label for="bCost">Birim alış fiyatı (${esc(cur)}) *</label>
            <input id="bCost" type="text" inputmode="decimal" value="${a2.unitPrice || ''}">
            <span class="err"></span>
          </div>
          <div class="field">
            <label for="bDate">Alış tarihi</label>
            <input id="bDate" type="date" max="${S.todayISO()}" value="${S.todayISO()}">
            <span class="err"></span>
          </div>
          <div class="field span-full">
            <label for="bNote">Not</label>
            <input id="bNote" placeholder="Örn. maaş birikimi, düşüşten aldım">
          </div>
        </div></div>
        <div class="hl" id="bPreview"></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" data-x="lots">Alımları gör</button>
        <div style="flex:1"></div>
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" id="bSave">Alımı ekle</button>
      </div>`, { title: 'Yeni alım' });

    const val = id => $(id, back).value;
    function preview() {
      const q = S.parseNum(val('#bQty')), c = S.parseNum(val('#bCost'));
      if (isNaN(q) || isNaN(c) || q <= 0) { $('#bPreview', back).textContent = 'Miktar ve alış fiyatını girin.'; return; }
      const newQty = a2.quantity + q;
      const oldCostTotal = (a2.unitCost == null ? 0 : a2.unitCost) * a2.quantity;
      const newAvg = (oldCostTotal + q * c) / newQty;
      $('#bPreview', back).innerHTML =
        `Toplam maliyet <b>${esc(S.fmtMoney(q * c, cur))}</b> · yeni miktar
         <b>${esc(S.fmtNum(newQty, 6))} ${esc(a2.unit)}</b> · yeni ortalama maliyet
         <b>${esc(S.fmtMoney(newAvg, cur))}</b>`;
    }
    back.addEventListener('input', preview);
    preview();

    back.addEventListener('click', e => {
      if (e.target.closest('[data-x="lots"]')) { closeModal(); openLotsView(a2); }
    });
    $('#bSave', back).addEventListener('click', () => {
      const input = { quantity: val('#bQty'), unitCost: val('#bCost'), date: val('#bDate'), note: val('#bNote') };
      const errors = S.validateLot(a2, input);
      $$('.field', back).forEach(f => f.classList.remove('invalid'));
      const map = { quantity: '#bQty', unitCost: '#bCost', date: '#bDate' };
      const keys = Object.keys(errors);
      if (keys.length) {
        keys.forEach(k => {
          const el = $(map[k], back); if (!el) return;
          el.closest('.field').classList.add('invalid');
          const er = $('.err', el.closest('.field')); if (er) er.textContent = errors[k];
        });
        toast(errors[keys[0]], 'err');
        return;
      }
      S.addLot(a2.id, input);
      S.takeSnapshot(true);
      closeModal();
      toast('Alım eklendi. Ortalama maliyet güncellendi.', 'ok');
      navigate();
    });
  }

  /* Alım lotlarının listesi */
  function openLotsView(asset) {
    if (!asset) return;
    S.ensureLots(asset);
    const cur = asset.currency;
    const lots = (asset.lots || []).slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    const back = openModal(`
      <div class="modal-head"><h2>📋 ${esc(asset.name)} — Alımlar</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <p class="hl">Satışta maliyet esası bu lotlardan hesaplanır
          (<b>${S.settings.costMethod === 'average' ? 'ortalama maliyet' : 'FIFO — önce giren önce çıkar'}</b>).
          Ortalama maliyet: <b>${S.fmtMoney(S.avgCost(asset), cur)}</b></p>
        ${lots.length ? `<div class="table-wrap"><table style="min-width:0">
          <thead><tr><th>Tarih</th><th class="num">Miktar</th><th class="num">Birim maliyet</th>
            <th class="num">Toplam</th><th class="num">Güncel K/Z</th><th></th></tr></thead>
          <tbody>${lots.map(l => {
            const pl = (asset.unitPrice - l.unitCost) * l.quantity;
            return `<tr>
              <td>${esc(S.fmtDate(l.date))}${l.note ? `<br><small class="muted">${esc(l.note)}</small>` : ''}</td>
              <td class="num">${S.fmtNum(l.quantity, 6)} <small class="muted">${esc(asset.unit)}</small></td>
              <td class="num">${S.fmtMoney(l.unitCost, cur)}</td>
              <td class="num">${S.fmtMoney(l.quantity * l.unitCost, cur)}</td>
              <td class="num"><span class="delta ${pl >= 0 ? 'up' : 'down'}">${S.fmtMoney(pl, cur)}</span></td>
              <td><button class="btn btn-sm btn-danger" data-lot="${l.id}" aria-label="Lotu sil">✕</button></td>
            </tr>`;
          }).join('')}</tbody></table></div>`
          : '<div class="empty"><h3>Kayıtlı alım yok</h3><p>“Alım” düğmesiyle alımlarınızı tek tek girerseniz satışta gerçek maliyet kullanılır.</p></div>'}
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="closeModal()">Kapat</button>
        <button class="btn btn-gold" data-x="add">+ Alım ekle</button></div>`, { title: 'Alımlar' });

    back.addEventListener('click', async e => {
      if (e.target.closest('[data-x="add"]')) { closeModal(); openBuyForm(asset); return; }
      const del = e.target.closest('[data-lot]');
      if (!del) return;
      const ok = await confirmDialog('Alım kaydını sil',
        'Bu lot ve içerdiği miktar varlıktan düşülecek; ortalama maliyet yeniden hesaplanacak.', 'Sil');
      if (!ok) return;
      S.removeLot(asset.id, del.dataset.lot);
      closeModal(); toast('Alım kaydı silindi.', 'ok'); navigate();
    });
  }

  /* ================= Satış formu ================= */
  function openSellForm(a) {
    if (!a) return;
    const cur = a.currency;
    const back = openModal(`
      <div class="modal-head"><h2>💰 ${esc(a.name)} — Satış</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <div class="panel"><ul class="stat-list">
          <li><span>Elinizdeki miktar</span><b>${S.fmtNum(a.quantity, 6)} ${esc(a.unit)}</b></li>
          <li><span>Güncel birim değer</span><b>${S.fmtMoney(a.unitPrice, cur)}</b></li>
          <li><span>Alış maliyeti (birim)</span><b>${a.unitCost == null ? 'girilmemiş' : S.fmtMoney(a.unitCost, cur)}</b></li>
          <li><span>Nerede</span><b>${esc(S.locLabel(a.location))}</b></li>
        </ul></div>
        <div class="panel"><div class="form-grid">
          <div class="field">
            <label for="sQty">Satılan miktar (${esc(a.unit)}) *</label>
            <input id="sQty" type="text" inputmode="decimal" value="${a.quantity}">
            <span class="err"></span>
            <span class="hint">Tamamını satarsanız pozisyon kapanır ve “Satılanlar”a taşınır.</span>
          </div>
          <div class="field">
            <label for="sPrice">Satış birim fiyatı (${esc(cur)}) *</label>
            <input id="sPrice" type="text" inputmode="decimal" value="${a.unitPrice}">
            <span class="err"></span>
          </div>
          <div class="field">
            <label for="sFee">Komisyon / masraf (${esc(cur)})</label>
            <input id="sFee" type="text" inputmode="decimal" placeholder="0">
            <span class="err"></span>
          </div>
          <div class="field">
            <label for="sDate">Satış tarihi</label>
            <input id="sDate" type="date" max="${S.todayISO()}" value="${S.todayISO()}">
            <span class="err"></span>
          </div>
          <div class="field">
            <label for="sMethod">Maliyet yöntemi</label>
            <select id="sMethod">
              <option value="fifo" ${S.settings.costMethod !== 'average' ? 'selected' : ''}>FIFO — önce alınan önce satılır</option>
              <option value="average" ${S.settings.costMethod === 'average' ? 'selected' : ''}>Ortalama maliyet</option>
            </select>
            <span class="hint">${(a.lots || []).length} kayıtlı alım (lot) var.</span>
          </div>
          <div class="field span-full">
            <label for="sTo">Hasılat nereye gitsin?</label>
            <select id="sTo">
              ${S.cashAssets().map(x => `<option value="a:${x.id}" ${x.currency === cur ? 'selected' : ''}>
                💵 ${esc(x.name)} — ${esc(x.currency)} hesabına ekle</option>`).join('')}
              <option value="new" ${S.cashAssets().some(x => x.currency === cur) ? '' : 'selected'}>
                ➕ Yeni ${esc(cur)} nakit hesabı oluştur</option>
              <option value="none">↗ Portföy dışına çıktı (nakde eklenmesin)</option>
            </select>
            <span class="hint">Hasılat nakde eklenmezse portföy toplamınız satış kadar azalır.</span>
          </div>
          <div class="field span-full">
            <label for="sNote">Not</label>
            <input id="sNote" placeholder="Örn. kâr realizasyonu, acil nakit ihtiyacı">
          </div>
        </div></div>
        <div class="hl" id="sPreview"></div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" id="sSave">Satışı kaydet</button>
      </div>`, { title: 'Satış' });

    S.ensureLots(a);
    const val = id => $(id, back).value;
    function preview() {
      const q = S.parseNum(val('#sQty')), p = S.parseNum(val('#sPrice')), f = S.parseNum(val('#sFee')) || 0;
      if (isNaN(q) || isNaN(p) || q <= 0) { $('#sPreview', back).textContent = 'Miktar ve fiyatı girin.'; return; }
      const proceeds = q * p - f;
      const pv = S.previewCost(a.id, q, val('#sMethod'));
      const cost = pv && pv.costBasis != null ? pv.costBasis : (a.unitCost == null ? null : q * a.unitCost);
      const pl = cost == null ? null : proceeds - cost;
      const kalan = Math.max(0, a.quantity - q);
      const toSel = $('#sTo', back).value;
      const toText = toSel === 'none' ? 'nakde eklenmeyecek'
        : toSel === 'new' ? `yeni ${cur} nakit hesabına eklenecek`
        : 'seçili nakit hesabına eklenecek';
      $('#sPreview', back).innerHTML =
        `Hasılat <b>${esc(S.fmtMoney(proceeds, cur))}</b> — ${esc(toText)}` +
        (pl == null ? ' · maliyet girilmediği için K/Z hesaplanamaz'
          : ` · gerçekleşen K/Z <b class="delta ${pl >= 0 ? 'up' : 'down'}">${esc(S.fmtMoney(pl, cur))}` +
            (cost ? ` (${esc(S.fmtPct(pl / cost * 100))})` : '') + '</b>') +
        ` · kalan <b>${esc(S.fmtNum(kalan, 6))} ${esc(a.unit)}</b>` +
        (pv && pv.breakdown && pv.breakdown.length > 1
          ? `<br><small class="muted">Maliyet esası: ` +
            pv.breakdown.map(b => `${esc(S.fmtNum(b.quantity, 4))} × ${esc(S.fmtMoney(b.unitCost, cur))}` +
              (b.date && b.date !== '—' ? ` (${esc(S.fmtDate(b.date))})` : '')).join(' + ') + '</small>'
          : '');
    }
    back.addEventListener('input', preview);
    back.addEventListener('change', preview);
    preview();

    $('#sSave', back).addEventListener('click', () => {
      const to = val('#sTo');
      const input = {
        quantity: val('#sQty'), unitPrice: val('#sPrice'), fee: val('#sFee'),
        date: val('#sDate'), note: val('#sNote'), currency: cur, costMethod: val('#sMethod'),
        proceedsTo: to === 'none' ? { mode: 'none' }
          : to === 'new' ? { mode: 'new', currency: cur, location: a.location }
          : { mode: 'asset', id: to.slice(2) }
      };
      const errors = S.validateSale(a, input);
      $$('.field', back).forEach(f => f.classList.remove('invalid'));
      const map = { quantity: '#sQty', unitPrice: '#sPrice', fee: '#sFee', date: '#sDate' };
      const keys = Object.keys(errors);
      if (keys.length) {
        keys.forEach(k => {
          const el = $(map[k], back); if (!el) return;
          const field = el.closest('.field');
          field.classList.add('invalid');
          const e = $('.err', field); if (e) e.textContent = errors[k];
        });
        toast(errors[keys[0]], 'err');
        return;
      }
      S.settings.costMethod = val('#sMethod');
      const sale = S.sellAsset(a.id, input);
      S.takeSnapshot(true);
      closeModal();
      toast((sale.closed ? 'Pozisyon kapatıldı ve “Satılanlar”a taşındı.' : 'Kısmi satış kaydedildi.') +
        (sale.cashAdded ? ` ${S.fmtMoney(sale.cashAdded, S.getAsset(sale.cashAssetId).currency)} nakde eklendi.` : ''), 'ok');
      assetFilter.tab = sale.closed ? 'sold' : 'active';
      navigate();
    });
  }

  async function delSale(id) {
    const ok = await confirmDialog('Satış kaydını sil',
      'Bu satış kaydı ve gerçekleşen kâr/zarar hesabındaki payı silinecek. Varlık portföye geri eklenmez.',
      'Sil');
    if (!ok) return;
    S.deleteSale(id);
    toast('Satış kaydı silindi.', 'ok');
    navigate();
  }

  /* ================= 3) İSTATİSTİK ================= */
  let statRange = 90;

  function renderStats(root) {
    const cur = S.settings.baseCurrency;
    const t = S.totals();
    if (!S.assets.length) {
      root.innerHTML = pageHead('İstatistik', 'Analiz için önce varlık ekleyin.') +
        emptyState('Analiz edilecek veri yok', 'Varlık ekledikçe dağılım, performans ve kâr/zarar analizleri burada oluşur.');
      return;
    }

    const types = S.byType(cur), locs = S.byLocationKind(cur),
          places = S.byLocationName(cur), curs = S.byCurrency(cur);
    const ser = S.series(statRange);
    const perf = S.performance(statRange);

    const withPL = S.assets.map(a => {
      const v = S.assetValue(a, cur), c = S.assetCost(a, cur);
      return { a, v, c, pl: v - c, pct: c > 0 ? (v - c) / c * 100 : NaN };
    }).filter(x => !isNaN(x.pl));
    const winners = [...withPL].sort((x, y) => y.pl - x.pl).slice(0, 5);
    const losers = [...withPL].sort((x, y) => x.pl - y.pl).filter(x => x.pl < 0).slice(0, 5);

    const hhi = types.reduce((s, x) => s + Math.pow(x.value / (t.value || 1), 2), 0);
    const conc = types.length ? types[0].value / (t.value || 1) * 100 : 0;
    const liquid = types.filter(x => ['Nakit', 'Kripto Para', 'Hisse Senedi', 'ETF / Endeks Fonu', 'Nakit / Döviz']
      .includes(x.label)).reduce((s, x) => s + x.value, 0);

    // Nakit akışı (işlem günlüğünden, son 12 ay)
    const flow = cashFlow();

    root.innerHTML = pageHead('İstatistik & Analiz',
      `${cur} bazında · ${S.assets.length} varlık · ${S.state.snapshots.length} günlük kayıt`,
      [30, 90, 180, 365, 0].map(d => `<button class="chip ${statRange === d ? 'active' : ''}" data-range="${d}">
        ${d === 0 ? 'Tümü' : d + 'g'}</button>`).join('')) + `

      <div class="grid g-kpi" style="margin-bottom:16px">
        <div class="card kpi"><p class="kpi-label">Dönem Performansı</p>
          <div class="kpi-value">${perf.abs == null ? '—' : S.fmtMoney(perf.abs)}</div>
          <p class="kpi-foot">${deltaHtml(perf.pct)} <span>${perf.from ? S.fmtDate(perf.from) + ' →' : ''}</span></p></div>
        <div class="card kpi"><p class="kpi-label">Gerçekleşmemiş K/Z</p>
          <div class="kpi-value ${t.pl >= 0 ? 'delta up' : 'delta down'}">${S.fmtMoney(t.pl)}</div>
          <p class="kpi-foot">${deltaHtml(t.plPct)} <span>maliyete göre</span></p></div>
        <div class="card kpi"><p class="kpi-label">Toplam Getiri</p>
          <div class="kpi-value ${S.totalReturn(cur).gain >= 0 ? 'delta up' : 'delta down'}">${S.fmtMoney(S.totalReturn(cur).gain)}</div>
          <p class="kpi-foot">${deltaHtml(S.totalReturn(cur).pct)} <span>fiyat + satış + getiri</span></p></div>
        <div class="card kpi"><p class="kpi-label">Reel Getiri (enflasyon sonrası)</p>
          ${(() => {
            const tr = S.totalReturn(cur);
            const real = S.realReturn(tr.pct, 1);
            const inf = S.inflationRate();
            return `<div class="kpi-value ${real == null ? '' : real >= 0 ? 'delta up' : 'delta down'}">${
              real == null ? '—' : S.fmtPct(real)}</div>
              <p class="kpi-foot">${inf ? `TÜFE %${S.fmtNum(inf.rate, 1)} · ${esc(inf.source)}`
                : 'TÜFE verisi yok — Ayarlar\'dan girin'}</p>`;
          })()}</div>
        <div class="card kpi"><p class="kpi-label">Gerçekleşen K/Z</p>
          <div class="kpi-value ${S.realizedTotals(cur).realized >= 0 ? 'delta up' : 'delta down'}">${S.fmtMoney(S.realizedTotals(cur).realized)}</div>
          <p class="kpi-foot">${S.sales.length} satış · <a class="link-btn" href="#/assets">detay</a></p></div>
        <div class="card kpi"><p class="kpi-label">Yoğunlaşma (HHI)</p>
          <div class="kpi-value">${(hhi * 100).toFixed(0)}<small style="font-size:14px" class="muted">/100</small></div>
          <p class="kpi-foot">En büyük sınıf %${conc.toFixed(1)}</p></div>
        <div class="card kpi"><p class="kpi-label">Likit Varlık Oranı</p>
          <div class="kpi-value">%${(liquid / (t.value || 1) * 100).toFixed(1)}</div>
          <p class="kpi-foot">${S.fmtMoney(liquid)} hızlı nakde çevrilebilir</p></div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2 class="card-title">Portföy Gelişimi</h2>
          <span class="pill"><span class="dot"></span>${ser.length} veri noktası</span></div>
        <div class="chart-box">${Charts.area(ser.map(s => ({ label: shortDate(s.date), value: s.total })),
          { fmtY: v => S.fmtMoney(v, cur, { compact: true }), height: 260 })}</div>
        <p class="muted" style="font-size:12px;margin:10px 0 0">
          Seri, uygulamayı her açtığınızda ve “Bugünü kaydet” dediğinizde günlük olarak biriktirilir.</p>
      </div>

      <div class="grid g-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2 class="card-title">Sınıf Bazında Değer</h2></div>
          <div class="chart-box">${Charts.bars(types.slice(0, 8),
            { fmt: v => S.fmtMoney(v, cur), fmtShort: v => S.fmtMoney(v, cur, { compact: true }) })}</div>
        </div>
        <div class="card">
          <div class="card-head"><h2 class="card-title">Saklama Yeri Kırılımı</h2></div>
          <div style="margin-bottom:14px">${Charts.stackedBar(locs)}</div>
          ${Charts.legend(locs, v => S.fmtMoney(v, cur, { compact: true }))}
          <p class="section-label" style="margin-top:18px">Kurum / Yer Detayı</p>
          <ul class="stat-list">
            ${places.slice(0, 10).map(p => `<li><span>${esc(p.label)}</span>
              <b>${S.fmtMoney(p.value, cur, { compact: true })}</b></li>`).join('')}
          </ul>
        </div>
      </div>

      <div class="grid g-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2 class="card-title">En Çok Kazandıranlar</h2></div>
          <ul class="stat-list">
            ${winners.map(w => `<li><span>${DATA.assetType(w.a.type).icon} ${esc(w.a.name)}</span>
              <b class="delta ${w.pl >= 0 ? 'up' : 'down'}">${S.fmtMoney(w.pl, cur, { compact: true })} · ${S.fmtPct(w.pct)}</b></li>`).join('')
              || '<li class="muted">Maliyet bilgisi girilmiş varlık yok.</li>'}
          </ul>
        </div>
        <div class="card">
          <div class="card-head"><h2 class="card-title">Zarardakiler</h2></div>
          <ul class="stat-list">
            ${losers.map(w => `<li><span>${DATA.assetType(w.a.type).icon} ${esc(w.a.name)}</span>
              <b class="delta down">${S.fmtMoney(w.pl, cur, { compact: true })} · ${S.fmtPct(w.pct)}</b></li>`).join('')
              || '<li class="muted">Zararda varlık yok. 🎉</li>'}
          </ul>
        </div>
      </div>

      <div class="grid g-2" style="margin-bottom:16px">
        <div class="card">
          <div class="card-head"><h2 class="card-title">Nakit Getiriler</h2>
            <button class="btn btn-sm" data-act="addIncome">+ Getiri ekle</button></div>
          ${(() => {
            const inc = S.incomeTotals(cur);
            if (!inc.count) return `<div class="empty" style="padding:22px 12px">
              <svg viewBox="0 0 24 24"><path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>
              <h3>Getiri kaydı yok</h3>
              <p>Temettü, faiz, kira gibi nakit getirileri kaydedin — toplam getiri hesabına dahil edilir.</p></div>`;
            const rows = Object.entries(inc.byKind).map(([k, v]) => ({
              label: (S.INCOME_KINDS.find(x => x.id === k) || { name: k }).name, value: v
            })).sort((x, y) => y.value - x.value);
            return `<div class="donut-wrap">
              <div class="chart-box">${Charts.donut(rows, { fmt: v => S.fmtMoney(v, cur) })}
                <div class="donut-center"><b>${S.fmtMoney(inc.total, cur, { compact: true })}</b><span>Toplam</span></div></div>
              ${Charts.legend(rows, v => S.fmtMoney(v, cur, { compact: true }))}</div>
            <ul class="stat-list" style="margin-top:16px">
              ${S.income.slice(0, 5).map(r => `<li>
                <span>${(S.INCOME_KINDS.find(k => k.id === r.kind) || {}).icon || '•'} ${esc(r.name)}
                  <small class="muted">${esc(S.fmtDate(r.date))}</small></span>
                <b>${S.fmtMoney(r.amount, r.currency)}</b></li>`).join('')}
            </ul>`;
          })()}
        </div>
        <div class="card">
          <div class="card-head"><h2 class="card-title">Yaklaşan Vadeler</h2></div>
          ${(() => {
            const ms = S.maturities();
            if (!ms.length) return `<div class="empty" style="padding:22px 12px">
              <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
              <h3>Vadeli kayıt yok</h3>
              <p>Vadeli mevduat veya tahvil eklerken vade tarihi ve faiz oranı girerseniz burada listelenir.</p></div>`;
            return `<ul class="stat-list">${ms.map(m => `<li>
              <span>${DATA.assetType(m.asset.type).icon} ${esc(m.asset.name)}
                <small class="muted">${esc(S.fmtDate(m.date))}${m.asset.interestRate ? ` · %${S.fmtNum(m.asset.interestRate, 2)}` : ''}</small></span>
              <b class="${m.overdue ? 'delta down' : m.days <= 7 ? 'delta up' : ''}">${
                m.overdue ? Math.abs(m.days) + ' gün geçti' : m.days === 0 ? 'bugün' : m.days + ' gün'}
                <br><small>${S.fmtMoney(m.value, m.asset.currency, { compact: true })}${
                  m.expected ? ' + ' + S.fmtMoney(m.expected, m.asset.currency, { compact: true }) : ''}</small></b></li>`).join('')}</ul>
            <p class="muted" style="font-size:12px;margin:12px 0 0">
              Beklenen faiz, yıllık orana göre kalan güne düşen basit faizdir; stopaj ve bileşik etki içermez.</p>`;
          })()}
        </div>
      </div>

      <div class="card" style="margin-bottom:16px">
        <div class="card-head"><h2 class="card-title">Hedef Dağılım & Dengeleme</h2>
          <button class="btn btn-sm" data-act="targets">Hedefleri düzenle</button></div>
        ${rebalanceHtml(cur)}
      </div>

      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><h2 class="card-title">Para Birimi Riski</h2></div>
          <div style="margin-bottom:14px">${Charts.stackedBar(curs)}</div>
          ${Charts.legend(curs, v => S.fmtMoney(v, cur, { compact: true }))}
          <p class="hl" style="margin-top:14px">
            Portföyünüzün %${((curs.find(c => c.label === cur) || { value: 0 }).value / (t.value || 1) * 100).toFixed(1)}'i
            raporlama para biriminizle (${cur}) aynı. Kalan kısım kur dalgalanmasına açıktır.</p>
        </div>
        <div class="card">
          <div class="card-head"><h2 class="card-title">Nakit Akışı (İşlem Günlüğü)</h2></div>
          <div class="chart-box">${flow.some(f => Math.abs(f.value) > 0.5) ? Charts.bars(flow, {
            fmt: v => S.fmtMoney(v, cur),
            fmtShort: v => (Math.abs(v) > 0.5 ? S.fmtMoney(v, cur, { compact: true }) : '')
          }) : Charts.placeholder('Henüz alım, satım veya getiri işlemi kaydedilmedi.')}</div>
          <p class="muted" style="font-size:12px;margin:10px 0 0">
            Yeşil üstü giriş (alım, yatırma, getiri), kırmızı çıkış (satım, çekme, masraf) işlemlerinin aylık net toplamı.</p>
        </div>
      </div>`;

    root.addEventListener('click', e => {
      if (e.target.closest('[data-act="targets"]')) { openTargetsForm(); return; }
      if (e.target.closest('[data-act="addIncome"]')) { openIncomeForm(null); return; }
      const c = e.target.closest('[data-range]');
      if (!c) return;
      statRange = Number(c.dataset.range);
      navigate();
    });
  }

  /* Hedef dağılım tablosu */
  function rebalanceHtml(cur) {
    const p = S.rebalancePlan(cur);
    if (!p.active) {
      return `<div class="empty" style="padding:26px 12px">
        <svg viewBox="0 0 24 24"><path d="M12 3v18M5 8l7-5 7 5M5 16l7 5 7-5"/></svg>
        <h3>Hedef dağılım tanımlı değil</h3>
        <p>Örneğin “%40 altın, %30 hisse, %20 nakit, %10 kripto” gibi bir hedef belirleyin;
           portföyünüz saptığında ne kadar alıp satmanız gerektiğini burada gösterelim.</p>
        <button class="btn btn-gold btn-sm" data-act="targets">Hedef belirle</button></div>`;
    }
    const rows = p.rows.filter(r => r.targetPct > 0 || Math.abs(r.value) > 0.5);
    return `
      <p class="hl" style="margin:0 0 14px">
        Toplam sapma <b>${S.fmtPct(p.drift).replace('+', '')}</b> —
        ${p.drift < 3 ? 'portföyünüz hedefe çok yakın.'
          : p.drift < 10 ? 'küçük bir düzeltme yeterli.'
          : 'hedeften belirgin şekilde uzaklaşmışsınız.'}</p>
      <div class="table-wrap"><table>
        <thead><tr><th>Varlık sınıfı</th><th class="num">Hedef</th><th class="num">Mevcut</th>
          <th>Sapma</th><th class="num">Gereken işlem</th></tr></thead><tbody>
        ${rows.map(r => `<tr>
          <td><div class="asset-name"><span class="asset-ico">${r.icon}</span>
            <span class="asset-meta"><strong>${esc(r.name)}</strong>
              <small>${S.fmtMoney(r.value, cur, { compact: true })}</small></span></div></td>
          <td class="num">${r.targetPct ? '%' + r.targetPct.toFixed(1) : '<span class="muted">—</span>'}</td>
          <td class="num">%${r.currentPct.toFixed(1)}</td>
          <td style="min-width:140px">
            <div class="bar-track" style="position:relative">
              <i class="bar-fill" style="width:${Math.min(100, Math.abs(r.diffPct) * 3).toFixed(1)}%;
                 background:${r.diffPct > 0 ? 'linear-gradient(90deg,#e0a96d,#ff9f68)' : 'linear-gradient(90deg,#7fd1c1,#4c6ac9)'}"></i>
            </div>
            <small class="muted">${r.diffPct > 0 ? 'fazla' : 'eksik'} ${Math.abs(r.diffPct).toFixed(1)} puan</small></td>
          <td class="num"><b class="${r.diff > 0 ? 'delta down' : 'delta up'}">
            ${r.diff > 0 ? 'Sat ' : 'Al '}${S.fmtMoney(Math.abs(r.diff), cur, { compact: true })}</b></td>
        </tr>`).join('')}
        </tbody></table></div>
      <p class="muted" style="font-size:12px;margin:12px 0 0">
        “Gereken işlem”, hedef oranlara dönmek için sınıf bazında yaklaşık tutarı gösterir;
        vergi ve işlem maliyetlerini içermez.</p>`;
  }

  /* Hedef dağılım düzenleme */
  function openTargetsForm() {
    const cur = S.settings.baseCurrency;
    const t = S.settings.rebalanceTargets || {};
    const p = S.rebalancePlan(cur);
    const present = new Set(S.assets.map(x => x.type));
    const types = DATA.ASSET_TYPES.filter(x => present.has(x.id) || t[x.id]);
    const list = types.length ? types : DATA.ASSET_TYPES.slice(0, 6);

    const back = openModal(`
      <div class="modal-head"><h2>🎯 Hedef Dağılım</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <p class="hl" style="margin:0">Her sınıf için hedef yüzdeyi girin. Toplamın tam 100 olması
          şart değil — oranlar kendi aralarında normalize edilir. Boş bırakılan sınıf hedefsizdir.</p>
        <div class="panel"><div class="form-grid" id="tgGrid">
          ${list.map(x => {
            const row = p.rows.find(r => r.type === x.id);
            return `<div class="field">
              <label for="tg_${x.id}">${x.icon} ${esc(x.name)}</label>
              <input id="tg_${x.id}" data-target="${x.id}" type="text" inputmode="decimal"
                value="${t[x.id] ? t[x.id] : ''}" placeholder="%">
              <span class="hint">Mevcut %${row ? row.currentPct.toFixed(1) : '0,0'}</span>
            </div>`;
          }).join('')}
        </div>
        <div class="switch-row" style="margin-top:6px">
          <div><strong style="font-size:13.5px">Sapma uyarısı</strong>
            <p>Toplam sapma %10'u aştığında açılışta hatırlat.</p></div>
          <label class="switch"><input type="checkbox" id="tgAlert"
            ${S.settings.notifications.rebalance ? 'checked' : ''}><i></i></label>
        </div></div>
        <p class="muted" style="font-size:12.5px;margin:0" id="tgSum"></p>
      </div>
      <div class="modal-foot">
        <button class="btn btn-danger" id="tgClear">Hedefleri kaldır</button>
        <div style="flex:1"></div>
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" id="tgSave">Kaydet</button></div>`, { title: 'Hedef dağılım' });

    const sum = () => $$('[data-target]', back)
      .reduce((n, el) => n + (S.parseNum(el.value) || 0), 0);
    const refresh = () => {
      const s = sum();
      $('#tgSum', back).textContent = s
        ? `Girilen toplam: %${S.fmtNum(s, 1)}${Math.abs(s - 100) > 0.5 ? ' — oranlar %100’e ölçeklenecek' : ''}`
        : 'Henüz hedef girilmedi.';
    };
    back.addEventListener('input', refresh);
    refresh();

    $('#tgClear', back).addEventListener('click', () => {
      S.setTargets({}); closeModal(); toast('Hedef dağılım kaldırıldı.', 'ok'); navigate();
    });
    $('#tgSave', back).addEventListener('click', () => {
      const map = {};
      $$('[data-target]', back).forEach(el => { map[el.dataset.target] = el.value; });
      const saved = S.setTargets(map);
      S.settings.notifications.rebalance = $('#tgAlert', back).checked;
      S.save();
      closeModal();
      toast(Object.keys(saved).length ? 'Hedef dağılım kaydedildi.' : 'Hedef girilmedi.', 'ok');
      navigate();
    });
  }

  function cashFlow() {
    const cur = S.settings.baseCurrency;
    const months = new Map();
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.set(d.toISOString().slice(0, 7), 0);
    }
    for (const t of S.transactions) {
      const sign = DATA.txType(t.type).sign;
      if (!sign || t.amount == null) continue;
      const m = (t.date || '').slice(0, 7);
      if (!months.has(m)) continue;
      const v = S.convert(t.amount, t.currency || cur, cur);
      if (isNaN(v)) continue;
      months.set(m, months.get(m) + sign * v);
    }
    return [...months.entries()].map(([m, v]) => ({
      label: m.slice(5) + '.' + m.slice(2, 4),
      value: v,
      color: v >= 0 ? '#3fd08a' : '#ff6b6b'
    }));
  }

  /* ================= 4) GEÇMİŞ ================= */
  const histFilter = { q: '', type: '', from: '', to: '' };

  function renderHistory(root) {
    root.innerHTML = pageHead('Geçmiş', `${S.transactions.length} kayıt · tüm hareketler ve denetim izi`,
      `<button class="btn btn-sm" data-act="csv">CSV indir</button>
       <button class="btn btn-sm" data-act="manual">+ İşlem ekle</button>`) + `
      <div class="card">
        <div class="filters">
          <input id="hq" type="search" placeholder="🔍 Varlık, kurum veya not ara…" value="${esc(histFilter.q)}">
          <select id="htype"><option value="">Tüm işlem türleri</option>
            ${DATA.TX_TYPES.map(t => `<option value="${t.id}" ${histFilter.type === t.id ? 'selected' : ''}>${t.icon} ${esc(t.name)}</option>`).join('')}</select>
          <input id="hfrom" type="date" value="${esc(histFilter.from)}" aria-label="Başlangıç tarihi">
          <input id="hto" type="date" value="${esc(histFilter.to)}" aria-label="Bitiş tarihi">
        </div>
        <div id="histBody"></div>
      </div>`;

    draw();
    root.addEventListener('input', e => { if (e.target.id === 'hq') { histFilter.q = e.target.value; draw(); } });
    root.addEventListener('change', e => {
      if (e.target.id === 'htype') histFilter.type = e.target.value;
      else if (e.target.id === 'hfrom') histFilter.from = e.target.value;
      else if (e.target.id === 'hto') histFilter.to = e.target.value;
      else return;
      draw();
    });
    root.addEventListener('click', e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      if (b.dataset.act === 'csv') download('gecmis.csv', S.exportTxCSV(), 'text/csv');
      if (b.dataset.act === 'manual') openTxForm();
      if (b.dataset.act === 'delTx') delTx(b.dataset.id);
      if (b.dataset.act === 'editTx') editTxNote(b.dataset.id);
    });

    function draw() {
      const q = histFilter.q.toLocaleLowerCase('tr');
      const rows = S.transactions.filter(t => {
        if (histFilter.type && t.type !== histFilter.type) return false;
        if (histFilter.from && t.date < histFilter.from) return false;
        if (histFilter.to && t.date > histFilter.to) return false;
        if (!q) return true;
        return [t.assetName, t.note, t.locationFrom, t.locationTo, DATA.txType(t.type).name]
          .join(' ').toLocaleLowerCase('tr').includes(q);
      });

      // Güne göre grupla
      const groups = new Map();
      rows.slice(0, 400).forEach(t => {
        if (!groups.has(t.date)) groups.set(t.date, []);
        groups.get(t.date).push(t);
      });

      $('#histBody', root).innerHTML = rows.length ? [...groups.entries()].map(([date, items]) => `
        <p class="section-label" style="margin-top:18px">${esc(S.fmtDate(date))} · ${items.length} hareket</p>
        <div class="timeline">${items.map(t => `
          <div class="tl-item">
            <div class="tl-dot">${DATA.txType(t.type).icon}</div>
            <div class="tl-main">
              <div class="tl-title"><strong>${esc(t.assetName || DATA.txType(t.type).name)}</strong>
                <span class="pill">${esc(DATA.txType(t.type).name)}</span>
                <span class="tl-time">${esc(S.fmtDateTime(t.at))}</span></div>
              <p class="tl-desc">${esc(t.note || '')}
                ${t.quantity != null ? ' · ' + esc(S.fmtNum(t.quantity, 6)) : ''}
                ${t.amount != null ? ' · <b>' + esc(S.fmtMoney(t.amount, t.currency)) + '</b>' : ''}
                ${t.locationFrom ? ' · ' + esc(t.locationFrom) + ' →' : ''}
                ${t.locationTo ? ' ' + esc(t.locationTo) : ''}</p>
              <div class="tl-actions">
                <button class="link-btn" data-act="editTx" data-id="${t.id}">notu düzelt</button>
                <button class="link-btn danger" data-act="delTx" data-id="${t.id}">sil</button>
              </div>
            </div></div>`).join('')}</div>`).join('') +
        (rows.length > 400 ? '<p class="muted" style="font-size:12px;margin-top:14px">İlk 400 kayıt gösteriliyor. Tamamı için CSV indirin.</p>' : '')
        : '<div class="empty"><h3>Kayıt bulunamadı</h3><p>Filtreleri gevşetin veya yeni bir işlem ekleyin.</p></div>';
    }
  }

  async function delTx(id) {
    const t = S.transactions.find(x => x.id === id);
    if (!t) return;
    const ok = await confirmDialog('Geçmiş kaydını sil',
      `<b>${esc(DATA.txType(t.type).name)}</b> kaydı günlükten silinecek.
       Varlıklarınız, satışlarınız ve bakiyeleriniz <b>etkilenmez</b> —
       yalnızca bu satır ve nakit akışı grafiğine katkısı kalkar.`, 'Sil');
    if (!ok) return;
    S.deleteTx(id);
    toast('Kayıt silindi.', 'ok');
    navigate();
  }

  function editTxNote(id) {
    const t = S.transactions.find(x => x.id === id);
    if (!t) return;
    const back = openModal(`
      <div class="modal-head"><h2>Notu düzelt</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body"><div class="panel">
        <div class="field">
          <label for="txNote">${esc(DATA.txType(t.type).name)} · ${esc(S.fmtDate(t.date))}</label>
          <textarea id="txNote" rows="3" maxlength="400">${esc(t.note || '')}</textarea>
          <span class="hint">Yalnızca açıklama değişir; tutar ve tarih korunur.</span>
        </div>
      </div></div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" id="txSave">Kaydet</button></div>`, { small: true, title: 'Notu düzelt' });
    $('#txSave', back).addEventListener('click', () => {
      S.updateTxNote(id, $('#txNote', back).value);
      closeModal(); toast('Not güncellendi.', 'ok'); navigate();
    });
  }

  function openTxForm() {
    const back = openModal(`
      <div class="modal-head"><h2>İşlem Ekle</h2>
        <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field"><label for="tType">İşlem türü</label>
            <select id="tType">${DATA.TX_TYPES.filter(t => !['create', 'update', 'delete'].includes(t.id))
              .map(t => `<option value="${t.id}">${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="tAsset">İlgili varlık</label>
            <select id="tAsset"><option value="">— Serbest kayıt —</option>
              ${S.assets.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
          <div class="field"><label for="tAmount">Tutar</label>
            <input id="tAmount" type="text" inputmode="decimal" placeholder="0"></div>
          <div class="field"><label for="tCur">Para birimi</label>
            <select id="tCur">${DATA.CURRENCIES.map(c => `<option value="${c.code}"
              ${c.code === S.settings.baseCurrency ? 'selected' : ''}>${c.code}</option>`).join('')}</select></div>
          <div class="field"><label for="tDate">Tarih</label>
            <input id="tDate" type="date" value="${S.todayISO()}" max="${S.todayISO()}"></div>
          <div class="field span-full"><label for="tNote">Not</label>
            <input id="tNote" placeholder="Örn. temettü ödemesi, komisyon"></div>
        </div>
      </div>
      <div class="modal-foot">
        <button class="btn btn-ghost" onclick="closeModal()">Vazgeç</button>
        <button class="btn btn-gold" id="tSave">Kaydet</button></div>`, { small: false, title: 'İşlem ekle' });

    $('#tSave', back).addEventListener('click', () => {
      const asset = S.getAsset($('#tAsset', back).value);
      const amount = S.parseNum($('#tAmount', back).value);
      if ($('#tAmount', back).value !== '' && (isNaN(amount) || amount < 0)) {
        toast('Tutar geçerli bir sayı olmalıdır.', 'err'); return;
      }
      S.addManualTx({
        type: $('#tType', back).value,
        assetId: asset ? asset.id : null,
        assetName: asset ? asset.name : 'Serbest kayıt',
        amount: $('#tAmount', back).value === '' ? null : amount,
        currency: $('#tCur', back).value,
        date: $('#tDate', back).value || S.todayISO(),
        note: $('#tNote', back).value.trim() || 'Elle eklenen işlem.'
      });
      closeModal(); toast('İşlem kaydedildi.', 'ok'); navigate();
    });
  }

  /* ================= 5) AYARLAR ================= */
  function renderSettings(root) {
    const st = S.settings, p = S.state.profile, c = S.state.cache;
    const r = Market.rates();

    root.innerHTML = pageHead('Ayarlar', 'Profil, para birimi, veri kaynakları ve gizlilik') + `
      <div class="settings-search">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>
          <input id="setSearch" type="search" autocomplete="off"
            placeholder="Ayarlarda ara: para birimi, yedek, QR, tema…">
        </div>
      </div>
      <div class="grid g-2" id="setGrid">

        <div class="card">
          <div class="card-head"><h2 class="card-title">Profil</h2></div>
          <div class="form-grid">
            <div class="field"><label for="sName">Görünen ad</label>
              <input id="sName" value="${esc(p.name)}" placeholder="Adınız"></div>
            <div class="field"><label for="sEmail">E-posta (yalnızca yerel)</label>
              <input id="sEmail" type="email" value="${esc(p.email)}" placeholder="ornek@eposta.com"></div>
          </div>
          <p class="hl" style="margin-top:14px">Bu bilgiler yalnızca bu tarayıcıda saklanır, hiçbir sunucuya gönderilmez.</p>
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">Para Birimi & Görünüm</h2></div>
          <div class="form-grid">
            <div class="field"><label for="sCur">Raporlama para birimi</label>
              <select id="sCur">${DATA.CURRENCIES.filter(x => x.code !== 'GAU').map(x =>
                `<option value="${x.code}" ${st.baseCurrency === x.code ? 'selected' : ''}>${x.code} — ${esc(x.name)}</option>`).join('')}</select></div>
            <div class="field"><label for="sTheme">Tema</label>
              <select id="sTheme">
                <option value="navy-gold" ${st.theme === 'navy-gold' ? 'selected' : ''}>Lacivert & Altın (koyu)</option>
                <option value="light-gold" ${st.theme === 'light-gold' ? 'selected' : ''}>Açık & Altın</option>
              </select></div>
            <div class="field"><label for="sLocale">Dil / biçim</label>
              <select id="sLocale">
                <option value="tr-TR" ${st.locale === 'tr-TR' ? 'selected' : ''}>Türkçe (tr-TR)</option>
                <option value="en-US" ${st.locale === 'en-US' ? 'selected' : ''}>English (en-US)</option>
                <option value="de-DE" ${st.locale === 'de-DE' ? 'selected' : ''}>Deutsch (de-DE)</option>
              </select></div>
          </div>
          <div style="margin-top:12px">
            <div class="switch-row"><div><strong style="font-size:13.5px">Büyük sayıları kısalt</strong>
              <p>1.250.000 ₺ yerine 1,25 Mn ₺ gösterilir.</p></div>
              <label class="switch"><input type="checkbox" id="sCompact" ${st.compactNumbers ? 'checked' : ''}><i></i></label></div>
            <div class="switch-row"><div><strong style="font-size:13.5px">Giriş animasyonu</strong>
              <p>Uygulama açılışındaki logo animasyonunu göster.</p></div>
              <label class="switch"><input type="checkbox" id="sSplash" ${st.showSplash ? 'checked' : ''}><i></i></label></div>
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">Veri Kaynakları</h2>
            <button class="btn btn-sm" id="sRefresh">Şimdi yenile</button></div>
          <div class="chip-row" style="margin-bottom:14px">
            <button class="btn btn-sm btn-gold" data-act="diag">🔌 Bağlantıyı test et</button>
          </div>
          <div id="diagBox"></div>
          <ul class="stat-list" style="margin-bottom:16px">
            ${['rates','tr','crypto','stocks','banks'].map(k => {
              const label = { rates:'Döviz kurları', tr:'Altın / gümüş', crypto:'Kripto',
                              stocks:'Hisse / ETF', banks:'Banka listesi' }[k];
              const st2 = Market.sources()[k];
              return `<li><span>${label}</span><b>${st2
                ? `<span class="${st2.ok ? 'ok-tag' : 'warn-tag'}">${st2.ok ? '✓' : '✕'}</span> ${esc(st2.msg)} · ${esc(S.relTime(st2.at))}`
                : '<span class="muted">henüz denenmedi</span>'}</b></li>`;
            }).join('')}
          </ul>
          <ul class="stat-list">
            <li><span>Banka listesi</span><b>${esc(c.banksSource)}</b></li>
            <li><span>Son banka güncellemesi</span><b>${c.banksAt ? esc(S.relTime(c.banksAt)) : '—'}</b></li>
            <li><span>Döviz kuru kaynağı</span><b>${esc(c.ratesSource)}</b></li>
            <li><span>Son kur güncellemesi</span><b>${c.ratesAt ? esc(S.relTime(c.ratesAt)) : '—'}</b></li>
            <li><span>Enflasyon (TÜFE)</span><b>${(() => { const i = S.inflationRate();
              return i ? '%' + esc(S.fmtNum(i.rate, 1)) + ' · ' + esc(i.source) : '—'; })()}</b></li>
            <li><span>Altın / gümüş (kapalıçarşı)</span><b>${c.trAt ? esc(c.trUpdate || S.relTime(c.trAt)) : '—'}</b></li>
            <li><span>Son fiyat güncellemesi</span><b>${c.pricesAt ? esc(S.relTime(c.pricesAt)) : '—'}</b></li>
          </ul>
          <div style="margin-top:12px">
            <p class="muted" style="font-size:12.5px;margin:0 0 12px">
              Döviz kurları (open.er-api.com, 6 saatte bir) ve “otomatik fiyat” işaretli varlıkların
              piyasa fiyatı (altın/gümüş kapalıçarşı · finans.truncgil.com, kripto · CoinGecko)
              <b>her zaman</b> çekilir. Bu istekler kişisel veri taşımaz, kapatılmalarına gerek yoktur;
              tek tek varlıklarda çekimi kapatmak için varlığın “Fiyatı otomatik güncelle” anahtarını kullanın.</p>
            <div class="switch-row"><div><strong style="font-size:13.5px">Hisse / ETF fiyatlarını çek</strong>
              <p>Yahoo Finance verisi, tarayıcıdan doğrudan erişilemediği için bir okuma vekili
                 (<b>r.jina.ai</b>, olmazsa allorigins / corsproxy) üzerinden alınır. Yalnızca hisse
                 sembolü (örn. THYAO.IS) bu servise gider; portföyünüz veya kişisel bilginiz
                 gönderilmez. Kapalıyken hisse değerlerini elle girersiniz.</p></div>
              <label class="switch"><input type="checkbox" id="sStock" ${st.stockPrices ? 'checked' : ''}><i></i></label></div>
          </div>
          <p class="section-label" style="margin-top:18px">Kurlar (1 birim kaç TRY?)</p>
          <div class="form-grid">
            ${DATA.CURRENCIES.filter(x => x.code !== 'TRY').map(x => `
              <div class="field"><label for="rate_${x.code}">${x.code} · ${esc(x.name)}</label>
                <input id="rate_${x.code}" data-rate="${x.code}" type="text" inputmode="decimal"
                  value="${r[x.code] ? Number(r[x.code]).toFixed(4) : ''}" placeholder="elle girin"></div>`).join('')}
          </div>
          <p class="muted" style="font-size:12px;margin:10px 0 0">Kur alınamazsa buradan elle girebilirsiniz. Değerler TRY cinsindendir.</p>
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">Bildirimler</h2></div>
          <div class="switch-row"><div><strong style="font-size:13.5px">Fiyat uyarıları</strong>
            <p>Otomatik fiyatlı varlıklarda eşiği aşan değişimde uyarı göster.</p></div>
            <label class="switch"><input type="checkbox" id="nPrice" ${st.notifications.priceAlerts ? 'checked' : ''}><i></i></label></div>
          <div class="form-grid" style="margin:10px 0 4px">
            <div class="field">
              <label for="nThreshold">Uyarı eşiği (%)</label>
              <input id="nThreshold" type="text" inputmode="decimal"
                value="${esc(st.notifications.priceThreshold ?? 5)}">
              <span class="hint">Birim fiyat bu orandan fazla değişirse bildirilir.</span>
            </div>
            <div class="field">
              <label for="nInflation">Yıllık TÜFE (%)</label>
              <input id="nInflation" type="text" inputmode="decimal"
                value="${st.inflationRate == null ? '' : esc(st.inflationRate)}" placeholder="otomatik">
              <span class="hint">${(() => { const i = S.inflationRate();
                return i ? `Kullanılan: %${S.fmtNum(i.rate, 1)} (${esc(i.source)})` : 'Veri yok — reel getiri hesaplanamıyor.'; })()}</span>
            </div>
          </div>
          <div class="switch-row"><div><strong style="font-size:13.5px">Dengeleme hatırlatıcısı</strong>
            <p>Bir varlık sınıfı portföyün %50'sini aştığında uyar.</p></div>
            <label class="switch"><input type="checkbox" id="nBal" ${st.notifications.rebalance ? 'checked' : ''}><i></i></label></div>
          <div class="switch-row"><div><strong style="font-size:13.5px">Haftalık özet</strong>
            <p>Haftada bir açılışta portföy özeti göster.</p></div>
            <label class="switch"><input type="checkbox" id="nWeek" ${st.notifications.weeklySummary ? 'checked' : ''}><i></i></label></div>
          <p class="muted" style="font-size:12.5px;margin:10px 0 0">
            Grafikleri besleyen günlük portföy kaydı, her varlık ekleme/çıkarma/satış işleminde
            ve her açılışta kendiliğinden alınır.</p>
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">Kurulum Testi</h2></div>
          <p class="muted" style="font-size:13px;margin:0 0 14px">
            “Nelere yatırım yapıyorsunuz?” testiyle portföyünüzü adım adım kurun. Uzun varlık formunu
            doldurmadan, tür seçip miktar girerek ilerlersiniz. Mevcut varlıklarınız silinmez —
            testte girdikleriniz portföye eklenir.</p>
          <div class="chip-row">
            <button class="btn btn-sm btn-gold" data-act="onboard">🎯 Kurulum testini çalıştır</button>
          </div>
          <ul class="stat-list" style="margin-top:16px">
            <li><span>Durum</span><b>${st.onboarded ? 'Tamamlandı' : 'Henüz yapılmadı'}</b></li>
            <li><span>Mevcut varlık</span><b>${S.assets.length}</b></li>
            <li><span>Formda gösterilen türler</span><b>${(st.assetTypes || []).length
              ? esc((st.assetTypes || []).map(id => DATA.assetType(id).name).join(', '))
              : 'tümü (' + DATA.ASSET_TYPES.length + ')'}</b></li>
          </ul>
          <p class="muted" style="font-size:12px;margin:10px 0 0">
            Yeni varlık formunda yalnızca testte seçtiğiniz türler görünür; diğerlerine
            “+N tür daha” düğmesiyle ulaşabilirsiniz.</p>
          ${(st.assetTypes || []).length ? `<div class="chip-row" style="margin-top:10px">
            <button class="btn btn-sm btn-ghost" data-act="allTypes">Tüm türleri göster</button>
          </div>` : ''}
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">Veri Yönetimi</h2></div>
          <p class="muted" style="font-size:13px;margin:0 0 14px">
            Verileriniz cihazınızdaki tarayıcı deposunda tutulur. Düzenli olarak yedek alın —
            tarayıcı verilerini temizlemek portföyünüzü siler.</p>
          <div class="chip-row">
            <button class="btn btn-sm" data-act="expJson">JSON yedek al</button>
            <button class="btn btn-sm" data-act="expAssets">Varlıklar CSV</button>
            <button class="btn btn-sm" data-act="expTx">Geçmiş CSV</button>
            <button class="btn btn-sm" data-act="expSales">Satışlar CSV</button>
            <button class="btn btn-sm" data-act="print">PDF / Yazdır</button>
            <button class="btn btn-sm" data-act="imp">Yedekten yükle</button>
            <input type="file" id="impFile" accept="application/json" hidden>
          </div>
          <ul class="stat-list" style="margin-top:16px">
            <li><span>Son yedek</span><b>${(() => { const b = S.backupStatus();
              return b.last ? esc(S.relTime(b.last)) : 'hiç alınmadı'; })()}</b></li>
          </ul>
          <div class="switch-row"><div><strong style="font-size:13.5px">Yedek hatırlatıcısı</strong>
            <p>14 günden uzun süre yedek alınmadıysa ana sayfada uyarı göster.</p></div>
            <label class="switch"><input type="checkbox" id="sBackupRem" ${st.backupReminder ? 'checked' : ''}><i></i></label></div>

          <p class="section-label" style="margin-top:20px">Tehlikeli Bölge</p>
          <div class="chip-row">
            <button class="btn btn-sm btn-danger" data-act="clearTx">Geçmişi temizle</button>
            <button class="btn btn-sm btn-danger" data-act="reset">Tüm verileri sil</button>
            ${S.assets.length ? '' : '<button class="btn btn-sm" data-act="demo">Örnek veri yükle</button>'}
          </div>
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">QR ile Cihaz Aktarımı</h2></div>
          <p class="muted" style="font-size:13px;margin:0 0 14px">
            Portföyünüzü telefon ve bilgisayar arasında, hiçbir sunucuya uğramadan taşıyın.
            Veri sıkıştırılıp QR kare(ler)ine dönüştürülür; diğer cihaz kamerayla okur.</p>
          <div class="chip-row">
            <button class="btn btn-sm btn-gold" data-act="qrSend">📤 QR ile gönder</button>
            <button class="btn btn-sm" data-act="qrRecv">📥 QR ile al</button>
          </div>
          <ul class="stat-list" style="margin-top:16px">
            <li><span>Aktarılacak veri</span><b>${S.assets.length} varlık · ${S.transactions.length} hareket</b></li>
            <li><span>Okuma desteği</span><b>${typeof BarcodeDetector !== 'undefined' ? 'Bu tarayıcıda var' : 'Bu tarayıcıda yok'}</b></li>
            <li><span>İnternet gerekir mi?</span><b>Hayır</b></li>
          </ul>
          <p class="hl" style="margin-top:14px">
            Alan cihazdaki veriler <b>üzerine yazılır</b>. QR kodunuz portföyünüzün tamamını içerir;
            ekranınızı yabancılara göstermeyin.</p>
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">PIN Kilidi & Şifreleme</h2></div>
          ${Lock.supported() ? `
            <p class="muted" style="font-size:13px;margin:0 0 14px">
              Açıldığında portföyünüz cihazda <b>AES-256 ile şifreli</b> saklanır ve uygulama
              her açılışta PIN ister. Anahtar yalnızca PIN'inizden türetilir, hiçbir yere gönderilmez.</p>
            <ul class="stat-list" style="margin-bottom:14px">
              <li><span>Durum</span><b class="${Lock.isEnabled() ? 'ok-tag' : 'muted'}">${Lock.isEnabled() ? '🔒 Etkin' : 'Kapalı'}</b></li>
              <li><span>Yöntem</span><b>AES-GCM 256 · PBKDF2 250.000 tur</b></li>
            </ul>
            <div class="chip-row">
              ${Lock.isEnabled()
                ? `<button class="btn btn-sm" data-act="lockNow">🔒 Şimdi kilitle</button>
                   <button class="btn btn-sm" data-act="pinChange">PIN'i değiştir</button>
                   <button class="btn btn-sm btn-danger" data-act="pinOff">Şifrelemeyi kapat</button>`
                : `<button class="btn btn-sm btn-gold" data-act="pinOn">🔐 PIN kilidini kur</button>`}
            </div>
            <p class="hl" style="margin-top:14px">
              <b>PIN'i unutursanız veri kurtarılamaz.</b> Bu yüzden kurulumdan önce JSON yedek
              indirmeniz istenir. Yedek dosyası şifresizdir — güvenli bir yerde saklayın.</p>`
          : `<p class="hl">Bu tarayıcı/bağlam şifrelemeyi desteklemiyor (güvenli bağlam gerekir).
              Uygulamayı <b>https</b> veya <b>localhost</b> üzerinden açın.</p>`}
        </div>

        <div class="card">
          <div class="card-head"><h2 class="card-title">Güvenlik & Gizlilik</h2></div>
          <ul class="stat-list">
            <li><span>Veri konumu</span><b>Yalnızca bu cihaz</b></li>
            <li><span>Depolama</span><b>${Lock.isEnabled() ? 'Şifreli (AES-256)' : 'Şifresiz'}</b></li>
            <li><span>Sunucuya gönderim</span><b>Yok</b></li>
            <li><span>Dış istekler</span><b>Kur, fiyat, banka listesi</b></li>
            <li><span>Çevrimdışı çalışma</span><b>Etkin (PWA)</b></li>
            <li><span>Sürüm</span><b>2.5.0</b></li>
          </ul>
          <p class="hl" style="margin-top:14px">
            Hesap numarası, IBAN, şifre veya cüzdan anahtarı gibi bilgileri buraya girmeyin.
            Paylaşılan bir cihaz kullanıyorsanız yedeğinizi güvenli bir yerde saklayın.</p>
        </div>
      </div>`;

    accordionize(root);

    // — Olay bağlantıları —
    const on = (sel, ev, fn) => { const e = $(sel, root); if (e) e.addEventListener(ev, fn); };
    on('#setSearch', 'input', e => filterSettings(root, e.target.value));
    on('#sName', 'change', e => { S.state.profile.name = e.target.value.trim(); S.save(); toast('Profil güncellendi.', 'ok'); });
    on('#sEmail', 'change', e => { S.state.profile.email = e.target.value.trim(); S.save(); });
    on('#sCur', 'change', e => { st.baseCurrency = e.target.value; S.save(); S.takeSnapshot(true); navigate(); toast('Raporlama para birimi ' + e.target.value + ' olarak ayarlandı.', 'ok'); });
    on('#sTheme', 'change', e => { st.theme = e.target.value; applyTheme(); S.save(); });
    on('#sLocale', 'change', e => { st.locale = e.target.value; S.save(); navigate(); });
    on('#sCompact', 'change', e => { st.compactNumbers = e.target.checked; S.save(); navigate(); });
    on('#sSplash', 'change', e => { st.showSplash = e.target.checked; S.save(); });
    on('#sBackupRem', 'change', e => { st.backupReminder = e.target.checked; S.save(); });
    on('#sStock', 'change', e => {
      st.stockPrices = e.target.checked; S.save();
      if (e.target.checked) toast('Hisse fiyatları açıldı. Sembolleri girip “Şimdi yenile” deyin.', 'ok');
    });
    on('#nPrice', 'change', e => { st.notifications.priceAlerts = e.target.checked; S.save(); });
    on('#nThreshold', 'change', e => {
      const v = S.parseNum(e.target.value);
      if (!(v > 0)) { toast('Eşik sıfırdan büyük olmalıdır.', 'err'); return; }
      st.notifications.priceThreshold = v; S.save(); toast('Uyarı eşiği %' + S.fmtNum(v, 1) + ' oldu.', 'ok');
    });
    on('#nInflation', 'change', e => {
      const raw = e.target.value.trim();
      if (!raw) { st.inflationRate = null; S.save(); toast('TÜFE otomatik kaynaktan alınacak.', 'ok'); navigate(); return; }
      const v = S.parseNum(raw);
      if (!(v >= 0)) { toast('TÜFE geçerli bir sayı olmalıdır.', 'err'); return; }
      st.inflationRate = v; S.save(); toast('TÜFE %' + S.fmtNum(v, 1) + ' olarak ayarlandı.', 'ok'); navigate();
    });
    on('#nBal', 'change', e => { st.notifications.rebalance = e.target.checked; S.save(); });
    on('#nWeek', 'change', e => { st.notifications.weeklySummary = e.target.checked; S.save(); });
    on('#sRefresh', 'click', () => doRefresh(true));

    root.addEventListener('change', e => {
      const code = e.target.dataset && e.target.dataset.rate;
      if (!code) return;
      const v = S.parseNum(e.target.value);
      if (e.target.value !== '' && (isNaN(v) || v <= 0)) { toast('Kur pozitif bir sayı olmalıdır.', 'err'); return; }
      Market.setRate(code, v);
      toast(code + ' kuru güncellendi.', 'ok');
      updateTopbar();
    });

    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'expJson') {
        download('servet-yedek-' + S.todayISO() + '.json', S.exportJSON(), 'application/json');
        S.markBackedUp();
      }
      if (act === 'expAssets') download('varliklar.csv', S.exportAssetsCSV(), 'text/csv');
      if (act === 'expTx') download('gecmis.csv', S.exportTxCSV(), 'text/csv');
      if (act === 'expSales') download('satislar.csv', S.exportSalesCSV(), 'text/csv');
      if (act === 'onboard') Onboard.open(appUI);
      if (act === 'allTypes') {
        st.assetTypes = []; S.save();
        toast('Varlık formunda tüm türler gösterilecek.', 'ok'); navigate();
      }
      if (act === 'diag') await runDiagnostics(root);
      if (act === 'pinOn') await setupPin();
      if (act === 'pinOff') await removePin();
      if (act === 'pinChange') await setupPin(true);
      if (act === 'lockNow') Lock.lockNow();
      if (act === 'print') window.print();
      if (act === 'qrSend') Transfer.openExport(appUI);
      if (act === 'qrRecv') {
        if (await confirmDialog('QR ile veri al',
          'Bu cihazdaki portföy, okunacak verinin <b>üzerine yazılacak</b>. Devam etmeden önce yedek almak ister misiniz?',
          'Devam et')) Transfer.openImport(appUI);
      }
      if (act === 'imp') $('#impFile', root).click();
      if (act === 'demo') { S.seedDemo(); toast('Örnek portföy yüklendi.', 'ok'); navigate(); }
      if (act === 'clearTx') {
        if (await confirmDialog('Geçmişi temizle', 'Tüm işlem kayıtları silinecek. Varlıklarınız etkilenmez.', 'Temizle')) {
          S.clearTransactions(); toast('Geçmiş temizlendi.', 'ok'); navigate();
        }
      }
      if (act === 'reset') {
        if (await confirmDialog('Tüm verileri sil',
          'Varlıklar, geçmiş, ayarlar ve grafik kayıtları dahil <b>her şey</b> silinecek. Önce yedek almanız önerilir.', 'Kalıcı olarak sil')) {
          S.resetAll(); toast('Tüm veriler silindi.', 'ok'); location.hash = '#/'; navigate();
        }
      }
    });

    on('#impFile', 'change', e => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        try {
          const n = S.importJSON(rd.result);
          applyTheme(); toast(n + ' varlık geri yüklendi.', 'ok'); navigate();
        } catch (err) { toast('Yedek okunamadı: ' + err.message, 'err'); }
      };
      rd.readAsText(f);
    });
  }

  /* Diğer modüllere (Transfer, Onboard) verilen arayüz köprüsü */
  const appUI = {
    openModal, closeModal, toast, openPicker, openSymbolPicker, openLocationPicker,
    afterImport: () => { applyTheme(); updateTopbar(); navigate(); }
  };
  const transferUI = appUI;

  /* Ayar kartlarını açılır/kapanır sekmelere çevirir (yoğunluğu azaltır) */
  const ACC_META = {
    'Profil': { icon: '👤', sub: 'Ad, e-posta' },
    'Para Birimi & Görünüm': { icon: '🎨', sub: 'Raporlama para birimi, tema, dil, sayı biçimi' },
    'Veri Kaynakları': { icon: '📡', sub: 'Kurlar, kapalıçarşı, hisse fiyatları, elle kur girişi' },
    'Bildirimler': { icon: '🔔', sub: 'Fiyat uyarıları, dengeleme, haftalık özet' },
    'Kurulum Testi': { icon: '🎯', sub: 'Portföyü adım adım yeniden kur' },
    'Veri Yönetimi': { icon: '💾', sub: 'Yedek al, geri yükle, CSV/PDF dışa aktar, sıfırla' },
    'QR ile Cihaz Aktarımı': { icon: '📱', sub: 'Telefon ↔ bilgisayar arası taşıma' },
    'Güvenlik & Gizlilik': { icon: '🔒', sub: 'Verilerin nerede tutulduğu, sürüm' }
  };

  function accordionize(root) {
    $$('#setGrid > .card', root).forEach((card, i) => {
      const head = $('.card-head', card);
      const titleEl = head && $('.card-title', head);
      if (!titleEl) return;
      const title = titleEl.textContent.trim();
      const meta = ACC_META[title] || { icon: '⚙️', sub: '' };
      const extra = head.querySelector('button, a');   // başlıktaki eylem düğmesi

      const d = document.createElement('details');
      d.className = 'card acc';
      d.open = i < 2;                                  // ilk iki bölüm açık gelir
      d.dataset.title = title;

      const summary = document.createElement('summary');
      summary.innerHTML = `<span class="acc-ico">${meta.icon}</span>
        <span class="acc-text">${esc(title)}<span class="acc-sub">${esc(meta.sub)}</span></span>
        <svg class="acc-arrow" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;

      const body = document.createElement('div');
      body.className = 'acc-body';
      head.remove();
      while (card.firstChild) body.appendChild(card.firstChild);
      if (extra) body.insertBefore(extra, body.firstChild);

      d.appendChild(summary);
      d.appendChild(body);
      card.replaceWith(d);
    });
  }

  function filterSettings(root, q) {
    const norm = t => String(t || '').toLocaleLowerCase('tr');
    const term = norm(q.trim());
    $$('#setGrid > .acc', root).forEach(d => {
      const hit = !term || norm(d.textContent).includes(term);
      d.classList.toggle('dim', !hit);
      if (term && hit) d.open = true;
    });
  }

  /* ================= Yardımcılar ================= */
  function download(filename, content, mime) {
    const blob = new Blob([content], { type: mime + ';charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(filename + ' indiriliyor…', 'ok');
  }

  function applyTheme() {
    document.documentElement.dataset.theme = S.settings.theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = S.settings.theme === 'light-gold' ? '#ffffff' : '#0b1533';
  }

  /* ---------------- PIN kilidi akışları ---------------- */
  function pinPrompt(opts) {
    return new Promise(resolve => {
      const back = openModal(`
        <div class="modal-head"><h2>${esc(opts.title)}</h2>
          <button class="icon-btn" onclick="closeModal()" aria-label="Kapat">✕</button></div>
        <div class="modal-body">
          <p class="hl" style="margin:0">${opts.text}</p>
          <div class="panel"><div class="form-grid">
            ${opts.askOld ? `<div class="field span-full">
              <label for="pinOld">Mevcut PIN</label>
              <input id="pinOld" type="password" inputmode="numeric" autocomplete="current-password">
            </div>` : ''}
            <div class="field${opts.confirm ? '' : ' span-full'}">
              <label for="pin1">${esc(opts.label || 'PIN')}</label>
              <input id="pin1" type="password" inputmode="numeric" autocomplete="new-password" maxlength="64">
              <span class="err"></span>
            </div>
            ${opts.confirm ? `<div class="field">
              <label for="pin2">PIN (tekrar)</label>
              <input id="pin2" type="password" inputmode="numeric" autocomplete="new-password" maxlength="64">
              <span class="err"></span>
            </div>` : ''}
          </div></div>
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" data-p="cancel">Vazgeç</button>
          <button class="btn btn-gold" data-p="ok">${esc(opts.ok || 'Devam')}</button>
        </div>`, { small: !opts.confirm, title: opts.title });

      back.addEventListener('click', e => {
        const b = e.target.closest('[data-p]');
        if (!b) return;
        if (b.dataset.p === 'cancel') { closeModal(); resolve(null); return; }
        const p1 = $('#pin1', back).value;
        const p2 = opts.confirm ? $('#pin2', back).value : p1;
        const old = opts.askOld ? $('#pinOld', back).value : null;
        if (!p1 || p1.length < 4) { toast('PIN en az 4 karakter olmalıdır.', 'err'); return; }
        if (p1 !== p2) { toast('PIN’in ikinci girişi eşleşmiyor.', 'err'); return; }
        closeModal();
        resolve({ pin: p1, old });
      });
    });
  }

  async function setupPin(isChange) {
    if (!Lock.supported()) { toast('Bu bağlamda şifreleme kullanılamıyor.', 'err'); return; }
    if (!isChange) {
      const ok = await confirmDialog('Önce yedek alın',
        `PIN kilidini kurmadan önce <b>JSON yedeğinizi indirin</b>. PIN unutulursa şifreli veri
         <b>kurtarılamaz</b>; tek geri dönüş yolu yedektir. Yedeği şimdi indirelim mi?`, 'Yedeği indir');
      if (!ok) return;
      download('servet-yedek-' + S.todayISO() + '.json', S.exportJSON(), 'application/json');
      S.markBackedUp();
    }
    const res = await pinPrompt({
      title: isChange ? 'PIN’i değiştir' : 'PIN kilidini kur',
      text: isChange ? 'Mevcut PIN’inizi ve yeni PIN’i girin.'
        : 'En az 4 karakterli bir PIN belirleyin. Uygulama her açılışta bunu soracak.',
      label: isChange ? 'Yeni PIN' : 'PIN', confirm: true, askOld: !!isChange,
      ok: isChange ? 'PIN’i değiştir' : 'Kilidi kur'
    });
    if (!res) return;
    try {
      S.flush();
      if (isChange) await Lock.changePin(res.old, res.pin);
      else await Lock.enable(res.pin);
      Lock.attach();
      await Lock.persist();
      toast(isChange ? 'PIN değiştirildi.' : 'PIN kilidi kuruldu. Uygulama artık şifreli saklanıyor.', 'ok');
      navigate();
    } catch (e) {
      toast('İşlem başarısız: ' + (e.message === 'Cipher job failed' ? 'mevcut PIN yanlış' : e.message), 'err');
    }
  }

  async function removePin() {
    const res = await pinPrompt({
      title: 'Şifrelemeyi kapat', label: 'Mevcut PIN',
      text: 'Doğrulamak için PIN’inizi girin. Kapattığınızda veriler cihazda <b>şifresiz</b> saklanır.',
      ok: 'Şifrelemeyi kapat'
    });
    if (!res) return;
    try {
      await Lock.disable(res.pin);
      S.flush();
      toast('Şifreleme kapatıldı.', 'ok');
      navigate();
    } catch (e) {
      toast('PIN doğru değil.', 'err');
    }
  }

  /* Bağlantı tanılaması */
  async function runDiagnostics(root) {
    const box = $('#diagBox', root);
    if (!box) return;
    box.innerHTML = `<p class="hl">Kaynaklar sırayla deneniyor…</p>`;
    const res = await Market.diagnose();
    const ap = S.autoPriceStatus();
    box.innerHTML = `
      <div class="table-wrap" style="margin-bottom:14px"><table style="min-width:0">
        <thead><tr><th>Kaynak</th><th>Sunucu</th><th class="num">Süre</th><th>Sonuç</th></tr></thead>
        <tbody>${res.map(r => `<tr>
          <td><b>${esc(r.name)}</b></td>
          <td><small class="muted">${esc(r.host)}</small></td>
          <td class="num">${r.ms} ms</td>
          <td>${r.ok ? `<span class="ok-tag">✓ ${esc(r.detail)}</span>`
                     : `<span class="warn-tag">✕ ${esc(r.detail)}</span>`}</td>
        </tr>`).join('')}</tbody></table></div>
      <p class="hl">Portföyünüzde otomatik fiyatlı <b>${ap.auto}</b> varlık var
        (fiyatı çekilebilecek toplam ${ap.eligible}).
        ${ap.needsSymbol.length ? `<br><span class="warn-tag">${ap.needsSymbol.length} varlıkta ürün/sembol seçilmemiş:
          ${esc(ap.needsSymbol.map(x => x.name).join(', '))}</span>` : ''}
        ${ap.stockOff.length ? `<br><span class="warn-tag">${ap.stockOff.length} hisse/ETF için fiyat çekimi kapalı.</span>` : ''}
        ${!ap.auto && ap.eligible ? `<br><span class="warn-tag">Hiçbir varlıkta “otomatik fiyat” açık değil —
          varlığı düzenleyip ürün/sembol seçin.</span>` : ''}</p>`;
    const bad = res.filter(r => !r.ok);
    toast(bad.length ? `${bad.length} kaynak yanıt vermedi: ${bad.map(b => b.name).join(', ')}`
                     : 'Tüm veri kaynakları çalışıyor.', bad.length ? 'err' : 'ok');
  }

  /* ================= Yenileme ================= */
  let busy = false;
  async function doRefresh(force) {
    if (busy) return;
    busy = true;
    const btn = $('#refreshBtn');
    btn.classList.add('spinning');
    try {
      const r = await Market.refreshAll(force);
      const ap = S.autoPriceStatus();
      if (r.errors.length) {
        toast('Bazı veriler alınamadı (' + r.errors.join(', ') + '). Çevrimdışı olabilirsiniz.', 'err');
      } else if (r.prices) {
        toast(r.prices + ' varlığın fiyatı güncellendi.', 'ok');
      } else if (!ap.auto) {
        toast(ap.eligible
          ? `Kurlar güncellendi. Fiyatı otomatik çekilebilecek ${ap.eligible} varlık var ama hiçbirinde “otomatik fiyat” açık değil — varlığı düzenleyip ürün/sembol seçin.`
          : 'Kurlar ve listeler güncel.', ap.eligible ? 'err' : 'ok');
      } else {
        toast('Fiyatlar zaten güncel (değişiklik yok).', 'ok');
      }
      if (r.failed && r.failed.length) toast('Fiyatı alınamayanlar: ' + r.failed.join(', '), 'err');
      if (ap.needsSymbol.length) {
        toast(`${ap.needsSymbol.length} varlıkta otomatik fiyat açık ama ürün/sembol seçilmemiş: ` +
          ap.needsSymbol.slice(0, 3).map(a => a.name).join(', '), 'err');
      }
      if (ap.stockOff.length) {
        toast(`${ap.stockOff.length} hisse/ETF için fiyat çekimi Ayarlar'dan kapalı.`, 'err');
      }
      navigate();
      checkAlerts();
    } catch (e) {
      toast('Yenileme başarısız: ' + e.message, 'err');
    } finally {
      btn.classList.remove('spinning');
      busy = false;
    }
  }

  function checkAlerts() {
    const st = S.settings;
    if (st.notifications.rebalance) {
      const plan = S.rebalancePlan();
      if (plan.active && plan.drift >= 10) {
        const worst = plan.rows[0];
        toast(`Dengeleme: hedeften %${plan.drift.toFixed(1)} sapma var. En büyük fark ` +
          `${worst.name} (${worst.diff > 0 ? 'fazla' : 'eksik'} ${S.fmtMoney(Math.abs(worst.diff), plan.currency, { compact: true })}).`);
      } else if (!plan.active) {
        const t = S.totals(), types = S.byType();
        if (types.length && t.value && types[0].value / t.value > 0.5) {
          toast(`Portföyünüzün %${(types[0].value / t.value * 100).toFixed(0)}'i "${types[0].label}" sınıfında. İstatistik → Hedef Dağılım'dan hedef belirleyebilirsiniz.`);
        }
      }
    }
    if (st.notifications.weeklySummary) {
      const last = Number(localStorage.getItem('servet.weekly') || 0);
      if (Date.now() - last > 7 * 864e5 && S.assets.length) {
        const p = S.performance(7);
        if (p.pct != null) toast(`Haftalık özet: portföyünüz ${S.fmtPct(p.pct)} değişti (${S.fmtMoney(p.abs)}).`);
        localStorage.setItem('servet.weekly', String(Date.now()));
      }
    }
  }

  /* ================= Gezinme (mobil) ================= */
  function openNav() {
    $('#sidenav').classList.add('open');
    $('#scrim').hidden = false;
    $('#navToggle').setAttribute('aria-expanded', 'true');
  }
  function closeNav() {
    $('#sidenav').classList.remove('open');
    $('#scrim').hidden = true;
    $('#navToggle').setAttribute('aria-expanded', 'false');
  }

  /* ================= PWA ================= */
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    deferredPrompt = e;
    $('#installBtn').hidden = false;
  });
  function initPWA() {
    $('#installBtn').addEventListener('click', async () => {
      if (!deferredPrompt) { toast('Tarayıcı menüsünden “Ana ekrana ekle” seçeneğini kullanabilirsiniz.'); return; }
      deferredPrompt.prompt();
      const res = await deferredPrompt.userChoice;
      if (res.outcome === 'accepted') toast('Servet yükleniyor…', 'ok');
      deferredPrompt = null;
      $('#installBtn').hidden = true;
    });
    // ?nosw ile önbellek devre dışı (geliştirme sırasında yeni dosyaları görmek için)
    if (location.search.includes('nosw')) {
      navigator.serviceWorker && navigator.serviceWorker.getRegistrations()
        .then(rs => rs.forEach(r => r.unregister()));
      if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k)));
    } else if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js').then(reg => {
        // Yeni sürüm yüklendiğinde açık sekmeyi bilgilendir
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing;
          if (!sw) return;
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast('Yeni sürüm hazır.', 'ok', {
                label: 'Yenile', sticky: true,
                run: () => { sw.postMessage('skipWaiting'); location.reload(); }
              });
            }
          });
        });
        setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
      }).catch(err => console.warn('[Servet] SW kaydı başarısız:', err));
    }
    const setOnline = () => { $('#offlineBadge').hidden = navigator.onLine; };
    window.addEventListener('online', () => { setOnline(); toast('Yeniden çevrimiçi.', 'ok'); });
    window.addEventListener('offline', () => { setOnline(); toast('Çevrimdışı moddasınız — kayıtlı verilerle çalışılıyor.'); });
    setOnline();
  }

  /* ================= Başlangıç ================= */
  function init() {
    applyTheme();
    bootSplash();
    initPWA();

    window.addEventListener('hashchange', navigate);
    $('#navToggle').addEventListener('click', () =>
      $('#sidenav').classList.contains('open') ? closeNav() : openNav());
    $('#scrim').addEventListener('click', closeNav);
    $('#addAssetBtn').addEventListener('click', () => openAssetForm());
    $('#refreshBtn').addEventListener('click', () => doRefresh(true));

    // Klavye kısayolları
    document.addEventListener('keydown', e => {
      if (e.target.matches('input,select,textarea')) return;
      if (e.key === 'n' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); openAssetForm(); }
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); doRefresh(true); }
    });

    navigate();

    // İlk açılış: kurulum testi (yoğun formu doldurmadan portföy kurma)
    if (!S.settings.onboarded && !S.assets.length) {
      setTimeout(() => Onboard.open(appUI), S.settings.showSplash && !sessionStorage.getItem('servet.obShown') ? 2400 : 400);
      sessionStorage.setItem('servet.obShown', '1');
    }

    // Açılışta arka planda veri tazele
    Market.refreshBanks(false);
    Market.refreshRates(false).then(() => {
      updateTopbar();
      if (routeOf() !== 'settings') navigate();
      return Market.refreshPrices(false);
    }).then(res => {
      S.takeSnapshot();
      updateTopbar();
      // Fiyatlar değiştiyse açık ekranı yeniden çiz — aksi halde tabloda
      // eski fiyatlar görünmeye devam ediyordu.
      if (res && res.updated) {
        navigate();
        toast(res.updated + ' varlığın fiyatı güncellendi.', 'ok');
      }
      if (res && res.failed && res.failed.length) {
        toast('Fiyatı alınamayanlar: ' + res.failed.join(', '), 'err');
      }
      checkAlerts();
    }).catch(err => console.warn('[Servet] Açılış tazelemesi:', err));
  }

  /* Şifreli veri varsa önce kilit çözülür; Store yeniden okunur. */
  function boot() {
    if (window.__servetBootGate) {
      window.__servetBootGate.then(() => {
        Store.reload();          // çözülen düz metni oku
        Lock.attach();
        delete document.documentElement.dataset.locked;
        init();
      });
    } else {
      if (window.Lock && Lock.isEnabled()) Lock.attach();
      init();
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
