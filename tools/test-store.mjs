/* =====================================================================
   test-store.mjs — Hesap katmanı testleri (bağımlılıksız)
   Çalıştırma:  node tools/test-store.mjs
   store.js tarayıcı dışında, sahte bir localStorage ile yüklenir.
   ===================================================================== */
import fs from 'node:fs';
import vm from 'node:vm';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function loadStore() {
  const mem = new Map();
  const ctx = {
    window: {}, console, Intl, Date, Math, JSON, setTimeout, clearTimeout,
    localStorage: {
      getItem: k => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
      removeItem: k => mem.delete(k)
    },
    document: { addEventListener() {}, hidden: false },
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } }
  };
  ctx.window.addEventListener = () => {};
  ctx.window.dispatchEvent = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(resolve(ROOT, 'js/data.js'), 'utf8'), ctx);
  ctx.DATA = ctx.window.DATA;
  vm.runInContext(fs.readFileSync(resolve(ROOT, 'js/store.js'), 'utf8'), ctx);
  const S = ctx.window.Store;
  S.resetAll();
  S.state.cache.rates = { TRY: 1, USD: 40, EUR: 45 };   // 1 USD = 40 TRY
  return S;
}

let failed = 0, passed = 0;
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  ✔ ' + name); }
  else { failed++; console.log('  ✘ ' + name + (detail ? '  → ' + detail : '')); }
}
const group = n => console.log('\n' + n);

/* ---------- 1) Sayı ayrıştırma (Türkçe ondalık) ---------- */
group('parseNum — virgüllü girdi');
{
  const S = loadStore();
  check('"12,5" → 12.5', S.parseNum('12,5') === 12.5);
  check('"1.234,56" → 1234.56', S.parseNum('1.234,56') === 1234.56);
  check('"1234.56" → 1234.56', S.parseNum('1234.56') === 1234.56);
  check('"7.200" → 7200 (TR binlik)', S.parseNum('7.200') === 7200);
  check('"7.2" → 7.2 (ondalık)', S.parseNum('7.2') === 7.2);
  check('"1.234.567" → 1234567', S.parseNum('1.234.567') === 1234567);
  check('"₺1.500,25" → 1500.25', S.parseNum('₺1.500,25') === 1500.25);
  check('boş → NaN', isNaN(S.parseNum('')));
  check('"abc" → NaN', isNaN(S.parseNum('abc')));
  check('virgüllü miktar varlığa doğru yazılır', (() => {
    const a = S.addAsset({ name: 'Test', type: 'gold', quantity: '12,5', unitPrice: '7.000,50',
      unitCost: '', currency: 'TRY', location: { kind: 'physical', name: '' } });
    return a.quantity === 12.5 && a.unitPrice === 7000.5;
  })());
}

/* ---------- 2) Kâr/zarar: maliyetsiz varlık kâr sayılmamalı ---------- */
group('totals — kâr/zarar hesabı');
{
  const S = loadStore();
  S.addAsset({ name: 'Maliyetli', type: 'gold', quantity: 1, unitPrice: 100, unitCost: 60,
    currency: 'TRY', location: { kind: 'physical', name: '' } });
  S.addAsset({ name: 'Maliyetsiz', type: 'realestate', quantity: 1, unitPrice: 50, unitCost: '',
    currency: 'TRY', location: { kind: 'physical', name: '' } });
  const t = S.totals();
  check('toplam değer 150', near(t.value, 150), 'value=' + t.value);
  check('K/Z 40 (maliyetsiz varlık kâra yazılmaz)', near(t.pl, 40), 'pl=' + t.pl);
  check('K/Z yüzdesi %66,67', near(t.plPct, 66.67, 0.1), 'plPct=' + t.plPct);
}

