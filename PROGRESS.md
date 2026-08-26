# PROGRESS.md — Servet: mimari, durum ve çalışma notları

> Bu dosya **yeni bir oturumun kodu sıfırdan öğrenmesi** için yazıldı.
> Kullanıcıya dönük anlatım `README.md`'dedir; burası geliştirici notudur.
> Son güncelleme: 2026-08-27 · Sürüm **2.4.0**

---

## 1. Uygulama nedir?

Türkçe, tek kullanıcılı, **backend'siz** bir varlık/portföy takip PWA'sı.
Kullanıcı altın, hisse, nakit, kripto, gayrimenkul vb. varlıklarını **nerede tuttuğuyla
birlikte** (elde / bankada / Midas gibi platformda / kasada) kaydeder; uygulama fiyatları
internetten çeker, kâr/zarar ve dağılım analizleri üretir.

**Temel kısıtlar (tasarım kararı):**
- Sunucu yok, hesap yok, derleme adımı yok. Saf HTML + CSS + vanilla JS.
- Tüm veri `localStorage`'da, yalnızca kullanıcının cihazında.
- Hiçbir kişisel veri dışarı gitmez; dış istekler sadece fiyat/kur/banka listesi/TÜFE içindir.
- Bağımlılık yok (npm paketi kullanılmaz). Tek istisna: `tools/test-qr.mjs` isteğe bağlı `jsqr`.

---

## 2. Dosya haritası

```
index.html                Uygulama kabuğu, splash, kilit kapısı, script sırası
css/style.css             Tüm stiller (tek dosya, ~1400 satır)
js/lock.js                PIN kilidi + AES-GCM şifreleme      ← Store'dan ÖNCE yüklenir
js/symbols.js             BIST/ABD hisse + ETF listeleri (statik veri)
js/data.js                Varlık türleri, saklama yerleri, para birimleri, maden ürünleri,
                          işlem türleri, banka/platform yedek listeleri, grafik paleti
js/store.js               ⭐ Veri katmanı: durum, kalıcılık, doğrulama, tüm hesaplar
js/charts.js              Bağımlılıksız SVG grafikler (halka, alan, sütun, yığılmış)
js/market.js              ⭐ Dış veri: kur, kapalıçarşı, kripto, hisse, TÜFE, banka listesi
js/qr.js                  QR kodu üreteci (byte modu, sürüm 1–40, L/M/Q/H)
js/transfer.js            QR ile cihazdan cihaza aktarım (çok kareli protokol)
js/onboard.js             Kurulum testi (ilk açılış sihirbazı)
js/app.js                 ⭐ Arayüz: router, 5 sayfa, tüm modallar, seçiciler, olaylar
sw.js                     Service worker (kabuk cache-first, API network-first)
manifest.webmanifest      PWA manifesti
icons/                    Üretilmiş PNG'ler + icon.svg
tools/make-icons.mjs      Bağımlılıksız PNG üreteci (kendi PNG kodlayıcısı + rasterleyici)
tools/test-store.mjs      Hesap katmanı testleri (55)
tools/test-qr.mjs         QR testleri (24, jsQR varsa tam doğrulama)
tools/smoke.js            Tarayıcı duman testi (21 adım, konsola yapıştırılır)
```

