# Servet — Varlık & Portföy Takibi

Altın, hisse, nakit, kripto, gayrimenkul ve diğer varlıklarınızı **nerede tuttuğunuzla birlikte**
(elde / bankada / Midas gibi platformlarda / kasada) takip eden, kurulum gerektirmeyen bir web
uygulaması. Lacivert–altın tema, giriş animasyonu, PWA desteği ve çevrimdışı çalışma.

> Geliştirici notu: mimari, veri şeması, dış servisler, bilinen tuzaklar ve sürüm
> çıkarma adımları için **[PROGRESS.md](PROGRESS.md)**.

## Çalıştırma

Uygulama tamamen statiktir (backend yok). `file://` üzerinden de açılır, ancak **PWA ve
service worker için bir sunucu gerekir**:

```bash
# proje klasöründe
python -m http.server 8777
# veya
npx serve .
```

Sonra tarayıcıda `http://127.0.0.1:8777/index.html` adresini açın.

Yayına almak için klasörü herhangi bir statik hosting'e (GitHub Pages, Netlify, Vercel,
Cloudflare Pages) yükleyin — HTTPS altında "Ana ekrana ekle" / "Uygulamayı yükle" çalışır.

## Sayfalar

| Sayfa | İçerik |
|---|---|
| **Ana Sayfa** | Toplam portföy, kâr/zarar, 7g / 30g / YTD performans, 90 günlük değer grafiği, varlık sınıfı ve saklama yeri dağılımı, en büyük 5 varlık, son hareketler |
| **Varlıklar** | **Portföy** ve **Satılanlar** sekmeleri. Portföyde arama, tür/saklama yeri filtresi, sıralama, ekle–düzenle–**sat**–sil; Satılanlar'da gerçekleşen kâr/zarar, hasılat ve kapanan pozisyonlar. CSV dışa aktarma |
| **İstatistik** | Dönem performansı, gerçekleşmemiş K/Z, yoğunlaşma (HHI), likidite oranı, sınıf bazında sütun grafik, saklama yeri kırılımı, kazandıran/kaybettiren varlıklar, para birimi riski, aylık nakit akışı |
| **Geçmiş** | Tüm hareketlerin güne göre gruplanmış denetim izi; tür, tarih aralığı ve metin filtresi, elle işlem ekleme, CSV dışa aktarma |
| **Ayarlar** | Üstte **arama kutusu**, altında açılır/kapanır bölümler: Profil · Para birimi & görünüm · Veri kaynakları · Bildirimler · Kurulum testi · Veri yönetimi · QR aktarım · Güvenlik |

## Kurulum testi (ilk açılış)

Uygulama ilk açıldığında giriş animasyonunun ardından kısa bir test başlar:
**"Nelere yatırım yapıyorsunuz?"** Seçtiğiniz her tür için yalnızca ürün, miktar ve saklama
yerini sorar; uzun varlık formuyla uğraşmazsınız. Her adım atlanabilir, "Şimdilik geç" ile
tamamen kapatılabilir. Sonradan **Ayarlar → Kurulum Testi → Çalıştır** ile tekrar açılır
(mevcut varlıklar silinmez, üzerine eklenir).

## Testler

```bash
node tools/test-store.mjs      # hesap katmanı: 55 test (parseNum, K/Z, kur, seri, satış, FIFO, yedek)
node tools/test-qr.mjs         # QR kodlayıcı: 24 test (jsQR ile kodla→çöz turu)
node tools/make-icons.mjs      # ikonları yeniden üretir (çıktı doğrulaması)
```

`test-qr.mjs`, kurulu ise **jsQR** ile üretilen kodları bağımsız olarak çözer;
kurulu değilse yapısal doğrulama yapar. Tam doğrulama için: `npm i jsqr`
(uygulamanın kendisi bağımlılıksızdır, bu yalnızca test içindir).

Arayüz regresyonları için tarayıcı duman testi: uygulamayı açın, DevTools konsoluna
`tools/smoke.js` içeriğini yapıştırıp `await smoke()` çalıştırın (20 adım).
Test, kurulum sihirbazını devre dışı bırakır ve gerekirse örnek portföyü kendisi yükler. Her sayfayı gezer,
15 varlık türünün formunu, seçicileri, satış/alım/lot/hedef/işlem/QR/kurulum ekranlarını
açar ve yakalanan hataları listeler. **Not:** sekme arka plandayken tarayıcı zamanlayıcıları
kıstığı için testi görünür sekmede çalıştırın.

