/* =====================================================================
   market.js — Dış veri entegrasyonu
   • Banka adları  : raw.githubusercontent üzerindeki açık veri kümesi
                     (CORS açık, anahtar gerekmez) + yerel küratörlü liste
   • Döviz kurları : open.er-api.com (ücretsiz, anahtarsız)
   • Altın / gümüş : api.gold-api.com (ons fiyatı → gram fiyatı)
   • Kripto        : api.coingecko.com/simple/price
   Tüm istekler başarısız olursa uygulama çevrimdışı yedeklerle çalışır;
   kullanıcı her değeri elle de girebilir. Hiçbir kişisel veri gönderilmez.
   ===================================================================== */
window.Market = (function () {
  'use strict';

  const TTL_BANKS = 7 * 864e5;   // 7 gün
  const TTL_RATES = 6 * 36e5;    // 6 saat
  const TTL_PRICES = 30 * 6e4;   // 30 dakika
  const TTL_STOCKS = 15 * 6e4;   // hisse fiyatı önbelleği: 15 dakika
  const STOCK_CONCURRENCY = 3;   // vekili yormamak için eşzamanlı istek sınırı
  const OZ_TO_GRAM = 31.1034768;

  const SOURCES = {
    banks: 'https://raw.githubusercontent.com/tgezginis/turkish_bin_numbers/master/lib/bin_list.json',
    rates: 'https://open.er-api.com/v6/latest/TRY',
    // Türkiye kapalıçarşı fiyatları: gram/çeyrek/tam altın, gümüş ve döviz (TRY)
    tr: 'https://finans.truncgil.com/v4/today.json',
    metal: sym => `https://api.gold-api.com/price/${sym}`,
    crypto: ids => `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    // Hisse/ETF: Yahoo Finance, CORS'a açık okuma vekili üzerinden (opsiyonel)
    stock: sym => PROXIES[0](yahooChart(sym)),
    // Sembol arama: paketlenmiş liste yetmediğinde tüm borsalarda arar
    search: q => PROXIES[0](yahooSearch(q)),
    // Yıllık TÜFE (Dünya Bankası, CORS açık)
    cpi: 'https://api.worldbank.org/v2/country/TR/indicator/FP.CPI.TOTL.ZG?format=json&per_page=5'
  };

  /* Yahoo CORS başlığı vermez; okuma vekili şart. Tek vekile bağlı kalmak
     kırılgandı (r.jina.ai anahtarsız kullanımda dakikada 20 istekle sınırlı ve
     zaman zaman 451/429 döner), bu yüzden sırayla denenen bir vekil listesi
     tutulur. Vekile yalnızca sembol gider, portföy verisi gitmez. */
  const yahooChart = sym => 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(sym) + '?interval=1d&range=1d';
  const yahooSearch = q => 'https://query1.finance.yahoo.com/v1/finance/search?q=' +
    encodeURIComponent(q) + '&quotesCount=25&newsCount=0&listsCount=0&enableFuzzyQuery=true';
  const PROXIES = [
    u => 'https://r.jina.ai/' + u,
    u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u),
    u => 'https://corsproxy.io/?url=' + encodeURIComponent(u)
  ];

  const COIN_IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', USDT: 'tether', USDC: 'usd-coin', BNB: 'binancecoin',
    SOL: 'solana', XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', TRX: 'tron',
    AVAX: 'avalanche-2', DOT: 'polkadot', MATIC: 'matic-network', LINK: 'chainlink',
    LTC: 'litecoin', SHIB: 'shiba-inu', ATOM: 'cosmos', XLM: 'stellar', TON: 'the-open-network',
    ARB: 'arbitrum', OP: 'optimism', NEAR: 'near', APT: 'aptos', FIL: 'filecoin'
  };

  /* --------- Kaynak durumu (Ayarlar'da gösterilir) --------- */
  function note(key, ok, msg) {
    const c = Store.state.cache;
    c.sources = c.sources || {};
    c.sources[key] = { ok: !!ok, at: Date.now(), msg: msg || (ok ? 'başarılı' : 'hata') };
    Store.save(true);
  }
  const sources = () => Store.state.cache.sources || {};

  /* --------- Yardımcı: hata mesajını Türkçeleştir ---------
     `fetch` başarısız olunca tarayıcı İngilizce ve belirsiz mesajlar verir
     ("Failed to fetch", "The user aborted a request."). Bu mesajlar Ayarlar →
     Veri kaynakları listesinde kullanıcıya olduğu gibi gösteriliyordu. */
  function errMsg(e) {
    const m = String((e && e.message) || e || '');
    if (e && e.name === 'AbortError') return 'zaman aşımı';
    if (!navigator.onLine) return 'çevrimdışısınız';
    if (/^HTTP 429/.test(m)) return 'istek sınırı aşıldı (429) — birazdan tekrar deneyin';
    if (/^HTTP 5\d\d/.test(m)) return 'kaynak sunucu hata verdi (' + m.slice(5) + ')';
    if (/^HTTP 4\d\d/.test(m)) return 'kaynak isteği reddetti (' + m.slice(5) + ')';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'bağlantı kurulamadı';
    if (/JSON|Unexpected token/i.test(m)) return 'yanıt okunamadı (beklenmeyen biçim)';
    return m || 'bilinmeyen hata';
  }

  /* --------- Yardımcı: zaman aşımlı fetch --------- */
  async function getJSON(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.json();
    } finally { clearTimeout(t); }
  }

  const dedupe = arr => {
    const seen = new Set(), out = [];
    for (const raw of arr) {
      const n = String(raw || '').trim();
      if (!n) continue;
      const k = n.toLocaleLowerCase('tr');
      if (seen.has(k)) continue;
      seen.add(k); out.push(n);
    }
    return out.sort((a, b) => a.localeCompare(b, 'tr'));
  };

  /* ================= BANKALAR ================= */
  let banksOk = true;          // son denemede çevrimiçi liste alınabildi mi
  async function refreshBanks(force) {
    const c = Store.state.cache;
    if (!force && c.banks && Date.now() - c.banksAt < TTL_BANKS) return c.banks;
    banksOk = true;
    try {
      const data = await getJSON(SOURCES.banks, 15000);
      const online = Array.isArray(data) ? data.map(r => r && r.bank_name).filter(Boolean) : [];
      if (!online.length) throw new Error('Boş yanıt');
      c.banks = dedupe(online.concat(DATA.BANKS_FALLBACK));
      c.banksAt = Date.now();
      c.banksSource = 'çevrimiçi veri kümesi + yerel liste';
      note('banks', true, c.banks.length + ' kurum');
      Store.save(true);
      return c.banks;
    } catch (e) {
      note('banks', false, errMsg(e));
      console.warn('[Servet] Banka listesi çevrimiçi alınamadı:', e.message);
      banksOk = false;
      if (!c.banks) { c.banks = dedupe(DATA.BANKS_FALLBACK); c.banksSource = 'yerel yedek liste'; Store.save(true); }
      return c.banks;
    }
  }

  const banks = () => Store.state.cache.banks || dedupe(DATA.BANKS_FALLBACK);

  function listFor(kind) {
    const custom = Store.state.customLists;
    if (kind === 'bank') return dedupe(banks().concat(custom.banks));
    if (kind === 'platform') return dedupe(DATA.PLATFORMS_FALLBACK.concat(custom.platforms));
    if (kind === 'custody') return dedupe(DATA.CUSTODY_FALLBACK.concat(custom.custody));
    if (kind === 'physical') return dedupe(DATA.PHYSICAL_FALLBACK.concat(custom.custody));
    return dedupe(DATA.OTHER_FALLBACK.concat(custom.custody));
  }

  /* ================= DÖVİZ KURLARI ================= */
  /* Sonuç: rates[X] = 1 X kaç TRY eder */
  let ratesOk = true;          // son denemede kur alınabildi mi
  async function refreshRates(force) {
    const c = Store.state.cache;
    ratesOk = true;
    if (!force && c.rates && Date.now() - c.ratesAt < TTL_RATES) return c.rates;

    const out = Object.assign({ TRY: 1 }, c.rates || {});
    let ok = false;
    try {
      const d = await getJSON(SOURCES.rates);
      if (d && d.rates) {
        for (const cur of DATA.CURRENCIES) {
          if (cur.code === 'TRY' || cur.code === 'GAU') continue;
          const perTRY = Number(d.rates[cur.code]);
          if (perTRY > 0) out[cur.code] = 1 / perTRY;
        }
        ok = true;
        c.ratesSource = 'open.er-api.com · ' + (d.time_last_update_utc || '').slice(0, 16);
        note('rates', true, Object.keys(out).length + ' kur');
      }
    } catch (e) {
      note('rates', false, errMsg(e));
      console.warn('[Servet] Kurlar alınamadı:', e.message);
    }
    // Kapalıçarşı: gram altın (GAU) ve er-api'nin veremediği kurlar için yedek
    const tr = await fetchTR(force);
    if (tr) {
      if (tr.GRA) { out.GAU = tr.GRA.try; ok = true; }
      for (const cur of DATA.CURRENCIES) {
        const v = tr['FX:' + cur.code];
        if (v && !(out[cur.code] > 0)) { out[cur.code] = v.try; ok = true; }
      }
      if (!c.ratesSource || c.ratesSource === 'yerel') c.ratesSource = 'finans.truncgil.com';
    }
    // Son çare: ons altın USD fiyatından gram altın türet
    if (!out.GAU && out.USD) {
      try {
        const g = await getJSON(SOURCES.metal('XAU'), 10000);
        if (g && g.price > 0) { out.GAU = g.price / OZ_TO_GRAM * out.USD; ok = true; }
      } catch (e) { /* sessiz geç */ }
    }

    ratesOk = ok;
    if (ok) { c.rates = out; c.ratesAt = Date.now(); Store.save(true); }
    else if (!c.rates) { c.rates = { TRY: 1 }; c.ratesSource = 'kur verisi yok — elle girin'; Store.save(true); }
    return c.rates;
  }

  const rates = () => Store.state.cache.rates || { TRY: 1 };

  function setRate(code, value) {
    const c = Store.state.cache;
    c.rates = Object.assign({ TRY: 1 }, c.rates || {});
    c.rates[code] = Number(value) || 0;
    c.ratesAt = Date.now();
    c.ratesSource = 'elle girildi';
    Store.save();
  }

  /* ================= KAPALIÇARŞI (TRY) ================= */
  /* Gram/çeyrek/tam altın, gümüş ve döviz — tek istekte, TRY cinsinden. */
  async function fetchTR(force) {
    const c = Store.state.cache;
    if (!force && c.tr && Date.now() - c.trAt < TTL_PRICES) return c.tr;
    try {
      const d = await getJSON(SOURCES.tr, 12000);
      const out = {};
      for (const q of DATA.METAL_QUOTES) {
        const v = d[q.key];
        const price = v && Number(v.Selling || v.Buying);
        if (price > 0) out[q.key] = { try: price, chg: v.Change != null ? Number(v.Change) : null };
      }
      for (const cur of DATA.CURRENCIES) {
        const v = d[cur.code];
        if (v && v.Type === 'Currency' && Number(v.Selling) > 0) out['FX:' + cur.code] = { try: Number(v.Selling) };
      }
      if (!Object.keys(out).length) throw new Error('Boş yanıt');
      c.tr = out; c.trAt = Date.now(); c.trUpdate = d.Update_Date || '';
      note('tr', true, Object.keys(out).length + ' kalem · ' + (d.Update_Date || ''));
      Store.save(true);
      return out;
    } catch (e) {
      note('tr', false, errMsg(e));
      console.warn('[Servet] Kapalıçarşı verisi alınamadı:', e.message);
      return c.tr || null;
    }
  }

  /* ================= HİSSE / ETF ================= */
  /* Yahoo Finance, CORS'a açık okuma vekili üzerinden. Yalnızca sembol
     gönderilir; kişisel veri paylaşılmaz. Ayarlardan açılıp kapatılabilir. */
  function stockSymbols(a) {
    const s = (a.symbol || '').trim().toUpperCase();
    if (!s) return [];
    if (s.includes('.')) return [s];
    // Nokta yoksa: TRY ise önce BIST (.IS), sonra sembolün kendisi
    return a.currency === 'TRY' ? [s + '.IS', s] : [s, s + '.IS'];
  }

  /* Vekil zincirini sırayla dener, ilk çalışanın JSON gövdesini döndürür. */
  async function proxyJSON(url, ms) {
    let last = null;
    for (const proxy of PROXIES) {
      try {
        const txt = await fetchText(proxy(url), ms || 20000);
        // r.jina.ai yanıtı markdown başlıklarıyla sarar; ilk JSON gövdesini ayıkla.
        const i = txt.indexOf('{');
        if (i < 0) throw new Error('Beklenmeyen yanıt');
        return JSON.parse(txt.slice(i));
      } catch (e) { if (!last) last = e; }   // ilk hatayı sakla, sıradaki vekili dene
    }
    throw last || new Error('Yanıt alınamadı');
  }

  async function fetchStock(sym) {
    const d = await proxyJSON(yahooChart(sym));
    if (d && d.chart && d.chart.error) throw new Error(d.chart.error.description || 'sembol bulunamadı');
    const meta = d && d.chart && d.chart.result && d.chart.result[0] && d.chart.result[0].meta;
    const price = meta && Number(meta.regularMarketPrice);
    if (!(price > 0)) throw new Error('Fiyat bulunamadı');
    return { price, currency: meta.currency || 'USD', name: meta.longName || meta.shortName || sym };
  }

  /* ================= SEMBOL ARAMA =================
     Paketlenmiş liste (symbols.js) yalnızca bir başlangıç listesidir; BIST'te
     900'ü aşkın sembol var ve sürekli değişiyor. Bu arama Yahoo'nun tüm
     borsaları kapsayan arama ucunu kullanır — servise yalnızca yazdığınız
     arama metni gider. Dönen `value` doğrudan fiyat çekiminde kullanılabilecek
     tam semboldür (ör. GMSTR.IS). */
  const EX_CUR = { IST: 'TRY', LSE: 'GBP', FRA: 'EUR', GER: 'EUR', PAR: 'EUR', AMS: 'EUR', MIL: 'EUR' };
  const TYPE_TR = { EQUITY: 'hisse', ETF: 'ETF', MUTUALFUND: 'fon', INDEX: 'endeks', CURRENCY: 'döviz',
                    CRYPTOCURRENCY: 'kripto', FUTURE: 'vadeli' };

  async function searchSymbols(q, wanted) {
    const query = String(q || '').trim();
    if (query.length < 2) return [];
    const d = await proxyJSON(yahooSearch(query), 15000);
    const quotes = (d && Array.isArray(d.quotes) ? d.quotes : []).filter(x => x && x.symbol);
    const want = wanted === 'etf' ? ['ETF', 'MUTUALFUND', 'INDEX', 'EQUITY']
               : wanted === 'stock' ? ['EQUITY', 'ETF', 'MUTUALFUND', 'INDEX']
               : null;
    // Sıralama: önce Borsa İstanbul, sonra ABD borsaları, en sonda Yahoo'nun
    // "0P…" fon kimlikleri (kullanıcı için okunaksız).
    const rank = x => (x.symbol || '').startsWith('0P') ? 3
      : x.exchange === 'IST' ? 0
      : ['NMS', 'NYQ', 'NGM', 'PCX', 'ASE'].includes(x.exchange) ? 1 : 2;
    return quotes
      .filter(x => !want || want.includes(x.quoteType))
      .sort((a, b) => rank(a) - rank(b))
      .map(x => ({
        value: x.symbol,
        code: x.symbol,
        name: x.longname || x.shortname || x.symbol,
        market: x.exchDisp || x.exchange || '',
        exchange: x.exchange || '',
        currency: EX_CUR[x.exchange] || (x.exchange === 'NYQ' || x.exchange === 'NMS' ? 'USD' : ''),
        kind: TYPE_TR[x.quoteType] || (x.typeDisp || '').toLowerCase()
      }));
  }

  async function fetchText(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 15000);
    try {
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    } finally { clearTimeout(t); }
  }

  /* ================= PİYASA FİYATLARI ================= */
  /* Otomatik fiyat işaretli varlıkların birim fiyatını günceller. */
  async function refreshPrices(force) {
    const c = Store.state.cache;
    if (!Store.settings.autoPrices) return { updated: 0, skipped: 'kapalı' };
    if (!force && Date.now() - c.pricesAt < TTL_PRICES) return { updated: 0, skipped: 'önbellek' };

    const assets = Store.assets.filter(a => a.autoPrice);
    if (!assets.length) { c.pricesAt = Date.now(); return { updated: 0, failed: [] }; }

    const prices = {};        // 'crypto:BTC' -> {usd} | 'metal:GRA' -> {try}
    const failed = [];

    /* --- Kripto (CoinGecko, USD) --- */
    const symbols = dedupe(assets.filter(a => a.type === 'crypto').map(a => a.symbol));
    const ids = symbols.map(s => COIN_IDS[s]).filter(Boolean);
    if (ids.length) {
      try {
        const d = await getJSON(SOURCES.crypto(dedupe(ids).join(',')));
        for (const s of symbols) {
          const id = COIN_IDS[s];
          if (id && d[id] && d[id].usd) prices['crypto:' + s] = { usd: d[id].usd, chg: d[id].usd_24h_change };
        }
        note('crypto', true, symbols.length + ' sembol');
      } catch (e) {
        failed.push('kripto (' + errMsg(e) + ')');
        note('crypto', false, errMsg(e));
        console.warn('[Servet] Kripto fiyatları alınamadı:', e.message);
      }
    }
    symbols.filter(s => !COIN_IDS[s]).forEach(s => failed.push(s + ' (bilinmeyen kripto)'));

    /* --- Altın / gümüş: önce kapalıçarşı (TRY), yoksa ons fiyatı (USD) --- */
    const metalAssets = assets.filter(a => a.type === 'gold' || a.type === 'silver');
    if (metalAssets.length) {
      const tr = await fetchTR(force);
      if (tr) {
        for (const q of DATA.METAL_QUOTES) if (tr[q.key]) prices['metal:' + q.key] = tr[q.key];
      } else {
        failed.push('altın/gümüş (kapalıçarşı: ' + ((sources().tr && sources().tr.msg) || 'alınamadı') + ')');
      }
      // Sembolsüz gram varlıklar için yedek: ons → gram, USD
      const needFallback = metalAssets.some(a => !DATA.metalQuote(a.symbol));
      if (needFallback) {
        for (const [type, sym] of [['gold', 'XAU'], ['silver', 'XAG']]) {
          if (!metalAssets.some(a => a.type === type && !DATA.metalQuote(a.symbol))) continue;
          try {
            const d = await getJSON(SOURCES.metal(sym), 10000);
            if (d && d.price > 0) prices['ons:' + type] = { usd: d.price / OZ_TO_GRAM };
          } catch (e) { failed.push((sym === 'XAU' ? 'ons altın' : 'ons gümüş') + ' (' + errMsg(e) + ')'); }
        }
      }
    }

    /* --- Hisse / ETF (opsiyonel) ---
       Aynı sembol birden çok varlıkta geçse tek istek atılır, sonuç 15 dk
       önbellekte tutulur ve istekler 3'erli paralel gruplar halinde gider. */
    const stockAssets = assets.filter(a => a.type === 'stock' || a.type === 'etf');
    if (stockAssets.length) {
      if (!Store.settings.stockPrices) {
        failed.push('hisse (ayarlardan kapalı)');
      } else {
        c.stocks = c.stocks || {};
        const wanted = new Map();          // anahtar -> ilk eşleşen varlık
        for (const a of stockAssets) {
          const key = (a.symbol || '').trim().toUpperCase() + '|' + a.currency;
          if (key.startsWith('|')) { failed.push(a.name + ' (sembol yok)'); continue; }
          if (!wanted.has(key)) wanted.set(key, a);
        }
        const fresh = k => c.stocks[k] && Date.now() - c.stocks[k].at < TTL_STOCKS;
        const todo = [...wanted.entries()].filter(([k]) => !fresh(k));
        let stockOk = 0, stockErr = '';

        for (let i = 0; i < todo.length; i += STOCK_CONCURRENCY) {
          const batch = todo.slice(i, i + STOCK_CONCURRENCY);
          await Promise.all(batch.map(async ([key, a]) => {
            for (const sym of stockSymbols(a)) {
              try {
                const got = await fetchStock(sym);
                c.stocks[key] = { price: got.price, currency: got.currency, symbol: sym, at: Date.now() };
                stockOk++;
                return;
              } catch (e) { stockErr = errMsg(e); /* sonraki sembol biçimini dene */ }
            }
            failed.push((a.symbol || a.name) + ' (hisse' + (stockErr ? ': ' + stockErr : '') + ')');
          }));
        }
        // Durum notu bir kez yazılır; tek başarı, aynı turdaki hataları gizlemesin.
        if (todo.length) {
          if (stockOk === todo.length) note('stocks', true, stockOk + ' sembol güncellendi');
          else if (stockOk) note('stocks', false, stockOk + '/' + todo.length + ' sembol alındı · ' + stockErr);
          else note('stocks', false, stockErr || 'sembol alınamadı');
        }
        for (const [key, a] of wanted) {
          const hit = c.stocks[key];
          if (hit) prices['stock:' + key] = hit;
        }
      }
    }

    /* --- Varlıklara uygula --- */
    let updated = 0;
    for (const a of assets) {
      let value = null, from = null;   // value: fiyat, from: para birimi

      if (a.type === 'crypto') {
        const p = prices['crypto:' + a.symbol];
        if (p) { value = p.usd; from = 'USD'; }
      } else if (a.type === 'gold' || a.type === 'silver') {
        const p = prices['metal:' + a.symbol];
        if (p) { value = p.try; from = 'TRY'; }
        else if (a.unit === 'gram' && prices['ons:' + a.type]) {
          value = prices['ons:' + a.type].usd; from = 'USD';   // gram bazlı yedek
        }
      } else if (a.type === 'stock' || a.type === 'etf') {
        const p = prices['stock:' + (a.symbol || '').trim().toUpperCase() + '|' + a.currency];
        if (p) { value = p.price; from = p.currency; }
      } else if (a.type === 'cash') {
        continue;   // nakitte birim fiyat 1'dir; değerleme kurdan yapılır
      }

      if (value == null) continue;
      const inAssetCur = Store.convert(value, from, a.currency);
      if (!isFinite(inAssetCur) || inAssetCur <= 0) continue;
      const rounded = Math.round(inAssetCur * 1e4) / 1e4;
      if (Math.abs(rounded - a.unitPrice) / (a.unitPrice || 1) > 0.0001) {
        const old = a.unitPrice;
        a.unitPrice = rounded;
        a.updatedAt = Store.nowISO();
        updated++;
        if (Store.settings.notifications.priceAlerts && old > 0) {
          const chg = (rounded - old) / old * 100;
          const thr = Number(Store.settings.notifications.priceThreshold) || 5;
          if (Math.abs(chg) >= thr) {
            window.dispatchEvent(new CustomEvent('servet:alert', {
              detail: `${a.name}: birim fiyat ${chg > 0 ? '+' : ''}${chg.toFixed(1)}% değişti.`
            }));
          }
        }
      }
    }
    c.prices = prices;
    c.pricesAt = Date.now();
    Store.save(updated > 0);
    return { updated, failed };
  }

  /* ================= ENFLASYON (reel getiri için) =================
     Dünya Bankası yıllık TÜFE serisi. Kullanıcı Ayarlar'dan elle de girebilir. */
  async function refreshInflation(force) {
    const c = Store.state.cache;
    if (!force && c.cpi && Date.now() - (c.cpiAt || 0) < 30 * 864e5) return c.cpi;
    try {
      const d = await getJSON(SOURCES.cpi, 12000);
      const rows = Array.isArray(d) && Array.isArray(d[1]) ? d[1] : [];
      const last = rows.find(r => r && r.value != null);
      if (!last) throw new Error('veri yok');
      c.cpi = { rate: Math.round(last.value * 10) / 10, year: last.date, source: 'Dünya Bankası' };
      c.cpiAt = Date.now();
      note('cpi', true, '%' + c.cpi.rate + ' (' + c.cpi.year + ')');
      Store.save(true);
      return c.cpi;
    } catch (e) {
      note('cpi', false, errMsg(e));
      return c.cpi || null;
    }
  }

  /* ================= TEK VARLIK İÇİN ANINDA FİYAT =================
     Varlık kaydedilir kaydedilmez fiyatını çeker; kullanıcı "0 TL" görmez.
     Dönüş: {ok, price, currency, reason} */
  async function fetchOne(a) {
    if (!a) return { ok: false, reason: 'varlık yok' };
    const t = DATA.assetType(a.type);
    if (!t.priceable) return { ok: false, reason: 'bu tür için otomatik fiyat yok' };
    if (!a.symbol && a.type !== 'cash') return { ok: false, reason: 'ürün/sembol seçilmemiş' };

    try {
      let value = null, from = null;

      if (a.type === 'gold' || a.type === 'silver') {
        const tr = await fetchTR();
        const q = tr && tr[a.symbol];
        if (q) { value = q.try; from = 'TRY'; }
        else if (a.unit === 'gram') {
          const d = await getJSON(SOURCES.metal(a.type === 'gold' ? 'XAU' : 'XAG'), 10000);
          if (d && d.price > 0) { value = d.price / OZ_TO_GRAM; from = 'USD'; }
        }
      } else if (a.type === 'crypto') {
        const id = COIN_IDS[a.symbol];
        if (!id) return { ok: false, reason: a.symbol + ' desteklenen kripto listesinde yok' };
        const d = await getJSON(SOURCES.crypto(id));
        if (d && d[id] && d[id].usd) { value = d[id].usd; from = 'USD'; }
      } else if (a.type === 'stock' || a.type === 'etf') {
        if (!Store.settings.stockPrices) return { ok: false, reason: 'hisse fiyatı çekimi kapalı', needsStockToggle: true };
        let got = null;
        for (const sym of stockSymbols(a)) {
          try { got = await fetchStock(sym); break; } catch (e) { /* sıradaki biçim */ }
        }
        if (!got) return { ok: false, reason: a.symbol + ' bulunamadı' };
        value = got.price; from = got.currency;
        const c = Store.state.cache;
        c.stocks = c.stocks || {};
        c.stocks[(a.symbol || '').trim().toUpperCase() + '|' + a.currency] =
          { price: got.price, currency: got.currency, at: Date.now() };
      }

      if (value == null) return { ok: false, reason: 'fiyat bulunamadı' };
      const inCur = Store.convert(value, from, a.currency);
      if (!isFinite(inCur) || inCur <= 0) return { ok: false, reason: 'kur çevrimi yapılamadı' };

      a.unitPrice = Math.round(inCur * 1e4) / 1e4;
      a.updatedAt = Store.nowISO();
      Store.save();
      return { ok: true, price: a.unitPrice, currency: a.currency };
    } catch (e) {
      return { ok: false, reason: errMsg(e) };
    }
  }

  /* ================= TOPLU YENİLEME ================= */
  async function refreshAll(force) {
    const results = { rates: false, prices: 0, banks: false, errors: [] };
    try { await refreshRates(force); results.rates = ratesOk; } catch (e) { results.rates = false; }
    if (!results.rates) results.errors.push('döviz kuru');
    try {
      const r = await refreshPrices(force);
      results.prices = r.updated || 0;
      results.failed = r.failed || [];
    } catch (e) { results.errors.push('fiyat'); }
    // refreshBanks kendi hatasını yutup yerel yedeğe düşer; durumu bayraktan oku.
    try { await refreshBanks(false); results.banks = banksOk; } catch (e) { results.banks = false; }
    if (!results.banks) results.errors.push('banka listesi');
    try { await refreshInflation(false); } catch (e) { /* enflasyon kritik değil */ }
    Store.takeSnapshot();
    return results;
  }

  /* ================= SEMBOL LİSTESİ TAZELEME (#13) =================
     Paketlenmiş BIST listesi zamanla eskir. Yahoo arama uçundan sembolün
     hâlâ geçerli olup olmadığı ve güncel şirket adı doğrulanır. */
  async function verifySymbol(code) {
    const s = SYMBOLS.find(code);
    const sym = s ? s.yahoo : code;
    try {
      const r = await fetchStock(sym);
      return { code, ok: true, name: r.name, price: r.price, currency: r.currency };
    } catch (e) {
      return { code, ok: false, error: e.message };
    }
  }

  /* Portföydeki hisse sembollerini doğrular (tümünü değil — hızlı kalsın) */
  async function verifyPortfolioSymbols() {
    const codes = dedupe(Store.assets
      .filter(a => (a.type === 'stock' || a.type === 'etf') && a.symbol)
      .map(a => a.symbol));
    const out = [];
    for (let i = 0; i < codes.length; i += STOCK_CONCURRENCY) {
      const batch = codes.slice(i, i + STOCK_CONCURRENCY);
      out.push(...await Promise.all(batch.map(verifySymbol)));
    }
    return out;
  }

  /* Bağlantı tanılaması: her kaynağı ayrı ayrı dener, süre ve hata döndürür */
  async function diagnose() {
    const tests = [
      ['Döviz kurları', 'open.er-api.com', () => getJSON(SOURCES.rates, 12000)
        .then(d => d && d.rates && d.rates.USD ? '1 TRY = ' + d.rates.USD.toFixed(4) + ' USD' : 'beklenmeyen yanıt')],
      ['Altın / gümüş', 'finans.truncgil.com', () => getJSON(SOURCES.tr, 12000)
        .then(d => d && d.GRA ? 'gram altın ' + (d.GRA.Selling || d.GRA.Buying) + ' TRY' : 'beklenmeyen yanıt')],
      ['Kripto', 'api.coingecko.com', () => getJSON(SOURCES.crypto('bitcoin'), 12000)
        .then(d => d && d.bitcoin ? 'BTC ' + d.bitcoin.usd + ' USD' : 'beklenmeyen yanıt')],
      ['Banka listesi', 'raw.githubusercontent.com', () => getJSON(SOURCES.banks, 15000)
        .then(d => Array.isArray(d) ? d.length + ' kayıt' : 'beklenmeyen yanıt')],
      ['Hisse (vekil)', 'r.jina.ai → Yahoo', () => fetchStock('THYAO.IS')
        .then(r => 'THYAO ' + r.price + ' ' + r.currency)]
    ];
    const out = [];
    for (const [name, host, run] of tests) {
      const t0 = performance.now();
      try {
        const detail = await run();
        out.push({ name, host, ok: true, ms: Math.round(performance.now() - t0), detail });
      } catch (e) {
        out.push({ name, host, ok: false, ms: Math.round(performance.now() - t0), detail: errMsg(e) });
      }
    }
    return out;
  }

  return {
    diagnose, sources, verifySymbol, verifyPortfolioSymbols, fetchOne, refreshInflation, searchSymbols,
    refreshBanks, banks, listFor,
    refreshRates, rates, setRate,
    refreshPrices, refreshAll, fetchTR, fetchStock, stockSymbols,
    COIN_IDS, SOURCES
  };
})();