**Yükleme sırası önemlidir** (`index.html`): `lock.js` → `symbols.js` → `data.js` →
`store.js` → `charts.js` → `market.js` → `qr.js` → `transfer.js` → `onboard.js` →
*(kilit kapısı script'i)* → `app.js`.

Her modül `window.X = (function(){...})()` kalıbıyla global yayımlar (ES modül yok, çünkü
`file://` üzerinden de açılabilsin).

---

## 3. Durum şeması (`Store.state`)

```js
{
  schema: 1,
  profile: { name, email, createdAt },
  settings: {
    baseCurrency: 'TRY',       // raporlama para birimi
    theme: 'navy-gold' | 'light-gold',
    locale: 'tr-TR',
    autoPrices: true,          // piyasa fiyatı çekimi — daima açık (ayar kaldırıldı, 2.4.0)
    stockPrices: false,        // hisse çekimi (vekil kullandığı için opt-in)
    autoRates: true,           // kur çekimi — daima açık (ayar kaldırıldı, 2.4.0)
    assetTypes: [],            // kurulum testinde seçilen türler; boş = tümü
    showSplash: true,
    compactNumbers: false,
    costMethod: 'fifo' | 'average',
    notifications: { priceAlerts, priceThreshold, rebalance, weeklySummary },
    rebalanceTargets: { [assetTypeId]: yüzde },
    inflationRate: null,       // null → Dünya Bankası'ndan çekilir
    snapshotDaily: true,
    onboarded: false,
    lastBackupAt: 0, backupReminder: true
  },
  assets: [ Asset ],
  sales:  [ Sale ],            // kapanan/kısmi satışlar
  income: [ Income ],          // temettü/faiz/kira
  transactions: [ Tx ],        // denetim izi (en yeni başta, üst sınır 5000)
  snapshots: [ Snapshot ],     // günlük portföy değeri (grafik kaynağı)
  customLists: { banks, platforms, custody },
  cache: { banks, banksAt, banksSource, rates, ratesAt, ratesSource,
           cpi, cpiAt, tr, trAt, trUpdate, prices, pricesAt, stocks, sources }
}
```

### Asset
```js
{ id, name, type, symbol, quantity, unit, unitPrice, unitCost, currency,
  acquiredAt, maturityDate, interestRate, autoPrice,
  location: { kind, name, account },
  lots: [ { id, date, quantity, unitCost, note } ],
  notes, createdAt, updatedAt }
```
- `type` → `DATA.ASSET_TYPES` id'si (gold, silver, stock, etf, cash, crypto, deposit…)
- `symbol` çok işlevlidir: altın/gümüşte **kapalıçarşı ürün anahtarı** (`GRA`,
  `CEYREKALTIN`), kriptoda `BTC`, hissede `THYAO`/`AAPL`.
- `unitCost` kalan lotların **ağırlıklı ortalaması** olarak senkron tutulur (`syncFromLots`).
- `location.kind` → `physical | bank | platform | custody | other`

### Snapshot (kritik ayrıntı)
```js
{ date: 'YYYY-MM-DD', total: <TRY cinsinden>, base: 'TRY', currency: 'TRY',
  synthetic?: true, byType: {...}, byLocation: {...} }
```
**Daima TRY tabanında saklanır.** `Store.series(days, cur)` okuma anında hedef para birimine
çevirir. Eski kayıtlar `base`/`currency` alanından çevrilir. Bu sayede raporlama para birimi
değişince grafik geçmişi bozulmaz. `synthetic: true` yalnızca `seedDemo`'nun ürettiği sahte
geçmiştir; `rescaleSynthetic()` bunu güncel toplamla ölçekler (yoksa grafikte sahte uçurum olur).

---

## 4. Store API (özet)

| Alan | Fonksiyonlar |
|---|---|
| Kalıcılık | `save(silent)` (80 ms debounce), `flush()`, `reload()`, `subscribe(fn)` |
| Sayı | `parseNum(v)` — `"7.200"`→7200, `"12,5"`→12.5, `"₺1.500,25"`→1500.25 |
| CRUD | `addAsset`, `updateAsset`, `removeAsset`, `getAsset`, `validateAsset` |
| Lot | `ensureLots`, `addLot`, `removeLot`, `avgCost`, `previewCost`, `validateLot` |
| Satış | `sellAsset(id, input)`, `validateSale`, `realizedTotals`, `deleteSale` |
| Getiri | `addIncome`, `deleteIncome`, `incomeTotals`, `totalReturn`, `INCOME_KINDS` |
| Değerleme | `convert`, `assetValue`, `assetCost`, `totals`, `byType`, `byLocationKind`, `byCurrency` |
| Seri | `takeSnapshot`, `series(days, cur)`, `seriesFrom`, `performance`, `performanceSince` |
| Analiz | `rebalancePlan`, `setTargets`, `maturities`, `realReturn`, `inflationRate` |
| Durum | `missingRates`, `autoPriceStatus`, `backupStatus`, `markBackedUp`, `cashAssets` |
| Biçim | `fmtMoney`, `fmtNum`, `fmtPct`, `fmtDate`, `fmtDateTime`, `relTime` |
| Aktarım | `exportJSON`, `exportAssetsCSV`, `exportTxCSV`, `exportSalesCSV`, `importJSON` |

**Hesap kuralları (test edilmiştir):**
- `totals().pl` yalnızca **maliyeti bilinen** varlıkların değeri üzerinden hesaplanır;
  maliyetsiz varlığın tüm değeri kâr sayılmaz.
- Kuru bilinmeyen varlık toplama katılmaz; `unknownFx` + `missingCurrencies` ile bildirilir
  (arayüzde ana sayfa bandı).
- `convert` kuru bilinmiyorsa `NaN` döner — çağıranlar bunu kontrol etmelidir.
- Satışta maliyet esası `consumeLots` ile FIFO veya ortalama olarak hesaplanır.

---

## 5. Dış veri katmanı (`market.js`)

| Kaynak | Uç | TTL | Not |
|---|---|---|---|
| Döviz kuru | `open.er-api.com/v6/latest/TRY` | 6 sa | `rates[X] = 1 X kaç TRY` |
| Kapalıçarşı | `finans.truncgil.com/v4/today.json` | 30 dk | gram/çeyrek/tam/ata/ayar altınları, gümüş, döviz |
| Kripto | `api.coingecko.com/simple/price` | 30 dk | `COIN_IDS` haritası sembol→id |
| Hisse/ETF | Yahoo chart ucu, vekil zinciriyle (`r.jina.ai` → allorigins → corsproxy) | 15 dk | **opt-in**; BIST'e `.IS` eklenir |
| Banka listesi | `raw.githubusercontent.com/tgezginis/turkish_bin_numbers` | 7 gün | yerel listeyle birleştirilir |
| TÜFE | `api.worldbank.org` (TR, FP.CPI.TOTL.ZG) | 30 gün | reel getiri için |

**Neden vekil?** Yahoo CORS başlığı vermez; `r.jina.ai` okuma vekili `Origin`'i yansıtır.
Anahtarsız kullanımda dakikada 20 istekle sınırlı olduğu için `PROXIES` dizisi sırayla denenir
(ilk hata saklanır, kullanıcıya o gösterilir). Vekile **yalnızca sembol** gider. Bu yüzden `settings.stockPrices` varsayılan `false` ve
kullanıcıdan açık onay istenir.

**Önemli fonksiyonlar:**
- `refreshAll(force)` → kur + fiyat + banka + TÜFE; `{rates, prices, banks, errors, failed}`
- `fetchOne(asset)` → tek varlık için anında fiyat (varlık kaydedilir kaydedilmez çağrılır)
- `diagnose()` → her kaynağı tek tek dener, süre + sonuç döndürür (Ayarlar'daki test düğmesi)
- `note(key, ok, msg)` → `cache.sources`'a kaynak durumu yazar (Ayarlar'da ✓/✕ listesi)
- `errMsg(e)` → tarayıcı hatasını Türkçeleştirir (zaman aşımı, 429, çevrimdışı, bağlantı yok).
  Kullanıcıya gösterilen her hata metni bundan geçer.
- `refreshRates`/`refreshBanks` hatayı yutup yedeğe düştüğü için durumlarını `ratesOk`/`banksOk`
  bayraklarıyla `refreshAll`'a bildirir — aksi halde "her şey yolunda" görünüyordu.
- `fetchTR(force)` — `force` zinciri kırılmasın diye; eskiden "Şimdi yenile" 30 dk boyunca
  kapalıçarşıyı tazelemiyordu.

**Fiyat uygulama sırası** (`refreshPrices`): kripto → maden (kapalıçarşı, yoksa ons/gram) →
hisse (tekilleştirilmiş, 3'erli paralel, önbellekli) → varlıklara yaz → `pricesAt` güncelle.

---

## 6. Arayüz (`app.js`)

Hash tabanlı router: `#/` (dashboard), `#/assets`, `#/stats`, `#/history`, `#/settings`.
`navigate()` görünümü tamamen yeniden çizer (`view.innerHTML = ''` → render).
Durum tutan sayfa yok; filtreler modül seviyesi nesnelerde (`assetFilter`, `histFilter`, `statRange`).

**Ortak bileşenler:**
- `openModal(html, opts)` / `closeModal()` — **yığılabilir** (seçici, form üstünde açılır),
  odak tuzağı içerir, kapanışta `modal:closed` olayı yayar.
- `openPicker({title, groups, value, allowCustom, onPick})` — üstte arama, gruplanmış liste,
  ok tuşları + Enter. "Kendim yazayım" satırı **en sonda** durur (gerçek eşleşmeler öne geçsin).
- `openRowMenu(assetId, btn)` — satır ⋯ menüsü. **`document.body`'ye eklenir**, `position:fixed`,
  ekran içine sıkıştırılır. (Tablo `overflow:auto` ve kart `transform` kırpıyordu.)
- `toast(msg, kind, action)` — `action` verilirse düğmeli/kalıcı toast (SW güncellemesi).
- `banners()` — ana sayfa uyarı bantları: eksik kur, vade, sıfır fiyat, yedek hatırlatması.
- `confirmDialog(title, htmlMessage, okLabel)` → Promise\<boolean\>

**Varlık türü listesi**: `formTypes()` yalnızca `settings.assetTypes` (kurulum testinde
seçilenler) döndürür; kalanlar "+N tür daha" düğmesiyle açılır. Düzenlenen varlığın türü ve
gizli listeden seçilip kaydedilen tür listeye eklenir. Ayarlar → Kurulum Testi'ndeki
"Tüm türleri göster" listeyi boşaltır (= tümü).

**Varlık formu (`openAssetForm`) — alan görünürlüğü dinamiktir** (`syncTypeFields`):
- Otomatik fiyat çekilecekse "Güncel birim değer" gizlenir.
- Nakitte maliyet ve birim değer gizlenir (`unitPrice` daima 1).
- Vade/faiz yalnızca `deposit`/`bond` türlerinde.
- Fiyatlanamayan türlerde "Sembol / kod" alanı **Detaylar** bölümüne taşınır (DOM'da yer değiştirir,
  değer korunur).
- Nadir alanlar (para birimi, birim, tarih, hesap notu, not, otomatik fiyat) katlanır
  `<details class="adv">` içindedir.

---

## 7. Kritik tuzaklar (hepsi bir kez ısırdı)

1. **`deepMerge` ve `null`** — `'x' in null` TypeError fırlatır. Kayıtta `null` olan alan
   (`cache.rates`) yüzünden yükleme çöküyor ve **tüm veri sıfırlanıyordu**. Artık iki taraf da
   düz nesne değilse kayıtlı değer kazanır.
2. **`transform` + `position:fixed`** — Animasyon `forwards` ile bitince `.app` üzerinde
   `transform: matrix(1,0,0,1,0,0)` kalıyor ve içeren blok oluşturuyordu; alt menü/modal sayfa
   sonuna kayıyordu. Çözüm: animasyon bitince `.ready` kaldırılıp `.shown` ekleniyor.
   **Aynı tuzak** `.card:hover{transform}` yüzünden satır menüsünde tekrar çıktı → menü body'ye taşındı.
3. **`[hidden]` vs `display`** — `.menu{display:grid}` UA'nın `[hidden]{display:none}` kuralını
   ezer; tüm menüler aynı anda görünüyordu. `.menu[hidden]{display:none}` gerekir.
4. **Tarayıcı önbelleği** — `index.html`'i sürümlemek yeterli değil; `js/*.js` de eskiyor.
   Tüm yerel kaynaklar `?v=SÜRÜM` taşır ve `sw.js` içindeki `VERSION` ile **birlikte** artırılır.
   Geliştirirken `index.html?nosw` ile SW kaydı atlanır ve önbellek temizlenir.
5. **Arka plan sekmesinde zamanlayıcı kısıtlaması** — Chrome, görünmeyen sekmede `setTimeout`'u
   kısar; duman testi dakikalarca "asılı" görünür. Testi **görünür sekmede** çalıştırın.
6. **`inline` eleman + `width`** — `.bar-fill` bir `<i>` idi, `display:block` olmadan genişlik
   uygulanmıyordu.
7. **Grid taşması** — flex çocuk (`.picker-btn`) `min-width:auto` yüzünden sütununa sığmayıp
   komşu alanın üstüne biniyordu. `.form-grid > *{min-width:0}` şart.
8. **Debounce'lu kayıt** — `save()` 80 ms gecikmelidir; sekme kapanışında `flush()` çağrılır
   (`pagehide`/`beforeunload`/`visibilitychange`). Test yazarken `location.reload()` öncesi
   `Store.flush()` gerekir.
9. **Ondalık belirsizliği** — `"7.200"` Türkçede 7200, standartta 7,2. Kural: tek nokta +
   tam üç basamak → binlik. Belirsizlik gizlenmez: alandan çıkınca değer yorumlandığı biçimde
   geri yazılır (`focusout` → `fmtNum`).

---

## 8. PIN kilidi / şifreleme (`lock.js`)

- `localStorage['servet.v1.enc']` = `{v, iter, salt, iv, data}` (base64), AES-GCM 256,
  anahtar PBKDF2-SHA256 · 250.000 tur.
- Çözülen düz metin geçici olarak `servet.v1`'e yazılır (Store normal çalışsın diye),
  sekme kapanırken `scrubPlain()` ile silinir; `persist()` her kayıttan sonra şifreliyi tazeler.
- `index.html` içindeki küçük kapı script'i, `Lock.isEnabled()` ise `Lock.unlockScreen()`
  promise'ini `window.__servetBootGate`'e koyar; `app.js`'teki `boot()` bunu bekler,
  sonra `Store.reload()` + `Lock.attach()` + `init()`.
- **PIN unutulursa kurtarma yoktur.** Kurulumdan önce JSON yedek indirmek zorunludur.

---

## 9. QR aktarımı (`qr.js` + `transfer.js`)

- Protokol: `SVT1:<sid>:<i>:<n>:<flag>:<base64url parça>` — `flag` `z` (deflate-raw) veya `p`.
- Kare başına 480 karakter (≈ QR sürüm 15, EC L). Çok kareli veri 900 ms'de bir döner.
- Okuma `BarcodeDetector` gerektirir: Android Chrome/macOS'ta var, **Windows masaüstünde yok**.
  Tipik akış "telefon bilgisayarın ekranını okur". Desteklenmeyen tarayıcı için metin yapıştırma.
- `qr.js` içindeki en ince yer: kısa bloklara **dolgu baytı** eklenir ve interleave sırasında
  atlanır. Bu atlanınca hiçbir kod çözülmüyordu.

---

## 10. Test altyapısı

```bash
node tools/test-store.mjs      # 55 test — hesaplar
node tools/test-qr.mjs         # 24 test — QR (jsqr varsa tam)
node tools/make-icons.mjs      # ikonları yeniden üretir
```
Tarayıcı: uygulamayı **görünür sekmede** açın, konsola `tools/smoke.js` içeriğini yapıştırıp
`await smoke()` → 21 adım (5 sayfa, 15 varlık türü formu, seçiciler, satış/alım/lot/getiri/
hedef/işlem/QR/kurulum/menü konumu, hesap doğrulamaları, şifreleme turu).

`test-store.mjs`, `store.js`'i `node:vm` ile sahte `localStorage`/`document` içinde yükler.
Bu yüzden **`store.js` tarayıcıya sıkı bağımlı olmamalıdır** (`Market` çağrısı savunmalıdır).

---

## 11. Sürüm çıkarma kontrol listesi

1. `index.html` içindeki tüm `?v=` değerlerini artır.
2. `sw.js` içindeki `VERSION` **ve** `?v=` değerlerini aynı sayıya getir.
3. `node tools/test-store.mjs && node tools/test-qr.mjs`
4. Tarayıcıda `await smoke()` → 0 hata.
5. İkon değiştiyse `node tools/make-icons.mjs`.

Sürüm tutarlılığını doğrulayan hazır komut için bkz. bu dosyanın 12. bölümündeki tek satırlık kontrol.

---

## 12. Faydalı tek satırlıklar

```bash
# Tüm JS sözdizimi + manifest + referans + sürüm tutarlılığı kontrolü
node -e "const fs=require('fs');for(const f of fs.readdirSync('js'))new Function(fs.readFileSync('js/'+f,'utf8'));const h=fs.readFileSync('index.html','utf8'),s=fs.readFileSync('sw.js','utf8');console.log((h.match(/\?v=([0-9.]+)/)||[])[1]===(s.match(/servet-v([0-9.]+)/)||[])[1]?'sürüm tutarlı':'SÜRÜM UYUMSUZ')"

# Yerel sunucu (PWA ve fetch için gerekir)
python -m http.server 8777 --bind 127.0.0.1
```

---

## 13. Bilinen sınırlar / yapılmayanlar

- **Çok cihaz senkronu yok** — yalnızca QR veya JSON yedek.
- **BIST listesi elle yazılmıştır** (`js/symbols.js`, ~90 şirket); zamanla eskir.
  `Market.verifyPortfolioSymbols()` portföydeki sembolleri doğrular ama listeyi güncellemez.
- **Vergi/stopaj hesabı yok**; FIFO yalnızca kâr/zarar bilgisi içindir.
- **Platin/paladyum otomatik fiyatı yok** (kaynaktaki birim belirsiz olduğu için bilinçli olarak kapalı).
- `transactions` 5000 kayıtta kırpılır; `snapshots` 1000 günde.
- Telefonda yakınlaştırma kapalıdır (`user-scalable=no`) — bilinçli bir erişilebilirlik ödünü.

---

## 14. Kod yazım alışkanlıkları

- **Arayüz metinleri Türkçe**, kod tanımlayıcıları İngilizce, yorumlar Türkçe.
- Kullanıcıdan gelen her metin `esc()` ile kaçırılır (`app.js`, `transfer.js`, `onboard.js`
  kendi `esc`'lerini taşır).
- Para/sayı gösterimi daima `Store.fmt*` üzerinden; ham `toFixed` kullanılmaz.
- Yeni sayı alanı eklerken: `type="text" inputmode="decimal"` + `Store.parseNum` ile oku.
- Yeni modal eklerken: `openModal` kullan, kapanışta temizlik gerekiyorsa `modal:closed` dinle,
  ve `tools/smoke.js`'e bir adım ekle.
- Yeni hesap eklerken: `store.js`'e yaz, `tools/test-store.mjs`'e test ekle (arayüze değil).
