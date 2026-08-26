/* =====================================================================
   smoke.js — Tarayıcı duman testi (arayüz regresyon kontrolü)
   Kullanım: uygulamayı açın, DevTools konsoluna bu dosyanın içeriğini
   yapıştırıp `await smoke()` çalıştırın. Her sayfayı gezer, her modalı
   açar ve yakalanan hataları listeler.
   ===================================================================== */
window.smoke = async function smoke() {
  if (window.__smokeRunning) { console.warn('Duman testi zaten çalışıyor.'); return []; }
  window.__smokeRunning = true;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const errors = [];
  const onErr = e => errors.push((e.error && e.error.message) || e.message);
  window.addEventListener('error', onErr);
  const origError = console.error;
  console.error = (...a) => { errors.push(a.join(' ')); origError(...a); };

  const step = async (name, fn) => {
    const before = errors.length;
    try { await fn(); } catch (e) { errors.push(name + ': ' + e.message); }
    await sleep(220);
    const ok = errors.length === before;
    console.log((ok ? '✔ ' : '✘ ') + name);
    return ok;
  };

  const q = s => document.querySelector(s);
  /* Seçici görünene kadar bekler (zamanlama yarışlarını önler) */
  const bekle = async (sel, ms = 2000) => {
    const son = Date.now() + ms;
    while (Date.now() < son) { const el = q(sel); if (el) return el; await sleep(60); }
    return null;
  };
  // İlk açılış sihirbazı testin üstüne binmesin
  Store.settings.onboarded = true; Store.save();
  const seeded = Store.assets.length > 0;
  if (!seeded) Store.seedDemo();
  await sleep(2600);                       // varsa açılmış sihirbazı kapat
  while (document.querySelector('#modalRoot > *')) { closeModal(); await sleep(80); }

  console.log('--- Sayfalar ---');
  for (const [hash, name] of [['#/', 'Ana sayfa'], ['#/assets', 'Varlıklar'],
      ['#/stats', 'İstatistik'], ['#/history', 'Geçmiş'], ['#/settings', 'Ayarlar']]) {
    await step(name, async () => { location.hash = hash; await sleep(350); });
  }

  console.log('--- Modallar ---');
  await step('Varlık ekleme formu', async () => {
    q('#addAssetBtn').click(); await sleep(300);
    if (!q('#fName')) throw new Error('form açılmadı');
    if (!q('#symbolWrap')) throw new Error('sembol alanı yok');
  });
  await step('Sembol seçici', async () => {
    q('[data-picker="symbol"]').click(); await sleep(250);
    if (!q('#pkSearch')) throw new Error('seçici açılmadı');
    q('#pkSearch').value = 'a'; q('#pkSearch').dispatchEvent(new Event('input')); await sleep(150);
    closeModal();
  });
  await step('Kurum seçici', async () => {
    [...document.querySelectorAll('#kindChips .chip')].find(c => c.dataset.kind === 'bank').click();
    await sleep(150);
    q('[data-picker="loc"]').click(); await sleep(250);
    if (!q('#pkSearch')) throw new Error('seçici açılmadı');
    closeModal(); await sleep(150); closeModal();
  });
  await step('Tüm varlık türleri için form', async () => {
    for (const t of DATA.ASSET_TYPES) {
      q('#addAssetBtn').click(); await sleep(120);
      const chip = [...document.querySelectorAll('#typeChips .chip')].find(c => c.dataset.type === t.id);
      chip.click(); await sleep(80);
      if (!q('#fQty')) throw new Error(t.id + ': miktar alanı yok');
      closeModal(); await sleep(60);
    }
  });
  await step('Satış formu', async () => {
    location.hash = '#/assets'; await sleep(300);
    q('[data-act="sell"]').click(); await sleep(250);
    if (!q('#sQty') || !q('#sTo')) throw new Error('satış formu eksik');
    closeModal();
  });
  await step('Alım (lot) formu', async () => {
    location.hash = '#/assets'; await sleep(300);
    q('[data-act="buy"]').click(); await sleep(250);
    if (!q('#bQty') || !q('#bPreview')) throw new Error('alım formu eksik');
    closeModal();
  });
  await step('Alım listesi (satır menüsünden)', async () => {
    location.hash = '#/assets'; await sleep(300);
    (await bekle('[data-menu]')).click();
    const link = await bekle('.menu [data-m="lots"]');
    if (!link) throw new Error('alımlar düğmesi yok');
    link.click();
    if (!await bekle('.modal')) throw new Error('alım listesi açılmadı');
    closeModal();
  });
  await step('Satır menüsü ekran içinde kalıyor', async () => {
    location.hash = '#/assets'; await sleep(300);
    const btns = document.querySelectorAll('[data-menu]');
    const btn = btns[btns.length - 1];     // en alttaki satır: yukarı açılmalı
    btn.click();
    const m = await bekle('.menu');
    if (!m) throw new Error('menü açılmadı');
    await sleep(250);                      // giriş animasyonu bitsin
    const r = m.getBoundingClientRect();
    if (r.bottom > innerHeight + 2 || r.right > innerWidth + 2 || r.top < -2)
      throw new Error('menü ekran dışına taştı');
    document.body.click(); await sleep(150);
    if (document.querySelector('.menu')) throw new Error('dışarı tıklamada kapanmadı');
  });
  await step('Getiri formu', async () => {
    location.hash = '#/assets'; await sleep(300);
    const menu = q('[data-menu]');
    if (!menu) throw new Error('satır menüsü yok');
    menu.click(); await sleep(250);
    const açık = document.querySelectorAll('.menu');
    if (açık.length !== 1) throw new Error(açık.length + ' menü aynı anda açık');
    const b = q('.menu [data-m="income"]');
    if (!b) throw new Error('getiri düğmesi yok');
    b.click(); await sleep(350);
    if (!q('#iAmount') || !q('#iKind')) throw new Error('getiri formu eksik');
    closeModal();
  });
  await step('Hedef dağılım formu', async () => {
    location.hash = '#/stats'; await sleep(400);
    const b = q('[data-act="targets"]');
    if (!b) throw new Error('hedef düğmesi yok');
    b.click(); await sleep(300);
    if (!q('#tgSave')) throw new Error('hedef formu açılmadı');
    closeModal();
  });
  await step('İşlem ekleme formu', async () => {
    location.hash = '#/history'; await sleep(300);
    q('[data-act="manual"]').click(); await sleep(250);
    if (!q('#tType')) throw new Error('işlem formu açılmadı');
    closeModal();
  });
  await step('QR gönderme', async () => {
    location.hash = '#/settings'; await sleep(350);
    q('[data-act="qrSend"]').click(); await sleep(600);
    if (!q('#qrBox svg')) throw new Error('QR üretilmedi');
    closeModal();
  });
  await step('Kurulum testi', async () => {
    Onboard.open({ openModal: window.__openModal || null } && {
      openModal: (h, o) => { const d = document.createElement('div'); d.className = 'modal-back';
        d.innerHTML = '<div class="modal">' + h + '</div>'; document.getElementById('modalRoot').appendChild(d); return d; },
      closeModal: () => { const m = document.getElementById('modalRoot').lastElementChild; if (m) m.remove(); },
      toast: () => {}, openSymbolPicker: () => {}, openLocationPicker: () => {}, afterImport: () => {}
    });
    await sleep(250);
    if (!q('#obNext')) throw new Error('kurulum testi açılmadı');
    q('#obSkip').click();
  });

  await step('Geçmiş: not düzeltme', async () => {
    location.hash = '#/history'; await sleep(350);
    const b = q('[data-act="editTx"]');
    if (!b) throw new Error('not düzeltme düğmesi yok');
    b.click(); await sleep(250);
    if (!q('#txNote')) throw new Error('not formu açılmadı');
    closeModal();
  });

  console.log('--- Hesaplar ---');
  await step('Toplamlar sayı döndürüyor', async () => {
    const t = Store.totals();
    if (!isFinite(t.value) || !isFinite(t.pl)) throw new Error('toplam NaN');
  });
  await step('FIFO maliyet önizlemesi', async () => {
    const a = Store.assets.find(x => (x.lots || []).length);
    if (!a) return;
    const pv = Store.previewCost(a.id, Math.min(1, a.quantity), 'fifo');
    if (!pv || !isFinite(pv.costBasis)) throw new Error('maliyet hesaplanamadı');
  });
  await step('Hedef dağılım hesabı', async () => {
    const p2 = Store.rebalancePlan();
    if (p2.active && !isFinite(p2.drift)) throw new Error('sapma NaN');
  });
  await step('Toplam & reel getiri hesabı', async () => {
    const tr = Store.totalReturn();
    if (!isFinite(tr.gain)) throw new Error('toplam getiri NaN');
    Store.realReturn(tr.pct, 1);              // hata fırlatmamalı
    Store.maturities(7);
  });
  await step('Şifreleme tur testi', async () => {
    if (!Lock.supported()) return;
    const blob = await Lock.encryptText('{"a":1}', 'test1234');
    const back2 = await Lock.decryptText(blob, 'test1234');
    if (back2 !== '{"a":1}') throw new Error('şifreleme turu bozuk');
  });
  await step('Seri para birimi dönüşümü', async () => {
    const a = Store.series(30, 'TRY'), b = Store.series(30, 'USD');
    if (a.length !== b.length) throw new Error('seri uzunlukları farklı');
  });

  window.removeEventListener('error', onErr);
  console.error = origError;
  window.__smokeRunning = false;
  console.log(errors.length ? `\n${errors.length} HATA:\n- ` + errors.join('\n- ')
                            : '\nTüm duman testleri temiz.');
  return errors;
};