## Alım lotları ve maliyet yöntemi (FIFO / ortalama)

Her alım ayrı bir **lot** olarak saklanır: tarih, miktar, birim maliyet, not.
Varlık satırındaki **Alım** düğmesi yeni lot ekler; miktar artar ve ortalama maliyet
yeniden hesaplanır. Birden çok lotu olan varlıkta satır altında “N alım” bağlantısı çıkar,
lot listesini ve her lotun güncel kâr/zararını gösterir.

Satışta maliyet esası seçilebilir:

- **FIFO** (varsayılan): önce alınan önce satılır. Satış ekranı hangi lotun ne kadar
  kullanıldığını canlı gösterir (`150 × ₺2.600 + 20 × ₺6.000`).
- **Ortalama maliyet**: tüm lotların ağırlıklı ortalaması kullanılır.

Örnek: 150 gram × ₺2.600 ve 50 gram × ₺6.000 alınmışsa, 170 gramın satışında
FIFO ₺510.000, ortalama ₺586.500 maliyet esası verir — ikisi de tek tıkla karşılaştırılabilir.

## Nakit getiriler (temettü / faiz / kira)

Varlık satırındaki **⋯ → Getiri ekle** ile temettü, faiz/kupon, kira veya stake ödülü
kaydedilir. Tutar istenirse doğrudan bir nakit hesabına eklenir; eklenmese bile
**toplam getiri** hesabına dahil olur.

İstatistik sayfasındaki **Toplam Getiri** KPI'ı üç bileşeni birleştirir:
gerçekleşmemiş K/Z + gerçekleşen (satış) K/Z + nakit getiriler.

## Vade takibi

Vadeli mevduat ve tahvil eklerken **vade tarihi** ve **yıllık faiz** girilebilir.
Vadeye 7 gün kalınca ana sayfada uyarı bandı çıkar; İstatistik sayfasındaki
**Yaklaşan Vadeler** kartı tüm vadeleri, kalan günü ve kalan güne düşen basit faizi listeler.

## Reel getiri (enflasyon sonrası)

Yıllık TÜFE **Dünya Bankası API'sinden** otomatik çekilir (CORS açık, anahtarsız);
Ayarlar → Bildirimler'den elle de girilebilir. Reel getiri
`(1 + nominal) / (1 + enflasyon) − 1` formülüyle hesaplanır ve İstatistik'te KPI olarak görünür.

## PIN kilidi ve şifreleme

**Ayarlar → PIN Kilidi & Şifreleme**. Açıldığında portföy localStorage'da düz metin yerine
**AES-GCM 256** ile şifreli tutulur; anahtar PIN'den **PBKDF2 (250.000 tur)** ile türetilir ve
hiçbir yerde saklanmaz. Uygulama her açılışta PIN sorar; sekme kapanırken düz kopya silinir.

- Kurulumdan önce **JSON yedek indirmek zorunludur** — PIN unutulursa veri kurtarılamaz.
- Yanlış PIN denemeleri reddedilir, kilit ekranı açık kalır.
- **Şimdi kilitle**, **PIN'i değiştir** ve **şifrelemeyi kapat** işlemleri aynı bölümde.
- Güvenli bağlam gerekir (https veya localhost); desteklenmiyorsa bölüm bunu söyler.
- JSON yedekleri **şifresizdir** — güvenli bir yerde saklayın.

## Hedef dağılım ve dengeleme

**İstatistik → Hedef Dağılım**'da her varlık sınıfı için hedef yüzde belirlenir
(toplamın 100 olması şart değil, oranlar normalize edilir). Kart; hedef ile mevcut oranı,
sapmayı ve hedefe dönmek için sınıf bazında **“Al ₺X / Sat ₺Y”** tutarını gösterir.
Toplam sapma %10'u aşarsa açılışta hatırlatılır (Bildirimler'den kapatılabilir).

## Satış ve gerçekleşen kâr/zarar

Varlık satırındaki **Sat** düğmesi satış ekranını açar: miktar, satış fiyatı, komisyon ve tarih.
Ekran, kaydetmeden önce hasılatı, gerçekleşen kâr/zararı ve kalan miktarı canlı gösterir.

