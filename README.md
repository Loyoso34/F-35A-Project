# F-35A Simülatör (PWA)

iPhone Safari (iOS 17+), Android Chrome ve masaüstü tarayıcılarda çalışan, ana ekrana eklenebilen (PWA) bir F-35A Lightning II uçuş simülatörü. Derleme adımı yoktur; yalnızca statik dosyalardan oluşur ve Three.js CDN üzerinden sabit sürümle yüklenir.

## Dosya yapısı

```
index.html              Sayfa iskeleti, CSS, arayüz, import map
manifest.webmanifest    PWA bildirimi
sw.js                   Service worker (önbellek, çevrimdışı, güncelleme)
js/main.js              Uygulama girişi, oyun döngüsü, menüler
js/world.js             Arazi, gökyüzü, su, ormanlar, hava üssü
js/aircraft.js          Prosedürel F-35A modeli (fasetli alt gövde, silah yuvası kapakları, düz kokpit güvertesi)
js/physics.js           Uçuş dinamiği (120 Hz sabit adım)
js/controls.js          Dokunmatik / klavye / eğim girişleri
js/hud.js               Yeşil HUD
js/audio.js             Prosedürel ses
js/cameras.js           Takip, kokpit, serbest kamera
js/ui.js                Menü yardımcıları
js/textures.js          Canvas ile üretilen dokular
js/noise.js             Gürültü fonksiyonları
js/version.js           Uygulama sürümü
icons/                  Ana ekran ikonları (tools/make_icons.py ile üretilir)
tools/make_icons.py     İkon üretici (yalnızca Python standart kütüphanesi)
.nojekyll               GitHub Pages'in dosyaları olduğu gibi sunması için
```

## GitHub Pages ile yayınlama

1. GitHub'da yeni bir depo oluşturun (örneğin `f35a-sim`).
2. Bu klasördeki tüm dosyaları deponun köküne yükleyin:

   ```bash
   git init
   git add .
   git commit -m "F-35A simülatör"
   git branch -M main
   git remote add origin https://github.com/KULLANICI/f35a-sim.git
   git push -u origin main
   ```

3. Depoda **Settings → Pages** bölümüne gidin. **Source** olarak *Deploy from a branch*, dal olarak `main` ve klasör olarak `/ (root)` seçip kaydedin.
4. Birkaç dakika sonra site `https://KULLANICI.github.io/f35a-sim/` adresinde yayında olur. Tüm yollar göreli (`./…`) olduğu için alt klasörden sorunsuz çalışır.

> Service worker ve "Ana Ekrana Ekle" özellikleri yalnızca HTTPS üzerinde çalışır; GitHub Pages bunu otomatik sağlar.

## iPhone ana ekranına ekleme

1. Siteyi **Safari** ile açın (Chrome veya uygulama içi tarayıcılar "Ana Ekrana Ekle"yi desteklemez).
2. Alt çubuktaki **Paylaş** düğmesine (kare içinden çıkan ok) dokunun.
3. Listeden **Ana Ekrana Ekle** seçin ve **Ekle**'ye dokunun.
4. Ana ekrandaki **F-35A** simgesi uygulamayı tam ekran, adres çubuğu olmadan açar. Telefonu yatay tutun; dikey tutulduğunda oyun duraklar ve "Telefonu yatay çevirin" uyarısı görünür.
5. İlk açılışta **Başla**'ya dokunun: ses ve (ayarlardan açılmışsa) eğim kontrolü izni bu dokunuşla etkinleşir.

Android Chrome'da adres çubuğundaki menüden **Ana ekrana ekle / Uygulamayı yükle** seçeneği aynı işi görür.

## Kontroller

- **Sol joystick:** yunuslama ve yatış. **Sağ kaydırıcı:** gaz kolu; üstteki turuncu bölge art yakıcı.
- **RUDDER kaydırıcısı (alt orta):** yaylı analog dümen ve burun tekeri; parmağı/fareyi bırakınca tam merkeze döner. **Takım / Flap / Fren:** aç-kapat.
- **Kamera:** takip → kokpit → serbest (sürükleyerek döndür, iki parmakla yakınlaştır) → uçuş geçişi (sabit dış kamera, Doppler sesi). HUD yalnızca kokpit görünümünde çizilir; dış görünümlerde yalnızca kısa uyarılar (STALL, İNİŞ TAKIMI) görünür.
- **Işık:** iniş ışıkları (takım açıkken burun önünü aydınlatır). Seyir ışıkları (kırmızı/yeşil/beyaz), flaşörler ve dönen ikaz ışıkları her zaman açıktır.
- **Klavye:** W/S veya ↑/↓ yunuslama, A/D veya ←/→ yatış, Q/E dümen, Shift/Ctrl gaz (üst uçta art yakıcı), G takım, F flap, B fren, C kamera, L ışıklar, M ses, P/Esc duraklat.
- **Kalkış:** Fren'i kapatın, gazı sonuna kadar itin, ~145 kt'ta burnu kaldırın, tırmanışta takımı toplayın.
- **Stall:** Hücum açısı 19°'de uyarı (HUD ve ses), 24°'nin üzerinde taşıma hızla düşer; burun düşer, kanat sallanır. Toparlamak için çubuğu ileri itip hız kazanın.
- **Eğim kontrolü:** Ayarlar → Eğim kontrolü → Açık. Telefonu rahat tuttuğunuz açıda **Kalibre Et**'e basın.