/* ---------- 3) Kuru bilinmeyen varlık ---------- */
group('totals — eksik kur bildirimi');
{
  const S = loadStore();
  S.addAsset({ name: 'TL', type: 'cash', quantity: 100, unitPrice: 1, unitCost: 1,
    currency: 'TRY', location: { kind: 'bank', name: 'X' } });
  S.addAsset({ name: 'Yen', type: 'cash', quantity: 1000, unitPrice: 1, unitCost: 1,
    currency: 'JPY', location: { kind: 'bank', name: 'X' } });
  const t = S.totals();
  check('kuru olmayan varlık sayılır', t.unknownFx === 1, 'unknownFx=' + t.unknownFx);
  check('eksik para birimi bildirilir', t.missingCurrencies.join() === 'JPY', t.missingCurrencies.join());
  check('missingRates() JPY döndürür', S.missingRates().includes('JPY'));
  check('toplam yalnızca bilinenleri içerir', near(t.value, 100), 'value=' + t.value);
}

/* ---------- 4) Anlık görüntüler para biriminden bağımsız ---------- */
group('series — para birimi değişince geçmiş bozulmaz');
{
  const S = loadStore();
  S.addAsset({ name: 'Altın', type: 'gold', quantity: 10, unitPrice: 8000, unitCost: 4000,
    currency: 'TRY', location: { kind: 'physical', name: '' } });
  S.takeSnapshot(true);
  const tryPoint = S.series(0, 'TRY')[0];
  check('TRY serisi 80.000', near(tryPoint.total, 80000), 'total=' + tryPoint.total);
  S.settings.baseCurrency = 'USD';
  const usdPoint = S.series(0)[0];
  check('USD serisi 2.000 (40 TRY/USD)', near(usdPoint.total, 2000), 'total=' + usdPoint.total);
  // Eski biçimde (USD tabanlı) kaydedilmiş bir geçmiş kaydı da doğru çevrilmeli
  S.state.snapshots.unshift({ date: '2020-01-01', total: 500, currency: 'USD' });
  const mixed = S.series(0, 'TRY');
  check('eski USD kaydı TRY’ye çevrilir', near(mixed[0].total, 20000), 'total=' + mixed[0].total);
  check('performans aynı para biriminde ölçülür',
    near(S.performance(0, 'TRY').pct, (80000 - 20000) / 20000 * 100, 0.1));
}

/* ---------- 5) Satış: gerçekleşen K/Z ve nakde dönüşüm ---------- */
group('sellAsset — hasılat, K/Z ve nakit');
{
  const S = loadStore();
  const a = S.addAsset({ name: 'Gram Altın', type: 'gold', quantity: 100, unitPrice: 7000,
    unitCost: 4000, currency: 'TRY', location: { kind: 'physical', name: 'Kasa' } });

  const sale = S.sellAsset(a.id, { quantity: '40', unitPrice: '7.200', fee: '200',
    proceedsTo: { mode: 'new', currency: 'TRY' } });
  check('hasılat = 40×7200 − 200', near(sale.proceeds, 287800), 'proceeds=' + sale.proceeds);
  check('maliyet = 40×4000', near(sale.costBasis, 160000));
  check('gerçekleşen K/Z = 127.800', near(sale.realized, 127800), 'realized=' + sale.realized);
  check('kısmi satış: pozisyon açık', sale.closed === false);
  check('kalan miktar 60', near(S.getAsset(a.id).quantity, 60));

  const cash = S.cashAssets()[0];
  check('nakit hesabı oluşturuldu', !!cash);
  check('nakde hasılat kadar eklendi', cash && near(cash.quantity, 287800), cash && cash.quantity);
  check('portföy toplamı korunur (60×7000 + 287.800)',
    near(S.totals().value, 60 * 7000 + 287800), 'value=' + S.totals().value);

  const sale2 = S.sellAsset(a.id, { quantity: '60', unitPrice: '7000', fee: '0',
    proceedsTo: { mode: 'asset', id: cash.id } });
  check('tamamı satılınca pozisyon kapanır', sale2.closed === true);
  check('varlık portföyden çıkar', S.getAsset(a.id) === null);
  check('aynı nakit hesabına eklendi', near(S.cashAssets()[0].quantity, 287800 + 420000));
  check('gerçekleşen toplam K/Z', near(S.realizedTotals().realized, 127800 + (420000 - 240000)));
  check('satış geçmişe işlendi', S.transactions.some(t => t.type === 'sell'));
}