- **Hasılat nereye gidecek** seçilir: mevcut bir nakit hesabına eklenir, yeni nakit hesabı
  açılır ya da "portföy dışına çıktı" denir. Nakde eklendiğinde portföy toplamı satıştan
  etkilenmez — yalnızca varlık dağılımı değişir.
- **Kısmi satış:** miktar azalır, varlık portföyde kalır.
- **Tamamını satma:** pozisyon kapanır, varlık **Satılanlar** sekmesine taşınır.
- Her satış geçmişe işlenir; gerçekleşen K/Z hem Varlıklar hem İstatistik sayfasında toplanır.
- `satislar.csv` ile dışa aktarılır.

## Aranabilir seçim ekranları

Hisse, altın ürünü, kripto, banka, platform ve kasa seçimlerinin tamamı aynı seçici ekranla
yapılır: üstte arama kutusu, altında gruplanmış liste (ok tuşları + Enter ile de kullanılır).
Listede olmayan bir kurumu veya sembolü arama kutusuna yazıp **"kendim gireyim"** satırıyla
ekleyebilirsiniz; yazdığınız isim sonraki seferde listede çıkar.

- **Hisse / ETF:** ~90 BIST şirketi, ~56 ABD hissesi, 19 ETF (`js/symbols.js`)
- **Altın / gümüş:** gram, has, 22/18/14 ayar, çeyrek, yarım, tam, ata, cumhuriyet, reşat,
  hamit, ikibuçuk, beşli, gremse ve gram gümüş

## Varlık türleri ve saklama yerleri

- **Türler:** altın, gümüş, platin, hisse, ETF, yatırım fonu, tahvil/bono, vadeli mevduat,
  nakit/döviz, kripto, gayrimenkul, araç, koleksiyon/sanat, alacak, diğer.
- **Saklama yeri:** *Elimde (fiziksel)*, *Banka*, *Yatırım platformu*, *Kasa / emanet*, *Diğer*.
  Kurum adı seçilebilir listeden gelir; listede yoksa serbestçe yazabilirsiniz ve
  yazdığınız isim bir sonraki sefer listede çıkar.

## Dış veri kaynakları (anahtar gerektirmez)

| Veri | Kaynak | Yedek |
|---|---|---|
| Banka adları | `raw.githubusercontent.com/tgezginis/turkish_bin_numbers` açık veri kümesi (7 gün önbellek) | `js/data.js` içindeki küratörlü liste ile birleştirilir |
| Döviz kurları | `open.er-api.com` (6 saat önbellek) | Ayarlar sayfasından elle giriş |
| Altın ürünleri & gümüş | `finans.truncgil.com` — kapalıçarşı TRY fiyatları (gram, çeyrek, tam, ata, ayar altınları, gram gümüş) | `api.gold-api.com` (ons → gram), sonra elle giriş |
| **Hisse / ETF** | Yahoo Finance, `r.jina.ai` okuma vekili üzerinden (BIST için `.IS` otomatik eklenir) | Elle giriş |
| Kripto fiyatları | `api.coingecko.com/simple/price` (30 dk önbellek) | Elle giriş |
| Yıllık TÜFE | `api.worldbank.org` (30 gün önbellek) | Ayarlar'dan elle giriş |

Hisse istekleri sembol bazında tekilleştirilir, 15 dakika önbelleklenir ve en fazla 3'ü
aynı anda gider; aynı sembolü taşıyan birden çok varlık tek istek harcar.

**Ayarlar → Veri Kaynakları → “Bağlantıyı test et”** her kaynağı tek tek dener ve
süre + sonuç tablosu gösterir (örn. `Altın / gümüş · 111 ms · ✓ gram altın 7114,39 TRY`).
Aynı bölümde her kaynağın son denemesi ✓/✕ olarak listelenir. Portföyde otomatik fiyatı
açık ama ürün/sembol seçilmemiş varlık varsa burada ve yenileme sonrası uyarı olarak çıkar.

**Varlık kaydedilir kaydedilmez fiyatı çekilir.** “Güncel birim değer” alanı, otomatik fiyat
açık ve ürün/sembol seçiliyse boş bırakılabilir — kaydettikten hemen sonra piyasadan alınır ve
sonucu bildirilir. Hisse fiyatı çekimi kapalıysa tek tıkla açmayı önerir. Birim değeri 0 kalan
varlık varsa ana sayfada uyarı bandı çıkar ve **“Fiyatları çek”** düğmesiyle toplu denenir.

