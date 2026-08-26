/* =====================================================================
   data.js — Sabit veri katmanı
   Varlık sınıfları, saklama yeri türleri, para birimleri, banka & platform
   çekirdek listeleri. Banka listesi çevrimiçi kaynaktan güncellenir
   (bkz. market.js -> Market.refreshBanks); buradaki liste çevrimdışı
   yedek (fallback) olarak kullanılır.
   ===================================================================== */
window.DATA = (function () {
  'use strict';

  /* ---------- Varlık sınıfları ---------- */
  // unit      : miktar birimi
  // priceable : piyasa fiyatı otomatik çekilebilir mi
  // quote     : otomatik fiyat için kaynak anahtarı
  const ASSET_TYPES = [
    { id: 'gold',        name: 'Altın',              icon: '🪙', unit: 'gram',  group: 'Kıymetli Maden', priceable: true,  quote: 'XAU', defaultCurrency: 'TRY' },
    { id: 'silver',      name: 'Gümüş',              icon: '🥈', unit: 'gram',  group: 'Kıymetli Maden', priceable: true,  quote: 'XAG', defaultCurrency: 'TRY' },
    { id: 'platinum',    name: 'Platin / Paladyum',  icon: '⚪', unit: 'gram',  group: 'Kıymetli Maden', priceable: false, defaultCurrency: 'TRY' },
    { id: 'stock',       name: 'Hisse Senedi',       icon: '📈', unit: 'adet',  group: 'Menkul Kıymet',  priceable: true,  quote: 'STOCK', defaultCurrency: 'TRY' },
    { id: 'etf',         name: 'ETF / Endeks Fonu',  icon: '🧺', unit: 'adet',  group: 'Menkul Kıymet',  priceable: true,  quote: 'STOCK', defaultCurrency: 'TRY' },
    { id: 'fund',        name: 'Yatırım Fonu',       icon: '🏦', unit: 'pay',   group: 'Menkul Kıymet',  priceable: false, defaultCurrency: 'TRY' },
    { id: 'bond',        name: 'Tahvil / Bono',      icon: '📜', unit: 'adet',  group: 'Sabit Getirili', priceable: false, defaultCurrency: 'TRY' },
    { id: 'deposit',     name: 'Vadeli Mevduat',     icon: '⏳', unit: 'birim', group: 'Sabit Getirili', priceable: false, defaultCurrency: 'TRY' },
    { id: 'cash',        name: 'Nakit / Döviz',      icon: '💵', unit: 'birim', group: 'Nakit',          priceable: false, defaultCurrency: 'TRY' },
    { id: 'crypto',      name: 'Kripto Para',        icon: '₿',  unit: 'adet',  group: 'Dijital Varlık', priceable: true,  quote: 'COIN', defaultCurrency: 'USD' },
    { id: 'realestate',  name: 'Gayrimenkul',        icon: '🏠', unit: 'adet',  group: 'Reel Varlık',    priceable: false, defaultCurrency: 'TRY' },
    { id: 'vehicle',     name: 'Araç',               icon: '🚗', unit: 'adet',  group: 'Reel Varlık',    priceable: false, defaultCurrency: 'TRY' },
    { id: 'collectible', name: 'Koleksiyon / Sanat', icon: '🖼️', unit: 'adet',  group: 'Reel Varlık',    priceable: false, defaultCurrency: 'TRY' },
    { id: 'receivable',  name: 'Alacak / Borç Senedi',icon: '🧾', unit: 'birim',group: 'Diğer',          priceable: false, defaultCurrency: 'TRY' },
    { id: 'other',       name: 'Diğer',              icon: '📦', unit: 'adet',  group: 'Diğer',          priceable: false, defaultCurrency: 'TRY' }
  ];

  /* ---------- Otomatik fiyatlı kıymetli maden ürünleri ----------
     Anahtarlar finans.truncgil.com/v4 alan adlarıdır; fiyatlar TRY'dir.
     Varlığın "symbol" alanında saklanır (örn. symbol: 'CEYREKALTIN'). */
  const METAL_QUOTES = [
    { key: 'GRA', short: 'GRAM',              name: 'Gram Altın (24 ayar)', unit: 'gram', type: 'gold' },
    { key: 'HAS', short: 'HAS',              name: 'Has Altın (gram)',     unit: 'gram', type: 'gold' },
    { key: 'YIA', short: '22 AYAR',              name: '22 Ayar Bilezik (gram)', unit: 'gram', type: 'gold' },
    { key: '18AYARALTIN', short: '18 AYAR',      name: '18 Ayar Altın (gram)', unit: 'gram', type: 'gold' },
    { key: '14AYARALTIN', short: '14 AYAR',      name: '14 Ayar Altın (gram)', unit: 'gram', type: 'gold' },
    { key: 'CEYREKALTIN', short: 'ÇEYREK',      name: 'Çeyrek Altın',         unit: 'adet', type: 'gold' },
    { key: 'YARIMALTIN', short: 'YARIM',       name: 'Yarım Altın',          unit: 'adet', type: 'gold' },
    { key: 'TAMALTIN', short: 'TAM',         name: 'Tam Altın',            unit: 'adet', type: 'gold' },
    { key: 'ATAALTIN', short: 'ATA',         name: 'Ata Altın',            unit: 'adet', type: 'gold' },
    { key: 'CUMHURIYETALTINI', short: 'CUMHUR.', name: 'Cumhuriyet Altını',    unit: 'adet', type: 'gold' },
    { key: 'RESATALTIN', short: 'REŞAT',       name: 'Reşat Altın',          unit: 'adet', type: 'gold' },
    { key: 'HAMITALTIN', short: 'HAMİT',       name: 'Hamit Altın',          unit: 'adet', type: 'gold' },
    { key: 'IKIBUCUKALTIN', short: '2.5 ALTIN',    name: 'İkibuçuk Altın',       unit: 'adet', type: 'gold' },
    { key: 'BESLIALTIN', short: 'BEŞLİ',       name: 'Beşli Altın',          unit: 'adet', type: 'gold' },
    { key: 'GREMSEALTIN', short: 'GREMSE',      name: 'Gremse Altın',         unit: 'adet', type: 'gold' },
    { key: 'GUMUS', short: 'GÜMÜŞ',            name: 'Gram Gümüş',           unit: 'gram', type: 'silver' }
  ];

  /* ---------- Saklama yeri türleri ---------- */
  const LOCATION_KINDS = [
    { id: 'physical', name: 'Elimde (Fiziksel)', icon: '🤲', hint: 'Evde, kasada, cüzdanda tuttuğunuz fiziksel varlıklar.', needsName: false, placeholder: 'Örn. Ev kasası' },
    { id: 'bank',     name: 'Banka',             icon: '🏛️', hint: 'Banka hesabı, mevduat, banka aracılığıyla tutulan varlıklar.', needsName: true,  placeholder: 'Banka seçin' },
    { id: 'platform', name: 'Yatırım Platformu', icon: '📱', hint: 'Midas, aracı kurum, kripto borsası veya dijital cüzdan.', needsName: true,  placeholder: 'Platform seçin' },
    { id: 'custody',  name: 'Kasa / Emanet',     icon: '🔐', hint: 'Banka kiralık kasası, kuyumcu emaneti, üçüncü taraf saklama.', needsName: true,  placeholder: 'Saklayıcı adı' },
    { id: 'other',    name: 'Diğer',             icon: '📍', hint: 'Yukarıdakilere girmeyen saklama yerleri.', needsName: true,  placeholder: 'Yer adı' }
  ];

  /* ---------- Para birimleri ---------- */
  const CURRENCIES = [
    { code: 'TRY', name: 'Türk Lirası',     symbol: '₺' },
    { code: 'USD', name: 'ABD Doları',      symbol: '$' },
    { code: 'EUR', name: 'Euro',            symbol: '€' },
    { code: 'GBP', name: 'İngiliz Sterlini',symbol: '£' },
    { code: 'CHF', name: 'İsviçre Frangı',  symbol: 'CHF' },
    { code: 'JPY', name: 'Japon Yeni',      symbol: '¥' },
    { code: 'AED', name: 'BAE Dirhemi',     symbol: 'AED' },
    { code: 'SAR', name: 'Suudi Riyali',    symbol: 'SAR' },
    { code: 'RUB', name: 'Rus Rublesi',     symbol: '₽' },
    { code: 'CNY', name: 'Çin Yuanı',       symbol: '¥' },
    { code: 'GAU', name: 'Gram Altın (birim)', symbol: 'gr' }
  ];

  /* ---------- İşlem türleri ---------- */
  const TX_TYPES = [
    { id: 'buy',       name: 'Alım',            icon: '🟢', sign: +1 },
    { id: 'sell',      name: 'Satım',           icon: '🔴', sign: -1 },
    { id: 'deposit',   name: 'Giriş / Yatırma', icon: '⬇️', sign: +1 },
    { id: 'withdraw',  name: 'Çıkış / Çekme',   icon: '⬆️', sign: -1 },
    { id: 'transfer',  name: 'Yer Değişikliği', icon: '🔁', sign: 0 },
    { id: 'valuation', name: 'Değer Güncelleme',icon: '📝', sign: 0 },
    { id: 'income',    name: 'Getiri / Temettü',icon: '💰', sign: +1 },
    { id: 'fee',       name: 'Masraf / Komisyon',icon: '💸', sign: -1 },
    { id: 'create',    name: 'Varlık Eklendi',  icon: '✨', sign: 0 },
    { id: 'update',    name: 'Varlık Düzenlendi',icon: '✏️', sign: 0 },
    { id: 'delete',    name: 'Varlık Silindi',  icon: '🗑️', sign: 0 }
  ];

  /* ---------- Çevrimdışı yedek: Türkiye'deki bankalar ---------- */
  /* Çevrimiçi kaynak ulaşılamazsa bu liste kullanılır. */
  const BANKS_FALLBACK = [
    'T.C. Ziraat Bankası', 'Türkiye İş Bankası', 'Türkiye Halk Bankası', 'Türkiye Vakıflar Bankası',
    'Yapı ve Kredi Bankası', 'Akbank', 'QNB Bank', 'Denizbank', 'Türk Ekonomi Bankası (TEB)',
    'Garanti BBVA', 'ING Bank', 'HSBC Bank', 'Şekerbank', 'Alternatifbank', 'Anadolubank',
    'Fibabanka', 'Odeabank', 'Turkish Bank', 'Burgan Bank', 'Citibank', 'Deutsche Bank',
    'ICBC Turkey Bank', 'Türkiye Sınai Kalkınma Bankası (TSKB)', 'Türk Eximbank',
    'İller Bankası', 'Aktif Yatırım Bankası', 'Nurol Yatırım Bankası', 'GSD Yatırım Bankası',
    'Pasha Yatırım Bankası', 'Golden Global Yatırım Bankası', 'Ziraat Katılım Bankası',
    'Vakıf Katılım Bankası', 'Emlak Katılım Bankası', 'Kuveyt Türk Katılım Bankası',
    'Albaraka Türk Katılım Bankası', 'Türkiye Finans Katılım Bankası', 'Dünya Katılım Bankası',
    'Hayat Finans Katılım Bankası', 'Enpara.com', 'CEPTETEB', 'N Kolay (Aktif Bank)',
    'Rabobank', 'Bank of China Turkey', 'MUFG Bank Turkey', 'JPMorgan Chase Bank', 'Standard Chartered'
  ];

  /* ---------- Yatırım platformları / aracı kurumlar / borsalar ---------- */
  const PLATFORMS_FALLBACK = [
    // Aracı kurumlar & yatırım uygulamaları
    'Midas', 'İş Yatırım', 'Garanti BBVA Yatırım', 'Ak Yatırım', 'Yapı Kredi Yatırım',
    'QNB Invest', 'Deniz Yatırım', 'Gedik Yatırım', 'Ziraat Yatırım', 'Vakıf Yatırım',
    'Halk Yatırım', 'Info Yatırım', 'A1 Capital', 'Ünlü Menkul', 'Marbaş Menkul',
    'Şeker Yatırım', 'Tacirler Yatırım', 'Oyak Yatırım', 'Piapiri', 'Papara Yatırım',
    'İnvestAZ', 'Osmanlı Yatırım', 'Integral Yatırım', 'Meksa Yatırım',
    // Global
    'Interactive Brokers', 'eToro', 'Trading 212', 'Revolut', 'Wise', 'Robinhood',
    // Kripto borsaları / cüzdanlar
    'Binance', 'BinanceTR', 'BTCTurk', 'Paribu', 'Bitexen', 'Bitci', 'ICRYPEX', 'Coinbase',
    'Kraken', 'OKX', 'Bybit', 'Metamask', 'Trust Wallet', 'Ledger', 'Trezor',
    // Altın / diğer
    'Hazine Altın (Darphane)', 'Kuyumcukent', 'Papara', 'Ininal'
  ];

  /* ---------- Kasa / emanet ---------- */
  const PHYSICAL_FALLBACK = [
    'Ev Kasası', 'Ev', 'Cüzdan', 'Çekmece', 'İş Yeri', 'Araba', 'Yazlık', 'Aile Yanında'
  ];

  const OTHER_FALLBACK = [
    'Tapu / Gayrimenkul', 'Noter', 'Sigorta Poliçesi', 'Şirket Ortaklığı', 'Alacak / Senet'
  ];

  const CUSTODY_FALLBACK = [
    'Banka Kiralık Kasası', 'Kuyumcu Emaneti', 'Noter Emaneti', 'Özel Kasa Firması',
    'Aile / Güvenilir Kişi', 'İş Yeri Kasası'
  ];

  /* ---------- Yardımcılar ---------- */
  const byId = (arr, id) => arr.find(x => x.id === id);

  return {
    ASSET_TYPES, LOCATION_KINDS, CURRENCIES, TX_TYPES, METAL_QUOTES,
    BANKS_FALLBACK, PLATFORMS_FALLBACK, CUSTODY_FALLBACK, PHYSICAL_FALLBACK, OTHER_FALLBACK,
    assetType: id => byId(ASSET_TYPES, id) || byId(ASSET_TYPES, 'other'),
    locationKind: id => byId(LOCATION_KINDS, id) || byId(LOCATION_KINDS, 'other'),
    metalQuote: key => METAL_QUOTES.find(q => q.key === key) || null,
    txType: id => byId(TX_TYPES, id) || { id, name: id, icon: '•', sign: 0 },
    currency: code => CURRENCIES.find(c => c.code === code) || { code, name: code, symbol: code },
    // Grafiklerde kullanılan lacivert-altın paleti
    PALETTE: ['#d4af37', '#4c6ac9', '#f6e27a', '#7fd1c1', '#b8860b', '#8ea2e0',
              '#e0a96d', '#c77dff', '#3fd08a', '#ff9f68', '#2b3f8f', '#6d7ba4']
  };
})();