/* ---------- 6) Para birimi dönüşümü ---------- */
group('convert — çapraz kur');
{
  const S = loadStore();
  check('100 USD → 4.000 TRY', near(S.convert(100, 'USD', 'TRY'), 4000));
  check('4.000 TRY → 100 USD', near(S.convert(4000, 'TRY', 'USD'), 100));
  check('90 EUR → 101,25 USD', near(S.convert(90, 'EUR', 'USD'), 101.25));
  check('bilinmeyen kur → NaN', isNaN(S.convert(10, 'JPY', 'TRY')));
}

/* ---------- 7) Yedek durumu ---------- */
group('backupStatus');
{
  const S = loadStore();
  S.addAsset({ name: 'X', type: 'gold', quantity: 1, unitPrice: 1, unitCost: '',
    currency: 'TRY', location: { kind: 'physical', name: '' } });
  check('hiç yedek yoksa uyarı gerekir', S.backupStatus().due === true);
  S.markBackedUp();
  check('yedek sonrası uyarı kalkar', S.backupStatus().due === false);
  S.settings.lastBackupAt = Date.now() - 20 * 864e5;
  check('20 gün sonra tekrar uyarır', S.backupStatus().due === true);
}

/* ---------- 8) Lot bazlı maliyet (FIFO / ortalama) ---------- */
group('addLot & FIFO — kısmi satışta maliyet esası');
{
  const S = loadStore();
  const a = S.addAsset({ name: 'Altın', type: 'gold', quantity: 10, unitPrice: 8000, unitCost: 4000,
    currency: 'TRY', acquiredAt: '2024-01-10', location: { kind: 'physical', name: '' } });
  check('ilk kayıt lota dönüştü', a.lots.length === 1 && a.lots[0].quantity === 10);

  S.addLot(a.id, { quantity: '10', unitCost: '6000', date: '2025-06-01' });
  check('ikinci lot eklendi', S.getAsset(a.id).lots.length === 2);
  check('miktar 20 oldu', S.getAsset(a.id).quantity === 20);
  check('ortalama maliyet 5.000', near(S.getAsset(a.id).unitCost, 5000), S.getAsset(a.id).unitCost);

  const pv = S.previewCost(a.id, 10, 'fifo');
  check('FIFO önizleme maliyeti 40.000', near(pv.costBasis, 40000), pv.costBasis);
  check('önizleme lotları bozmadı', S.getAsset(a.id).lots.length === 2);

  const sale = S.sellAsset(a.id, { quantity: '10', unitPrice: '9000', fee: '0', costMethod: 'fifo',
    proceedsTo: { mode: 'none' } });
  check('gerçekleşen K/Z = 90.000 − 40.000', near(sale.realized, 50000), sale.realized);
  check('satış lot dökümü kaydedildi', sale.lots.length === 1 && near(sale.lots[0].unitCost, 4000));
  check('eski lot tükendi, yeni lot kaldı', S.getAsset(a.id).lots.length === 1);
  check('kalan ortalama maliyet 6.000', near(S.getAsset(a.id).unitCost, 6000), S.getAsset(a.id).unitCost);
  check('kalan miktar 10', near(S.getAsset(a.id).quantity, 10));
}

group('Ortalama maliyet yöntemi');
{
  const S = loadStore();
  const a = S.addAsset({ name: 'Gümüş', type: 'silver', quantity: 100, unitPrice: 100, unitCost: 40,
    currency: 'TRY', location: { kind: 'physical', name: '' } });
  S.addLot(a.id, { quantity: '100', unitCost: '80' });
  const sale = S.sellAsset(a.id, { quantity: '100', unitPrice: '120', fee: '0', costMethod: 'average',
    proceedsTo: { mode: 'none' } });
  check('ortalama maliyet 60 → esas 6.000', near(sale.costBasis, 6000), sale.costBasis);
  check('K/Z = 12.000 − 6.000', near(sale.realized, 6000), sale.realized);
  check('kalan miktar 100', near(S.getAsset(a.id).quantity, 100));
}

console.log(`\n${passed} test geçti, ${failed} başarısız.`);
process.exit(failed ? 1 : 0);