> **Fiyat güncellenmiyor gibi görünüyorsa** önce burayı kontrol edin: en sık neden,
> varlıkta “Fiyatı otomatik güncelle” kapalı olması ya da ürün/sembol seçilmemiş olmasıdır.
> Varlık listesinde otomatik fiyatlı satırlar yeşil **otomatik fiyat**, eksik olanlar turuncu
> **ürün seçilmedi** etiketi taşır.

Otomatik fiyat yalnızca varlık kartında "Fiyatı otomatik güncelle" işaretliyse ve
sembol/ürün seçildiyse çalışır. Çevrimdışıyken uygulama son bilinen değerlerle çalışmaya devam eder.

**Hisse fiyatları varsayılan olarak kapalıdır** (Ayarlar → Veri Kaynakları → "Hisse / ETF
fiyatlarını çek"). Tarayıcı Yahoo Finance'e doğrudan erişemediği için istek `r.jina.ai` okuma
vekili üzerinden gider; bu servise **yalnızca hisse sembolü** (örn. `THYAO.IS`) ulaşır,
portföyünüz veya kişisel bilginiz gönderilmez. Kapalıyken hisse değerlerini elle girersiniz.

## Sayı girişi (Türkçe ondalık)

Tüm sayı alanları hem `12,5` hem `12.5` biçimini kabul eder; `1.234,56` ve `₺1.500,25` de
çalışır. Tek nokta ve tam üç basamak (`7.200`) Türkçe binlik ayırıcı sayılır, `7.2` ondalık
kabul edilir. Alandan çıkıldığında değer yorumlandığı biçimde geri yazılır — böylece hangi
sayının anlaşıldığı görünür olur.

## Uyarı bantları

Ana sayfada iki durum bant olarak gösterilir:

- **Eksik kur:** bir varlığın para birimi için kur alınamadıysa o varlık toplama katılmaz;
  bant kaç varlığın dışarıda kaldığını ve hangi kurların eksik olduğunu söyler, Ayarlar'daki
  elle kur girişine yönlendirir.
- **Yedek hatırlatması:** 14 gündür (veya hiç) yedek alınmadıysa uyarır, tek tıkla JSON yedeği
  indirir. Ayarlar → Veri Yönetimi'nden kapatılabilir; son yedek tarihi orada görünür.

## Veri ve gizlilik

- Tüm veriler **yalnızca tarayıcının localStorage'ında** tutulur; hiçbir kişisel veri
  sunucuya gönderilmez. Dış istekler sadece kur/fiyat/banka listesi içindir.
- Tarayıcı verilerini temizlemek portföyü siler → Ayarlar → **JSON yedek al**.
- Uygulama IBAN, şifre veya cüzdan anahtarı istemez; bu bilgileri girmeyin.
- Sekme kapanırken bekleyen yazma işlemi anında diske aktarılır (`pagehide`/`beforeunload`).

## QR ile cihaz aktarımı

**Ayarlar → QR ile Cihaz Aktarımı**. Gönderen cihaz portföyü sıkıştırıp (deflate) base64'e
çevirir ve QR kare(ler)i olarak gösterir; büyük veri otomatik olarak birden çok kareye bölünür
ve kareler sırayla döner. Alan cihaz kamerayla okur, kareler tamamlanınca içe aktarır.
Veri internete çıkmaz — aktarım iki ekran arasında olur.

- QR üreteci bağımlılıksızdır (`js/qr.js`, byte modu, sürüm 1–40, L/M/Q/H) ve bağımsız bir
  çözücüyle (jsQR) doğrulanmıştır.
- **Okuma tarafı `BarcodeDetector` API'si gerektirir**: Android Chrome ve macOS'ta vardır,
  **Windows masaüstü Chrome'da yoktur**. Tipik kullanım "telefon, bilgisayarın ekranını okur"
  yönündedir. Desteklenmeyen tarayıcıda kare metinleri elle yapıştırılabilir ya da
  JSON yedek dosyası kullanılabilir.
- Alan cihazdaki veriler **üzerine yazılır**; ekran portföyün tamamını içerdiği için
  yabancılara gösterilmemelidir.

## İkonlar

`icons/` altındaki tüm PNG'ler bağımlılıksız bir üreteçle oluşturulur:

```bash
node tools/make-icons.mjs
```

Logo bir **kelime markasıdır**: krem zemin üzerinde iki satır — **SER** lacivert, **VET** altın.
Harfler monoline (tek çizgi) geometriyle çizilir, font gerekmez.
Üretilenler: 16–1024 px web/PWA ikonları, `apple-touch-icon.png` (iOS 180 px) ve Android için
`maskable-192/512.png` (%28 güvenli alan). Vektör sürüm: `icons/icon.svg`.

## PWA notları

- `manifest.webmanifest`: standalone görünüm, tema renkleri, kısayollar (Varlık ekle /
  İstatistik / Geçmiş).
- `sw.js`: uygulama kabuğu **cache-first**, dış API'ler **network-first** (çevrimdışında son
  yanıt döner).
