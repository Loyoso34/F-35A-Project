# FFS — Flight Simulator (F-35A Lightning II, PWA)

iPhone Safari (iOS 17+), Android Chrome ve masaüstü tarayıcılarda çalışan, ana ekrana eklenebilen (PWA) bir uçuş simülatörü. Derleme adımı yoktur; yalnızca statik dosyalardan oluşur ve Three.js CDN üzerinden sabit sürümle yüklenir.

Oyundaki tek uçak **F-35A Lightning II**'dir. Açılışta **hangar** ekranı gelir: kalkış havaalanı ve boya şeması seçilir, F-35A kartına dokununca uçuş başlar.

## Dosya yapısı

```
index.html              Sayfa iskeleti, CSS, arayüz, import map
manifest.webmanifest    PWA bildirimi
sw.js                   Service worker (önbellek, çevrimdışı, güncelleme)
js/viewport.js          Görüntü alanı ölçümü (döndürme, iOS PWA, güvenli alan) — <head>'de, modül değil
js/main.js              Uygulama girişi, yükleme hattı ve ilerleme, oyun döngüsü (sabit adımlı fizik + çizim enterpolasyonu), menüler
js/perf.js              Uyarlanabilir kalite: önce ikincil efektler, en son yumuşak adımlarla çözünürlük
js/world.js             Arazi, gökyüzü, deniz/göller, ormanlar, iki havaalanı, kasabalar, yollar, köprü
js/city.js              Şehir üreteci: bölgeleme, yol ağı, bina yerleşimi, yeşil alan, detay, trafik, LOD
js/aircraft.js          Prosedürel F-35A modeli: gövde, kokpit + pilot, kanopi, hacimsel art yakıcı alevi
js/fleet.js             F-35A yapılandırması: aerodinamik veri, kontrol kanunu, sistemler, kamera, ses
js/liveries.js          Boya şemaları (livery) — YALNIZCA görsel veri; fizik ve sistemlerle bağı yoktur
js/physics.js           Uçuş dinamiği düzenleyicisi (120 Hz sabit adım): hava verileri, kuvvet/moment
                        toplama, yer teması; veriyi fleet.js + aerodata.js'ten alır
js/rigidbody.js         6-DOF rijit cisim: tam Euler denklemleri (I_xz dahil) + kuaterniyon entegrasyonu
js/atmosphere.js        ISA atmosfer (yoğunluk, ses hızı, basınç oranları)
js/aero.js              Aerodinamik katsayı modeli — alpha/beta'nın SÜREKLİ fonksiyonları, stall eşiği yok
js/aerodata.js          F-35A aerodinamik/itki veri seti + yükleme anında bütünlük denetimi
js/engine.js            Motor modeli: spool dinamiği, irtifa/Mach itki kaybı, art yakıcı
js/fcs.js               Fly-by-wire kontrol kanunu (genel mimari; gerçek F-35 kanunları gizlidir, modellenmez)
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
.nojekyll               GitHub Pages'in dosyaları olduğu gibi sunması için
```

## Kameralar

Oyun **serbest kamerayla** başlar; kokpitte başlamaz. Kamera sırası:

```
Free Camera -> Cockpit -> Chase -> Flyby -> Left Wing -> Right Wing -> Landing Gear
```

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
- Ek maliyet yoktur: panel dokusu paylaşılır (renk çarpanıyla tonlanır). Üçgen
  sayısı ve çizim çağrısı değişmez.
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

**Kontrol yüzeyleri (kamuya açık F-35A yerleşimi).** Kanatta artık tam açıklıklı **hücum kenarı flapları (LEF)** ve kanat başına **tek flaperon** vardır; eski modeldeki ayrı iç flap + dış kanatçık düzeni konvansiyonel bir uçağa aitti (ayrı kanatçık yalnızca F-35C'nin katlanır kanadında bulunur). Flaperonlar flap ve yatışı birlikte yapar; tümüyle hareketli stabilatörler simetrik yunuslama + diferansiyel yatış payı verir; ikiz dümenler sapmada aynı yöne döner, kalkış rotasyonunda ve yüksek AoA'da **toe-in** yapar (firar kenarları içe). FCS'nin otomatik programı: LEF havada AoA ile iner (ses üstünde toplanır; yerde kapalı). Flaperonların simetrik açısı v2.9.1'den beri **yalnızca pilotun flap kolundan** gelir (bkz. aşağıdaki v2.9.1 bölümü); yüksek AoA'daki küçük manevra kamburluğu yalnızca aerodinamikte kalır. Tüm yüzeyler eyleyici hız sınırlıdır ve çizimde ayrıca kısa bir yumuşatmadan geçer (ani sıçrama yok); LEF aerodinamiğe de girer (küçük taşıma/sürükleme artışı).

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

## Dünya ve havaalanları

**Harita 72 x 72 km'dir.** Ortada ova ve tepelik araziler, kenarlarda (27 km'den sonra) dağ kuşağı, sekiz göl, doğudan batıya uzanan bir nehir, iki kasaba, yollar ve iki havaalanı vardır.

