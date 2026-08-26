/* =====================================================================
   symbols.js — Seçilebilir menkul kıymet listeleri
   Fiyatlar Yahoo Finance'ten çekilir: BIST sembollerine otomatik ".IS"
   eklenir. Listede olmayan bir sembolü seçicideki "kendim yazayım"
   seçeneğiyle elle girebilirsiniz.
   ===================================================================== */
window.SYMBOLS = (function () {
  'use strict';

  /* ---------- Borsa İstanbul ---------- */
  const BIST = [
    ['AEFES', 'Anadolu Efes'], ['AGHOL', 'AG Anadolu Grubu Holding'], ['AKBNK', 'Akbank'],
    ['AKSA', 'Aksa Akrilik'], ['AKSEN', 'Aksa Enerji'], ['ALARK', 'Alarko Holding'],
    ['ALBRK', 'Albaraka Türk'], ['ALFAS', 'Alfa Solar Enerji'], ['ANSGR', 'Anadolu Sigorta'],
    ['ARCLK', 'Arçelik'], ['ASELS', 'Aselsan'], ['ASTOR', 'Astor Enerji'],
    ['AYDEM', 'Aydem Yenilenebilir Enerji'], ['BAGFS', 'Bagfaş'], ['BERA', 'Bera Holding'],
    ['BIMAS', 'BİM Mağazalar'], ['BIOEN', 'Biotrend Enerji'], ['BRSAN', 'Borusan Mannesmann'],
    ['BUCIM', 'Bursa Çimento'], ['CCOLA', 'Coca-Cola İçecek'], ['CIMSA', 'Çimsa'],
    ['CWENE', 'CW Enerji'], ['DOAS', 'Doğuş Otomotiv'], ['DOHOL', 'Doğan Holding'],
    ['ECILC', 'Eczacıbaşı İlaç'], ['EGEEN', 'Ege Endüstri'], ['EKGYO', 'Emlak Konut GYO'],
    ['ENJSA', 'Enerjisa Enerji'], ['ENKAI', 'Enka İnşaat'], ['EREGL', 'Ereğli Demir Çelik'],
    ['EUPWR', 'Europower Enerji'], ['FROTO', 'Ford Otosan'], ['GARAN', 'Garanti BBVA'],
    ['GESAN', 'Girişim Elektrik'], ['GLYHO', 'Global Yatırım Holding'], ['GUBRF', 'Gübre Fabrikaları'],
    ['GWIND', 'Galata Wind Enerji'], ['HALKB', 'Halkbank'], ['HEKTS', 'Hektaş'],
    ['IPEKE', 'İpek Doğal Enerji'], ['ISCTR', 'Türkiye İş Bankası (C)'], ['ISDMR', 'İskenderun Demir Çelik'],
    ['ISMEN', 'İş Yatırım Menkul Değerler'], ['IZMDC', 'İzmir Demir Çelik'], ['KARSN', 'Karsan Otomotiv'],
    ['KCHOL', 'Koç Holding'], ['KLRHO', 'Kiler Holding'], ['KMPUR', 'Kimteks Poliüretan'],
    ['KONTR', 'Kontrolmatik Teknoloji'], ['KORDS', 'Kordsa Teknik Tekstil'], ['KOZAA', 'Koza Anadolu Metal'],
    ['KOZAL', 'Koza Altın'], ['KRDMD', 'Kardemir (D)'], ['MAVI', 'Mavi Giyim'],
    ['MGROS', 'Migros Ticaret'], ['MPARK', 'MLP Sağlık (Medical Park)'], ['NTHOL', 'Net Holding'],
    ['ODAS', 'Odaş Elektrik'], ['OTKAR', 'Otokar'], ['OYAKC', 'Oyak Çimento'],
    ['PENTA', 'Penta Teknoloji'], ['PETKM', 'Petkim'], ['PGSUS', 'Pegasus Hava Yolları'],
    ['QUAGR', 'QUA Granite'], ['REEDR', 'Reeder Teknoloji'], ['SAHOL', 'Sabancı Holding'],
    ['SASA', 'Sasa Polyester'], ['SELEC', 'Selçuk Ecza Deposu'], ['SISE', 'Şişecam'],
    ['SKBNK', 'Şekerbank'], ['SMRTG', 'Smart Güneş Enerjisi'], ['SOKM', 'Şok Marketler'],
    ['TABGD', 'TAB Gıda'], ['TAVHL', 'TAV Havalimanları'], ['TCELL', 'Turkcell'],
    ['THYAO', 'Türk Hava Yolları'], ['TKFEN', 'Tekfen Holding'], ['TOASO', 'Tofaş Oto Fabrika'],
    ['TSKB', 'T. Sınai Kalkınma Bankası'], ['TTKOM', 'Türk Telekom'], ['TTRAK', 'Türk Traktör'],
    ['TUPRS', 'Tüpraş'], ['TURSG', 'Türkiye Sigorta'], ['ULKER', 'Ülker Bisküvi'],
    ['VAKBN', 'VakıfBank'], ['VESBE', 'Vestel Beyaz Eşya'], ['VESTL', 'Vestel'],
    ['YEOTK', 'Yeo Teknoloji'], ['YKBNK', 'Yapı ve Kredi Bankası'], ['ZOREN', 'Zorlu Enerji']
  ];

  /* ---------- ABD hisseleri ---------- */
  const US = [
    ['AAPL', 'Apple'], ['ABBV', 'AbbVie'], ['ABNB', 'Airbnb'], ['ADBE', 'Adobe'],
    ['AMD', 'Advanced Micro Devices'], ['AMZN', 'Amazon'], ['ARM', 'Arm Holdings'],
    ['AVGO', 'Broadcom'], ['BA', 'Boeing'], ['BAC', 'Bank of America'],
    ['BRK-B', 'Berkshire Hathaway (B)'], ['CAT', 'Caterpillar'], ['COIN', 'Coinbase'],
    ['COST', 'Costco'], ['CRM', 'Salesforce'], ['CSCO', 'Cisco'], ['DIS', 'Walt Disney'],
    ['F', 'Ford Motor'], ['GM', 'General Motors'], ['GOOGL', 'Alphabet (Google)'],
    ['GS', 'Goldman Sachs'], ['HD', 'Home Depot'], ['INTC', 'Intel'], ['JNJ', 'Johnson & Johnson'],
    ['JPM', 'JPMorgan Chase'], ['KO', 'Coca-Cola'], ['LLY', 'Eli Lilly'], ['MA', 'Mastercard'],
    ['META', 'Meta Platforms'], ['MRK', 'Merck'], ['MS', 'Morgan Stanley'], ['MSFT', 'Microsoft'],
    ['MU', 'Micron'], ['NFLX', 'Netflix'], ['NKE', 'Nike'], ['NVDA', 'NVIDIA'],
    ['ORCL', 'Oracle'], ['PEP', 'PepsiCo'], ['PFE', 'Pfizer'], ['PG', 'Procter & Gamble'],
    ['PLTR', 'Palantir'], ['PYPL', 'PayPal'], ['QCOM', 'Qualcomm'], ['SBUX', 'Starbucks'],
    ['SHOP', 'Shopify'], ['SNOW', 'Snowflake'], ['T', 'AT&T'], ['TSLA', 'Tesla'],
    ['TSM', 'TSMC'], ['TXN', 'Texas Instruments'], ['UBER', 'Uber'], ['UNH', 'UnitedHealth'],
    ['V', 'Visa'], ['VZ', 'Verizon'], ['WMT', 'Walmart'], ['XOM', 'Exxon Mobil']
  ];

  /* ---------- ETF / endeks fonları ---------- */
  const ETF = [
    ['SPY', 'S&P 500 ETF (SPDR)'], ['VOO', 'Vanguard S&P 500'], ['IVV', 'iShares Core S&P 500'],
    ['QQQ', 'Nasdaq 100 (Invesco)'], ['VTI', 'Vanguard Total Stock Market'],
    ['DIA', 'Dow Jones ETF'], ['IWM', 'Russell 2000'], ['EEM', 'Gelişen Piyasalar'],
    ['VEA', 'Gelişmiş Piyasalar (ABD dışı)'], ['GLD', 'Altın ETF (SPDR)'],
    ['SLV', 'Gümüş ETF (iShares)'], ['ARKK', 'ARK Innovation'], ['XLK', 'Teknoloji Sektörü'],
    ['XLF', 'Finans Sektörü'], ['XLE', 'Enerji Sektörü'], ['SCHD', 'Schwab Temettü'],
    ['VNQ', 'Gayrimenkul (REIT)'], ['TLT', 'ABD 20+ Yıl Tahvil'], ['BND', 'Toplam Tahvil Piyasası']
  ];

  const map = (arr, market, suffix) => arr.map(([code, name]) => ({
    code, name, market, yahoo: suffix ? code + suffix : code
  }));

  const ALL = [].concat(
    map(BIST, 'Borsa İstanbul', '.IS'),
    map(US, 'ABD Borsaları', ''),
    map(ETF, 'ETF / Endeks', '')
  );

  return {
    BIST: map(BIST, 'Borsa İstanbul', '.IS'),
    US: map(US, 'ABD Borsaları', ''),
    ETF: map(ETF, 'ETF / Endeks', ''),
    ALL,
    find: code => ALL.find(s => s.code === String(code || '').toUpperCase()) || null
  };
})();