- **Dosya güncelledikten sonra** hem `sw.js` içindeki `VERSION`'ı hem de `index.html` /
  `sw.js` içindeki `?v=1.3.1` sorgu parametrelerini artırın; aksi halde tarayıcı eski
  sürümü önbellekten sunar.
- Geliştirirken `index.html?nosw` ile açarsanız service worker kaydı atlanır ve mevcut
  önbellek temizlenir.

## Bildirim eşikleri

- **Fiyat uyarısı:** birim fiyat, ayarlanabilir eşiği (varsayılan %5) aşarsa bildirilir.
- **Dengeleme:** hedef dağılımdan toplam sapma %10'u aşarsa açılışta hatırlatılır.
- **Vade:** 7 gün kala ana sayfa bandı.
- **Yedek:** 14 gün yedek alınmadıysa ana sayfa bandı.

## Klavye kısayolları

- `n` — yeni varlık ekle
- `r` — kurları ve fiyatları yenile
- `Esc` — açık pencereyi kapat
- Seçim ekranlarında: yazarak ara, `↑`/`↓` ile gez, `Enter` ile seç
- Modal içinde `Tab` odağı pencerede döndürür (arkadaki sayfaya kaçmaz)

## Tema ve hareket

Lacivert–altın koyu tema ve **krem–altın** açık tema (Ayarlar → Tema). Krem tonları
logo plakası, seçici rozetleri ve kart parıltılarında da kullanılır. Sayfa geçişleri,
kart girişleri, tablo satırları ve kurulum kartları kademeli (stagger) animasyonlarla gelir;
`prefers-reduced-motion` açıksa tüm animasyonlar devre dışı kalır.

Krem tonları yalnızca açık temada değil koyu temada da kullanılır: kart yüzeyleri,
form panelleri, tablo başlıkları, rozetler ve zemindeki sıcak ışık katmanı krem esaslıdır.

Telefonda çift dokunuşla yakınlaştırma kapatılmıştır (`user-scalable=no` +
`touch-action: manipulation`) — uygulama hissi için; erişilebilirlik açısından ödünç
verilen tek noktadır.

## Dosya yapısı

```
index.html                uygulama kabuğu + giriş animasyonu
css/style.css             lacivert–altın–krem tema, responsive yerleşim, animasyonlar
js/symbols.js             BIST / ABD hisseleri ve ETF listeleri
js/onboard.js             kurulum testi (ilk açılış sihirbazı)
js/qr.js                  bağımlılıksız QR kodu üreteci
js/transfer.js            QR ile cihazdan cihaza aktarım
js/lock.js                PIN kilidi + AES-GCM şifreleme
tools/test-store.mjs      hesap katmanı testleri (node)
tools/test-qr.mjs         QR kodlayıcı testleri
tools/smoke.js            tarayıcı duman testi (20 adım)
js/data.js                varlık türleri, saklama yerleri, para birimleri, yedek listeler
js/store.js               durum, localStorage kalıcılığı, doğrulama, değerleme, dışa aktarma
js/market.js              banka listesi, döviz kuru ve piyasa fiyatı entegrasyonları
js/charts.js              bağımlılıksız SVG grafik motoru (halka, alan, sütun, yığılmış)
js/app.js                 yönlendirme, sayfalar, formlar, modallar, PWA
manifest.webmanifest      PWA manifesti
sw.js                     service worker
icons/                    üretilmiş ikonlar + icon.svg
tools/make-icons.mjs      PNG ikon üreteci (Node 18+, bağımlılıksız)
```