**Arazi.** Yükseklik alanı dört katmandan oluşur: çok geniş ölçekli bir *bölge* gürültüsü kabartma şiddetini değiştirir (bazı bölgeler yayvan ova, bazıları engebeli tepelik olur), ana fbm ana hatları, sırt gürültüsü (`1 - |noise|`) doğal vadi ve sırt hatlarını, ince gürültü de yüzey kabartmasını verir. Renklendirme bölgesel iklime (kurak samanlı ↔ nemli koyu yeşil), yüksekliğe (çalılık → kaya → moloz → kar), eğime, tarla desenine ve yamaç yönüne göre köşe renklerinden gelir.

**Havaalanları.** Her havaalanı kendi yerel çerçevesinde tanımlanır (`AIRPORTS` dizisi: merkez, pist yönü, kot, düzleştirme dikdörtgeni). Arazi düzleştirmesi, yüzey tipi sorgusu ve çarpışma kutuları tek kod yolundan geçtiği için yeni havaalanı eklemek bir kayıt satırı ve bir kurucu demektir.

| | Anadolu Hava Üssü | Yeşilova Havalimanı |
|---|---|---|
| Tür | Askeri üs | Sivil havalimanı |
| Konum | Harita merkezi (0, 0) | 24 km doğu-güneydoğu |
| Pist | 09/27 · 3000 x 45 m | 12/30 · 3400 x 45 m |
| Kot | 0 m | 185 m (yayla) |
| Tesisler | Paralel taksi yolları, apron, sundurmalar, hangarlar, korumalı sığınaklar, kule, park halinde F-35'ler | Paralel taksi yolu, apron ve duraklar, cam cepheli terminal + parmak iskele, körükler, kargo apronu, hangarlar, kule |

İki havaalanı arası **yaklaşık 26 km (14 deniz mili)**. Kalkış yeri **hangardaki Departure satırından** seçilir; kamera seçilen havaalanının üzerinde döner. Her iki havaalanı da kalkış ve inişe uygundur.

**Performans.** Arazi 18 x 18 = 324 parçaya bölünür ve üç kademede örneklenir: havaalanı/su çevresi 2x, iç bölge normal, dış dağ kuşağı yarı çözünürlük. Her parçanın iki LOD'u ve histerezisi vardır. Ağaç bütçesi haritanın tamamına eşit dağıtılmaz; iki havaalanı arasındaki koridora ağırlıklı ve **koruluk kümeleri** halinde yerleştirilir, böylece aynı bütçeyle seyrek nokta yerine gerçek orman dokusu oluşur. Ağaç parçaları da 4 km'lik hücrelerdir (mesafe kırpması isabetli olsun diye) ve ağaç geometrisi düşük segmentlidir.

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

Haritanın güneyinde büyük bir körfez vardır. Kıyı çizgisi düz bir kenar değildir: iki ölçekli gürültüyle koylar ve burunlar oluşur (`coastLineZ`). Kıyıdan itibaren plaj eğimi, sonra kademeli derinleşen bir taban gelir; su, derinliğe göre renklenir ve çok sığ bantta köpük çıkar. Deniz yüzeyi harita sınırının 12 km ötesine kadar uzanır, böylece oyuncu su kütlesinin kenarını göremez — bu aynı zamanda haritanın güney sınırını gizler. Kıyı bandı ince, açık deniz kaba ızgarayla döşenir.

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
- **Klavye:** W/S veya ↑/↓ yunuslama, A/D veya ←/→ yatış, Q/E dümen, Shift/Ctrl gaz (üst uçta art yakıcı), G takım, F flap, B fren, C kamera, L ışıklar, M ses, P/Esc duraklat.
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

| Ayar | Piksel oranı | Gölge | Çizim mesafesi | Ağaç | Bulut | Su dalga detayı |
|------|-------------|-------|----------------|------|-------|-----------------|
| Düşük | 1 | yok | 16 km | 19 000 | 46 | düşük |
| Orta (varsayılan) | 1.5 | 1024 | 26 km | 42 000 | 80 | tam |
| Yüksek | 2 | 2048 | 42 km | 72 000 | 125 | tam |

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
- Kontrol kanunu yük katsayısı (g) komutludur; düşük hızda hücum açısı komutuna geçer. Çubuk merkezdeyken uçak trim durumuna yakın kalır, ancak hız düştükçe burun düşer.
- Yunuslama sönümü: dış döngü kazancı dinamik basınca göre programlanır (kapalı döngü kısa periyot sönümü ζ≈0,9), çubuk girişine ön filtre ve kontrol momentlerine 0,04 s eyleyici gecikmesi uygulanır. Çubuk bırakıldığında uçak yeni uçuş yoluna tek ve düzgün bir geçişle oturur; burun aşağı-yukarı sekmesi yoktur. Fizik 120 Hz sabit adımlı olduğundan davranış kare hızından bağımsızdır.
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

## Yerel test

Herhangi bir statik sunucu yeterlidir, örneğin:

```bash
python3 -m http.server 8080
```

Ardından `http://localhost:8080/` adresini açın. (Service worker `localhost` üzerinde de çalışır.)