## Güncelleme yayınlama

1. Kodda değişiklik yapın.
2. `sw.js` içindeki `CACHE_VERSION` ve `js/version.js` içindeki `APP_VERSION` değerlerini **her değişiklikte** artırın (örneğin `1.0.0` → `1.0.1`). Aynı sürüm numarası kalırsa eski kullanıcılarda yeni dosyalar devreye girmez.
3. `git commit` ve `git push` yapın; GitHub Pages birkaç dakikada yeni sürümü sunar.
4. Uygulamayı açan kullanıcılara "Yeni sürüm hazır" bildirimi çıkar; **Yenile** ile yeni sürüme geçerler. Ayarlar menüsünde geçerli sürüm görünür.

## Kalite ayarları

| Ayar | Piksel oranı | Gölge | Çizim mesafesi | Ağaç | Bulut | Su dalga detayı |
|------|-------------|-------|----------------|------|-------|-----------------|
| Düşük | 1 | yok | 13 km | 6 000 | 40 | düşük |
| Orta (varsayılan) | 1.5 | 1024 | 21 km | 13 000 | 70 | tam |
| Yüksek | 2 | 2048 | 34 km | 24 000 | 110 | tam |

Dünya 40 × 40 km'dir: kenarlarda dağlar, ortada düzlükler ve tarlalar, dört göl, bir nehir, yollar, bir kasaba ve askeri hava üssü (paralel taksi yolları, apron, güneşlikler, hangarlar, korumalı sığınaklar, kule, park halinde F-35'ler, bakım atölyeleri, kışla ve filo binaları, yakıt sahası, mühimmat igloları, dikenli telli çevre çiti, nöbetçi kulübeli kapılar, çevre/servis yolları, otoparklar, askeri araçlar ve bitki örtüsü). Su yüzeyleri derinliğe göre renklenir (sığ turkuaz → derin koyu), kıyılar yumuşak geçişlidir ve gökyüzü/güneş yansıması Fresnel ile hesaplanır.

## Uçuş modeli

- Hız vektörü gerçek ivmelenmeden gelir; dikey hız (VS) doğrudan hız vektörünün düşey bileşenidir. Burun aşağıdayken irtifa kaybı kaçınılmazdır; yapay irtifa tutucu yoktur.
- Kontrol kanunu yük katsayısı (g) komutludur; düşük hızda hücum açısı komutuna geçer. Çubuk merkezdeyken uçak trim durumuna yakın kalır, ancak hız düştükçe burun düşer.
- Yunuslama sönümü: dış döngü kazancı dinamik basınca göre programlanır (kapalı döngü kısa periyot sönümü ζ≈0,9), çubuk girişine 0,12 s ön filtre ve kontrol momentlerine 0,04 s eyleyici gecikmesi uygulanır. Çubuk bırakıldığında uçak yeni uçuş yoluna tek ve düzgün bir geçişle oturur; burun aşağı-yukarı sekmesi yoktur. Fizik 120 Hz sabit adımlı olduğundan davranış kare hızından bağımsızdır.
- Taşıma/sürükleme: CL eğrisi stall sonrası düşer, indüklenmiş sürükleme (Oswald), ayrılma sürüklemesi, takım/flap sürüklemesi, yer etkisi (h/b oranına göre) ve ISA atmosferi.
- Motor: yavaş tepkili itki (spool), art yakıcı ayrı kademe, yakıt tüketimi; ses motoru rumble/türbin/egzoz/art yakıcı katmanlarını buna göre karıştırır.

Eski cihazlarda veya Düşük Güç Modu'nda takılma olursa **Düşük** seçin.

## İkonları yeniden üretme

```bash
python3 tools/make_icons.py
```

Ek kütüphane gerektirmez; `icons/` klasörüne 180, 192 ve 512 piksellik PNG'leri yazar.

## Yerel test

Herhangi bir statik sunucu yeterlidir, örneğin:

```bash
python3 -m http.server 8080
```

Ardından `http://localhost:8080/` adresini açın. (Service worker `localhost` üzerinde de çalışır.)
