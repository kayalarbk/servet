/* =====================================================================
   store.js — Veri katmanı
   Tüm veriler localStorage üzerinde, yalnızca kullanıcının cihazında
   saklanır. Sunucuya hiçbir kişisel veri gönderilmez.
   Şema sürümlenmiştir; ileride migration eklenebilir.
   ===================================================================== */
window.Store = (function () {
  'use strict';

  const KEY = 'servet.v1';
  const SCHEMA = 1;

  const uid = () =>
    (Date.now().toString(36) + Math.random().toString(36).slice(2, 8)).toUpperCase();

  /* Sayı ayrıştırma: Türkçe klavyede yazılan "1,5" ve "1.234,5" biçimleri
     de kabul edilir. Boş/geçersiz girdi için NaN döner. */
  function parseNum(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    let t = String(v).trim();
    if (!t) return NaN;
    t = t.replace(/\s/g, '').replace(/[₺$€£]/g, '');
    const hasComma = t.includes(','), dots = (t.match(/\./g) || []).length;
    if (hasComma) {
      // Virgül ondalık ayırıcıdır; noktalar binlik ayırıcıdır (1.234,56)
      t = t.replace(/\./g, '').replace(',', '.');
    } else if (dots > 1) {
      t = t.replace(/\./g, '');                      // 1.234.567
    } else if (dots === 1 && /^\d{1,3}\.\d{3}$/.test(t)) {
      t = t.replace('.', '');                        // "7.200" → 7200 (TR binlik)
    }
    const n = Number(t);
    return isFinite(n) ? n : NaN;
  }
  const isBlank = v => v === '' || v == null;

  const nowISO = () => new Date().toISOString();
  const todayISO = () => new Date().toISOString().slice(0, 10);

  /* ---------------- Varsayılan durum ---------------- */
  function defaults() {
    return {
      schema: SCHEMA,
      profile: { name: '', email: '', createdAt: nowISO() },
      settings: {
        baseCurrency: 'TRY',
        theme: 'navy-gold',
        locale: 'tr-TR',
        autoPrices: true,          // piyasa fiyatı çekimi — daima açık (ayar kaldırıldı)
        stockPrices: true,         // hisse/ETF fiyatı — daima açık (ayar kaldırıldı)
        autoRates: true,           // döviz kuru çekimi — daima açık (ayar kaldırıldı)
        assetTypes: [],            // kurulum testinde seçilen türler; boş = tümü
        showSplash: true,          // giriş animasyonu
        compactNumbers: false,
        notifications: { priceAlerts: true, priceThreshold: 5, rebalance: false, weeklySummary: true },
        inflationRate: null,       // yıllık TÜFE (%) — reel getiri için; null = otomatik çek
        rebalanceTargets: {},      // { assetTypeId: yüzde }
        snapshotDaily: true,
        onboarded: false,          // kurulum testi tamamlandı mı
        costMethod: 'fifo',        // satışta maliyet: 'fifo' | 'average'
        lastBackupAt: 0,           // son JSON yedeğinin zamanı
        backupReminder: true
      },
      assets: [],
      sales: [],                   // kapanan/kısmi satışlar (gerçekleşen K/Z)
      income: [],                  // temettü / faiz / kira gibi nakit getiriler
      transactions: [],
      snapshots: [],               // [{date:'YYYY-MM-DD', total:number, byType:{}, byLocation:{}}]
      customLists: { banks: [], platforms: [], custody: [] },
      cache: {
        banks: null, banksAt: 0, banksSource: 'yerel',
        rates: null, ratesAt: 0, ratesSource: 'yerel',
        cpi: null, cpiAt: 0,
        tr: null, trAt: 0, trUpdate: '',
        prices: {}, pricesAt: 0, stocks: {}, sources: {}
      }
    };
  }

  /* ---------------- Yükleme / kaydetme ---------------- */
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return defaults();
      const parsed = JSON.parse(raw);
      return migrate(deepMerge(defaults(), parsed));
    } catch (e) {
      // Veriyi asla sessizce kaybetme: bozuk kaydı yedekleyip kullanıcıyı uyar.
      console.error('[Servet] Kayıtlı veri okunamadı, yedeklendi.', e);
      try { localStorage.setItem(KEY + '.bozuk', localStorage.getItem(KEY) || ''); } catch (_) {}
      setTimeout(() => emitError('Kayıtlı veri okunamadı. Bozuk kopya "servet.v1.bozuk" anahtarında saklandı.'), 500);
      return defaults();
    }
  }

  /* Sürüm geçişleri: eski kayıtları güncel kurallara uydurur.
     Kur ve piyasa fiyatı çekimi artık kapatılamaz (Ayarlar'daki anahtarlar
     kaldırıldı); eskiden kapatmış kullanıcılarda veri sessizce eskimesin. */
  function migrate(s) {
    s.settings.autoRates = true;
    s.settings.autoPrices = true;
    s.settings.snapshotDaily = true;   // günlük kayıt artık her değişiklikte otomatik
    s.settings.stockPrices = true;     // hisse fiyatı çekimi artık ayar değil
    if (!Array.isArray(s.settings.assetTypes)) s.settings.assetTypes = [];
    s.settings.assetTypes = s.settings.assetTypes
      .filter(id => DATA.ASSET_TYPES.some(t => t.id === id));
    return s;
  }

  function deepMerge(base, over) {
    if (over === undefined) return base;
    // Yalnızca iki taraf da düz nesneyse derin birleştir; aksi halde kayıtlı değer kazanır.
    const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    if (!plain(base) || !plain(over)) return over;
    const out = Object.assign({}, base);
    for (const k of Object.keys(over)) {
      out[k] = (k in base) ? deepMerge(base[k], over[k]) : over[k];
    }
    return out;
  }

  let saveTimer = null;
  let dirty = false;
  const listeners = new Set();

  // Anında yaz (sekme kapanırken veya kritik anlarda)
  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!dirty) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      dirty = false;
    } catch (e) {
      console.error('[Servet] Kayıt başarısız (depolama dolu olabilir).', e);
      emitError('Veriler kaydedilemedi. Tarayıcı depolama alanı dolmuş olabilir.');
    }
  }

  function save(silent) {
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 80);
    if (!silent) listeners.forEach(fn => fn(state));
  }

  // Sekme kapanır/arka plana alınırsa bekleyen yazmayı kaybetme
  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
  }

  function emitError(msg) {
    window.dispatchEvent(new CustomEvent('servet:error', { detail: msg }));
  }

  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };

  /* Depodan yeniden oku (PIN ile çözülen veriyi almak için) */
  function reload() { state = load(); listeners.forEach(fn => fn(state)); return state; }

  /* ---------------- Doğrulama ---------------- */
  function validateAsset(a) {
    const errors = {};
    if (!a.name || !a.name.trim()) errors.name = 'Varlık adı zorunludur.';
    else if (a.name.trim().length > 80) errors.name = 'En fazla 80 karakter.';
    if (!DATA.ASSET_TYPES.some(t => t.id === a.type)) errors.type = 'Geçerli bir varlık türü seçin.';
    const q = parseNum(a.quantity);
    if (isBlank(a.quantity)) errors.quantity = 'Miktar girin.';
    else if (isNaN(q) || q < 0) errors.quantity = 'Miktar 0 veya daha büyük bir sayı olmalıdır (örn. 12,5).';
    const p = parseNum(a.unitPrice);
    // Otomatik fiyat açık ve ürün/sembol seçilmişse birim değer boş bırakılabilir:
    // kaydettikten hemen sonra piyasadan çekilir.
    const willFetch = a.autoPrice && (a.symbol || a.type === 'cash');
    if (isBlank(a.unitPrice) && !willFetch) errors.unitPrice = 'Güncel birim değeri girin.';
    else if (!isBlank(a.unitPrice) && (isNaN(p) || p < 0)) errors.unitPrice = 'Birim değer 0 veya daha büyük olmalıdır.';
    if (!isBlank(a.costCurrency) && !DATA.CURRENCIES.some(c => c.code === String(a.costCurrency).toUpperCase())) {
      errors.costCurrency = 'Maliyet para birimi geçersiz.';
    }
    if (!isBlank(a.unitCost) && (isNaN(parseNum(a.unitCost)) || parseNum(a.unitCost) < 0)) {
      errors.unitCost = 'Alış maliyeti geçerli bir sayı olmalıdır.';
    }
    if (!DATA.CURRENCIES.some(c => c.code === a.currency)) errors.currency = 'Para birimi seçin.';
    const loc = a.location || {};
    if (!DATA.LOCATION_KINDS.some(k => k.id === loc.kind)) errors.locationKind = 'Saklama yeri seçin.';
    const kind = DATA.locationKind(loc.kind);
    if (kind.needsName && !(loc.name || '').trim()) errors.locationName = 'Kurum / yer adı seçin veya yazın.';
    if (a.acquiredAt && isNaN(Date.parse(a.acquiredAt))) errors.acquiredAt = 'Geçerli bir tarih girin.';
    if (a.acquiredAt && a.acquiredAt > todayISO()) errors.acquiredAt = 'Gelecek bir tarih girilemez.';
    return errors;
  }

  /* ---------------- Varlık CRUD ---------------- */
  function normalize(a) {
    return {
      id: a.id || uid(),
      name: (a.name || '').trim(),
      type: a.type,
      symbol: (a.symbol || '').trim().toUpperCase(),
      quantity: parseNum(a.quantity) || 0,
      unit: a.unit || DATA.assetType(a.type).unit,
      unitPrice: parseNum(a.unitPrice) || 0,
      unitCost: isBlank(a.unitCost) ? null : (parseNum(a.unitCost) || 0),
      // Maliyetin tutulduğu para birimi. Boşsa varlığın kendi para birimi geçerlidir.
      // Döviz nakitte "1 USD kaç TRY'ye alındı" bilgisini taşımak için gerekir;
      // aksi halde 1000 USD'nin maliyeti daima 1000 USD olur ve kur kârı görünmez.
      costCurrency: isBlank(a.costCurrency) ? null : String(a.costCurrency).toUpperCase(),
      currency: a.currency,
      acquiredAt: a.acquiredAt || null,
      location: {
        kind: a.location.kind,
        name: (a.location.name || '').trim(),
        account: (a.location.account || '').trim()
      },
      autoPrice: !!a.autoPrice,
      maturityDate: a.maturityDate || null,          // vadeli mevduat / tahvil vadesi
      interestRate: isBlank(a.interestRate) ? null : parseNum(a.interestRate),
      lots: Array.isArray(a.lots) ? a.lots : [],
      notes: (a.notes || '').trim(),
      createdAt: a.createdAt || nowISO(),
      updatedAt: nowISO()
    };
  }

  function addAsset(input) {
    const asset = normalize(input);
    ensureLots(asset);
    state.assets.push(asset);
    logTx({
      type: 'create', assetId: asset.id, assetName: asset.name,
      quantity: asset.quantity, unitPrice: asset.unitPrice, currency: asset.currency,
      amount: asset.quantity * asset.unitPrice,
      locationTo: locLabel(asset.location),
      note: 'Varlık portföye eklendi.'
    });
    rememberCustom(asset.location);
    save();
    return asset;
  }

  function updateAsset(id, input) {
    const i = state.assets.findIndex(a => a.id === id);
    if (i < 0) return null;
    const prev = state.assets[i];
    const next = normalize(Object.assign({}, prev, input, { id, createdAt: prev.createdAt }));
    state.assets[i] = next;

    const moved = locLabel(prev.location) !== locLabel(next.location);
    const qtyChanged = prev.quantity !== next.quantity;
    const priceChanged = prev.unitPrice !== next.unitPrice;

    if (moved) {
      logTx({
        type: 'transfer', assetId: id, assetName: next.name,
        quantity: next.quantity, unitPrice: next.unitPrice, currency: next.currency,
        amount: next.quantity * next.unitPrice,
        locationFrom: locLabel(prev.location), locationTo: locLabel(next.location),
        note: 'Saklama yeri değiştirildi.'
      });
    }
    if (qtyChanged) {
      const diff = next.quantity - prev.quantity;
      logTx({
        type: diff > 0 ? 'buy' : 'sell', assetId: id, assetName: next.name,
        quantity: Math.abs(diff), unitPrice: next.unitPrice, currency: next.currency,
        amount: Math.abs(diff) * next.unitPrice,
        locationTo: locLabel(next.location),
        note: `Miktar ${fmtNum(prev.quantity)} → ${fmtNum(next.quantity)} ${next.unit}`
      });
    }
    if (priceChanged && !qtyChanged && !moved) {
      logTx({
        type: 'valuation', assetId: id, assetName: next.name,
        quantity: next.quantity, unitPrice: next.unitPrice, currency: next.currency,
        amount: next.quantity * next.unitPrice,
        locationTo: locLabel(next.location),
        note: `Birim değer ${fmtNum(prev.unitPrice)} → ${fmtNum(next.unitPrice)} ${next.currency}`
      });
    }
    if (!moved && !qtyChanged && !priceChanged) {
      logTx({ type: 'update', assetId: id, assetName: next.name, currency: next.currency,
              amount: next.quantity * next.unitPrice, note: 'Varlık bilgileri güncellendi.' });
    }
    rememberCustom(next.location);
    save();
    return next;
  }

  function removeAsset(id) {
    const i = state.assets.findIndex(a => a.id === id);
    if (i < 0) return false;
    const a = state.assets[i];
    state.assets.splice(i, 1);
    logTx({
      type: 'delete', assetId: id, assetName: a.name, quantity: a.quantity,
      unitPrice: a.unitPrice, currency: a.currency, amount: a.quantity * a.unitPrice,
      locationFrom: locLabel(a.location), note: 'Varlık portföyden silindi.'
    });
    save();
    return true;
  }

  function getAsset(id) { return state.assets.find(a => a.id === id) || null; }

  /* ---------------- Getiri kayıtları (temettü / faiz / kira) ----------------
     Fiyat artışından bağımsız nakit getiriler. Toplam getiri hesabına ve
     istenirse doğrudan bir nakit hesabına eklenir. */
  const INCOME_KINDS = [
    { id: 'dividend', name: 'Temettü', icon: '💰' },
    { id: 'interest', name: 'Faiz / kupon', icon: '🏦' },
    { id: 'rent',     name: 'Kira geliri', icon: '🏠' },
    { id: 'staking',  name: 'Stake / ödül', icon: '🪙' },
    { id: 'other',    name: 'Diğer getiri', icon: '✨' }
  ];

  function validateIncome(input) {
    const errors = {};
    const amt = parseNum(input.amount);
    if (isBlank(input.amount)) errors.amount = 'Tutar girin.';
    else if (isNaN(amt) || amt <= 0) errors.amount = 'Tutar sıfırdan büyük olmalıdır.';
    if (input.date && input.date > todayISO()) errors.date = 'Gelecek bir tarih girilemez.';
    if (!INCOME_KINDS.some(k => k.id === input.kind)) errors.kind = 'Getiri türü seçin.';
    return errors;
  }

  function addIncome(assetId, input) {
    const a = assetId ? getAsset(assetId) : null;
    const amount = parseNum(input.amount);
    const currency = input.currency || (a ? a.currency : state.settings.baseCurrency);
    const date = input.date || todayISO();
    const rec = {
      id: uid(), assetId: a ? a.id : null, name: a ? a.name : (input.name || 'Serbest getiri'),
      type: a ? a.type : 'other', kind: input.kind || 'other',
      amount, currency, date, at: nowISO(), note: (input.note || '').trim(), toCashId: null
    };

    // İstenirse nakit hesabına ekle
    const to = input.toCash;
    if (to && to.mode !== 'none') {
      let cash = to.mode === 'asset' ? getAsset(to.id) : null;
      if (to.mode === 'new' || !cash) {
        cash = normalize({
          name: DATA.currency(currency).name + ' (getiri)', type: 'cash', symbol: '',
          quantity: 0, unit: 'birim', unitPrice: 1, unitCost: 1, currency,
          acquiredAt: date, autoPrice: false, notes: 'Getiri kayıtlarından oluşturuldu.',
          location: (a && a.location) || { kind: 'physical', name: '', account: '' }
        });
        state.assets.push(cash);
      }
      const added = convert(amount, currency, cash.currency);
      if (isFinite(added) && added > 0) {
        cash.quantity = Math.round((cash.quantity + added) * 1e8) / 1e8;
        cash.updatedAt = nowISO();
        rec.toCashId = cash.id;
      }
    }

    state.income.unshift(rec);
    logTx({
      type: 'income', assetId: rec.assetId, assetName: rec.name, amount, currency, date,
      locationTo: rec.toCashId ? locLabel(getAsset(rec.toCashId).location) : '',
      note: `${INCOME_KINDS.find(k => k.id === rec.kind).name} kaydedildi.` +
            (rec.toCashId ? ' Nakde eklendi.' : '') + (rec.note ? ' — ' + rec.note : '')
    });
    save();
    return rec;
  }

  function deleteIncome(id) {
    const i = state.income.findIndex(x => x.id === id);
    if (i < 0) return false;
    state.income.splice(i, 1);
    save();
    return true;
  }

  /* Getiri toplamları (raporlama para biriminde) */
  function incomeTotals(cur, days) {
    const c = cur || state.settings.baseCurrency;
    const from = days ? new Date(Date.now() - days * 864e5).toISOString().slice(0, 10) : null;
    let total = 0;
    const byKind = {};
    const byAsset = {};
    for (const r of state.income) {
      if (from && r.date < from) continue;
      const v = convert(r.amount, r.currency, c);
      if (isNaN(v)) continue;
      total += v;
      byKind[r.kind] = (byKind[r.kind] || 0) + v;
      if (r.assetId) byAsset[r.assetId] = (byAsset[r.assetId] || 0) + v;
    }
    return { total, byKind, byAsset, count: state.income.length, currency: c };
  }

  /* Toplam getiri: fiyat değişimi + gerçekleşen K/Z + nakit getiriler */
  function totalReturn(cur) {
    const c = cur || state.settings.baseCurrency;
    const t = totals(c);
    const r = realizedTotals(c);
    const inc = incomeTotals(c);
    const gain = t.pl + r.realized + inc.total;
    const base = t.cost;
    return {
      unrealized: t.pl, realized: r.realized, income: inc.total,
      gain, base, pct: base > 0 ? gain / base * 100 : null, currency: c
    };
  }

  /* ---------------- Alım lotları (FIFO / ortalama maliyet) ----------------
     Her alım ayrı bir lot olarak saklanır. Kısmi satışta hangi lotun
     tüketileceğini settings.costMethod belirler:
       fifo    → en eski lottan başlar (varsayılan, vergi hesabına yakın)
       average → tüm lotların ağırlıklı ortalaması kullanılır          */

  /* Eski kayıtlar için tek seferlik lot üretimi */
  function ensureLots(a) {
    if (Array.isArray(a.lots) && a.lots.length) return a.lots;
    a.lots = [];
    if (a.quantity > 0 && a.unitCost != null) {
      a.lots.push({
        id: uid(), date: a.acquiredAt || (a.createdAt || nowISO()).slice(0, 10),
        quantity: a.quantity, unitCost: a.unitCost, note: 'İlk kayıt'
      });
    }
    return a.lots;
  }

  const lotQty = a => (a.lots || []).reduce((n, l) => n + l.quantity, 0);

  /* Kalan lotların ağırlıklı ortalama maliyeti */
  function avgCost(a) {
    const lots = a.lots || [];
    const q = lotQty(a);
    if (!q) return a.unitCost;
    return lots.reduce((n, l) => n + l.quantity * l.unitCost, 0) / q;
  }

  function syncFromLots(a) {
    const q = lotQty(a);
    if (!q) return;
    a.unitCost = Math.round(avgCost(a) * 1e6) / 1e6;
  }

  function validateLot(asset, input) {
    const errors = {};
    const q = parseNum(input.quantity);
    if (isBlank(input.quantity)) errors.quantity = 'Alınan miktarı girin.';
    else if (isNaN(q) || q <= 0) errors.quantity = 'Miktar sıfırdan büyük olmalıdır.';
    const c = parseNum(input.unitCost);
    if (isBlank(input.unitCost)) errors.unitCost = 'Birim alış fiyatını girin.';
    else if (isNaN(c) || c < 0) errors.unitCost = 'Alış fiyatı geçerli olmalıdır.';
    if (input.date && input.date > todayISO()) errors.date = 'Gelecek bir tarih girilemez.';
    return errors;
  }

  /* Yeni alım: miktarı artırır, lotu ekler, ortalama maliyeti günceller */
  function addLot(assetId, input) {
    const a = getAsset(assetId);
    if (!a) return null;
    ensureLots(a);
    const qty = parseNum(input.quantity);
    const cost = parseNum(input.unitCost);
    const date = input.date || todayISO();
    const lot = { id: uid(), date, quantity: qty, unitCost: cost, note: (input.note || '').trim() };
    a.lots.push(lot);
    a.lots.sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    a.quantity = Math.round((a.quantity + qty) * 1e8) / 1e8;
    syncFromLots(a);
    a.updatedAt = nowISO();
    logTx({
      type: 'buy', assetId: a.id, assetName: a.name, quantity: qty, unitPrice: cost,
      currency: a.currency, amount: qty * cost, date, locationTo: locLabel(a.location),
      note: `Yeni alım eklendi. Ortalama maliyet ${fmtMoney(a.unitCost, a.currency)}.` +
            (input.note ? ' — ' + input.note : '')
    });
    save();
    return lot;
  }

  function removeLot(assetId, lotId) {
    const a = getAsset(assetId);
    if (!a || !a.lots) return false;
    const i = a.lots.findIndex(l => l.id === lotId);
    if (i < 0) return false;
    const lot = a.lots[i];
    a.lots.splice(i, 1);
    a.quantity = Math.max(0, Math.round((a.quantity - lot.quantity) * 1e8) / 1e8);
    syncFromLots(a);
    a.updatedAt = nowISO();
    save();
    return true;
  }

  /* Satışta lotları tüketir; maliyet esasını ve tüketim dökümünü döndürür */
  function consumeLots(a, qty, method) {
    ensureLots(a);
    if (!a.lots.length) {
      return { costBasis: a.unitCost == null ? null : qty * a.unitCost, breakdown: [] };
    }
    const m = method || state.settings.costMethod || 'fifo';
    if (m === 'average') {
      const avg = avgCost(a);
      let left = qty;
      // Ortalama yöntemde lotlar orantılı azaltılır
      const total = lotQty(a);
      a.lots.forEach(l => { l.quantity = Math.max(0, l.quantity * (1 - qty / (total || 1))); });
      a.lots = a.lots.filter(l => l.quantity > 1e-9);
      return { costBasis: qty * avg, breakdown: [{ date: '—', quantity: qty, unitCost: avg }] };
    }
    // FIFO
    let left = qty, cost = 0;
    const breakdown = [];
    const sorted = a.lots.slice().sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    for (const l of sorted) {
      if (left <= 1e-9) break;
      const take = Math.min(l.quantity, left);
      cost += take * l.unitCost;
      breakdown.push({ date: l.date, quantity: take, unitCost: l.unitCost });
      l.quantity = Math.round((l.quantity - take) * 1e8) / 1e8;
      left -= take;
    }
    a.lots = a.lots.filter(l => l.quantity > 1e-9);
    // Lotlar yetmediyse kalan miktar ortalama maliyetle kapatılır
    if (left > 1e-9) {
      const fallback = a.unitCost == null ? 0 : a.unitCost;
      cost += left * fallback;
      breakdown.push({ date: '—', quantity: left, unitCost: fallback });
    }
    return { costBasis: cost, breakdown };
  }

  /* Satış öncesi maliyet önizlemesi (lotları değiştirmez) */
  function previewCost(assetId, qty, method) {
    const a = getAsset(assetId);
    if (!a) return null;
    const clone = { lots: (a.lots || []).map(l => Object.assign({}, l)), unitCost: a.unitCost, quantity: a.quantity };
    return consumeLots(clone, qty, method);
  }

  /* ---------------- Satış (gerçekleşen kâr/zarar) ----------------
     Kısmi satışta miktar azalır; tamamı satılırsa varlık portföyden
     çıkar ve "satılanlar" listesine kapanmış pozisyon olarak geçer. */
  function validateSale(asset, input) {
    const errors = {};
    const q = parseNum(input.quantity);
    if (isBlank(input.quantity)) errors.quantity = 'Satılan miktarı girin.';
    else if (isNaN(q) || q <= 0) errors.quantity = 'Miktar sıfırdan büyük olmalıdır.';
    else if (q > asset.quantity + 1e-9) errors.quantity = `En fazla ${fmtNum(asset.quantity)} ${asset.unit} satabilirsiniz.`;
    const p = parseNum(input.unitPrice);
    if (isBlank(input.unitPrice)) errors.unitPrice = 'Satış fiyatını girin.';
    else if (isNaN(p) || p < 0) errors.unitPrice = 'Satış fiyatı geçerli olmalıdır.';
    if (!isBlank(input.fee) && (isNaN(parseNum(input.fee)) || parseNum(input.fee) < 0)) {
      errors.fee = 'Masraf geçerli bir sayı olmalıdır.';
    }
    if (input.date && input.date > todayISO()) errors.date = 'Gelecek bir tarih girilemez.';
    return errors;
  }

  function sellAsset(id, input) {
    const a = getAsset(id);
    if (!a) return null;
    const qty = parseNum(input.quantity);
    const price = parseNum(input.unitPrice);
    const fee = parseNum(input.fee) || 0;
    const cur = input.currency || a.currency;
    const date = input.date || todayISO();

    const proceeds = convert(qty * price, cur, a.currency) - convert(fee, cur, a.currency);
    const method = input.costMethod || state.settings.costMethod || 'fifo';
    const consumed = consumeLots(a, qty, method);       // lotları tüketir
    // Lot maliyetleri costCurrency cinsindendir; hasılatla aynı birime çevrilir.
    const costBasis = consumed.costBasis == null ? null : costToAssetCur(a, consumed.costBasis);
    const realized = costBasis == null ? null : proceeds - costBasis;
    const closed = qty >= a.quantity - 1e-9;

    const sale = {
      id: uid(), assetId: a.id, name: a.name, type: a.type, symbol: a.symbol,
      quantity: qty, unit: a.unit, unitPrice: price, currency: a.currency,
      proceeds, costBasis, fee: convert(fee, cur, a.currency), realized,
      pct: costBasis ? realized / costBasis * 100 : null,
      date, at: nowISO(), location: locLabel(a.location), closed,
      costMethod: method, lots: consumed.breakdown,
      heldFrom: a.acquiredAt || a.createdAt, note: (input.note || '').trim()
    };
    state.sales.unshift(sale);

    logTx({
      type: 'sell', assetId: a.id, assetName: a.name, quantity: qty, unitPrice: price,
      currency: a.currency, amount: proceeds, date,
      locationFrom: locLabel(a.location),
      note: (closed ? 'Pozisyon tamamen kapatıldı.' : 'Kısmi satış.') +
            (realized == null ? ' Maliyet girilmediği için K/Z hesaplanamadı.'
                              : ` Gerçekleşen K/Z: ${fmtMoney(realized, a.currency)}`) +
            (input.note ? ' — ' + input.note : '')
    });

    if (closed) {
      const i = state.assets.findIndex(x => x.id === id);
      if (i >= 0) state.assets.splice(i, 1);
    } else {
      a.quantity = Math.round((a.quantity - qty) * 1e8) / 1e8;
      syncFromLots(a);                                  // kalan lotların ortalaması
      a.updatedAt = nowISO();
    }

    // Hasılatı nakde çevir: mevcut bir nakit hesabına ekle ya da yenisini aç.
    // input.proceedsTo = {mode:'asset', id} | {mode:'new', location, currency} | {mode:'none'}
    const to = input.proceedsTo || { mode: 'none' };
    sale.proceedsTo = to.mode;
    if (to.mode === 'asset' || to.mode === 'new') {
      let cash = to.mode === 'asset' ? getAsset(to.id) : null;
      if (to.mode === 'new' || !cash) {
        const curNew = (to.currency || a.currency);
        cash = normalize({
          name: DATA.currency(curNew).name + ' (satış hasılatı)',
          type: 'cash', symbol: '', quantity: 0, unit: 'birim',
          unitPrice: 1, unitCost: 1, currency: curNew,
          acquiredAt: date, autoPrice: false,
          notes: 'Satış hasılatından otomatik oluşturuldu.',
          location: to.location || { kind: 'physical', name: '', account: '' }
        });
        state.assets.push(cash);
      }
      const added = convert(proceeds, a.currency, cash.currency);
      if (isFinite(added) && added > 0) {
        cash.quantity = Math.round((cash.quantity + added) * 1e8) / 1e8;
        cash.updatedAt = nowISO();
        sale.cashAssetId = cash.id;
        sale.cashAdded = added;
        logTx({
          type: 'deposit', assetId: cash.id, assetName: cash.name,
          quantity: added, unitPrice: 1, currency: cash.currency, amount: added, date,
          locationTo: locLabel(cash.location),
          note: `${a.name} satışından gelen hasılat nakde eklendi.`
        });
      } else {
        sale.proceedsTo = 'none';   // kur bilinmiyorsa nakde çevirme
      }
    }

    save();
    return sale;
  }

  /* Hasılatın eklenebileceği nakit hesapları */
  const cashAssets = () => state.assets.filter(a => a.type === 'cash');

  /* Gerçekleşen kâr/zarar toplamı (raporlama para biriminde) */
  function realizedTotals(cur) {
    const c = cur || state.settings.baseCurrency;
    let realized = 0, proceeds = 0, known = 0;
    for (const s of state.sales) {
      const p = convert(s.proceeds, s.currency, c);
      if (!isNaN(p)) proceeds += p;
      if (s.realized != null) {
        const r = convert(s.realized, s.currency, c);
        if (!isNaN(r)) { realized += r; known++; }
      }
    }
    return { realized, proceeds, count: state.sales.length, known, currency: c };
  }

  function deleteSale(id) {
    const i = state.sales.findIndex(s => s.id === id);
    if (i < 0) return false;
    state.sales.splice(i, 1);
    save();
    return true;
  }


  /* ---------------- İşlem günlüğü ---------------- */
  function logTx(tx) {
    state.transactions.unshift(Object.assign({
      id: uid(), at: nowISO(), date: todayISO(),
      quantity: null, unitPrice: null, amount: null,
      locationFrom: '', locationTo: '', note: ''
    }, tx));
    if (state.transactions.length > 5000) state.transactions.length = 5000;
  }

  function addManualTx(tx) {
    logTx(Object.assign({ note: 'Elle eklenen işlem.' }, tx));
    save();
  }

  function clearTransactions() { state.transactions = []; save(); }

  /* Tek bir geçmiş kaydını siler. Varlık/satış verisi etkilenmez —
     yalnızca günlük satırı kaldırılır (nakit akışı grafiğini düzeltmek için). */
  function deleteTx(id) {
    const i = state.transactions.findIndex(t => t.id === id);
    if (i < 0) return false;
    state.transactions.splice(i, 1);
    save();
    return true;
  }

  /* Kaydın notunu düzeltir. */
  function updateTxNote(id, note) {
    const t = state.transactions.find(x => x.id === id);
    if (!t) return false;
    t.note = String(note || '').trim();
    save();
    return true;
  }

  /* ---------------- Özel liste hafızası ---------------- */
  function rememberCustom(loc) {
    if (!loc || !loc.name) return;
    const map = { bank: 'banks', platform: 'platforms', custody: 'custody' };
    const key = map[loc.kind];
    if (!key) return;
    // Market yüklenmemişse (test ortamı veya ağ katmanı hatası) sessizce geç
    const known = (typeof Market !== 'undefined' && Market.listFor) ? Market.listFor(loc.kind) : [];
    if (!known.some(n => n.toLowerCase() === loc.name.toLowerCase())) {
      const arr = state.customLists[key];
      if (!arr.some(n => n.toLowerCase() === loc.name.toLowerCase())) arr.push(loc.name);
    }
  }

  /* ---------------- Değerleme ---------------- */
  const locLabel = loc => {
    if (!loc) return '—';
    const k = DATA.locationKind(loc.kind);
    const parts = [k.name];
    if (loc.name) parts.push(loc.name);
    return parts.join(' · ');
  };

  // Bir tutarı hedef para birimine çevirir. Kurlar TRY tabanlıdır: rates[X] = 1 X kaç TRY.
  function convert(amount, from, to) {
    if (!isFinite(amount)) return 0;
    if (from === to) return amount;
    const r = state.cache.rates || {};
    const fx = c => (c === 'TRY' ? 1 : Number(r[c]) || 0);
    const f = fx(from), t = fx(to);
    if (!f || !t) return NaN;      // kur bilinmiyor
    return amount * f / t;
  }

  /* Otomatik fiyat özeti: kaç varlık takip ediliyor, kaçı eksik yapılandırılmış */
  function autoPriceStatus() {
    const auto = state.assets.filter(a => a.autoPrice);
    const needsSymbol = auto.filter(a => !a.symbol && a.type !== 'cash');

    const eligible = state.assets.filter(a => DATA.assetType(a.type).priceable);
    return {
      auto: auto.length,
      eligible: eligible.length,
      notTracked: eligible.filter(a => !a.autoPrice).length,
      needsSymbol,
      lastAt: state.cache.pricesAt || 0
    };
  }

  const assetValue = (a, cur) => convert(a.quantity * a.unitPrice, a.currency, cur || state.settings.baseCurrency);
  /* Maliyet kendi para biriminden (costCurrency) çevrilir; böylece döviz nakitte
     alış kuru ile bugünkü kur arasındaki fark kâr/zarar olarak görünür. */
  const costCurrency = a => a.costCurrency || a.currency;
  const costToAssetCur = (a, v) => convert(v, costCurrency(a), a.currency);
  const assetCost = (a, cur) =>
    a.unitCost == null ? NaN : convert(a.quantity * a.unitCost, costCurrency(a), cur || state.settings.baseCurrency);

  function totals(cur) {
    const c = cur || state.settings.baseCurrency;
    // valueKnownCost: yalnızca maliyeti girilmiş varlıkların güncel değeri.
    // Kâr/zarar bunun üzerinden hesaplanır; aksi halde maliyetsiz varlıkların
    // tüm değeri kâr gibi görünürdü.
    let value = 0, cost = 0, valueKnownCost = 0;
    const missing = [];
    for (const a of state.assets) {
      const v = assetValue(a, c);
      if (isNaN(v)) { missing.push(a); continue; }
      value += v;
      const k = assetCost(a, c);
      if (!isNaN(k)) { cost += k; valueKnownCost += v; }
    }
    return {
      value, cost,
      pl: cost > 0 ? valueKnownCost - cost : 0,
      plPct: cost > 0 ? (valueKnownCost - cost) / cost * 100 : 0,
      valueKnownCost,
      count: state.assets.length,
      unknownFx: missing.length,
      missingAssets: missing,
      missingCurrencies: [...new Set(missing.map(a => a.currency))],
      currency: c
    };
  }

  /* Kuru bilinmeyen para birimleri (arayüzde uyarı için) */
  function missingRates() {
    const r = state.cache.rates || {};
    const used = new Set(state.assets.map(a => a.currency));
    used.add(state.settings.baseCurrency);
    return [...used].filter(code => code !== 'TRY' && !(Number(r[code]) > 0));
  }

  function groupBy(fn, cur) {
    const c = cur || state.settings.baseCurrency;
    const map = new Map();
    for (const a of state.assets) {
      const v = assetValue(a, c);
      if (isNaN(v)) continue;
      const key = fn(a);
      map.set(key, (map.get(key) || 0) + v);
    }
    return [...map.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((x, y) => y.value - x.value);
  }

  const byType = cur => groupBy(a => DATA.assetType(a.type).name, cur);
  const byLocationKind = cur => groupBy(a => DATA.locationKind(a.location.kind).name, cur);
  const byLocationName = cur => groupBy(a => locLabel(a.location), cur);
  const byCurrency = cur => groupBy(a => a.currency, cur);

  /* ---------------- Vade takibi (mevduat / tahvil) ---------------- */
  function maturities(withinDays) {
    const today = todayISO();
    const limit = withinDays
      ? new Date(Date.now() + withinDays * 864e5).toISOString().slice(0, 10) : null;
    return state.assets
      .filter(a => a.maturityDate)
      .map(a => {
        const days = Math.round((new Date(a.maturityDate) - new Date(today)) / 864e5);
        const value = a.quantity * a.unitPrice;
        // Basit faiz: yıllık oran × kalan gün / 365 (bilgilendirme amaçlı)
        const expected = a.interestRate ? value * (a.interestRate / 100) * (Math.max(0, days) / 365) : null;
        return { asset: a, date: a.maturityDate, days, overdue: days < 0, value, expected };
      })
      .filter(m => !limit || m.date <= limit)
      .sort((x, y) => x.days - y.days);
  }

  /* ---------------- Reel getiri (enflasyondan arındırılmış) ---------------- */
  function inflationRate() {
    const manual = Number(state.settings.inflationRate);
    if (isFinite(manual) && manual > 0) return { rate: manual, source: 'elle girildi' };
    const c = state.cache.cpi;
    return c ? { rate: c.rate, source: c.source + ' · ' + c.year } : null;
  }

  function realReturn(nominalPct, years) {
    const info = inflationRate();
    const infl = info ? info.rate : NaN;
    if (!isFinite(infl) || nominalPct == null) return null;
    const y = years || 1;
    const nominal = Math.pow(1 + nominalPct / 100, 1 / y);
    const price = 1 + infl / 100;
    return (nominal / price - 1) * 100;
  }

  /* ---------------- Hedef dağılım & dengeleme ----------------
     settings.rebalanceTargets: { assetTypeId: yüzde }. Toplam 100 olmak
     zorunda değil; oranlar girilen toplama göre normalize edilir. */
  function rebalancePlan(cur) {
    const c = cur || state.settings.baseCurrency;
    const targets = state.settings.rebalanceTargets || {};
    const keys = Object.keys(targets).filter(k => Number(targets[k]) > 0);
    if (!keys.length) return { active: false, rows: [], drift: 0, currency: c };

    const sum = keys.reduce((a, k) => a + Number(targets[k]), 0);
    const total = totals(c).value;
    const current = {};
    for (const a of state.assets) {
      const v = assetValue(a, c);
      if (isNaN(v)) continue;
      current[a.type] = (current[a.type] || 0) + v;
    }
    // Hedefi olan türler + hedefi olmayıp portföyde bulunanlar
    const all = [...new Set(keys.concat(Object.keys(current)))];
    const rows = all.map(type => {
      const targetPct = keys.includes(type) ? Number(targets[type]) / sum * 100 : 0;
      const value = current[type] || 0;
      const currentPct = total > 0 ? value / total * 100 : 0;
      const targetValue = total * targetPct / 100;
      return {
        type, name: DATA.assetType(type).name, icon: DATA.assetType(type).icon,
        targetPct, currentPct, value, targetValue,
        diff: value - targetValue, diffPct: currentPct - targetPct
      };
    }).sort((a, b) => Math.abs(b.diffPct) - Math.abs(a.diffPct));

    const drift = rows.reduce((a, r) => a + Math.abs(r.diffPct), 0) / 2;   // toplam sapma
    return { active: true, rows, drift, total, currency: c, targetSum: sum };
  }

  function setTargets(map) {
    const out = {};
    for (const [k, v] of Object.entries(map || {})) {
      const n = parseNum(v);
      if (n > 0) out[k] = Math.round(n * 100) / 100;
    }
    state.settings.rebalanceTargets = out;
    save();
    return out;
  }

  /* ---------------- Anlık görüntüler (zaman serisi) ---------------- */
  /* Kayıtlar daima TRY tabanında tutulur; raporlama para birimi değişse bile
     geçmiş bozulmaz (eski kayıtlar kendi `currency` alanıyla çevrilir). */
  /* Örnek portföyle gelen yapay geçmiş, fiyatlar güncellenince gerçek toplamla
     uyumsuz kalır ve grafikte sahte bir sıçrama oluşur. Serinin şeklini
     koruyup ölçeğini bugünkü değere taşıyoruz. */
  function rescaleSynthetic(newTotal) {
    const syn = state.snapshots.filter(x => x.synthetic);
    if (syn.length < 2 || !(newTotal > 0)) return;
    const last = syn[syn.length - 1].total;
    if (!(last > 0)) return;
    const f = newTotal / last;
    if (!isFinite(f) || Math.abs(f - 1) < 0.02) return;
    syn.forEach(x => { x.total = Math.round(x.total * f); });
  }

  function takeSnapshot(force) {
    const d = todayISO();
    const t = totals('TRY');
    if (!t.value && !state.assets.length) return;
    rescaleSynthetic(t.value);
    const rec = {
      date: d, total: Math.round(t.value * 100) / 100, base: 'TRY', currency: 'TRY',
      byType: Object.fromEntries(byType('TRY').map(x => [x.label, Math.round(x.value)])),
      byLocation: Object.fromEntries(byLocationKind('TRY').map(x => [x.label, Math.round(x.value)]))
    };
    const i = state.snapshots.findIndex(s => s.date === d);
    if (i >= 0) state.snapshots[i] = rec;   // aynı gün: üzerine yaz
    else state.snapshots.push(rec);
    state.snapshots.sort((a, b) => a.date.localeCompare(b.date));
    if (state.snapshots.length > 1000) state.snapshots.splice(0, state.snapshots.length - 1000);
    save(true);
  }

  /* Seriyi istenen para birimine çevirerek döndürür. Her kayıt kendi
     tabanından (base/currency) çevrildiği için karışık geçmiş de doğru okunur. */
  function series(days, cur) {
    const c = cur || state.settings.baseCurrency;
    let out = state.snapshots;
    if (days) {
      const from = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
      out = out.filter(s => s.date >= from);
    }
    return out.map(s => {
      const base = s.base || s.currency || 'TRY';
      const v = base === c ? s.total : convert(s.total, base, c);
      return { date: s.date, total: isNaN(v) ? null : v, base, raw: s.total };
    }).filter(s => s.total != null);
  }

  function seriesFrom(dateISO, cur) {
    return series(0, cur).filter(s => s.date >= dateISO);
  }

  function perfOf(list) {
    if (!list || list.length < 2) return { pct: null, abs: null, from: null, to: null };
    const a = list[0].total, b = list[list.length - 1].total;
    return { pct: a ? (b - a) / a * 100 : null, abs: b - a, from: list[0].date, to: list[list.length - 1].date };
  }

  const performance = (days, cur) => perfOf(series(days, cur));
  const performanceSince = (dateISO, cur) => perfOf(seriesFrom(dateISO, cur));

  /* ---------------- Biçimlendirme ---------------- */
  function fmtMoney(v, cur, opts) {
    const c = cur || state.settings.baseCurrency;
    if (v == null || isNaN(v)) return '—';
    const compact = (opts && opts.compact) || (state.settings.compactNumbers && Math.abs(v) >= 1e6);
    try {
      return new Intl.NumberFormat(state.settings.locale, {
        style: 'currency', currency: c === 'GAU' ? 'TRY' : c,
        maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2,
        notation: compact ? 'compact' : 'standard'
      }).format(v).replace('₺', c === 'GAU' ? 'gr ' : '₺');
    } catch (e) {
      return fmtNum(v) + ' ' + c;
    }
  }

  function fmtNum(v, max) {
    if (v == null || isNaN(v)) return '—';
    return new Intl.NumberFormat(state.settings.locale, {
      maximumFractionDigits: max == null ? 8 : max
    }).format(v);
  }

  function fmtPct(v) {
    if (v == null || isNaN(v)) return '—';
    return (v > 0 ? '+' : '') + new Intl.NumberFormat(state.settings.locale,
      { maximumFractionDigits: 2 }).format(v) + '%';
  }

  function fmtDate(d) {
    if (!d) return '—';
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleDateString(state.settings.locale, { day: '2-digit', month: 'short', year: 'numeric' });
  }

  function fmtDateTime(d) {
    const dt = new Date(d);
    if (isNaN(dt)) return '—';
    return dt.toLocaleString(state.settings.locale,
      { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function relTime(d) {
    const diff = Date.now() - new Date(d).getTime();
    const m = Math.round(diff / 6e4);
    if (m < 1) return 'az önce';
    if (m < 60) return m + ' dk önce';
    const h = Math.round(m / 60);
    if (h < 24) return h + ' sa önce';
    const g = Math.round(h / 24);
    if (g < 30) return g + ' gün önce';
    return fmtDate(d);
  }

  /* ---------------- Dışa / içe aktarma ---------------- */
  function markBackedUp() {
    state.settings.lastBackupAt = Date.now();
    save(true);
  }

  /* Yedek gerekiyor mu? (14 günden eski veya hiç alınmamış) */
  function backupStatus() {
    const last = Number(state.settings.lastBackupAt) || 0;
    const days = last ? Math.floor((Date.now() - last) / 864e5) : null;
    return {
      last, days,
      due: !!state.assets.length && state.settings.backupReminder && (!last || days >= 14)
    };
  }

  function exportJSON() {
    return JSON.stringify({
      app: 'Servet', schema: SCHEMA, exportedAt: nowISO(),
      profile: state.profile, settings: state.settings,
      assets: state.assets, sales: state.sales, income: state.income, transactions: state.transactions,
      snapshots: state.snapshots, customLists: state.customLists
    }, null, 2);
  }

  function csvEscape(v) {
    const s = String(v == null ? '' : v);
    return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function exportAssetsCSV() {
    const cur = state.settings.baseCurrency;
    const head = ['Ad', 'Tür', 'Sembol', 'Miktar', 'Birim', 'Birim Değer', 'Para Birimi',
      'Toplam (' + cur + ')', 'Alış Maliyeti', 'Maliyet Para Birimi', 'Kâr/Zarar (' + cur + ')',
      'Saklama Türü', 'Kurum/Yer', 'Hesap', 'Edinme Tarihi', 'Not'];
    const rows = state.assets.map(a => {
      const v = assetValue(a, cur), k = assetCost(a, cur);
      return [a.name, DATA.assetType(a.type).name, a.symbol, a.quantity, a.unit, a.unitPrice,
        a.currency, isNaN(v) ? '' : v.toFixed(2), a.unitCost == null ? '' : a.unitCost,
        costCurrency(a), isNaN(k) || isNaN(v) ? '' : (v - k).toFixed(2),
        DATA.locationKind(a.location.kind).name, a.location.name, a.location.account,
        a.acquiredAt || '', a.notes];
    });
    return '﻿' + [head, ...rows].map(r => r.map(csvEscape).join(';')).join('\r\n');
  }

  function exportTxCSV() {
    const head = ['Tarih', 'Saat', 'İşlem', 'Varlık', 'Miktar', 'Birim Değer', 'Tutar',
      'Para Birimi', 'Kaynak Yer', 'Hedef Yer', 'Not'];
    const rows = state.transactions.map(t => {
      const d = new Date(t.at);
      return [t.date, isNaN(d) ? '' : d.toLocaleTimeString(state.settings.locale),
        DATA.txType(t.type).name, t.assetName || '', t.quantity ?? '', t.unitPrice ?? '',
        t.amount ?? '', t.currency || '', t.locationFrom || '', t.locationTo || '', t.note || ''];
    });
    return '﻿' + [head, ...rows].map(r => r.map(csvEscape).join(';')).join('\r\n');
  }

  function exportSalesCSV() {
    const head = ['Tarih', 'Varlık', 'Tür', 'Miktar', 'Birim', 'Satış Fiyatı', 'Para Birimi',
      'Hasılat', 'Maliyet', 'Masraf', 'Gerçekleşen K/Z', 'Getiri %', 'Satıldığı Yer', 'Durum', 'Not'];
    const rows = state.sales.map(s => [s.date, s.name, DATA.assetType(s.type).name, s.quantity, s.unit,
      s.unitPrice, s.currency, s.proceeds.toFixed(2), s.costBasis == null ? '' : s.costBasis.toFixed(2),
      s.fee.toFixed(2), s.realized == null ? '' : s.realized.toFixed(2),
      s.pct == null ? '' : s.pct.toFixed(2), s.location, s.closed ? 'Kapandı' : 'Kısmi satış', s.note]);
    return '\ufeff' + [head, ...rows].map(r => r.map(csvEscape).join(';')).join('\r\n');
  }

  function importJSON(text) {
    const data = JSON.parse(text);
    if (!data || !Array.isArray(data.assets)) throw new Error('Dosya biçimi tanınmadı.');
    state = deepMerge(defaults(), {
      profile: data.profile, settings: data.settings, assets: data.assets,
      sales: data.sales || [], income: data.income || [], transactions: data.transactions || [], snapshots: data.snapshots || [],
      customLists: data.customLists || undefined
    });
    save();
    return state.assets.length;
  }

  function resetAll() { state = defaults(); save(); }

  /* ---------------- Demo verisi ---------------- */
  function seedDemo() {
    const demo = [
      { name: 'Gram Altın (24 ayar)', type: 'gold', symbol: 'GRA', quantity: 150, unitPrice: 4350, unitCost: 2600, currency: 'TRY', autoPrice: true, location: { kind: 'physical', name: 'Ev Kasası' }, acquiredAt: '2024-03-11' },
      { name: 'Çeyrek Altın', type: 'gold', symbol: 'CEYREKALTIN', quantity: 20, unit: 'adet', unitPrice: 7400, unitCost: 4900, currency: 'TRY', autoPrice: true, location: { kind: 'custody', name: 'Banka Kiralık Kasası' }, acquiredAt: '2023-11-02' },
      { name: 'Türk Hava Yolları', type: 'stock', symbol: 'THYAO', quantity: 400, unitPrice: 312, unitCost: 240, currency: 'TRY', autoPrice: true, location: { kind: 'platform', name: 'Midas', account: 'Ana hesap' }, acquiredAt: '2024-06-01' },
      { name: 'Apple Inc.', type: 'stock', symbol: 'AAPL', quantity: 25, unitPrice: 232, unitCost: 178, currency: 'USD', autoPrice: true, location: { kind: 'platform', name: 'Midas' }, acquiredAt: '2024-01-22' },
      { name: 'S&P 500 ETF', type: 'etf', symbol: 'SPY', quantity: 8, unitPrice: 610, unitCost: 505, currency: 'USD', autoPrice: true, location: { kind: 'platform', name: 'Interactive Brokers' }, acquiredAt: '2023-09-14' },
      { name: 'Vadesiz TL Hesap', type: 'cash', quantity: 85000, unit: 'birim', unitPrice: 1, unitCost: 1, currency: 'TRY', location: { kind: 'bank', name: 'Türkiye İş Bankası', account: '****4412' } },
      { name: 'Dolar Birikim', type: 'cash', quantity: 12000, unit: 'birim', unitPrice: 1, unitCost: 1, currency: 'USD', location: { kind: 'bank', name: 'Garanti BBVA', account: '****9080' } },
      { name: 'Nakit Euro', type: 'cash', quantity: 2500, unit: 'birim', unitPrice: 1, unitCost: 1, currency: 'EUR', location: { kind: 'physical', name: 'Ev' } },
      { name: 'Bitcoin', type: 'crypto', symbol: 'BTC', quantity: 0.42, unitPrice: 96000, unitCost: 41000, currency: 'USD', autoPrice: true, location: { kind: 'platform', name: 'Binance' }, acquiredAt: '2023-02-08' },
      { name: 'Ethereum', type: 'crypto', symbol: 'ETH', quantity: 3.5, unitPrice: 3400, unitCost: 1900, currency: 'USD', autoPrice: true, location: { kind: 'platform', name: 'Ledger' }, acquiredAt: '2023-05-19' },
      { name: 'Kadıköy 2+1 Daire', type: 'realestate', quantity: 1, unitPrice: 7250000, unitCost: 3100000, currency: 'TRY', location: { kind: 'other', name: 'Tapu / İstanbul' }, acquiredAt: '2021-07-30' },
      { name: 'Vadeli Mevduat 32 gün', type: 'deposit', quantity: 200000, unit: 'birim', unitPrice: 1, unitCost: 1, currency: 'TRY', location: { kind: 'bank', name: 'Türkiye Vakıflar Bankası', account: '****2231' } },
      { name: 'Serbest Şemsiye Fon', type: 'fund', symbol: 'TTE', quantity: 12000, unit: 'pay', unitPrice: 3.9, unitCost: 2.7, currency: 'TRY', location: { kind: 'bank', name: 'Yapı ve Kredi Bankası' } },
      { name: 'Volkswagen Passat 2019', type: 'vehicle', quantity: 1, unitPrice: 1450000, unitCost: 720000, currency: 'TRY', location: { kind: 'physical', name: 'Garaj' }, acquiredAt: '2020-08-05' }
    ];
    demo.forEach(d => addAsset(Object.assign({ autoPrice: false, notes: '' }, d)));
    // Demo fiyatları eskidir; ilk yenilemede otomatik fiyatlılar güncellenir.
    // Geriye dönük 90 günlük örnek anlık görüntü serisi
    const base = totals('TRY').value || 1;
    const snaps = [];
    for (let i = 90; i >= 0; i--) {
      const d = new Date(Date.now() - i * 864e5).toISOString().slice(0, 10);
      const drift = 1 - i / 90 * 0.22;
      const noise = 1 + Math.sin(i / 5) * 0.012 + (Math.random() - 0.5) * 0.008;
      snaps.push({ date: d, total: Math.round(base * drift * noise), base: 'TRY', currency: 'TRY',
                   synthetic: true, byType: {}, byLocation: {} });
    }
    state.snapshots = snaps;
    takeSnapshot(true);
    save();
  }

  /* Portföyü değiştiren her işlemden sonra günlük kaydı tazeler. Kullanıcının
     ayrıca "bugünü kaydet" demesine gerek yoktur; aynı güne ikinci kayıt
     yazılmaz, mevcut kaydın üzerine geçilir. */
  const stamped = fn => function () {
    const r = fn.apply(null, arguments);
    try { takeSnapshot(true); } catch (e) { console.warn('[Servet] Günlük kayıt alınamadı:', e); }
    return r;
  };

  /* ---------------- Genel API ---------------- */
  return {
    get state() { return state; },
    get settings() { return state.settings; },
    get assets() { return state.assets; },
    get transactions() { return state.transactions; },
    save, flush, reload, subscribe, uid, nowISO, todayISO, parseNum,
    validateAsset, getAsset,
    addAsset: stamped(addAsset), updateAsset: stamped(updateAsset), removeAsset: stamped(removeAsset),
    validateSale, realizedTotals,
    sellAsset: stamped(sellAsset), deleteSale: stamped(deleteSale),
    INCOME_KINDS, validateIncome, incomeTotals, totalReturn,
    addIncome: stamped(addIncome), deleteIncome: stamped(deleteIncome),
    get income() { return state.income; },
    maturities, realReturn, inflationRate,
    ensureLots, avgCost, validateLot, previewCost,
    addLot: stamped(addLot), removeLot: stamped(removeLot),
    get sales() { return state.sales; },
    addManualTx, clearTransactions, deleteTx, updateTxNote,
    convert, assetValue, assetCost, costCurrency, costToAssetCur,
    totals, byType, byLocationKind, byLocationName, byCurrency,
    locLabel, takeSnapshot, series, seriesFrom, performance, performanceSince,
    missingRates, cashAssets, markBackedUp, backupStatus, autoPriceStatus,
    rebalancePlan, setTargets,
    fmtMoney, fmtNum, fmtPct, fmtDate, fmtDateTime, relTime,
    exportJSON, exportAssetsCSV, exportTxCSV, exportSalesCSV, importJSON, resetAll, seedDemo
  };
})();
