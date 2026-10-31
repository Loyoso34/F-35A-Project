# FFS — Flight Simulator (F-35A Lightning II, PWA)

iPhone Safari (iOS 17+), Android Chrome ve masaüstü tarayıcılarda çalışan, ana ekrana eklenebilen (PWA) bir uçuş simülatörü. Derleme adımı yoktur; yalnızca statik dosyalardan oluşur ve Three.js CDN üzerinden sabit sürümle yüklenir.

Oyundaki tek uçak **F-35A Lightning II**'dir. Açılışta **hangar** ekranı gelir: kalkış havaalanı ve boya şeması seçilir, F-35A kartına dokununca uçuş başlar.

**Varsayılan bölge gerçek dünyadır: Bodrum (Muğla) ve Milas–Bodrum Havalimanı (LTFE)** — gerçek
yükseklik verisi, Sentinel-2 uydu görüntüsü, gerçek koordinatlarda iki paralel pist (bkz. "Gerçek
dünya: Bodrum" bölümü). Kurgusal eğitim bölgesi (Anadolu Hava Üssü / Yeşilova) hangardaki
**Departure** satırından seçilmeye devam eder.

## Dosya yapısı

```
index.html              Sayfa iskeleti, CSS, arayüz, import map
manifest.webmanifest    PWA bildirimi
sw.js                   Service worker (önbellek, çevrimdışı, güncelleme)
js/viewport.js          Görüntü alanı ölçümü (döndürme, iOS PWA, güvenli alan) — <head>'de, modül değil
js/main.js              Uygulama girişi, yükleme hattı ve ilerleme, oyun döngüsü (sabit adımlı fizik + çizim enterpolasyonu), menüler
js/perf.js              Uyarlanabilir kalite: önce ikincil efektler, en son yumuşak adımlarla çözünürlük
js/world.js             Kurgusal eğitim bölgesi: arazi, gökyüzü, deniz/göller, ormanlar, iki havaalanı, kasabalar, yollar;
                        bölgeden bağımsız dünya arayüzü (heightAt, surfaceTypeAt, spawnPose, cameraFar…)
js/geo.js               Jeodezi: WGS84, yerel Transvers Merkatör (Krüger), Web Merkatör karo matematiği,
                        MSL / elipsoit (EGM96 geoid ızgarası) / AGL yükseklikleri
js/geoterrain.js        Gerçek dünya arazisi: karo dörtlü ağacı, akışlı DEM + Sentinel-2 görüntüsü, LOD, etek,
                        örgü havuzu, doku/DEM bellek bütçesi, fizik yükseklik/su sorgusu, eğrilik
js/geoworld.js          Bodrum bölgesi (World'den türer): LTFE pistleri, havaalanı düzleştirmesi, deniz halkası,
                        yüzey tipleri, kalkış noktaları, coğrafi telemetri
js/georegion.js         LTFE ve Bodrum verisi (her sayının kaynağıyla)
geo/bodrum/             Bölge karoları: manifest.json, dem/{z}/{x}/{y}.png, img/{z}/{x}/{y}.webp (~15 MB, 1259 dosya)
tools/geodata/          Bölge verisi üretici (bake.py: DEM + Sentinel-2 -> karo piramidi; meta.mjs: geoid, WMM)
js/worldshade.js        Dünya gölgelendiricileri: atmosferik pus (gökyüzüyle aynı renk), arazi malzemesi
                        (çok ölçekli makro değişim, tarlalar, orman örtüsü, eğim kayası)
js/waterfront.js        Sahil şehri rıhtımı: kruvaziyer terminali + gemi, marina, plaj ve oteller,
                        dönme dolaplı iskele; rıhtım arazisi ve yol planı
js/city.js              Şehir üreteci: bölgeleme, yol ağı, bina yerleşimi, yeşil alan, detay, trafik, LOD
js/aircraft.js          Prosedürel F-35A modeli: gövde, kokpit + pilot, kanopi, hacimsel art yakıcı alevi,
                        iç silah yuvaları (kapaklar, ray, AIM-120) ve dış istasyonlar (pilon + AIM-120)
js/runway.js            Pist tanımlayıcıları (geometri + manyetik sapma), ICAO/FAA işaretleri, yönlü pist ışıkları
js/airfield.js          Taksi yolu/apron planı (fizik ve çizim aynı plandan), dolgu yayları, bekleme çizgisi, tabelalar
js/crash.js             Çarpma sınıflandırması (öncelik sırasıyla neden + şiddet), enkaz parametreleri
js/weapons.js           Silah sistemi: envanter, ateşleme sırası, yuva dizisi, füze uçuşu ve çarpışma
js/fx.js                Silah efektleri: GPU parçacıkları, duman izi şeridi, patlama, krater/is izleri
js/fleet.js             F-35A yapılandırması: aerodinamik veri, kontrol kanunu, sistemler, kamera, ses
js/liveries.js          Boya şemaları (livery) — YALNIZCA görsel veri; fizik ve sistemlerle bağı yoktur
js/physics.js           Uçuş dinamiği düzenleyicisi (120 Hz sabit adım): hava verileri, kuvvet/moment
                        toplama, yer teması; veriyi fleet.js + aerodata.js'ten alır
js/rigidbody.js         6-DOF rijit cisim: tam Euler denklemleri (I_xz dahil) + kuaterniyon entegrasyonu
js/atmosphere.js        ISA atmosfer (yoğunluk, ses hızı, basınç oranları)
js/aero.js              Aerodinamik katsayı modeli — alpha/beta'nın SÜREKLİ fonksiyonları, stall eşiği yok
js/aerodata.js          F-35A aerodinamik/itki veri seti + yükleme anında bütünlük denetimi
js/engine.js            Motor modeli: spool dinamiği, irtifa/Mach itki kaybı, art yakıcı
js/fcs.js               Fly-by-wire kontrol kanunu (genel mimari; gerçek F-35 kanunları gizlidir, modellenmez):
                        g/AoA kanunu, takım-aşağı oran kanunu, sürekli sınırlayıcılar, eyleyiciler
PUBLIC_DATA_SOURCES.md  Her sayının kaynağı: [V] doğrulanmış kamuya açık / [E] mühendislik yaklaşımı / [T] ayarlanmış
js/controls.js          Dokunmatik / klavye / eğim girişleri
js/hud.js               Yeşil HUD
js/audio.js             Prosedürel ses
js/cameras.js           Takip, kokpit, serbest kamera
js/ui.js                Menüler, katman geçişleri (açılış/kapanış animasyonları), yükleme göstergesi
js/textures.js          Canvas ile üretilen dokular
js/noise.js             Gürültü fonksiyonları
js/version.js           Uygulama sürümü
icons/                  Ana ekran ikonları (tools/make_icons.py ile üretilir)
tools/make_icons.py     İkon üretici (yalnızca Python standart kütüphanesi)
tools/flighttest/       Başsız testler: uçuş fiziği (21 senaryo), çarpma sınıflandırması, pist/yol geometrisi (Node, bkz. README)
.nojekyll               GitHub Pages'in dosyaları olduğu gibi sunması için
```

## Kameralar

Oyun **serbest kamerayla** başlar; kokpitte başlamaz. Kamera sırası:

```
Free Camera -> Cockpit -> Chase -> Rear -> Flyby -> Cinematic -> Left Wing -> Right Wing -> Landing Gear
```

- **Rear** (v3.8): kuyruğun gerisinde ve üstünde gövdeye sabit; gecikme yok, uçak ekranda kaymaz.
- **Cinematic** (v3.8): yer gözlemcisi gibi uçuş yolunun ilerisine yerleşir; bakış kritik sönümlü
  yayla izler (kare hızından bağımsız), FOV uçağın ekrandaki boyunu sabit tutar, Doppler sesi.
- Serbest kamera gövdeyi saran elipsoidin içine giremez; tüm dış kameralar araziye gömülmez.

- **Free Camera**: uçağın çevresinde sınırsız yatay dönüş, alttan ve üstten bakış
  (−66°..+80°), 14–600 m arası yumuşak yakınlaştırma. Sabit bir takip kamerası değildir.
- **Cockpit**: gerçek pilot göz noktası. **Serbest bakış** vardır — sağa/sola ±145°,
  yukarı +78°, aşağı −72°. Çift dokunuş veya **R** bakışı ileri toplar.
- Tüm bakış girdileri bir HEDEFE yazılır, kamera hedefe üstel olarak yaklaşır. Parmak
  kalkınca hedef sabitlenir ve hareket temiz biçimde durur: atalet ya da sıçrama yoktur.
- Hız ve irtifa şeridi **her** kamerada çizilir, yalnızca kokpitte değil.

## Boya şemaları (livery)

Hangarda bir satır livery çipi vardır: **USAF Standard**, **Navy Style**, **Luftwaffe
Style**. Seçim `localStorage`'a yazılır ve sonraki açılışta geri yüklenir.

- Tanımlar `js/liveries.js` içinde tek bir veri tablosudur. Yeni bir livery eklemek
  için diziye bir girdi yazmak yeterlidir; arayüz listeyi kendisi üretir.
- Livery **yalnızca görseldir**: malzeme renkleri, gövde kaplama paleti ve
  işaret/yazı dekalları. Geometri, kütle, atalet, aerodinamik katsayılar, sistemler,
  kamera ve ses hiçbir biçimde etkilenmez — aynı girdiyle 60 s manevra sonunda iki
  farklı livery **birebir aynı** uçuş durumunu verir (test/livphys.mjs).
- Ek maliyet yok denecek kadar azdır: panel dokusu paylaşılır (renk çarpanıyla tonlanır).
  Navy şemasının NAVY yazısı ve burun numarası iki küçük dekal çizimi ekler (65 → 67);
  diğer şemalarda üçgen sayısı ve çizim çağrısı aynıdır.
- Uçuş sırasında livery değiştirilirse yalnızca görsel model yeniden kurulur;
  fizik nesnesine dokunulmaz (konum, hız, yönelim, motor, takım/flap korunur).

## Uçuş modeli mimarisi

Uçak konum/yönelimini KONTROL GİRDİSİNDEN doğrudan almaz. Zincir her zaman şudur:

```
pilot girdisi -> FCS -> yüzey komutu -> aerodinamik kuvvet/moment -> ivme -> hız -> konum/yönelim
```

- **6-DOF**: yönelim kuaterniyondur (Euler açıları yalnızca HUD/telemetri için türetilir).
  Açısal dinamik tam Euler denklemleridir, atalet çarpımı I_xz dahil; atalet (jiroskopik)
  çiftlenimi modelden çıkarılmaz, FCS tarafından yönetilir.
- **Sabit 120 Hz fizik adımı**; çizim 60 fps'e kilitlidir. Sonuç kare hızından bağımsızdır.
- **Stall modu yoktur.** Taşıma eğrisi Polhamus hücum kenarı emme analojisidir ve alpha'nın
  sürekli bir fonksiyonudur. Kanat düşmesi/otorotasyon, sol ve sağ kanadın AYRI yerel hücum
  açısı görmesinden (şerit modeli) kendiliğinden doğar; yapay tork yoktur.
- **Gizli veri kullanılmaz.** Gerçek F-35 kontrol kanunları, aerodinamik tabloları ve atalet
  tensörü kamuya açık değildir; modellenmemiştir. Her sayının kaynağı ve türetimi
  `PUBLIC_DATA_SOURCES.md` dosyasında etiketlenmiştir.

**Shift+D** geliştirici fizik panelini açar: hava verileri, alpha/beta, açısal oranlar,
katsayılar, kuvvetler, momentler (jiroskopik dahil), itki, yüzey komutları ve FCS iç değerleri.

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
4. Ana ekrandaki **FFS** simgesi uygulamayı tam ekran, adres çubuğu olmadan açar. Telefonu yatay tutun; uçuş sırasında dikey tutulduğunda oyun duraklar ve "Rotate your phone to landscape" uyarısı görünür.
5. İlk açılışta **Start**'a dokunun: ses ve (ayarlardan açılmışsa) eğim kontrolü izni bu dokunuşla etkinleşir.

Android Chrome'da adres çubuğundaki menüden **Ana ekrana ekle / Uygulamayı yükle** seçeneği aynı işi görür.

## Ekran yönü, yükleme ekranı ve arayüz geçişleri (v2.8.0)

**Ekran yönü / görüntü alanı.** Eskiden katmanlar `100vw/100vh`, `inset: 0` ve `window.innerWidth/innerHeight` ile boyutlanıyordu. iPhone'da (Safari ve ana ekran PWA'sı) bu üç sorun çıkarıyordu: (1) döndürmeden hemen sonra tarayıcı ESKİ yönelimin boyutlarını bildiriyor, (2) tam ekran PWA dikey açılıp yataya çevrilince yerleşim alanı durum çubuğu kadar kısa kalıyor (altta açık renkli şerit), (3) dünya kurulurken ana iş parçacığı saniyelerce meşgul olduğu için döndürme yerleşime hiç yansımıyordu (yükleme kartı ilk açılıştaki 924×924 alanda sol altta takılı kalıyordu). Şimdi:
- `js/viewport.js` `<head>`'de, sayfa çizilmeden çalışır; görünen alanı `visualViewport`'tan ölçer (iOS tam ekran PWA'da ekran boyutuna oturtur, iPad Split View gibi gerçekten küçük pencerelere dokunmaz) ve `--app-w / --app-h` CSS değişkenlerine yazar. Döndürme, `resize`, `visualViewport`, `screen.orientation`, `matchMedia` ve `pageshow` olaylarının hepsini dinler; tarayıcının son boyutu ne zaman bildireceği belli olmadığından olaydan sonra ~1,2 s boyunca her karede yeniden ölçer. Hızlı art arda döndürmeler tek bir ölçüm döngüsünde birleşir.
- Tüm arayüz tek bir `#app` kabının içindedir; kap ve içindeki her katman (3B tuval, HUD, kontroller, menüler, yükleme ekranı) bu ölçülen boyutu kullanır. `100vh`, `100vw` ve `vw/vh` birimleri kalmadı (yerlerine `--vw/--vh`).
- 3B tuval ve WebGL görüntü alanı, HUD tuvali ve kamera en-boy oranı ölçülen boyut DEĞİŞTİĞİ anda yeniden ayarlanır (yükleme sırasında da). Çentik / Dynamic Island / ana ekran çubuğu için `safe-area-inset` değerleri her katmanda uygulanır.
- Dünya artık parça parça (zaman dilimli) kurulur: iş ~70 ms'lik dilimlere bölünür ve her dilimden sonra tarayıcı bir kare çizip döndürmeye tepki verir. Eskiden dünya tek parça, saniyelerce süren bir işti ve bu sürede ekran donuk kalıyordu.

**Yükleme ekranı.** Koyu, sade bir kart: yapay ufuk simgesi, FFS / Flight Simulator, o anda yapılan iş (ör. "Building terrain…", "Planting forests…", "Compiling shaders…"), **yüzde** ve ince ilerleme çubuğu. Dikey ve yatayda ortalanır, kısa yatay ekranlarda sıkışır; dikeyde "Rotate to landscape to fly" ipucu görünür. Hata olursa mesaj ve **Reload** düğmesi çıkar.

**Yüzde GERÇEK ilerlemedir, zamana bağlı değildir.** Yükleme aşamalara bölünür (grafik, gökyüzü, arazi, su, ormanlar, yollar, kasabalar, üs, havalimanı, şehir, bulutlar, yansımalar, sistemler, uçak önizlemeleri, gölgelendirici derlemesi). En uzun iş olan arazi her arazi parçası (chunk) bittiğinde, ormanlar yerleştirilen ağaç sayısıyla, önizlemeler uçak uçak ilerler. Her aşamanın payı süresiyle ağırlıklanır: ilk açılışta ölçülmüş varsayılan süreler, sonraki açılışlarda BU cihazda bir önceki yüklemede ölçülen süreler kullanılır (`localStorage`, kalite ayarına göre ayrı). Çubuk ve yüzde aynı değerden çizilir; çizilen değer gerçek ilerlemeye kısa bir yumuşatmayla yaklaşır ama onu asla geçmez. %100 yalnızca her şey (gölgelendiriciler dahil) hazır olunca görünür. Uçak değiştirirken ve kalite değişiminde de aynı gösterge kullanılır. Dünya üretimi değişmedi: yeni (dilimli) kurulumun ürettiği geometri, örnekler ve çarpışma/yükseklik sorguları önceki sürümle bayt bayt aynıdır (üç kalite ayarında da doğrulandı).

**Geçişler.** Her menü, panel ve katman (duraklat, ayarlar, kaza, hangar, kontroller, yükleme, yön uyarısı, bildirimler) aynı kurallarla açılır/kapanır: açılış 200 ms (saydamlık + hafif ölçek/kayma, yavaşlayarak), kapanış 150 ms (hızlanarak). Web Animations API kullanılır: yarıda kesilen geçiş o anki görünümden devam eder, hızlı art arda basışlarda sıçrama ya da takılı kalan katman olmaz. Kapanan katman dokunuşu hemen bırakır; açılan katmanın düğmeleri animasyon sürerken de çalışır. Animasyon herhangi bir nedenle başlamazsa (kare üretilmezse) katman yine de son hâline geçer. Düğmeler basıldığında anında hafifçe küçülür. Sistemde "Hareketi azalt" açıksa geçişler kapanır.

## F-35A: kalite, uçuş modeli ve görsel geçiş (v2.9.0)

**Kontrol yüzeyleri (kamuya açık F-35A yerleşimi).** Kanatta artık tam açıklıklı **hücum kenarı flapları (LEF)** ve kanat başına **tek flaperon** vardır; eski modeldeki ayrı iç flap + dış kanatçık düzeni konvansiyonel bir uçağa aitti (ayrı kanatçık yalnızca F-35C'nin katlanır kanadında bulunur). Flaperonlar flap ve yatışı birlikte yapar; tümüyle hareketli stabilatörler simetrik yunuslama + diferansiyel yatış payı verir; ikiz dümenler sapmada aynı yöne döner, kalkış rotasyonunda ve yüksek AoA'da **toe-in** yapar (firar kenarları içe). FCS'nin otomatik programı: LEF havada AoA ile iner (ses üstünde toplanır; yerde kapalı). Flaperonların simetrik açısı v2.9.1'den beri **yalnızca pilotun flap kolundan** gelir (bkz. aşağıdaki v2.9.1 bölümü); yüksek AoA'daki küçük manevra kamburluğu yalnızca aerodinamikte kalır. Tüm yüzeyler eyleyici hız sınırlıdır ve çizimde fiziğin eyleyici konumunu doğrudan gösterir (v3.5.0'dan beri ayrı görsel yumuşatma yok); LEF aerodinamiğe de girer (küçük taşıma/sürükleme artışı).

**Model.** Arka gövde artık 2,4 m genişliğinde düz siyah bir levhayla bitmiyor: gövde nozul kılıfına doğru daralır (boat-tail), iki yanda stabilatör köklerini taşıyan kuyruk bumları vardır; nozulda çıkış dudağı, türbin arkasında merkez konisi ve değişken alanlı çıkış (rölantide açık, askeri güçte kısılı, art yakıcıda tam açık) bulunur. Kanat, stabilatör, dikey kuyruk ve dümen panelleri artık **kapalı katı**dır (uçları ve menteşe kesitleri kapalı); ana takım yuvası kabuğu artık gövde yanından aşağı sarkmaz (yüzey sorgusunun bir hatası düzeltildi), burun ucu ve hava alığı ağız tabanı kapatıldı. Piksel-kesin delik testinde (50 görünüm, tüm yüzey sapmaları, takım açık/kapalı) delik pikseli **75 349 → 133**. Gövde normalleri kırışma açısıyla (38°) hesaplanır: eğimler pürüzsüz, chine ve kenarlar keskin (eskiden tüm gövde yüz yüz düz gölgeleniyordu). Kanopi sarı plastik görünümünden koyu, altın-bronz yansımalı ITO kaplama görünümüne geçti ve tepe yüksekliği %7 düşürüldü. Kanat amblemleri profile yapışık (eskiden yüzeyden ~10 cm yukarıda asılıydı). Üçgen sayısı 9,7 bin → 12,9 bin.

**Uçuş modeli ve FBW.**
- *Bırakılan çubuk sığ yollarda uçuş yolunu tutar* (yatış ≤35°'de irtifa telafili); eski "nötr = 1 g" komutu dönüşte irtifa kaybettiriyor, tırmanışta burnu kaldırmaya devam ediyordu. Dik tırmanış/dalış, dik yatış ve ters uçuşta klasik 1 g'ye döner (çubuk bırakılan dalıştaki uçak yere doğru yolunu tutmaz). 9 g sınırı, AoA koruması, yatış oranı sınırları ve salınımsızlık testleri değişmeden geçer.
- *Sürükleme:* CD0 0,0165 → 0,0190 (rölantide 480 kt'tan yavaşlama 1,5 → 2,5 kt/s); dalga sürüklemesi aynı oranda azaltıldı, ses üstü toplam değişmedi.
- *F135:* rölanti net itkisi ram sürüklemesiyle hızla düşer (yalnızca rölanti payı; askeri güçte etkisi yok, yerde davranış aynı); rölanti→askeri ≈ 4,5 s; **art yakıcı** 0,22 s tutuşma gecikmesi ve ardından ~1,5 s S-eğrisiyle kademeli artar, kesmede ~0,35 s'de söner — itki de alev de ışık anahtarı gibi açılmaz. Sabit geometrili DSI alığının ses üstü basınç kaybı modellendi: uzun tam AB koşusunda uçak artık M 1,74'e sürünmüyor, kamuya açık **M 1,6**'da dengeleniyor.
- Ölçümler: kalkış koşusu askeri güçte ~2 790 ft, AB'de ~1 970 ft; yaklaşma 150 kt / 13° AoA; frenli iniş koşusu ~3 000 ft; rölantide pistte 60 s'de kayma 0 m; stall'da yüzme ya da sapma ıraksaması yok.

**Kamera.** Takip kamerası uçağa göre sabit bir ofsette durur, yalnızca ofsetin yönü ~0,12 s'lik bir gecikmeyle gövdeyi izler. Eskiden dünya konumu 5/s oranıyla izlendiği için kamera 250 m/s'de hedefinin ~50 m gerisinde kalıyor ve sert dönüşte uçak ekran merkezinden kayıyordu.

## F-35A: flap nötrü, hava alığı ve burun düzeltmeleri (v2.9.1)

**Flap UP iken flaperonlar aşağıda görünüyordu — iki ayrı kök neden.**

1. *Gizli otomatik sarkma.* v2.9.0'daki FCS programı takım aşağı ve hız 118 kt'un altındayken flaperonları flap kolundan bağımsız olarak %70 (≈21°) indiriyordu; kol UP iken bile pistte flaperonlar sarkık duruyordu (LEF de yerde 7,5° aşağıdaydı). Bu program kaldırıldı: flaperonun simetrik açısı artık yalnızca flap koludur (UP = 0°, LAND = 30°, ara konumlarda doğrusal), LEF yerde tamamen kapalıdır. Görsel açı ile aerodinamiğin gördüğü flap aynı değerdir. Tek istisna: havada, AoA 8°'nin üstünde FCS'nin küçük manevra kamburluğu (en fazla 0,22) uçuş karakteristiğini değiştirmemek için yalnızca aerodinamikte kalır; seyirde, yerde ve kalkışta sıfırdır. Sonuç: flap UP kalkışta sanal ~21° flap yardımı yok — kopma hızı ~190 kt'a çıkar; kısa kalkış için flap LAND seçilir (~175 kt).
2. *Menteşede V oluk.* Kanat ve dikey kuyruk kesitlerini üreten `airfoilPoints` bir veter aralığının ön ucunda alt yüzey noktasını atlıyordu; hareketli yüzeyin ön ucu dikey değil çapraz bir kesitle başlıyor ve yüzey 0°'deyken bile LEF ve flaperon menteşesi boyunca alt yüzeyde ~3 cm derin bir oluk (sarkmış flap gölgesi) bırakıyordu. Kesit artık tam dikey kapanır (isteğe bağlı `cutStart`). Ayrıca sabit kanat ile hareketli yüzeyler arasındaki 4–10 mm'lik bindirmeler (z-fighting şeritleri) kaldırıldı, LEF uca kadar uzatıldı, flaperon dış ucu kanat ucuna 4 mm boşlukla hizalandı.

Doğrulama (`f35flush`): flap 0'da flaperon/LEF köşelerinin sabit kanat profilinden en büyük sapması 1e-8 m / 4e-5 m, kuaterniyonlar birim; flap 0,25/0,5/0,75/1 → 7,5°/15°/22,5°/30°, sol ve sağ birebir aynı; 8 120 ışınlık yüzey taramasında oluk/basamak 0 (v2.9.0: 414).

**Hava alıkları.** Eski ağız, dudaktan gövde duvarına gerilmiş düz siyah bir levhaydı (derinlik yok) ve dudak şeridi ağızdan ileri doğru bir bıçak gibi taşıyordu. Şimdi: dudak, dış kaplamadan kanala doğru kısa ve keskin bir eğimdir (gövde boyası, keskin kenar); arkasında ~1,8 m geriye doğru daralıp içe kıvrılan kapalı bir kanal vardır ve derinlikle kararır (köşe renkleri; kapalı kanal içine gökyüzü yansıması kısık). DSI tümseği daha yassı ve duvara kaynaşık. Chine'deki eski levhanın gizlediği ince bir aralık kapatıldı. İki taraf aynı fonksiyonla kurulur (birebir simetrik).

**Burun.** EOTS penceresi burundan 22 cm sarkan ters bir koniydi; artık gövdeye oturan alçak, fasetli bir kubbe. Burun lofu değişmedi.

**Maliyet.** +371 üçgen (12 933 → 13 304), çizim çağrısı 68 → 67 (kanal malzemesi tek ağa birleşir). Delik testi 4 durumda 50 görünümde 0 piksel (v2.9.0: 133).

## F-35A: tek uçak, pilot, kokpit ve art yakıcı (v3.0.0)

**Yalnızca F-35A.** Önceki sürümlerdeki diğer iki uçak oyundan tamamen çıkarıldı: modelleri,
aerodinamik veri setleri, filo yapılandırmaları, liveryleri, yalnızca onların kullandığı dokular,
genişletilmiş dış HUD şeridi, hız freni düğmesi ve **V** tuşu, ters itki, slat ve hız freni fizik
yolları, konvansiyonel kanat taşıma dalı, servis çalışanı önbellek girdileri ve sivil
havalimanındaki park halindeki yolcu jeti siluetleri. F-35A'nın uçuşu sayısal olarak aynıdır (çıkarılan
terimlerin hepsi F-35'te sıfırla çarpılıyordu; regresyon paketi aynı sonuçları verir). Eski
kayıtlarda başka bir uçak seçiliyse yükleme sırasında F-35A'ya düşer.

**Pilot.** Silindir gövde + küre kafa yerine: süperelips kesitlerle loft edilmiş gövde (kalçadan
omza, koltuk sırtıyla aynı ~14° eğimde), omuzlar, kollar (sağ el yan çubukta, sol el gaz
kolunda), bacaklar ve pedallarda botlar; adaçayı yeşili tulum, koşum kayışları, bel kemeri, can
yeleği yakası ve cepleri, sağ uylukta diz tahtası; Gen III HMDS tarzı büyük yuvarlak kask
(arka-üst şişkinlik, yan projektörler), yüzü kaşlardan çeneye örten koyu yansıtıcı vizör,
oksijen maskesi ve göğse inen hortum. Gövde köşe renkli tek ağdır: kask ve vizörle birlikte
yine 3 çizim çağrısı. Kokpit kamerasında gizlenir; apronda park eden uçaklarda pilot yoktur.

**Kokpit.** Tek geniş panoramik ekran (göze dönük ~26° eğik, çerçeveli), kanopi biçimini izleyen
kavisli parlama siperi, diz paneli, düğme sıralı yan konsollar, HOTAS (gaz kolu ve yan çubuk),
pedallar, US16E benzeri fırlatma koltuğu (minderler, kova yanları, yan raylar, daralan başlık
kutusu, sarı fırlatma kolu) ve koltuk arkasında kanopi altına alçalan avyonik güvertesi. Bütün
donanım köşe renkli tek malzemededir: tek çizim çağrısına birleşir.

**Kokpitin dışarı taşması düzeltildi.** Kokpit parçaları artık kanopi profilinden türetilen
yüzeyle (`canopySurfaceY`) kırpılır. Kanopi kenarının altındaki iç eşik rafı 3.8–4.6
istasyonlarında gövde yanından **7–9 cm dışarı** taşıyordu (chine boyunca koyu şerit); dış
kenar artık chine'in 6 cm içinde kalır. Eski parlama siperinin uçları kanopi camından dışarı
çıkıyordu; yenisi camın 3 cm altında kırpılır. `f35inside` testi kokpit ve pilotun 18 000+
köşesinin her birinin kanopi camının ya da gövde üst yüzeyinin altında ve gövde kesitinin
içinde olduğunu doğrular: 0 ihlal.

**Kanopi.** Camın taban kenarı boyunca, gövdeye oturan koyu çerçeve bandı (burundan kuyruğa
kesintisiz), arka çerçeve kemeri ve inceltilmiş bow. Oyunda kanopi açılma işlevi yoktur;
eklenmedi.

**Art yakıcı.** İç içe üç saydam tüp (sert tüp kenarları, beyaza patlayan katı koni) yerine tek
**hacimsel** alev: sınırlayıcı bir silindirin içinde 14 örnekli kısa bir ışın yürüyüşü
(düşük kalitede 9) analitik bir yoğunluk alanını tarar — nozul çıkışında dolu, hafif
genişleyip uca doğru incelen ve gürültüyle dalgalanan dış zarf (turuncu-sarıdan kızıla),
açık sarı-beyaz sıcak çekirdek, çekirdekte düzenli aralıklı **şok elmasları** ve alevin ötesine
uzanan titreşen ısı pusu (kırılma taklidi; ek render hedefi yok). Çıktı önçarpımlı yayılım +
soğurmadır: gündüz göğünün önünde renkli, gece parlak; ton eşlemesi beyaza patlamayı önler.
Alev nozul alanını (kn) izler, uçağın grubunun çocuğudur (gecikme ya da kopma olmaz) ve nozul
ekseniyle hizalıdır (`f35only` testi: çıkışa uzaklık 7 cm, eksen nokta çarpımı 1,0000).
Uzaktan görünürlük için kameraya dönük yumuşak bir nozul halesi, AB'de petallerde hafif ısı
tonu; askeri güçte nozul içi yalnızca derinde sıcak bir tondadır. Tek çizim çağrısı (+ hale).

**Maliyet.** Uçak 13 312 → 17 702 üçgen (pilot ve kokpit), çizim çağrısı 67 → 66. Yeni gölgelendirici
programı yükleme ekranında derlenir: takım, ışık, ilk art yakıcı ve kamera geçişlerinde yeni
program 0 (`hitch`).

## F-35A: iniş takımı, boya, Donanma işaretleri ve formasyon ışıkları (v3.1.0)

Uçağın biçimi ve kimliği değişmedi; bu sürüm ayrıntı ve doğruluk geçişidir.

**İniş takımı (yeniden tasarlandı).**
- Lastikler profilli döndürme yüzeyleridir (yanak, omuz, sırt yivleri); çanak jant iki
  yüzlüdür, dış yüzde 8 cıvatalı göbek, iç yüzde fren diski vardır.
- Burun takımı: muylu, dış silindir, direksiyon bileziği ve eyleyicisi, krom piston, çatal,
  tork (makas) kolları, hidrolik hat, iki iniş/taksi lambası (iniş spot ışığı bu lambalardan
  çıkar) ve bacağın önünden yuva tavanına uzanan dizli sürükleme dikmesi.
- Ana takımlar: bacak, rakor bileziği, krom piston, tork kolları, aks gövdesi, fren kaliperi,
  iki hidrolik hat ve yuva tavanına çıkan dizli yan dikme.
- Kapaklar gövde altının eğrisini izleyen kalın panellerdir (kaplamaya ışınla oturtulur);
  iç yüzlerinde kaplamayı izleyen kaburgalar, menteşe kulakları ve eyleyici kolu vardır.
  Açıkken dik (menteşe tarafına 6° yatık) asılı dururlar. Yuva içleri yapı dokuludur
  (kaburgalar, hatlar, bağlantılar).
- Animasyon sıralıdır ve yumuşak geçişlidir: kapaklar açılır, bacak iner, amortisör serbest
  kalır; toplamada tersi. Burun takımı öne katlanır. Ana takımlar da öne katlanır: 0,74 m
  çaplı tekerlek 0,36 m genişliğindeki yuva ağzından yalnızca dik (0,29 m genişliğiyle)
  geçebildiği için ağızdan dik girer, gövde içine girdikten sonra merkeze döner.
- Yuvalar tekerleğin katlanırken süpürdüğü yaya göre uzatıldı (burun 2,48–4,50; ana
  7,05–9,15); burun muylusu yuvanın arka ucuna alındı.
- **Doğrulama** (`gearpoke`): takımın her üçgen kenarı, inikten toplanmışa 11 adımda dış
  kaplamayla kesiştirilir. Yuva ağızları dışında kesişme: **0**. Önceden yüzlerce vardı:
  ana tekerlek katlanırken silah yuvası kapağının ve yan duvarın içinden geçiyor, burun
  dikmesi yuvanın gerisinde kaplamayı deliyor, ana muylunun ucu yan kaplamadan dışarı
  çıkıyordu. Katlanmış burun takımı kokpit tabanının en az 9 cm altında kalır.

**Boya ve yüzey.** Düzensiz panel ızgarası; ek yerleri aydınlık/koyu çift çizgi, perçin sıraları,
testere dişli kapak kenarları ve perçin çevreli bakım kapakları. Boyaya gölgelendiricide makro ton
değişimi, akış izleri, gövde altında hafif kir ve egzoz çevresinde is eklenir (tek paylaşılan
program). Dekallar düz levha değil, kaplamaya ışınla oturtulmuş ızgaralardır. Düşük görünürlüklü
bakım işaretleri tek atlastadır (tek çizim): fırlatma koltuğu uyarısı, hava alığı tehlike
uyarısı, NO STEP, kriko noktaları, kurtarma oku, veri bloğu, yakıt bilgisi, topraklama noktası.
USAF amblemi tek bir kesit fasetine taşındı (iki fasetin kırık çizgisinde ortadan kırık
görünüyordu). Kuyruk kodu ve seri numarası kuyruk profiline oturtuldu (seri numarası profilin
içinde kalıyor, yalnızca bir iki harfi görünüyordu).

**Donanma işaretleri.** Ulusal amblem ön gövde yanında, hava alığının hemen arkasındadır
(F/A-18 ve F-35C ile aynı yer) ve kaplamaya oturtulmuştur. Arka gövdede alçak görünürlüklü NAVY
yazısı, burunda modex numarası, kuyrukta kod ve NAVY seri numarası. Amblem yüksek çözünürlüklü,
ince kenar çizgili ve düşük kontrastlıdır.

**Formasyon ışıkları.** Eski düz levhalar (biri kanadın altında havada, biri burunda kaplamaya
gömülü, biri kuyrukta kod yazısının üstünde) kaldırıldı. Yerine kaplamaya oturtulmuş
elektrolüminesan şeritler geldi: koyu, yuvarlak uçlu gövde çerçevesi içinde keskin kenarlı
mercek (merkezde açık yeşil-beyaz, kenarda doygun yeşil) ve kaplamaya çok hafif taşan katkılı
hale. Hale merceğin 4 mm altındadır (aynı yükseklikte olunca eğri kaplamada yer yer merceğin
önüne geçip onu beyaza boyuyordu). Yerleşim: her iki yanda gövde omzu (kokpitin gerisi) ve dikey
kuyrukların dış yüzünde hücum kenarına paralel. Yalnızca 2 çizim çağrısı.

**Maliyet.** Uçak 17 702 → 28 162 üçgen (artışın çoğu takımdadır; takım toplanınca çizilmez),
çizim çağrısı 66 → 65 (Navy 67). Kapakları, yuvaları ve dekalları kaplamaya oturtan kurulum
ışınları yalnızca ilgili bölgenin üçgenlerini tarar (sonuç birebir aynı; geometri sağlama
toplamıyla doğrulandı; dekal ışınları ~5, takım ışınları ~2 kat hızlandı): uçağın soğuk kurulumu v3.0.0'a göre yalnızca
~35 ms uzun. Yeni gölgelendirici programı yok (`hitch`).

## Gerçekçilik ve kalite: pistler, taksi yolları, yollar, çarpma, kamera, joystick (v3.7.0)

Uçuş modeli, FCS ve aerodinamik değişmedi (`tools/flighttest` 21/21). Değişenler: pist ve
havaalanı geometrisi, yol ağı, çarpma sistemi, dağlar ve aydınlatma, kamera, HUD ve
dokunmatik joystick.

**Joystick merkezleme.** Boştaki iç daire artık her zaman tam ortadadır. İç daire CSS'te
`left/top: 50%` + yarı çap kadar negatif kenar boşluğuyla ortalanır; konum yalnızca
`transform` ile değişir. Bırakınca, açılışta, yeniden başlatmada (`resetInputs()`), ekran
döndürmede ve yeniden boyutlandırmada `releaseStick()` hem değeri hem görüntüyü sıfırlar.
Halka çapı `vw`'den geldiği için bazı telefonlarda kesirli çıkıyordu (iPhone SE'de 86,7 px →
yarım piksellik kayma); CSS `round()` destekleniyorsa çift piksele yuvarlanır. İç daire koyu
gri (#42464D tabanlı degrade), dokunurken yeşil kenar. Ölçüm (Chromium mobil öykünme,
iPhone SE / 12 mini / 14 / 15 Pro Max, DPR 2–3): açılışta, bıraktıktan sonra, döndürmeden
sonra ve yeniden başlatmadan sonra kayma 0,000 px; çubuk + gaz aynı anda çoklu dokunuşla
çalışır. Gerçek iPhone'da denenmedi.

**Pist tanımlayıcıları geometriden.** `runway.js`: gerçek yön pistin iki ucundan hesaplanır
(`trueHeadingFromEnds`, kuzey = −Z), manyetik yön = gerçek − sapma (doğu +), 10°'ye
yuvarlanır, 0 → 36, karşı uç ±18; paralel pistlerde L ↔ R, C aynı kalır. Dünya kurgusal
olduğu için manyetik sapma verisi yoktur: `MAGNETIC_VARIATION_DEG = 0` ve her havaalanının
`magVar` alanı yapılandırılabilir (veri uydurulmadı). Sonuç: üs 09/27 (090°), sivil 12/30
(120°); hangar etiketleri de bu değerlerden gelir.

**Pist işaretleri (ICAO Annex 14; FAA tablosu `markings: 'FAA'`).** Eşikten 6 m sonra 30 m
uzunluğunda eşik çizgileri, sayısı genişliğe göre (45 m → 12, ortada çift boşluk); tanımlayıcı
9 m yüksekliğinde, çizgilerden 12 m sonra; orta hat 30 m çizgi / ≥ 20 m boşluk; nişan noktası
400 m'de; temas bölgesi çiftleri 150 m arayla kodlu desende (3, 3, 2, 2, 1, 1), nişan
noktasına 50 m'den yakın çift atlanır; 0,9 m kenar çizgileri; 60 m'den uzun patlama
pedlerinde sarı ok işaretleri; kaydırılmış eşik desteklenir. Rakamlar dokudan değil çizgi
yazı tipinden üretilen geometridir: her uzaklıkta keskin, iki yaklaşma yönünden de dik ve
aynalanmamış. Kaplama 0,015 m, işaretler 0,03 m + `polygonOffset`: z-fighting ya da havada
duran çizgi yok. Temas bölgesinde gölgelendiricide lastik izi.

**Pist ışıkları.** Tek `Points` çizimi, yönlü: kenar beyaz (son 600 m sarı), eşik yeşil ve
pist sonu kırmızı yalnızca doğru yönden görünür, PAPI soldaki 4 birim (3°30' / 3°10' /
2°50' / 2°30'). En az piksel boyutu sayesinde ~12 km'ye kadar görünür.

**Taksi yolları ve apronlar.** `airfield.js`: havaalanı, birbirine binmeyen dikdörtgenlerden
(pist / taksi yolu / apron / kara tarafı otopark) ve kavşaklarda otomatik dolgu yaylarından
oluşan bir plandır. Fizikteki yüzey sorgusu (`surfaceTypeAt`) ve çizim aynı planı kullanır.
Sarı orta hat ve dönüş yayları, pist orta hattından 90 m'de ICAO A tipi bekleme çizgisi,
zorunlu (kırmızı) ve konum (siyah üstüne sarı) tabelaları, mavi kenar ışıkları, apron
kenarında taksi yolu yan çizgileri. Üs 5 güney + 3 kuzey bağlantı, sivil 5 bağlantı.

**Yol ağı.** Yollar ağ olarak tanımlanır: kollar başka bir yolun üstünden başlar
(`from: { road, x | near }`), her uç ya bir yola ya da bir tesise (kapı, otopark, kargo
apronu, kasaba, mezra) varır. Üs içinde çevre yolu, ana ve batı kapı, hangar sırası, karargâh,
depo, koğuşlar, jeneratör, yakıt, sığınak arkası ve mühimmat yolları. Yol profili yol
boyunca yumuşatılır; araziye uygulanan kesme sınırlıdır (sivil yaylada 60 m'lik yarma
kalmadı, en düşük arazi 184 m). Yol şeritleri 20 m'de bir sıklaştırılıp araziye ±0,5 m
kenetlenir: havada duran ya da gömülen kenar yok; asfalt dokusu açıldı (siyah şerit yok).

**Çarpma sınıflandırması.** `crash.js` önce fiziksel büyüklükleri hesaplar (yere dik çarpma
hızı, yer hızı, uçuş yolu açısı, tutum, takım, yüzey, eğim), sonra nedenleri öncelik
sırasıyla denetler: engel → yıkıcı enerji → su → yerde yuvarlanma → arazi → aşırı dikey hız
→ yüksek hız → dik yol/yamaç → takım yukarı → sert iniş → kanat ucu / kuyruk / burun → pist
dışı. Örnek: takım yukarı, 480 kt, −9000 ft/dk → eskiden "Landed with the gear up", şimdi
"Excessive vertical impact speed", yıkıcı; "Landing gear was retracted" ikincil not. Eşikler
`IMPACT_LIMITS`'te yapılandırılabilir [E]. Şiddet: minor / major / critical / catastrophic.

**Çarpma sonrası fizik.** Çarpma anında hız korunur (donma, ışınlanma yok). Enkaz:
yerçekimi, sürükleme, temas noktalarında Coulomb sürtünme dürtüsü, enerjiye bağlı sekme,
dönme sönümü; parametreler şiddete göre (`WRECK_PARAMS`). Enkaz sınırlı sürede durur, kaza
yalnızca bir kez tetiklenir. Efektler şiddete göre ölçeklenir: patlama, toz, kıvılcım, sürtünme
izi, ateş ve duman, suda sıçrama, çarpma ve sürtünme sesi, kamera sarsıntısı. Kamera son
canlı konumdan 1,2 s'de çarpma görünümüne geçer ve arazinin üstünde kalır.

**Çarpma ekranı.** "Flight terminated" + şiddet başlığı (ör. CRITICAL IMPACT), neden, çarpma
hızı, dikey hız, tutum, takım, ikincil notlar; RESTART FLIGHT ve HANGAR düğmeleri. 700 ms
karartma, 650 ms kart kayması, satırlar sırayla (Web Animations; hareket azaltma tercihinde
animasyonsuz). Yeniden başlatma kaza durumunu, enkazı, efektleri, kamera geçişini ve
girişleri temizler, uçağı kalkış pistine koyar.

**Dağlar, arazi, ışık.** Dağ kütleleri bükülmüş (warp) gürültüyle ve yumuşak sırtlı 3 oktavla
üretilir; tepelerdeki iğne gibi sivri tepeler kalktı, eteklerde yumuşak geçiş. Yakın arazide
ince ayrıntı ve doğal doygunluk. Güneş azimut 140°, yükseklik 50°. Hangarlar, sığınaklar
(HAS), kule ve atölyeler için kaplama/cephe dokuları ve sabit güneşe göre önceden hesaplanmış
(baked) gölgeler; bu binalar gerçek zamanlı gölge atmaz.

**Kamera.** Takip kamerası daha yakın ve hıza bağlı (16,5–23 m), uçağın önüne bakar;
arazinin içine girmez. Kamera modları arasında 0,55 s yumuşak geçiş. İki parmak / tekerlek
ile takip uzaklığı (0,6–2,2×); Ayarlar → *Camera field of view*: dar / normal / geniş.

**HUD.** Yükseklik deniz seviyesine göredir (ALT … FT MSL; su yüzeyi = MSL), ayrıca radar
irtifası (RA, tekerlek altı, 5000 ft'e kadar). Değerler hafifçe yumuşatılır, sabit genişlikli
alanlar titremez, binlik ayırıcı. Pistte: ALT 21 ft MSL, RA 0.

**Testler.** `tools/flighttest`: `npm run test:all` = uçuş fiziği (21/21) + çarpma (13 olay,
47 denetim) + dünya (38 denetim). Bkz. `tools/flighttest/README.md`.

**Ölçülen maliyet (Chromium + SwiftShader, yazılım GPU; telefon değil).** Üs kalkış
görünümü: 254 → 257 çizim çağrısı, 692 k → 688 k üçgen. Sivil terminal görünümü: 73 çizim,
210 k üçgen. **iPhone Safari'de 60 FPS doğrulanmadı** (gerçek cihazda test yapılmadı).

**Sınırlamalar.** Manyetik sapma 0 (kurgusal dünya). Gölgeler düz zemin ve sabit güneş
varsayar. Bulutlar ve uçak modeli bu sürümde değişmedi (yalnızca gölge/temas). FAA temas
bölgesi ayrıntıları ve ICAO B deseni sayıları yayımlanmış tablolardan bellekten aktarıldı;
resmi belgeyle karşılaştırılmadı.

## Dünya görselleri: kıyılar, su ve arazi malzemesi (v3.6.0)

Yalnızca dünya görselleri değişti (`world.js`, `worldshade.js`). Uçak modeli, uçuş fiziği,
FCS, aerodinamik, HUD, kontroller, silahlar, kamera ve oyun mantığı birebir aynıdır (aynı 60 s
manevra v3.5.0 ile bit düzeyinde aynı sonucu verir). Harita düzeni korunur: kıyı çizgisinin
genel biçimi (`coastLineZ`), göllerin yeri ve boyu, nehir, yollar, şehir, kasabalar ve
havaalanları yerindedir; yalnızca yerel ayrıntı eklendi.

**Korunan bölgeler.** Yeni arazi ayrıntısı `protectW` ağırlığıyla uygulanır. İki havaalanı,
şehir (rıhtım, marina, plaj dahil), iki kasaba ve göllerin içinden geçen yolların koridoru
eski araziyle BİREBİR aynıdır (10 000 örnekte 0 fark; su/kara sınıfı değişmedi; bütün yol
yüzeyleri 0 fark). Bu bölgelerde yalnızca gölgelendirme iyileşti.

**Kıyı geometrisi.** Kıyıya uzaklık iki ölçekli gürültüyle bozulur: koylar, küçük burunlar,
kayalık çıkıntılar ve adacıklar oluşur (genel çizgi aynı kalır). Kıyı tipi (kum → çakıl → kaya)
arka kıyının yüksekliğinden ve geniş ölçekli bir gürültüden çıkar ve kıyı boyunca değişir.
Kumlu kıyıda alçak kumul + 10–35 m'lik plaj yüzü + sığ kıyı önü ve kum seti; kayalık kıyıda
18–45 m'lik dik yar (95–150 m genişlik, ızgaradan dar olmasın diye) ve arkasında yükselen
kıyı yamacı, deniz tarafında daha dik taban ve yer yer resif kayalıkları. Su altı profili
üstel derinleşir (kumlu kıyıda ~%1, kayalıkta ~%7,5 başlangıç eğimi) ve eski açık deniz
tabanıyla birleşir. Göllerin yıldız biçimli lobları yerine iki ölçekli kıvrımlı kıyı, alçak
kıyı şeridi (eski düz +7 m halka yerine) ve kademeli derinleşen taban. Tepelik kesimlerde
sırtlı gürültüyle hafif aşınma oluğu/sırt ayrıntısı (nehir vadisinde ve korunan bölgelerde yok).
Kıyıdaki arazi parçaları iki kat ızgara çözünürlüğündedir.

**Kara → ıslak kıyı → sığ → derin.** Ayrı renk bantları yerine tek bir fiziksel model:
su altındaki taban (deniz/göl), kendi pikselinde ışığın sudaki yolunu uygular — kanal başına
Beer–Lambert soğurması (kırmızı en hızlı söner) + su kütlesinin saçtığı ışık; görüş ışını
yüzeyde kırılır (n = 1,33), güneş ışığı da tabana inerken söner. Sığlıkta kum, çakıl, kaya ve
yer yer deniz çayırı seçilir; derinleştikçe taban kendiliğinden su rengine döner. Su yüzeyi
yalnızca kendi katkısını çizer (Fresnel'e göre gök yansıması, parıltı, köpük); derin suda ve
harita kenarında aynı saçılma rengiyle opaklaşır. Arazi ve su aynı sabitleri paylaştığı için
geçişte dikiş ya da basamak yoktur. Eskiden su 1,4 m derinlikte opaklaşıyor, kıyıda yeşil
kara ile mavi su arasında belirgin bir çizgi ve turkuaz bir bant kalıyordu. Deniz ılıman,
hafif bulanık kıyı suyudur (her yerde Karayip turkuazı değil); göl ve nehir daha bulanık,
yeşil-kahverengi.

**Kıyı şeridi malzemesi (piksel).** Suya göre yükseklik ve su çizgisine yatay uzaklık
(yükseklik / eğim) pikselde hesaplanır; şerit genişliği metre cinsindendir (kumda ~30–100 m,
kayalıkta ~5–15 m, göl/nehirde ~3–10 m), düz kıyı ovasında geniş halka oluşmaz. Kum, çakıl ve
kaya kıyı tipine göre, yerel ceplerle karışır; kumlu kıyıda plajın arkasında seyrek kıyı otu.
Islak bant dalga tırmanmasını izler (0,3–1,1 m, düzensiz), daha koyu ve daha az pürüzlüdür.
Su çizgisi pikselde sabit ölçekli gürültüyle ±0,4 m kaydırılır: kıyı hattı arazi üçgenlerinin
kenarlarını izleyen düz parçalar yerine düzensizdir.

**Su gölgelendiricisi.** Dört ölçekli (~3 m … ~250 m), her biri farklı açıda döndürülmüş ve
farklı yönde akan normal; ince ölçekler uzaklıkla söner. Kilometre ölçekli rüzgâr lekeleri
pürüzlülüğü değiştirir (sakin ve dalgalı alanlar; tekrar eden desen görünmez). Fresnel
(Schlick, F0 = 0,02), bakış yönüne bağlı gök yansıması, Beckmann dağılımlı güneş parıltısı
(pürüzlülük rüzgârla ve uzaklıkla artar; uzakta geniş, sönük parıltı bandı). Karışım
ön-çarpımlıdır: parıltı toplamalı kalır, atmosferik pus yansımaya doğru oranda uygulanır.
Su yalnızca analitik zeminin su seviyesinin altında kaldığı yerde çizilir: uzak (kaba LOD)
arazi alçak kıyıda su düzleminin altına inse bile karada su görünmez.

**Köpük yalnızca etkileşim bölgesinde.** Kıyıya yatay uzaklık, derinliğin ekran türevlerinden
pikselde çıkarılır. Kırılma bantları kıyıya doğru ilerler ve ~15–40 m içinde söner; en kıyıda
ince bir yalama köpüğü. Kıyı boyunca kesintili bir maske ve köpük dokusu sürekli beyaz çizgiyi
önler; kayalık kıyıda daha çok, kumlu kıyıda ince ve sönük; göl ve nehirde köpük yok; uzakta
incelir.

**Su ağları kıyıyı izler.** Deniz kıyı bandı, temel kıyı çizgisine göre ofsetli satırlardan
oluşan şeritlerdir (±650 m'de 23 sık satır, ~45 m sütun; düşük kalitede 70 m), göller kutupsal
ızgaradır (kıyı bandında ~52 m'lik halkalar). Derinlik ve kıyı tipi köşe özniteliğidir.

**Arazi malzemesi.** Yeni köşe özniteliği `shore`: kıyı tipi, suya yakınlık/nem, eğrilik ve kıyı
bandı (+ deniz / − göl, nehir). Eğrilik ve nem: dere ve çukurlar daha gür ve koyu, sırtlar
kuru ve açık (havadan kabartmayı okutur, büyük tek düze yeşil alanları böler). Kuru ot, bodur
çalı ve açık çayır lekeleri mevcut makro örneklerden üretilir (ek doku örneği yok).

**Maliyet (orta kalite, 45 görünüm, v3.5.0 ile).** Çizim çağrısı 7 854 → 7 911 (+%0,7), üçgen
+%8,3 (kıyı görünümlerinde +%12–20; açık deniz, şehir içi ve dağlarda ~değişmez). Dünya kurulumu
~9,7 → ~10,6 s (`terrainHeight` 3,3 → 3,6 µs). Yeni gölgelendirici programı yok (`hitch`). Su
gölgelendiricisi kıyı dışında köpük yolunu atlar; arazi gölgelendiricisi iki ek doku örneğini
yalnızca su çizgisinin ±4 m'sinde alır.

## Uçuş fiziği denetimi: kesintisiz yunuslama, fiziksel kalkış, FBW sınırlayıcıları (v3.5.0)

Yalnızca uçuş fiziği ve uçuş kontrol sistemi değişti (`fcs.js`, `physics.js`, `aero.js`,
`aerodata.js`, `fleet.js`; `main.js`/`controls.js`'te çubuğun alt adımlara aktarılması;
`aircraft.js`'te stabilatörün fizik değerini işaretiyle göstermesi). Uçak görsel modeli, dünya,
silahlar, HUD, kamera ve arayüz değişmedi.

**Tam ileri çubukta "eğil–dur–eğil" — kök neden.** `fcs.js`'teki negatif AoA tabanı sürekli bir
sınırlayıcı değil bir ANAHTARDI: `if (α < −14°) qCmd = max(qCmd, (−14° − α)·0,8)`. Aynı anda g
kanunu −3 g istiyordu; 150 m/s ve 3000 m'de bunun için α ≈ −18° gerekir. α −14°'yi geçtiği adımda
yunuslama komutu −23°/s'den +0,1°/s'ye sıçrıyor, stabilatör ters dönüyor, α −14°'nin üstüne
çıkınca tam burun aşağı komutu geri geliyordu: ~0,4 s periyotlu bir limit çevrimi (q, −19 ile
−3°/s arasında gidip geliyordu; 5 s'de 23 yön değişimi). Eyleyici modelindeki bir hata salınımı
keskinleştiriyordu: hız sınırlı adımın ardından ayrı bir üstel adım uygulanıyor, 4 birim/s olan
sınır büyük komutlarda 8–18 birim/s'ye çıkıyordu; küçük komutlarda yüzey hiç gecikmeden komuta
atlıyordu.

**Düzeltme.** (1) g hedefi, negatif AoA yumuşak sınırının (−10°) o hız, irtifa ve Mach'ta
üretebileceği yük faktörüyle sınırlanır (pozitif taraftaki CLmax zarfının aynası); g kanunu ve
AoA sınırlayıcısı artık aynı anda karşıt yönlere çekmez. (2) Negatif AoA sınırlayıcısı, pozitif
taraftaki gibi sürekli bir banttır (−10° → −16°, smoothstep). (3) g hedefi ve yunuslama oranı
komutu zarfa C¹-sürekli yumuşak doyumla yaklaşır; sert kırpma yok. (4) Eyleyici tek adımlı
birinci mertebe gecikme (τ = 35 ms) ve gerçekten uygulanan hız sınırıdır (4 birim/s). Aynı
manevrada q artık tek ve düzgün bir tepeden kararlı değere iner: q yön değişimi 23 → 1,
stabilatör yön değişimi 23 → 2, α −15° → −9,9°, stabilatör hızı 8,6 → 4,0 birim/s. Düşük hızda
(95 m/s) α −18,9° → −9,6°, salınım 9 → 1.

**Stabilatör: tek yetkili değer, doğru işaret.** Görsel model `elevator > 0`'ı burun yukarı
(firar kenarı yukarı) çizer; aerodinamikte ise `de > 0` burun aşağıdır (Cm_δe < 0). Fizik değeri
işaret çevrilmeden aktarıyordu: havada stabilatörler ters yöne sapmış çiziliyordu. Yerde çubuk
doğrudan aerodinamik değere yazılıyordu (geri çubuk kuyruğa yukarı taşıma ekliyordu) ve
havalanmada stabilatör +0,2'den −0,45'e sıçrıyordu. Artık fizik, görsel ve telemetri FCS
eyleyicisinin tek değerini kullanır; ayrı görsel yumuşatma kaldırıldı.

**Kalkış ve yer teması.** Eskiden yerde çubuk q̄ ile ölçeklenen KİNEMATİK bir dönüş hızı yazıyordu
(137 kt'ta tam çubukla bile net dönüş ≈ 0), havada ise g komutuydu: havalanma anında %35 çubuk
birden 2,7 g istiyor, burun 3°/s'den 22°/s'ye sıçrıyordu. Konum her yer adımında piste geri
yazıldığı için taşıma ağırlığı geçse de uçak ~1 s piste yapışık kalıyordu. Şimdi:

- Yerde yunuslama, ana takım teması etrafında fiziksel bir dönüştür. Burun tekeri yükü
  N_n = (a·R + h·f − M_a)/(a + b); stabilatör momenti ağırlığın ana teker etrafındaki momentini
  yendiğinde burun kalkar ve (I_yy + m·c₁²)·θ̈ = M_a − c₁·R − c₂·f + m·c₁·c₂·θ̇² ile döner
  (a = 0,8 m, h = 2,25 m, b = 4,3 m; c₁, c₂ yunuslamayla değişen kollar). Rotasyonun başladığı
  hız q̄'dan, ağırlıktan ve stabilatör yetkisinden kendiliğinden çıkar.
- Takım aşağıyken (yerde ve havada) kalkış/iniş kanunu: çubuk = yunuslama oranı (tam çubuk
  12°/s, doğrusal); bırakılınca havada tutum tutulur, yerde burun yavaşça iner. Yerde komut
  edilebilen tutum 12°'dir (kuyruk sürtme açısı ~14,5°). Takım toplanırken kanun 6 s içinde
  sürekli olarak seyir kanununa geçer.
- Takım yük taşıdığı sürece uçak yerdedir; net düşey kuvvet yukarı döndüğü adımda serbest kalır.
  Teker koymada yatış ve burun-aşağı tutum tek adımda sıfırlanmaz (sönümlü yay).

Tam güçte aynı çubukla: yerdeki azami yunuslama 15,2° → 12°, %35 çubukla kopma 211 → 192 kt,
%60 çubukla 188 → 180 kt; hiçbir senaryoda kuyruk sürtmesi ya da çarpma yok.

**Yatış–yunuslama çiftlenimi.** Tam çekip tam yatışta (I_xx − I_yy)·p·q sapma momenti (~665 kN·m)
dümenin tüm yetkisini tüketiyordu; kayma açısı 14°'ye çıkıyordu. Yatış tavanı artık bu momenti
dümen yetkisinin %60'ıyla sınırlayacak şekilde |q| ile sürekli düşer, koordinasyona %20 pay
bırakılır ve yüksek AoA'da yatış komutunun değişim hızı dümenin sapma ivmesiyle sınırlanır.
Yuvarlanarak çekişte kayma 14° → 8,8°; 26° AoA'da tam yatışta 22,9° → 2,5° (eskiden yatış
oranı komutun üstüne, 267°/s'ye kaçıyordu).

**Kare hızı.** Fizik zaten 120 Hz sabit adımlıydı, ancak çubuk karede bir örneklenip tüm alt
adımlarda sabit tutuluyordu (30 fps'de 4 adımlık basamaklar). Çubuk yumuşatması artık fizik alt
adımlarında uygulanır: aynı girdi 30, 60 ve 120 fps'de bit düzeyinde aynı uçuşu üretir (önce
30 fps'de 0,5° RMS yatış farkı).

**Diğer düzeltmeler.** Yük faktörü gövde ekseninde L·cosα + D·sinα'dır (eskiden L·cosα + T·sinα;
itki gövde normaline bileşen vermez). Düşük hızda yatış tavanındaki `sinα > 0,05` eşiği sürekli
hale getirildi. FCS ön filtresi ve β türevi yerde de güncellenir (havalanmada bayat değer ya da
sapma sıçraması yok). Stall uyarı bayrakları histerezisli (eşikte HUD yazısı ve ses titremez).

**Test.** `tools/flighttest/` (`npm install && npm test`): `physics.js`'in kendisi Node'da
çalıştırılarak (main.js döngüsünün birebir taklidi) 21 senaryo ölçülür ve kabul denetimlerinden
geçer (v3.4.0 bu denetimlerin 13/21'ini, v3.5.0 21/21'ini geçer): tam ileri/geri çubuk, nötr çubuk sönümü, ±g sınırı, yüksek/düşük hızda burun
aşağı, ses üstü, yüksek AoA, stall toparlanması, tam yatış/dümen, birleşik girdiler, kalkış (4
çubuk miktarı), iniş flare'i, takım yukarı/aşağı uçuş, 30/60/değişken fps. NaN/sonsuz yok, oran
güvenlik ağı hiç devreye girmedi, tam lup ve sürekli tonozda tutum kilidi yok. Fizik adımı
~15 µs'dir (değişmedi); ek çizim çağrısı ya da tahsis yok.

## F-35A görünümü: gövde hatları, kanopi, RAM panel deseni ve boya (v3.4.0)

Yalnızca F-35'in görsel modeli, malzemeleri ve dokuları değişti. Uçuş fiziği, kontroller, HUD,
kamera, silah mantığı ve oynanış aynıdır: `physcmp` uçuş modelini eski sürümle adım adım
karşılaştırır, fark yoktur. Aerodinamik yüzeylerin menteşe hatları ve hareket aralıkları aynıdır.

**Ön gövde ve burun.** Kesitin üst eğrisi artık, chine'e ~38° eğimle gelen kübik bir bezier
ile süperelipsin karışımıdır (`halfSection`, profil başına `cb`): düz bir sırt, eğik yan faset
ve burundan hava alığına kadar KESKİN, kesintisiz bir chine çizgisi. Chine burun boyunca yükseltildi
(fotoğraftaki gibi burun alt yarısı daha dolgun, üst yüzey daha basık). Ön profiller hava
alığının arkasında omuz bölgesine yumuşak geçer. DSI çıkıntısı daha ince ve uzun (gövde
yanına teğet, dudağa doğru incelir).

**Kanopi.** Koyu duman-altın renkli, metalik kaplamalı cam (eskisi açık sarı ve soluk
görünüyordu): daha yüksek opaklık, daha az clearcoat yansıması, pilot ve kokpit gölgede
seçilir. Çerçeve artık gövde grisinin koyu tonudur, kemer ince; contalık şeridi koyu.

**Dikey kuyruklar.** Kök hücum kenarı 0,5 m geri alındı: kök veteri daralır, hücum kenarı
oku fotoğraftakine yaklaşır (iki dışa eğik kuyruk, aynı menteşe ve dümen).

**RAM panel deseni (gölgelendirici).** F-35'in karakteristik iki tonlu görünümü: kapak ve
panellerin çevresinde açık gri, hafif parlak, testere dişli ya da basamaklı kenar bantları.
Sırtta ikmal kapağı, omuz panelleri, orta "merdiven" ve motor bölmesi konturları; kanat ucunda
"U" bandı, flaperon ve hücum kenarı flabı menteşe çizgileri; yatay kuyruk hücum kenarı ve ucu;
dikey kuyruklarda hücum kenarına paralel bant ve iç panel; altta silah yuvası ve iniş takımı
kapaklarının testere dişli kenarları. Chine altında ön gövde yanları koyu antrasit, radom açık
gri ve pürüzsüzdür (testere dişli sınır). Desen UV'den değil, uçağın **durağan poz**
koordinatlarından hesaplanır (`acp` özniteliği, `bakeRestPositions`): hareketli yüzeylerle
birlikte döner, kaymaz, çözünürlükten bağımsızdır; çizgiler `fwidth` ile kenar yumuşatmalıdır.
Bantlarda pürüzlülük düşer (gerçek uçaktaki gibi açıyla parlayan kenar bantları). Park halindeki
uçaklar da aynı deseni taşır.

**Boya ve dokular.** Sıcak nötr F-35 grisi, düşük parlaklık (roughness 0,66, metalness 0,16):
eski boya mavimsi ve fazla metalik görünüyordu. Panel dokusu sadeleşti (perçin yok, ince ek
yerleri; desenle çakışan sert çizgiler yok), makro ton değişimi daha ölçülü. Donanma ve
Luftwaffe şemaları da buna göre ayarlandı.

**İşaretler.** Düşük görünürlüklü yıldız-çubuk: yarı saydam açık gri disk ve çubuklar, boyanmamış
yıldız, ince koyu kontur (beyaz yok). Kanat amblemi gerçek boyutuna küçüldü (1,7 m genişlik,
kanadın dış yarısı; eskiden 3 m idi ve kanadı kaplıyordu). Seyrüsefer ve çakar ışık
parıltıları küçüldü.

**Maliyet.** Uçak 38 562 → 38 650 üçgen, 82 → 83 ağ (+1 çizim çağrısı: kanopi contalık şeridi); sahnede
287 → 288 çizim çağrısı. Takip kamerasında kare başına çizim süresi v3.3.0 ile aynı (ölçüm gürültüsü
içinde, 8–10 ms / 9 ms). Desen doku örneklemez, yalnızca aritmetiktir; ek doku yok.
Boya gölgelendiricisi büyüdüğü için yükleme ekranındaki ön derleme yazılım render'ında (SwiftShader)
4,1 → 5,9 s sürdü (gerçek GPU'da bunun çok küçük bir kesri); uçuş sırasında yeni program
derlenmez (`hitch`: 0). Tüm geometri testleri geçer: 6 durumda 0 delik pikseli (`f35holes2`),
kokpit gövde içinde (`inside`), flap nötrü kusursuz (`flush`), takım ve EOTS çakışması yok.

## Dünya görselleri: arazi, yollar, kasabalar ve sahil şehri (v3.3.0)

Yalnızca dünya/harita görselleri değişti. Uçak, uçuş fiziği, HUD, kontroller, silahlar, kamera ve
oyun mantığı aynıdır. Dünya koordinatları, ölçek, havaalanı ve pist konumları korunur: iki
havaalanının pist/apron alanında ve kalkış noktalarında 2160 örnek noktada arazi kotu farkı **0**.
Fizik yüksekliği (`world.heightAt`) hâlâ `terrainHeight`'tır; çarpışma kutuları aynı yoldan geçer.

**Arazi gölgelendirmesi (`js/worldshade.js`).** Köşe rengi geniş biyomu taşır (iklim, irtifa
kuşakları, kıyı, nehir kıyısı, orman, çalılık, kar). Piksel başına: döndürülmüş örneklerle çok
ölçekli makro değişim (4,1 km / 1,1 km / 290 m; döşeme izi yok), kurak/yeşil lekeler ve çıplak
toprak, **tarlalar** (~2,6 km'lik tarım bölgeleri, her biri kendi yönelimi ve parsel boyutuyla;
8 renkli ürün paleti, bölünmüş şeritler, ekin sıraları, çit/patika sınırları — piksel
çözünürlüğünde, `fwidth` ile kenar yumuşatmalı), orman örtüsü kümelenmesi, eğime bağlı kaya
(eşik gürültüyle bozulur, hafif katmanlaşma) ve yakında ince ayrıntı. `land` özniteliği (tarım
uygunluğu, orman, yerleşim, kuraklık) her köşede hesaplanır. Büyük ölçekli iki makro örnek köşede
(bulanık mip), ince ayrıntı yalnızca 1,6 km içinde örneklenir: uzakta pikselde tek doku örneği.

**Atmosfer.** Sahnenin doğrusal sisi dünya malzemelerinde yerini havai perspektife bıraktı: pus
rengi o bakış yönündeki **gökyüzü rengidir** (gök kubbesiyle aynı işlev), yoğunluk 1200 m ölçek
yükseklikli üstel bir tabaka boyunca integrallenir (alçakta uzaklar puslu, yüksekten aşağı bakınca
zemin net), uzaklıkla hafif doygunluk kaybı ve maviye kayma. Pus ton eşlemeden önce doğrusal
uzayda uygulanır; uzak dağlar arkalarındaki göğe birebir karışır, ufukta açık renkli bant veya
yüksekten bakınca açık denizde basamak oluşmaz. Pus köşede hesaplanır (pikselde tek karışım);
su pusu piksel başınadır. Uçak malzemeleri eski sisi kullanmaya devam eder.

**Dağlar ve arazi biçimi.** Temel gürültü alan bükmeli (yuvarlak tepeler yerine uzamış sırtlar),
sırt terimi küplü (keskin sırt, yayvan vadi). Kenar dağları bükülmüş alanda kütle gürültüsü +
4 oktavlı, ağırlıklı sırtlı çoklu fraktaldır: ayrıntı sırtlarda toplanır, vadi tabanları yumuşak
kalır. Dağ parçaları artık 3/4 çözünürlükte (eskiden 1/2: uzak LOD'da 500 m'lik kırık üçgenler).
Nehir yumuşatılmış (Catmull-Rom) ve menderesli; genişliği boyunca değişir.

**Yollar.** Köşeler yol sınıfına göre yarıçaplı yaylarla yumuşatılır (otoyol 900 m, yol 420 m).
Enine kesit: çakıllı banket + asfalt (kenar çizgileri, kesikli orta çizgi, tekerlek izi aşınması);
tek doku atlası, tek malzeme. Her kesit noktası **görünen arazi yüzeyine** (LOD0 üçgenleri)
oturur: eğimli zeminde kenarlar gömülmez, havada kalmaz (47 904 yol köşesinde gömülen 0).
Kavşaklarda (257) çizgisiz asfalt dolgu; köprüler yol-nehir kesişimlerinden otomatik hesaplanır.

**Kasabalar.** Izgara sokaklar yerine organik plan: merkezi kaydırılmış, düzensiz dört halka yolu,
halkalar arasında kaydırmalı ve kavisli ara sokaklar, çekirdekte kısa sokaklar, kenarda kırsala
uzanan çıkmaz sokaklar. Evler sokağa bakar; dört tip (tek katlı beşik çatılı, iki katlı kırma
çatılı, düz çatılı dükkân, çiftlik ambarı), ev atlası dokusu (pencere, kapı, kiremit), duvar ve
çatı renkleri örnek başına (tek çizim çağrısında). Merkezde ana yol üzerinde dükkânlar, dışa doğru
müstakil evler, kenarda ambarlar. Taban görünen yüzeyin en alçak köşesindedir (havada kalan ev 0).
Arka bahçelerde ağaçlar. Kasaba ağları 3B mesafeyle (7,5 km; ağaçlar 4,8 km) kapanır.

**Sahil şehri rıhtımı (`js/waterfront.js`).** Şehir merkezinin güneyindeki 3,3 km'lik kıyı tek bir
tasarım: yumuşak eğrili rıhtım hattı, arkasında deniz seviyesinin 3,5 m üstünde teras, önünde
derin su. Batıdan doğuya:
- **Kruvaziyer terminali:** 110 m'lik rıhtım güvertesi, 380 m'lik cam terminal ve dalgalı çatı,
  yolcu köprüleri, **300 m × 38 m kruvaziyer gemisi** (karina/su hattı/borda bantları, 12 güverte
  balkon dokusu, köprü kanatları, baca, havuzlar, su kaydırağı, filikalar), römorkör, otoparklar.
- **Marina:** moloz dalgakıranlar (kaba kaya yamaç, beton yürüyüş yolu), giriş ağzında kırmızı ve
  yeşil deniz fenerleri, rıhtıma bağlı beş yüzer iskele, parmak iskeleler, motor yatlar,
  yelkenliler ve iskele başlarında süper yatlar; rıhtımda tenteli restoranlar, liman ofisi kulesi.
- **Plaj ve oteller:** palmiyeli promenat, kum, şemsiyeler, plaj barları; plaj ortasında en yüksek
  (125 m'ye kadar) otel kuleleri (podyum + kule + taç, çatı havuzu), arkada orta yükseklikte
  konutlar: siluet denize doğru yükselir, içeride apartmanlara iner.
- **Eğlence iskelesi:** 440 m'lik kazıklı iskele, platformda **61 m çaplı dönme dolap** (kıyıya
  paralel, yavaşça döner; gondollar dik kalır), serbest düşme kulesi, atlıkarınca, büfeler,
  iskele ucunda restoran köşkü.
- Yollar: rıhtım bulvarı, arka cadde, bağlantı sokakları; şehrin sahil bulvarı kesilmez ve şehir
  sokaklarının şeritte kesilen uçları kendi doğrultularında rıhtım caddelerine bağlanır.
- Şehir üretecine `reserved` geri çağrısı eklendi: şehir binaları/ağaçları/otoparkları rıhtım
  şeridine ve bağlantı koridorlarına yerleşmez (şeritte şehir binası 0).
- Arazi ızgarası (~62 m) düşey rıhtım duvarını çözemediği için eğim güvertenin altında kalır;
  güvertenin ön yüzü su altına inen düşey duvardır. Plajda arazi kendisi yumuşak eğimli kumdur.
- Doğudaki yüksek burun doğal kayalık kıyı olarak kaldı.

**Su ve kıyı.** Kıyı bandının rıhtım bölgesindeki parçası ince ızgaralı (45 m × 36 m): rıhtım
önündeki derin su, marina ve plaj kıyısı doğru renk ve saydamlık alır. Uzakta güneş parıltısı
dar noktalar yerine yumuşak bir ışıltı bandıdır.

**Doğrulama.** Gemi gövde izi derin suda (omurga altı 4,5 m) ve rıhtım yüzünden 3 m açıkta;
137 teknenin tümü suda (en sığ 9,7 m), güvertede veya dalgakıranda değil; 268 rıhtım binası
karada ya da tamamen güvertede; tüm iskeleler rıhtıma bağlı; dönme dolap iskele platformunda
(en alçak gondol güvertenin 2,7 m üstünde). Çarpışma: gemi, otel, dönme dolap ve füze yolu
isabet eder; açık deniz ve marina suyu boştur.

**Performans (orta kalite, 30 görünüm, eski → yeni).** Çizim çağrısı 4594 → 4881 (+%6),
üçgen 16,65 M → 17,76 M (+%7), dünya kurulumu ~10,3 s → ~9,3 s. Arazi ağırlıklı görünümler
yazılım (CPU) oluşturucuda eşit (ova ×1,02, dağ ×1,05, nehir ×1,06, otoyol ×0,96); şehir/sahil
×1,0–1,25; yakın kasaba görünümleri ×1,4–1,6 (daha yoğun kasaba + zengin arazi gölgelendirmesi).
30 görünümün ortalaması ×1,17. Kullanılan teknikler: örnekli ağlar (evler, tekneler, palmiye,
ağaç, araba, şemsiye, gondol), birleştirilmiş statik ağlar, dizinli geometri (orman ağaçları dahil:
köşe sayısı ~%40 az), mesafe katmanları (rıhtım ayrıntısı 6,2 km, araba/şemsiye 3,2 km), köşede
pus ve makro örnek, yakında ince ayrıntı.

## F-35A: silahlar, ekran ve iniş takımı düzeltmeleri (v3.2.0)

**Ekranın altındaki siyah şerit (iOS, yatay).** Neden: `viewport.js` uygulama yüksekliğini
`visualViewport.height`'tan alıyordu. iOS Safari ve ana ekran (PWA) kipinde yatayda bu değer
pencerenin gerçek yüksekliğinden ~60 px kısa gelebiliyor; `#app` bu ölçüyle (`--app-h`)
boyutlandığı için altta boş, siyah bir şerit kalıyordu. Eski PWA düzeltmesi yalnızca fark ≤ 80 px
ve tam ekran kipindeyken devreye giriyordu. Şimdi uzun/kısa kenar birden çok kaynağın en
büyüğüdür (`innerWidth/Height`, ölçek ≈ 1 iken `visualViewport`, `documentElement.client*`,
`position: fixed; inset: 0` ölçüm öğesi); yön `matchMedia('(orientation: landscape)')` ile (yoksa
ekran açısıyla) belirlenir; iOS tam ekran iPhone'da ekran boyutu kullanılır. `vpfill` testi: kısa
bildirilen görsel alan, iOS tam ekran PWA (932×430) ve dikey ↔ yatay döndürmede tuval tüm ekranı
kaplar, çizim tamponu oranı ekranla aynıdır, tüm kumandalar ekran içindedir. v3.1.0 aynı testte
hatayı üretir (852×393 ekranda uygulama 852×331).

**Burun iniş takımı.** Muylu 4,30 istasyonundaydı ve bacak ~23° öne yatıktı: takım yandan
"yamuk" görünüyordu. Muylu 4,0 istasyonuna, gövde altının 0,20 m üstüne alındı; bacak ~12° yatık,
neredeyse dik. Sürükleme dikmesi yeni bacak geometrisine bağlandı. Katlanırken amortisör önce
0,30 m kısalır, sonra takım yuvaya girer. Tekerleğin yer teması değişmedi (amortisör sıkışması
`gearComp` aynen işler). Katlı burun takımı kokpit tabanının en az 12 cm altında kalır.

**Ana iniş takımı katlanma yolu.** Yuvanın ön ucunda gövde daralır ve ağız tekerlekten ancak
birkaç santim geniştir; v3.1.0'da tekerlek geçiş sırasında hem kaplamaya hem asılı kapağa
değiyordu (0,01 adımlı taramada 25 kaplama + 51 kapak kesişmesi). Şimdi içe kayma 2°, tekerlek
katlanırken bacak ekseni etrafında 15° yatar (üstü içe), merkeze dönüş 9,75° ve katlanmanın
%60'ından sonra başlar; kapak eyleyici çubuğu kısaltıldı (0,2 m'lik çubuk bacağın yoluna
taşıyordu). Takım inikken bunların hepsi sıfırdır. Sonuç: iki yanda, 0,01 adımlı taramada
kaplama ve kapak kesişmesi **0** (komşu parametre değerleri de 0).

**Füzeler neden görünmüyordu, şimdi nerede.** AIM-120'ler yalnızca iç silah yuvalarının
içindeydi: kapaklar kapalıyken görünmezler ve dış istasyon yoktu. Şimdi 2 ve 10 numaralı kanat
altı istasyonlarında (x = ±2,9 m, sabit kanat kutusu) pilon, LAU tipi ray ve birer AIM-120C
asılıdır. Pilonun üstü kanadın alt yüzeyine oturtulmuştur (3 cm gömülü); füze, hareketli
yüzeylerin (LEF, flaperon) her sapmasında onlardan uzak kalır. Füze ağı ve malzemesi iç
yuvadakilerle paylaşılır (tek geometri, tek malzeme). İç yuvalar kapalıyken kaplamayla aynı
köşelerden kurulan yamadır; açılınca menteşeli kalın kapaklar, yapılı yuva içi, ray ve rayda füze.

**Silah sistemi (`js/weapons.js`).** FIRE düğmesi (sağ sütunun üstü) ve Space. Envanter 4: önce
dış istasyonlar, sonra iç yuvalar. Ardışık bırakmalar arası 1,2 s; meşgulken basış tek bir
sıradaki atış olarak saklanır (her basış yeni füze üretmez); yerde ateşleme engellidir, yerde
durunca 2 s sonra yeniden yüklenir.
- Dış istasyon: raydaki AYNI füze gizlenir, havuzdaki füze onun dünya dönüşümüyle (konum +
  yönelim) başlar, uçağın hızı + 2 m/s aşağı ejektör hızıyla ayrılır, 0,22 s ve 0,7 m düşüşten
  sonra motor ateşlenir.
- İç yuva dizisi: kapaklar açılır (0,42 s, yumuşak hızlanma + mekanik oturma salınımı; iç ve dış
  kapak 50 ms arayla) → ejektör rayı füzeyi iter (0,12 s) → füze bırakılır (4,6 m/s) → yuvanın en
  az 1,5 m altına düşer → motor ateşlenir → ileri uçar → ray geri çekilir; füzenin kuyruğu yuvanın
  ön ucunu geçince kapaklar kapanır (0,5 s). Kapaklar, füze kapak süpürme hacmindeyken asla kapanmaz.
- Işınlanma yok: bırakıldığı karede füze ilerletilmez ve silahların saati çizilen uçak pozunun
  saatidir (fizik zamanı + artık). Yavaş karede bile füze bırakıldığı noktadan, uçağa göre
  milimetrik süreklilikle ayrılır.
- Uçuş: 2,6 s itki (230 m/s²), 3,5 s sürdürme (32 m/s²), yoğunluğa bağlı sürüklenme, yanma bitince
  yerçekimi; gövde hız vektörüne hizalanır; 16 s sonra havada imha olur. Bırakıldıktan sonra uçağa
  bağlı değildir.

**Çarpışma.** Her kare kat edilen parça süpürülerek denetlenir (hızlı füze ince engelin içinden
geçmez): arazi (≤ 4 m adımlar + ikiye bölme), su yüzeyi ve binalar (çarpışma ızgarasındaki
kutularla parça–kutu kesişimi, `world.segmentHit`).

**Efektler (`js/fx.js`).** GPU'da analitik parçacıklar (iki sistem, iki çizim çağrısı, halka
tampon; yalnızca yazılan aralık GPU'ya gider): ateş topu, kıvılcım, enkaz, toz ve duman, şok
halkası, zemin parlaması. Duman izi kameraya dönük bir şerittir; kabarık kenarları döşenebilir
gürültüyle çizilir. Yer izleri (krater/is) 6'lık havuzdan araziye oturtulur; suda sıçrama ve
köpük halkası. Ateşleme parlaması ve ejektör tozu. Patlama ışığı sahneye ışık eklemeden
(`FX_LIGHT` gölgelendirici sabitleri) uçağa vurur: hiçbir malzeme yeniden derlenmez.

**Ses ve kamera.** Kapak motoru, ejektör, roket motoru ve patlama sesi (mesafe/343 s gecikme,
mesafeyle zayıflama ve alçak geçiren süzgeç). Kamera ateşlemede hafifçe, yakın patlamada (≤ 700 m)
ses gecikmesiyle sarsılır.

**Ayrıca düzeltilenler.** Silah yuvası sütunlarının karın şeridine eklenmesiyle burun ucu ve
arka gövde halkasında oluşan T-birleşimi (alttan arkaya bakınca tek piksel delikler) kapatıldı.
Açık kapaklarda dış kaplama ile iç levha arasındaki 4 mm'lik kenar yarığı bir kenar bandıyla
kapatıldı. Parçacık atlası ters satırdan okunuyordu (duman halka, parlama enkaz dokusuyla
çiziliyordu); duman izi artık sabitlenmiş (clamp) atlas yerine döşenebilir gürültü kullanır.

**Maliyet.** Uçak 28 162 → 38 562 üçgen, 65 → 82 ağ (artışın çoğu silah yuvası kapakları, yuva içi
ve raylardır; yalnızca yuva açıkken çizilir). Seyirde aynı sahnede çizim çağrısı 175 → 179, çizilen
üçgen +%0,4, silah güncellemesi kare başına ~0,07 ms. Uçan bir füzeyle +10, patlama sırasında birkaç
saniye +20–35 çizim çağrısı; silah güncellemesi 0,2–0,5 ms. Parçacıklar GPU'da hareket ettiği için
canlı parçacık sayısı CPU maliyetini değiştirmez. Uçuş ve atış sırasında yeni gölgelendirici programı
derlenmez (`hitch`); efekt gölgelendiricileri (5) ve yeni malzeme varyantları uçuş başlarken, yükleme
ekranının arkasında derlenir. Silah efektlerinin ilk ÇİZİMİ de orada yapılır (uçuş sahnesinin ışık
kümesiyle): önceden ilk atışta ve ilk patlamada tek karelik bir takılma vardı, şimdi ilk atış karesi
de sonrakiler kadar hızlıdır. Uçuş modeli v3.1.0 ile birebir aynıdır (aynı 60 s manevra, aynı sonuç).

**Testler.** `weapons` (24 denetim: takılma, uçakla birlikte hareket, yerde engel, aynı dönüşümle
ayrılma, düşüşte gövdeye göre süreklilik (öne sıçrama yok), sıra/kopya yok, düşüş → ateşleme →
hızlanma, burun doğrultusu, yuva dizisi sırası, kapakların füze süpürme hacmindeyken asla
kapanmaması, yama/iç kısım geçişi, yere/yapıya/suya çarpma, krater, havada imha, yeni program yok,
yeniden başlatınca yeniden yükleme, konsol hatası yok), `vpfill` (12), `gearpoke` (gövde ve EOTS,
tüm takım konumları), 0,01 adımlı ana takım taraması, `nosetub`, `f35holes` (300 görünüm: yüzeyler,
takım, yuvalar açık/yarı açık), `flush`, `inside`, `f35only`, `app`, `hitch`, `suite`, `uilayout`,
`offline`, `livphys`, `abcost`, `loadsmoke` ve uçuş modelinin v3.1.0 ile birebir karşılaştırması.

## Dünya ve havaalanları

**Harita 72 x 72 km'dir.** Ortada ova ve tepelik araziler, kenarlarda (27 km'den sonra) dağ kuşağı, sekiz göl, doğudan batıya uzanan bir nehir, iki kasaba, yollar ve iki havaalanı vardır.

**Arazi.** Yükseklik alanı dört katmandan oluşur: çok geniş ölçekli bir *bölge* gürültüsü kabartma şiddetini değiştirir (bazı bölgeler yayvan ova, bazıları engebeli tepelik olur), ana fbm ana hatları, sırt gürültüsü (`1 - |noise|`) doğal vadi ve sırt hatlarını, ince gürültü de yüzey kabartmasını verir. Geniş biyom (bölgesel iklim, irtifa kuşakları, kıyı, orman, kar) köşe renklerinden; tarlalar, makro değişim, orman örtüsü ve eğim kayası arazi gölgelendiricisinden gelir (bkz. v3.3.0 bölümü).

**Havaalanları.** Her havaalanı kendi yerel çerçevesinde tanımlanır (`AIRPORTS` dizisi: merkez, pist yönü, kot, düzleştirme dikdörtgeni). Arazi düzleştirmesi, yüzey tipi sorgusu ve çarpışma kutuları tek kod yolundan geçtiği için yeni havaalanı eklemek bir kayıt satırı ve bir kurucu demektir.

| | Anadolu Hava Üssü | Yeşilova Havalimanı |
|---|---|---|
| Tür | Askeri üs | Sivil havalimanı |
| Konum | Harita merkezi (0, 0) | 24 km doğu-güneydoğu |
| Pist | 09/27 · 3000 x 45 m | 12/30 · 3400 x 45 m |
| Kot | 0 m | 185 m (yayla) |
| Tesisler | Paralel taksi yolları, apron, sundurmalar, hangarlar, korumalı sığınaklar, kule, park halinde F-35'ler | Paralel taksi yolu, apron ve duraklar, cam cepheli terminal + parmak iskele, körükler, kargo apronu, hangarlar, kule |

İki havaalanı arası **yaklaşık 26 km (14 deniz mili)**. Kalkış yeri **hangardaki Departure satırından** seçilir; kamera seçilen havaalanının üzerinde döner. Her iki havaalanı da kalkış ve inişe uygundur.

**Performans.** Arazi 18 x 18 = 324 parçaya bölünür ve üç kademede örneklenir: havaalanı/su çevresi 2x, iç bölge normal, dış dağ kuşağı 3/4 çözünürlük. Her parçanın iki LOD'u ve histerezisi vardır. Ağaç bütçesi haritanın tamamına eşit dağıtılmaz; iki havaalanı arasındaki koridora ağırlıklı ve **koruluk kümeleri** halinde yerleştirilir, böylece aynı bütçeyle seyrek nokta yerine gerçek orman dokusu oluşur. Ağaç parçaları da 4 km'lik hücrelerdir (mesafe kırpması isabetli olsun diye) ve ağaç geometrisi düşük segmentlidir.

## Şehir

Haritanın güney kıyısında, üsten **yaklaşık 18 km (10 deniz mili)** uzaklıkta bir sahil şehri vardır: kalkış → tırmanış → siluetin görünmesi → şehrin üzerinden geçiş → banliyö ve kır. Şehir `js/city.js` içinde üretilir; dünya modülünden yalnızca arazi yüksekliği ve kıyı çizgisi fonksiyonlarını alır.

**Bölgeleme.** Merkezden dışa doğru kademeli: `downtown → core (orta yükseklik) → urban (apartman) → suburb (müstakil ev) → outskirt → kır`. Sanayi bölgesi kuzeybatı diliminde, parklar merkez çevresinde dağılır. Halka sınırları gürültüyle dalgalandırılır; kusursuz daire olmaz. Blok doluluğu kenara doğru azalır, böylece "gökdelen → boş çayır" gibi ani bir geçiş oluşmaz.

**Binalar.** 13 arketip (kademeli kule, podyumlu ofis, ince kule, çatı teknik hacimli ofis, apartman, müstakil ev, dükkân, depo…) **temsilî boyutlarda** üretilir ve UV'leri o boyuta göre döşenir; örneklerde ölçek yalnızca sınırlı oynatılır, böylece cephe dokusu esnemez. Yükseklik çeşitliliği arketip seçiminden gelir: çok sayıda alçak, daha az orta, birkaç yüksek, tek bir imza kule. Her arketip-malzeme çifti bir `InstancedMesh`'tir; renk `instanceColor` ile örnek başına değişir. Dört prosedürel cephe dokusu vardır: cam giydirme, ofis paneli, apartman, sanayi.

**Simgeler.** 284 m'lik daralan cam kule (şehrin en yükseği), stadyum, haberleşme kulesi, liman vinçleri ve nehir üzerindeki asma köprü. Bunlar navigasyon referansıdır; şehir simgeyle doldurulmaz.

**Yollar.** Hiyerarşi: çevre otoyolu (ring) → radyal arterler → cadde ızgarası → sahil bulvarı. Izgara dünya eksenlerinden döndürülmüştür. Denize düşen bölümler atılır, kara parçaları ayrı polilinelere bölünür; yol denizde bitmez. Kesişmelerde katmanlar ayrı derinlik ofsetlerindedir (z-fighting yok). Üsten kasabaya, kasabadan şehre ve şehirden limana ana hatlar geçer.

**Trafik.** Yol poliline'ları üzerinde sabit hızla ilerleyen örneklenmiş araçlar. Fizik yoktur. Yoğunluk otoyol > arter > cadde sırasındadır. Uzakta katman tamamen kapanır ve **o durumda hiç güncellenmez**.

**Kentsel zemin.** Şehrin altındaki gri zemin ayrı bir levha değildir; arazinin köşe rengidir (`urbanDensity`). Böylece ek geometri, sert kenar ve z-fighting oluşmaz, kırlığa geçiş yumuşaktır.

**LOD.** Katmanlar mesafeye göre açılıp kapanır (histerezisli): imza kuleler ve gökdelenler her zaman, orta kat yapılar 9 km, evler/dükkânlar 4,2 km, otoparklar 5,2 km, yeşil alan 5,6 km, trafik 3,2 km, sokak lambaları 2,6 km. Mesafe şehrin **merkezine değil kütlesinin dışına** göre ölçülür; aksi hâlde şehrin içindeyken bile detaylar kapanırdı.

**Çarpışma.** 18 m'den yüksek yapılar için çarpışma kutusu üretilir (gökdelenlere çarpılır). Çarpışma sorgusu **uzamsal karma ızgara** üzerinden yapılır: 200 bin sorgu ~23 ms, yani 120 Hz fizik için ihmal edilebilir. Doğrusal tarama bırakılsaydı şehir eklendikten sonra kare başına binlerce kutu gezilecekti.

**Gölge.** Binalar gölge üretmez. Gölge kamerası uçağın çevresinde ±70 m'lik küçük bir hacimdir; on binlerce örnekli ağı gölge geçişine sokmanın görsel kazancı yok denecek kadar azdır. Uçağın gölge kalitesi korunur.

**Ölçüm (iPhone profili, orta kalite).** Şehir üzerinde 700 m: 201 çizim çağrısı / 745 bin üçgen. Downtown alçak uçuş: 222 / 749 bin. Üs pisti: 188 / 476 bin. Sabit kamerada şehir içinde titreyen piksel oranı %0.

## Deniz ve kıyı

Haritanın güneyinde büyük bir körfez vardır. Şehrin önündeki 3,3 km'lik kıyı rıhtım, marina, plaj ve iskeleden oluşan simge bölgedir (bkz. v3.3.0). Kıyı çizgisi düz bir kenar değildir: iki ölçekli gürültüyle koylar ve burunlar oluşur (`coastLineZ`). Kıyı tipi (kum, çakıl, kaya/yar) kıyı boyunca değişir; su altı tabanı sığlıkta görünür ve derinleştikçe su rengine döner, köpük yalnızca dalganın kırıldığı dar kuşaktadır (bkz. v3.6.0). Deniz yüzeyi harita sınırının 12 km ötesine kadar uzanır, böylece oyuncu su kütlesinin kenarını göremez — bu aynı zamanda haritanın güney sınırını gizler. Kıyı bandı ince, açık deniz kaba ızgarayla döşenir.

Dağ kuşağı deniz tarafında oluşmaz; kıyı gerçekçi kalır.

## Havaalanı çevresi

Üssün doğu kapısında kargo/lojistik depoları ve otopark, batı kapısında havaalanı oteli ve ofis binaları vardır. Çevre yolu üssü dolanır, kargo yolu depolara bağlanır. Pist, taksi yolları, apron ve yaklaşma koridorları yapı içermez.

## Rüzgâr

Aerodinamik her zaman **havaya göre bağıl hızla** hesaplanır, yer hızıyla değil. Varsayılan rüzgâr pist 09 için hafif karşı rüzgâr ve ~3 kt çapraz bileşendir (110°/9 kt, 4 kt patlamalı). Yüzeye yakın sürtünme katmanında hız düşer, yön ve şiddet yavaşça gezinir. Sonuçlar:

- Park halindeyken hız göstergesi rüzgârı gösterir (gerçek uçakta olduğu gibi).
- Çapraz rüzgârda uçak yanal olarak sürüklenir; pist eksenini tutmak için yengeç açısı gerekir.
- Üsteki rüzgâr tulumu gerçek rüzgâr yönüne döner ve şiddete göre dolar.
- Dış kamera şeridinde **WIND 110/9 KT** olarak görünür.

## Kontroller

- **Sol joystick:** yunuslama ve yatış. **Sağ kaydırıcı:** gaz kolu; üstteki turuncu bölge art yakıcı.
- **Alt kümede soldan sağa sıra: FLAPS → JOYSTICK → RUDDER.** Dümen ekranın ortasında durur; dar ekranda ortaya sığmazsa joystickin hemen sağına çekilir (çakışmama güvencesi her zaman önde gelir).
- **RUDDER kaydırıcısı (ekranın ortası):** yaylı analog dümen ve burun tekeri; parmağı/fareyi bırakınca tam merkeze döner. **Takım / Fren:** aç-kapat.
- **FLAPS kolu (ekranın en solu):** gerçek bir kol gibi çalışan dikey kaydırıcı. Yukarı 0 (temiz), aşağı son kademe; sürüklerken en yakın kademeye oturur, ize dokunmak da o kademeye atlar. Topuz kademe adını gösterir (UP / LAND). Kol her uçuşta **0'da** başlar. Klavyedeki **F** kademeleri sırayla gezer; kol onu da izler.
- **☰ Menü (sol üst):** Duraklat, Kamera, Ses ve Işık düğmeleri bu çekmecede toplanır; dokununca yumuşak bir geçişle açılır, 7 s hareketsizlikte veya duraklatınca kendini kapatır. Ekranda sürekli yalnızca uçuş için gerekli kontroller kalır. Çekmece açıkken joystick alanı onun altından başlar, böylece uçuş girişi ile menü dokunuşları çakışmaz.
- **Kalkış durumu:** uçak piste **fren basılı DEĞİL**, gaz rölantide ve **flap 0** ile doğar. Yerinde durmasını fren değil, aşağıda anlatılan kopma sürtünmesi sağlar.
- **Uçak ve kamera düğmeleri İngilizcedir:** `Flaps`, `Camera`, `Landing Gear`. Kamera modu adları da İngilizcedir (CHASE / COCKPIT / FREE / FLYBY / LEFT WING / RIGHT WING / LANDING GEAR).
- **Kamera:** takip → kokpit → serbest (sürükleyerek döndür, iki parmakla yakınlaştır) → uçuş geçişi (sabit dış kamera, Doppler sesi) → sol kanat → sağ kanat → iniş takımı. Kanat ve takım görünümleri gövdeye sabittir. Tam HUD yalnızca kokpit görünümünde çizilir; tüm dış görünümlerde üst ortada kompakt bir şerit sürekli **IAS / ALT / VS / HDG** gösterir; altında kısa uyarılar (STALL, İNİŞ TAKIMI) çıkar. Dar ekranda sığmayan alanlar sondan düşer.
- **Işık:** iniş ışıkları (takım açıkken burun önünü aydınlatır). Seyir ışıkları (kırmızı/yeşil/beyaz), flaşörler ve dönen ikaz ışıkları her zaman açıktır.
- **FIRE (sağ sütunun üstü):** AIM-120 fırlatır — önce kanat altı istasyonları, sonra iç silah yuvaları. Düğme kalan füze sayısını, bekleme süresini (dolan şerit) ve sıradaki atışı (QUEUED) gösterir. Yerde engellidir; yerde durunca 2 s içinde yeniden yüklenir.
- **Klavye:** W/S veya ↑/↓ yunuslama, A/D veya ←/→ yatış, Q/E dümen, Shift/Ctrl gaz (üst uçta art yakıcı), G takım, F flap, B fren, C kamera, L ışıklar, M ses, **Space ateş**, P/Esc duraklat.
- **Kalkış:** gazı sonuna kadar itin, ~145 kt'ta burnu kaldırın, tırmanışta takımı toplayın. (Fren zaten açıktır; park freni istenirse **Brakes** düğmesiyle basılır.)
- **Stall:** Hücum açısı 19°'de uyarı (HUD ve ses), 24°'nin üzerinde taşıma hızla düşer; burun düşer, kanat sallanır. Toparlamak için çubuğu ileri itip hız kazanın.
- **Eğim kontrolü:** Ayarlar → Eğim kontrolü → Açık. Telefonu rahat tuttuğunuz açıda **Kalibre Et**'e basın.

## Yerde yuvarlanma ve kopma sürtünmesi

Yer temasında uçağa iki ayrı sürtünme uygulanır:

- **Kinetik yuvarlanma** (`rollMu`): tekerler dönerken. Betonda 0,015-0,02, çimde 0,075-0,09. [E]
- **Kopma / statik** (`stictionMu`): uçak DURUYORKEN yuvarlanmaya başlaması için aşılması gereken eşik. Betonda 0,060-0,065, çimde 0,16-0,17. [E] Lastik deformasyonu, rulman direnci ve fren balatası temasının toplamıdır; kamuya açık ölçümlerde beton üzerinde kopma direnci yuvarlanma direncinin 2-3 katıdır.

Boyuna net kuvvet (itki − direnç ± eğim bileşeni) bu eşiğin altındaysa ve uçak 0,25 m/s'den yavaşsa tekerler dönmeye başlamaz: hız ve boyuna kuvvet sıfırlanır.

Bu eşik olmadan model yalnızca kinetik yuvarlanmayı biliyordu ve **rölanti itkisi onu aşıyordu**: F-35'te rölanti 6,8 kN, yuvarlanma direnci ise 4,2 kN. Sonuçta gaz sıfırken ve fren bırakılmışken uçak düz pistte ~0,12 m/s² ile kendiliğinden ileri kayıyordu. Ölçülen sonuç: **60 saniye rölantide yer değiştirme 0,04 m'nin altında** (her iki uçakta), %4 gazda hâlâ duruyor, %35 gazda normal biçimde hızlanıyor.

## Güncelleme yayınlama

1. Kodda değişiklik yapın.
2. `sw.js` içindeki `CACHE_VERSION` ve `js/version.js` içindeki `APP_VERSION` değerlerini **her değişiklikte** artırın (örneğin `1.0.0` → `1.0.1`). Aynı sürüm numarası kalırsa eski kullanıcılarda yeni dosyalar devreye girmez.
3. `git commit` ve `git push` yapın; GitHub Pages birkaç dakikada yeni sürümü sunar.
4. Uygulamayı açan kullanıcılara "Yeni sürüm hazır" bildirimi çıkar; **Yenile** ile yeni sürüme geçerler. Ayarlar menüsünde geçerli sürüm görünür.

## Kare hızı

Oyun **60 fps'e sabitlenmiştir**. Render döngüsü sürüklenmesiz bir hedef zamanla ilerler: 60 Hz ekranda hiçbir kare atlanmaz, 90/120/144/165 Hz ekranlarda fazla kareler atlanıp ortalama tam 60 fps olur. Fizik bundan bağımsızdır ve her koşulda **120 Hz sabit adımla** çalışır; bir karede en fazla 12 adım (0,1 s) atılır, yavaş cihazda biriken açık atılır (fizik kendini besleyen gecikme sarmalına girmez).

**Çizim enterpolasyonu (v2.9.0).** 60 Hz ekranda kare zamanları ±1 ms titrer; bu yüzden bazı karelerde 1, bazılarında 3 fizik adımı atılır. Eskiden uçak ve kamera doğrudan son fizik durumunu çizdiğinden bu, yüksek hızda kare başına ~2 m'lik sıçrama (mikro takılma) demekti. Şimdi uçak, kamera, HUD ve gölge kamerası son iki fizik durumu arasında enterpole edilmiş pozu kullanır (konum doğrusal, yönelim kuaterniyon slerp); gecikme en fazla bir fizik adımıdır (8,3 ms). 9 g çekişte ölçülen kare-kare ekran titremesi 0,0003 NDC'dir.

**Uyarlanabilir kalite (js/perf.js).** Karar ortalama fps'e değil kare dağılımına göre verilir: 2 s'lik pencerede kareler hedefin %20 üstüne sık çıkıyorsa bir kademe düşülür. Sıra: (1) uzak gölgeler (gölge kamerası daralır), (2) bulut yoğunluğu, (3) çevre detayı (ağaç ve ayrıntılı arazi mesafesi), (4) ikincil efektler (bulutlar daha seyrek, şehir katmanları/trafik ve pist ışıkları daha yakında kapanır), (5+) çözünürlük — %5'lik adımlarla, en fazla %80'e kadar. **Uçak modeli hiçbir kademede değişmez.** Geri yükselme 8 s temiz kare ister; yükselttikten hemen sonra yine düşülürse bekleme süresi ikiye katlanır (salınım yok). Hiçbir kademe gölgelendirici programını değiştiren bir şeye dokunmaz, yani kademe değişimi takılma üretmez. Ayarlar → FPS göstergesi açıkken satır `60/60 fps · clouds · 210 draws` biçiminde güncel kademeyi gösterir.

**Takılma (kare süresi sıçraması) önlemleri (v2.9.0).**
- *Gölgelendirici derlemesi uçuşta olmaz.* three.js `compile()` yalnızca görünür nesneleri dolaştığı için art yakıcı alevi, iniş ışığı merceği ve kokpit kanopisi malzemesi ilk kullanıldıkları karede derleniyordu. Ön derleme artık ağaçtaki her nesneyi geçici olarak görünür yapar; kokpit kanopisi malzemesi için çizilmeyen bir vekil ağ vardır; gölge derinlik gölgelendiricileri opak yükleme ekranının arkasında çizilen bir ısınma karesiyle derlenir.
- *Işık sayısı sabittir.* İniş ışığı (SpotLight) açılıp kapanırken ve burun takımı içeri alınırken (ışık takım pivotuna bağlıydı ve pivot gizleniyordu) sahnedeki ışık sayısı değişiyor, bu da HER aydınlatılan malzemenin yeniden derlenmesi demekti (telefonda yüzlerce ms). Işık artık her zaman sahnededir, kapalıyken yoğunluğu 0'dır. Test: takım, iniş ışığı, ilk art yakıcı ve tüm kameralar sırasında yeni program sayısı **0**.
- *Çöp toplama baskısı yok.* 120 Hz fizik döngüsü, FCS, telemetri, hata ayıklama nesneleri, uçak güncelleme argümanları ve şehir trafiği artık kare başına nesne tahsis etmez (önceden adım başına birkaç büyük nesne, trafikte araç başına bir nesne + arazi gürültüsü değerlendirmesi vardı; arazi yüksekliği artık her araç için 4 karede bir, kaydırmalı hesaplanır).
- *HUD.* Dış kameralarda bilgi şeridi yalnızca gösterilen bir değer değiştiğinde ve en fazla 15 Hz ile, yalnızca üst bant temizlenerek çizilir (eskiden her karede tam ekran tuval temizlenip yeniden çiziliyordu). Kokpit HUD'unda her metin/çizgi için Gauss bulanıklığı (`shadowBlur`) yerine 1 px keskin gölge kullanılır.
- *Çizim çağrısı.* Oyuncu F-35A'sında canlandırılmayan parçalar malzemeye göre birleştirilir: uçak 101 yerine 68 çizim çağrısıdır.

## Kalite ayarları

Arayüzde **Performance / Balanced / Ultra** (kayıtlı anahtarlar low / medium / high; eski ayarlar korunur).
Varsayılan **Balanced**.

| Ayar | Piksel oranı | Gölge | Çizim mesafesi (kurgusal) | Ağaç | Bulut | Su dalga detayı |
|------|-------------|-------|----------------|------|-------|-----------------|
| Performance | 1 | yok | 16 km | 19 000 | 46 | düşük |
| Balanced (varsayılan) | 1.5 | 1024 | 26 km | 42 000 | 80 | tam |
| Ultra | 2 | 2048 | 42 km | 72 000 | 125 | tam |

Gerçek dünya bölgesinde (js/geoworld.js `GEO_QUALITY`):

| Ayar | Görüş (pus) | Uzak düzlem | LOD çarpanı | GPU görüntü karosu | İnce DEM karosu | Kare başına inşa |
|------|------|------|------|------|------|------|
| Performance | 70 km | 300 km | 1,9 | 120 (~42 MB) | 40 | 2,5 ms |
| Balanced | 100 km | 420 km | 2,5 | 180 (~63 MB) | 64 | 3,5 ms |
| Ultra | 140 km | 480 km | 3,3 | 300 (~105 MB) | 96 | 5 ms |

Uyarlanabilir kalite (perf.js) gerçek dünyada da çalışır: "detail" kademesi arazi LOD çarpanını düşürür.

Ayrıca kaliteye göre şehir trafiği: düşük 160, orta 420, yüksek 800 araç.

Dünya 72 × 72 km'dir: güneyde deniz ve girintili kıyı, kenarlarda dağlar, ortada düzlükler ve tarlalar, sekiz göl, bir nehir ve asma köprü, yollar, sahil şehri, iki kasaba, bir askeri hava üssü ve bir sivil havalimanı (paralel taksi yolları, apron, güneşlikler, hangarlar, korumalı sığınaklar, kule, park halinde F-35'ler, bakım atölyeleri, kışla ve filo binaları, yakıt sahası, mühimmat igloları, dikenli telli çevre çiti, nöbetçi kulübeli kapılar, çevre/servis yolları, otoparklar, askeri araçlar ve bitki örtüsü). Su yüzeyleri derinliğe göre renklenir (sığ turkuaz → derin koyu), kıyılar yumuşak geçişlidir ve gökyüzü/güneş yansıması Fresnel ile hesaplanır.

## Havaalanı çizim kararlılığı

Pist, taksi yolları, apron ve işaretler arazinin yalnızca 5–10 cm üstündedir; bu fark uzaktan derinlik tamponunda çözülemez ve z-fighting (titreme) doğurur. Çözüm:

- **Derinlik katmanlaması:** yüzeyler `polygonOffset` ile sıralanır (arazi < asfalt < beton < yollar < işaretler < pist numaraları); ofset birimleri pencere-derinlik çözünürlüğü cinsinden olduğundan her mesafede geçerlidir.
- **Eş düzlemli çakışmaların kaldırılması:** taksi yolu bağlantıları yalnızca pist ile taksi yolu kenarları arasında uzanır, üs içi yol kesişimleri parçalara bölündü, çift nizamiye geometrisi kaldırıldı, servis yolu taksi yolunu kesmiyor.
- **Kesişen yollar iki katman:** kasaba sokakları ve üs yolları doğu-batı / kuzey-güney olarak ayrı ağlara ve ayrı ofsetlere bölündü; aynı malzemede eş düzlemli kavşak dörtgenleri artık derinlik yarışına girmez.
- **LOD ve görünürlük histerezisi:** arazi LOD'u, ağaç parçaları, üs ışıkları ve çevre çiti eşik mesafesinde açılıp kapanmaz (eşik ± bant). Ölçüm: eşikte 4 saniye salınan kamerada eski kodda 54 arazi LOD sıçraması ve 53 ışık aç/kapa, yeni kodda 0.
- **Piksel altı parıldama:** uzakta hairline kalan üs ışıkları ve tel örgü 3B mesafeye göre gizlenir (aynı zamanda orta mesafede ~40 bin üçgen tasarruf).
- **Gölge ve kırpma:** gölge kamerası ışık uzayında doku hücresi ızgarasına hizalanır (düz yüzeylerde gölge yüzmesi yok), dış kameraların yakın düzlemi 1 m'ye çekildi.

Ölçüm (pist/apron bölgesinde ardışık karelerde renk sıçratan piksel oranı): önce %0,5–3,7, sonra %0,012–0,07.

## Uçuş modeli

- Hız vektörü gerçek ivmelenmeden gelir; dikey hız (VS) doğrudan hız vektörünün düşey bileşenidir. Burun aşağıdayken irtifa kaybı kaçınılmazdır; yapay irtifa tutucu yoktur.
- Kontrol kanunu takım yukarıyken yük katsayısı (g) komutludur; düşük hızda hücum açısı komutuna geçer. Takım aşağıyken (kalkış/iniş, yerde de) yunuslama oranı komutlu ve tutum tutucudur. g ve AoA sınırları iki yönde de süreklidir: çubuk zarfa yaklaştıkça komut yumuşakça doyar (bkz. v3.5.0).
- Yunuslama sönümü: dış döngü kazancı dinamik basınca göre programlanır (kapalı döngü kısa periyot sönümü ζ≈0,9), çubuk girişine ön filtre, yüzeylere 35 ms gecikmeli ve 4 birim/s hız sınırlı eyleyici uygulanır. Çubuk bırakıldığında uçak yeni uçuş yoluna tek ve düzgün bir geçişle oturur; burun aşağı-yukarı sekmesi yoktur. Fizik 120 Hz sabit adımlı olduğundan davranış kare hızından bağımsızdır.
- Taşıma/sürükleme: CL eğrisi tek sürekli ifadedir (eşik yok), indüklenmiş sürükleme (Oswald), girdap/ayrılma sürüklemesi, transonik dalga sürüklemesi, takım/flap sürüklemesi, yer etkisi (h/b oranına göre) ve ISA atmosferi.
- Motor: yavaş tepkili itki (spool), art yakıcı ayrı kademe, yakıt tüketimi; ses motoru rumble/türbin/egzoz/art yakıcı katmanlarını buna göre karıştırır. Ses tümüyle sentezlenir (döngüye alınmış motor kaydı yoktur): gürleme, kükreme, türbin ıslığı ve egzoz katmanlarının frekans ve seviyeleri N1'i sürekli izler, böylece rölanti, spool, kalkış, seyir ve spool-down kendiliğinden ayrışır.
- Kullanılabilir yük katsayısı, içinde bulunulan konfigürasyonun azami taşımasıyla hesaplanır (flap katkısı dahil).
- Aerodinamik/itki katsayıları `js/aerodata.js`'te, kontrol kanunu kazançları ile sistem/kamera/ses/arayüz yapılandırması `js/fleet.js`'tedir; 
- İniş takımı kolu yerde **ağırlık-tekerde (squat switch)** kilidiyle korunur: tekerlekler yerdeyken takım içeri alınamaz.

Eski cihazlarda veya Düşük Güç Modu'nda takılma olursa **Düşük** seçin.

## İkonları yeniden üretme

```bash
python3 tools/make_icons.py
```

Ek kütüphane gerektirmez; `icons/` klasörüne 180, 192 ve 512 piksellik PNG'leri yazar.

## Gerçek dünya: Bodrum ve Milas–Bodrum Havalimanı (v3.8.0)

**Mimari kararı.** CesiumJS değerlendirildi ve kullanılmadı: kendi WebGL bağlamı ve çizicisi vardır,
Three.js uçağıyla derinlik tamponunu, gölgeleri ve mevcut PBR/pus hattını paylaşamaz; arazi sorgusu
asenkrondur (120 Hz fizik eşzamanlı `heightAt` ister); Cesium World Terrain bir ion erişim
anahtarı gerektirir. Bunun yerine Three.js içinde Web Merkatör XYZ karo **dörtlü ağacı** yazıldı
(js/geoterrain.js); veri aynı kaynaktan statik karo olarak gelir (anahtar, kota, üçüncü taraf
hizmet yok; service worker görülen karoları çevrimdışı uçuş için saklar).

**Koordinatlar.** Fizik, kökü LTFE ARP olan yerel **Transvers Merkatör** çerçevesindedir (WGS84,
Krüger serisi; PROJ ile ±160 km'de < 0,01 mm uyum). x doğu, z güney, y = MSL + `WATER_LEVEL`.
Böylece fizik, FCS, kameralar, silahlar ve HUD değişmeden çalışır; mesafe, hız ve irtifa gerçektir
(ölçek hatası bölgede < 3·10⁻⁴). Dünya eğriliği yalnızca **çizimde** uygulanır (kameraya göre
d²/2R, tüm dünya malzemelerinde): ufuk ve uzak deniz doğru batar, fizik düz kalır. Her arazi
düğümünün köşeleri düğüm merkezine göredir; model-görünüm matrisi CPU'da çift duyarlıkla
kurulduğu için bölgenin her yerinde titreme yoktur.

**Yükseklikler hiçbir yerde karıştırılmaz.** HUD **MSL** irtifa ve radar (**AGL**) gösterir;
Shift+D panelinde ayrıca WGS84 **elipsoit** yüksekliği (MSL + EGM96 ondülasyonu, LTFE'de 34,1 m),
zemin kotu, enlem/boylam, ızgara/gerçek/manyetik yön ve meridyen yakınsaması vardır. HUD yönü
gerçek dünyada **manyetiktir** (WMM-2025, 5,41° D) ve pist numaralarıyla tutarlıdır.

**Arazi.** Çekirdek bölge (27,00–28,10° D, 36,72–37,62° K; Bodrum yarımadası, Güllük körfezi,
Milas, Didim, Bafa) 30 m DEM + 15 m görüntü; dış halka (±150 km) 195 m DEM + 120 m görüntü; ötesi
deniz halkası ve pus. Düğüm ızgarası 32x32; en ince düğümde köşe aralığı DEM pikseline eşittir ve
fizik aynı üçgenleri kullanır (tekerlek havada kalmaz, görünmez tepeye çarpılmaz). Komşu LOD
çatlakları iki yüzlü eteklerle kapanır. İnce DEM yüklendiğinde fizik yüksekliği 1,2 s'de yumuşakça
geçer (uçağın altındaki zemin sıçramaz); uçağın altı ve 20 s ilerisi önceden yüklenir; kalkış
havaalanının ±9 km'si uçuş başlamadan hazırdır. Düğüm inşası kare başına süre bütçelidir,
örgüler havuzdan yeniden kullanılır (akışta çöp toplama ve GPU tahsisi yok).

**Işık ve su.** Görüntü fiziksel albedodur (Sentinel-2 yüzey yansıtırlığı); güneş, birincil
sahnenin çekim anındaki konumundadır (azimut 162°, yükseklik 47°), bu yüzden gerçek zamanlı ışık
ve gölgeler görüntüdeki gölgelerle uyumludur. Kabartma ışığı yumuşatılmıştır (görüntü gölgelemeyi
zaten içerir). Su: Fresnel gök yansıması ve güneş parıltısı; dalga ayrıntısı yalnızca alçakta.

**Havaalanı (LTFE).** İki paralel pist (10L/28R 3000 m, 10R/28L 2940 m — *v3.9'da düzeltildi: OSM
ve görüntüye göre 2496 m*, 45 m) yayımlanmış veri ve uydu görüntüsü ölçümüyle konumlandı; ICAO işaretleri (eşik, tanımlayıcı L/R, eksen, TDZ, nişan
noktası, kenar), kenar ve eşik/son ışıkları. Pistler eşik kotları arasında eğimlidir (10L 9 ft,
28R 21 ft); meydan zemini pist profillerine oturtulur. Yaklaşma ışık sistemi, PAPI ve taksi yolu
çizgileri doğrulanamadığı için kurulmadı; taksi yolları ve apron görüntüden görünür (v3.9: taksi
yolları ve apronlar artık OSM geometrisinden 3B kaplama olarak kurulur, aşağıya bakın). Ayrıntı ve
kaynaklar: `js/georegion.js`, `PUBLIC_DATA_SOURCES.md` §7.

**Veriyi yeniden üretme.**

```bash
pip install rasterio numpy pillow scipy
# AWS Terrain Tiles (z12 çekirdek, z9 dış) ve Sentinel-2 bantları (B02/B03/B04/B08) önbelleğe indirilir
python3 -I tools/geodata/bake.py --cache <önbellek> --out geo/bodrum
cd tools/geodata && npm install && node meta.mjs ../../geo/bodrum/manifest.json
```

**Çevrimdışı.** Bölge verisi alınamazsa (ör. ilk açılış çevrimdışı) uygulama kurgusal eğitim
bölgesine geçer ve bunu bildirir.

## Gerçek dünya v3.9.0: 3B Bodrum, OSM meydanı, kıyı ve göstergeler

**Kaynaklar.** Overture Maps 2026-10-21.0 (OpenStreetMap + Microsoft ML bina ayak izleri, ODbL) ve
ESA WorldCover 2021 (CC BY 4.0). Ayrıntı, etiketler ([V] doğrulanmış / [E] yaklaşık) ve atıflar:
`PUBLIC_DATA_SOURCES.md` §7–9. Uygulama içi atıf: Ayarlar ve hangar.

**Doğrulanmış olanlar ve yaklaşıklar.**

| Öğe | Durum |
|---|---|
| Pist uçları, taksi yolu eksenleri, apron/stopway çokgenleri, meydan binası ayak izleri | OSM geometrisi |
| Taksi yolu genişliği (23 m), bekleme çizgileri (pist ekseninden 90 m) | **yaklaşık** (ICAO tipik değerleri; gerçek konumlar ölçülmedi) |
| Kule, PAPI, yaklaşma/taksi yolu ışıkları, tabelalar, yer araçları | **kurulmadı** (doğrulanmış veri yok) |
| 306 068 şehir binasının ayak izi | OSM + Microsoft ML |
| Bina yükseklikleri | **%99,8'i yaklaşık** (OSM'de yükseklik 41, kat sayısı 653 binada); tek tek yapılar (kale, anıtlar) modellenmedi |
| Yollar | OSM geometrisi; genişlikler sınıfa göre yaklaşık |
| Ağaç/çalı yerleri | WorldCover oranlarından seyrek temsil; tür ve boy veri değil |
| Kıyı çizgisi | OSM kara çokgenleri (görüntü OSM'ye çakıştırıldı: +6 m D, +12 m K) |

**Şehir.** Binalar z14 karolarında (12 bayt/bina) akar; kutu + kırma çatı örneklenmiş çizimle
(karo başına 2 çizim çağrısı), alana göre sıralı örnekler sayesinde `mesh.count` uzaklık LOD'u
olarak çalışır (uzakta küçük binalar çizilmez). Çarpışma yönlü kutularla (64 m ızgara); meydan
binaları ayak izi çokgeniyle. Füze ve kamera parça testleri de çokgeni kullanır. Yollar araziye
oturtulur, köprüler doğrusal; ağaçlar bina, kaplama ve deniz üstüne konmaz. Karo dizinleri sayesinde
var olmayan karo (deniz) istenmez: konsolda 404 yok.

**Arazi ve deniz düzeltmeleri.** (1) Terrarium z9'daki hatalı tepeler temizlendi (Leros'ta 4952 m,
Arki yakınında 3546 m, Sömbeki (Symi) adasında 1202 m …). (2) z12 Terrarium'da denizde batimetri yok (tam 0 m):
bu hücreler z9 batimetrisinden doldurulur. (3) Deniz/kara ayrımı OSM kıyı çizgisinden: 3 Ekim
görüntüsündeki güneş parıltısı NDWI'yi bozduğu için Gökova Körfezi'nin büyük kısmı 0,5 m kara olarak
pişiyordu (fizikte `grass`); çekirdek su payı %20,6 → %46,3. (4) Batı kenarındaki 2 km'lik kara
şeridi (9000 m'den görülen koyu çizgi) giderildi. (5) Yakın arazi ayrıntı oktavları yeniden
ölçeklendi (önceki ~1 m desen mip ile kayboluyordu); ortalamayı koruyan ton çarpanıdır, gerçek
ayrıntı üretmez. (6) Su yansıması köşe normaliyle ağırlıklı: kısmi su bayraklı eğimli karada gök
yansıması çizilmez.

**Göstergeler.** IAS artık **kalibre hava hızıdır** (pitot darbe basıncı; ses altı izantropik, ses
üstü Rayleigh); önceden EAS gösteriliyordu (FL300 M0,80'de 16 kt düşük). Yer hızı yataydır (önceden
3B hız). Shift+D panelinde TAS, IAS(CAS), EAS, GS, iz, Mach, RA.

**Performans katmanı.** Ayarlar › FPS counter › **Debug** ya da **`** tuşu: HUD'dan ayrı panel. Kare
aralığı (ortalama/p95/en kötü), CPU kare işi (dünya güncellemesi + çizim gönderimi; GPU süresi
değildir, iOS Safari GPU zamanını vermez), çizim çağrısı/üçgen/program, arazi düğümleri, DEM ve
görüntü karoları, görüntü doku belleği (tahmin), öğe karoları (bina/ağaç/yol), geometri belleği
(tahmin), JS yığını (yalnızca tarayıcı bildirirse).

**Gün saati.** Ayarlar › Time of day: 12:10 (görüntü anı, varsayılan), 08:30, 16:30, 18:25. Güneş
konumu gerçek (Astronomical Almanac formülleri; görüntünün Sentinel-2 meta verisiyle 0,2° içinde).
Sınır: görüntü kendi çekim anının gölgelerini taşır; gece yok; kurgusal eğitim haritasında
desteklenmez (yapı gölgeleri sabit güneşe pişirilmiştir).

**Ses.** İniş takımı hidroliği (takım yalnızca fizikte hareket ederken) ve kilitlenme sesi; teker
koymada lastik cıyaklaması + darbe (son batış hızıyla). Hepsi Web Audio ile prosedürel (dosya yok).

**Kamera.** Takip, arka ve yörünge kameraları binaların içine girmez (uçaktan kameraya parça bir
yapıya çarparsa kamera önüne çekilir).

**Veriyi yeniden üretme (v3.9).**

```bash
pip install rasterio numpy pillow scipy pyarrow shapely
python3 -I tools/geodata/overture_extract.py --cache <önbellek>          # Overture: bina, yol, meydan, kara
python3 -I tools/geodata/bake.py --cache <önbellek> --out geo/bodrum      # DEM + görüntü (--skip-imagery)
python3 -I tools/geodata/vectors.py --cache <önbellek> --out geo/bodrum   # meydan, bina, yol, bitki karoları
```

**iPhone'da test.** 1) Safari ile yayın adresini açın, Paylaş › Ana Ekrana Ekle. 2) Ayarlar ›
Quality: Performance / Balanced / Ultra; FPS counter › Debug. 3) LTFE 10L'den kalkıp Bodrum
üzerinde 300–1000 ft'te uçun; paneldeki kare aralığı p95 ve "adaptive tier" değerini not edin.
4) Meydanda taksi, 28R'ye iniş. 5) Time of day ve bölge değişimi (eğitim ↔ Bodrum).
**60 fps cihazda ölçülmedi**; geliştirme ortamındaki değerler yazılımsal (SwiftShader) çizimdir ve
cihaz performansını göstermez.

## Yerel test

Herhangi bir statik sunucu yeterlidir, örneğin:

```bash
python3 -m http.server 8080
```

Ardından `http://localhost:8080/` adresini açın. (Service worker `localhost` üzerinde de çalışır.)

Başsız testler (`tools/flighttest`, `npm run test:all`): uçuş fiziği, çarpma, kurgusal dünya,
jeodezi (`geo.mjs`: TM ↔ PROJ, karo matematiği, datumlar, güneş konumu), gerçek dünya
(`geoworld.mjs`: LTFE verisi, yüzeyler, OSM taksi yolu/apron, bekleme çizgileri, meydan ve şehir
binası çarpışması, karo biçimleri ve dizinleri, parıltılı denizde su, arazi sürekliliği, ışınlanma
önlemi, 10L'den kalkış ve 28R'ye iniş — gerçek fizik, gerçek DEM) ve göstergeler
(`instruments.mjs`: CAS/EAS/TAS, GS, VS, RA).
