# FFS — Flight Simulator (F-35A Lightning II & Airbus A321neo, PWA)

iPhone Safari (iOS 17+), Android Chrome ve masaüstü tarayıcılarda çalışan, ana ekrana eklenebilen (PWA) bir uçuş simülatörü. Derleme adımı yoktur; yalnızca statik dosyalardan oluşur ve Three.js CDN üzerinden sabit sürümle yüklenir.

Açılışta **uçak seçim ekranı** gelir: **F-35A Lightning II** (savaş uçağı) ve **Airbus A321neo** (dar gövdeli yolcu uçağı). Her uçağın kendi 3B modeli, kokpiti, uçuş modeli, sistemleri, sesi, arayüzü ve kamera konumları vardır.

## Dosya yapısı

```
index.html              Sayfa iskeleti, CSS, arayüz, import map
manifest.webmanifest    PWA bildirimi
sw.js                   Service worker (önbellek, çevrimdışı, güncelleme)
js/main.js              Uygulama girişi, oyun döngüsü, menüler
js/world.js             Arazi, gökyüzü, deniz/göller, ormanlar, iki havaalanı, kasabalar, yollar, köprü
js/city.js              Şehir üreteci: bölgeleme, yol ağı, bina yerleşimi, yeşil alan, detay, trafik, LOD
js/aircraft.js          Prosedürel F-35A modeli (fasetli alt gövde, silah yuvası kapakları, düz kokpit güvertesi)
js/a321.js              Prosedürel Airbus A321neo modeli (gövde, kanat, LEAP motorlar, kapılar, A320 kokpiti)
js/fleet.js             Uçak kayıt defteri: her uçağın aerodinamiği, kontrol kanunu, sistemleri, kamerası, sesi
js/liveries.js          Boya şemaları (livery) — YALNIZCA görsel veri; fizik ve sistemlerle bağı yoktur
js/physics.js           Uçuş dinamiği düzenleyicisi (120 Hz sabit adım): hava verileri, kuvvet/moment
                        toplama, yer teması; uçaktan bağımsız, veriyi fleet.js + aerodata.js'ten alır
js/rigidbody.js         6-DOF rijit cisim: tam Euler denklemleri (I_xz dahil) + kuaterniyon entegrasyonu
js/atmosphere.js        ISA atmosfer (yoğunluk, ses hızı, basınç oranları)
js/aero.js              Aerodinamik katsayı modeli — alpha/beta'nın SÜREKLİ fonksiyonları, stall eşiği yok
js/aerodata.js          Uçak başına aerodinamik/itki veri setleri + yükleme anında bütünlük denetimi
js/engine.js            Motor modeli: spool dinamiği, irtifa/Mach itki kaybı, art yakıcı
js/fcs.js               Fly-by-wire kontrol kanunu (genel mimari; gerçek F-35 kanunları gizlidir, modellenmez)
PUBLIC_DATA_SOURCES.md  Her sayının kaynağı: [V] doğrulanmış kamuya açık / [E] mühendislik yaklaşımı / [T] ayarlanmış
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

Seçim ekranında her uçak için bir satır livery çipi vardır; seçim `localStorage`'a
yazılır ve sonraki açılışta geri yüklenir.

| F-35A | Airbus A321neo |
|---|---|
| USAF Standard | Atlantic Blue |
| Navy Style | Aurora Teal |
| Luftwaffe Style | Ember Red |
| | Slate Charcoal |

- Tanımlar `js/liveries.js` içinde tek bir veri tablosudur. Yeni bir livery eklemek
  için diziye bir girdi yazmak yeterlidir; arayüz listeyi kendisi üretir.
- Livery **yalnızca görseldir**: malzeme renkleri, gövde kaplama paleti ve
  işaret/yazı dekalları. Geometri, kütle, atalet, aerodinamik katsayılar, sistemler,
  kamera ve ses hiçbir biçimde etkilenmez — aynı girdiyle 60 s manevra sonunda iki
  farklı livery **birebir aynı** uçuş durumunu verir (test/livphys.mjs).
- Ek maliyet yoktur: savaş uçağında panel dokusu paylaşılır (renk çarpanıyla
  tonlanır), yolcu uçağında kaplama dokusu zaten uçak başına üretiliyordu. Üçgen
  sayısı ve çizim çağrısı değişmez.
- Uçuş sırasında livery değiştirilirse yalnızca görsel model yeniden kurulur;
  fizik nesnesine dokunulmaz (konum, hız, yönelim, motor, takım/flap/spoyler korunur).

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
4. Ana ekrandaki **F-35A** simgesi uygulamayı tam ekran, adres çubuğu olmadan açar. Telefonu yatay tutun; dikey tutulduğunda oyun duraklar ve "Telefonu yatay çevirin" uyarısı görünür.
5. İlk açılışta **Başla**'ya dokunun: ses ve (ayarlardan açılmışsa) eğim kontrolü izni bu dokunuşla etkinleşir.

Android Chrome'da adres çubuğundaki menüden **Ana ekrana ekle / Uygulamayı yükle** seçeneği aynı işi görür.

## Uçak seçimi

- Oyun açılınca **UÇAK SEÇ** ekranı gelir. İki büyük kart yan yana durur (dar ekranda alt alta); her kartta uçağın **oyun içi modelinden anlık üretilmiş** önizlemesi, adı ve teknik bilgileri vardır. Önizlemeler dışarıdan indirilmez; `WebGLRenderTarget` ile o anda render edilir.
- Karta dokunulduğunda yalnızca seçilen uçak sahneye kurulur: modeli, fiziği, kokpiti, sesi, HUD biçimi, arayüz düğmeleri ve kamera konumları birlikte değişir. İki uçak aynı anda sahnede bulunmaz; önceki model ve tüm kaynakları (`dispose`) serbest bırakılır.
- Uçuş sırasında **☰ Menü → Duraklat → Uçak Değiştir** ile seçim ekranına dönülür.
- Yeni uçak eklemek için `js/fleet.js` içine bir yapılandırma nesnesi eklemek yeterlidir; kodun geri kalanında uçağa özel dallanma yoktur.

## Airbus A321neo

**Model.** Gerçek ölçüler: uzunluk 44,51 m, kanat açıklığı 35,8 m (sharklet dahil), yükseklik 11,8 m. Yuvarlatılmış gövde kesiti 20 istasyonluk bir tablodan loft edilir (düz alt yüzey yok).

**Burun ve ön gövde.** Kesitler 0 → 6,50 m arasında analitik bir eğriden üretilir. Yarı genişlik oranı f(s) kontrol noktalarından **monoton kübik (PCHIP)** ile geçirilir; ilk 1,5 m gerçek bir **teğet ojiv** radomdan gelir (taban yarıçapı 1,35 m, uzunluk 2,5 m → ojiv yarıçapı ρ = (R_b² + L_n²)/(2R_b) = 2,99 m, r(x) = √(ρ² − (L_n − x)²) + R_b − ρ). Bu ojiv s = 0,25 / 0,50 / 1,00 / 1,50 m'de gövde genişliğinin **%14 / %26 / %43 / %55**'i kadardır — yani A320 radomu küttür. Radom tabanı silindire teğet değildir (gövde arkasında genişlemeyi sürdürür), bu yüzden eğri 1,9 m'den sonra sekant gibi devam eder ve 6,8 m'de tam kesite teğet oturur.

Karina doğrudan tanımlıdır: `yb(s) = −2,06 + 1,15·(1 − s/5)³`, uçta −0,90. Sarkma buradan gelir, taç ise `yb + 4,05·f(s)` olarak türetilir; kesit her yerde dairesele yakın kalır. **Üs 3'tür**: karina uçta hızla yükselir, böylece siluet alttan da daralır — üs 2 ile alt hat neredeyse yataydı ve burun yuvarlak kapaklı bir *boru* gibi görünüyordu.

Denenen ve elenen iki eğri vardı: 7,0 m'lik uzun bir ojiv (aynı istasyonlarda %9 / %16 / %31) burnu **sivri** yapıyordu; sonraki 5,0 m'lik dolgun eğri (%17 / %30 / %49) ise onu **şişkin** yapıyor, üstelik radom camları örtüyordu. Şimdiki eğri ikisinin arasındadır.

Radom **ayrı bir küre değildir**; aynı kesit tablosunun ilk parçasının loft'udur, yalnızca malzemesi farklıdır (derz istasyon 2,44'te). Radom ile kaplama aynı halkayı paylaştığı için geçişte ne dikiş ne çap sıçraması olur.

**Kokpit camları.** A320 ailesinin altı pencereli düzeni: iki ön cam (No.1), yan ön cam (No.2), açılabilir DV penceresi ve arka çeyrek pencere. Her cam **(u, w) parametre uzayında hafifçe yuvarlatılmış köşeli** bir dış hattan üretilir (u = 0 ön direk → 1 arka direk, w = 0 üst → 1 alt kenar); No.1 camın üst-ön köşesi diğerlerinden geniş yuvarlanır — Airbus ön camının imzası budur.

Bandın kenarları sabit v ile değil **mutlak yükseklikle** çözülür: üst kenar y = 1,38 → 1,17 m, eşik y = 0,66 → 0,75 m. Bant böylece neredeyse yataydır ve gövde onun çevresinde büyür; A320'nin kaşı (üst camın üstündeki gövde) önde 0,01 m'den arkada 0,80 m'ye açılır, cam yükseklikleri 0,71 → 0,42 m'ye iner. Sabit v ile çalışırken eşik arkaya doğru yükseliyor, DV penceresinin alt kenarı pilot göz hizasının üstünde kalıyordu (yana bakınca gövde duvarı görünüyordu). Camlar arasındaki istasyon boşlukları 0,16-0,18 m'dir; daha dar boşluklarda çerçeve halkaları birleşiyor ve dört cam **tek bir kara leke** gibi okunuyordu.

Camlar yüzeye yapıştırılmış dekal değildir, **gerçek derinliği olan** dört katmanlı bir yapıdır (hepsi yüzey normali boyunca, metre cinsinden ötelenir):

1. **Parlama maskesi** — 4 mm, mat siyah; bandı saran ince şerit, uçlara doğru kama gibi sivrilir. Üst kenarı taç çizgisini geçemez, böylece burnun tepesinde gövde rengi bir **orta direk** kalır ve iki ön cam ayrı okunur.
2. **Çerçeve halkası** — 22 mm, koyu gri metal; cam başına ayrı bir halka, dış hattı aynı eğrinin genişletilmiş kopyası. Halkalar birbirine değmez, aralarında maske görünür.
3. **Yanak (reveal)** — çerçeveden cam yüzeyine inen 17 mm'lik duvar; kenardaki gölge çizgisi buradan gelir.
4. **Cam** — 5 mm, koyu ve parlak.

**Kokpit astarı.** Gövdeyi izleyen, cam açıklıkları kesilmiş bir tüptür. İki kural onu doğru kılar:

- Astar hücresi cam çerçevesinden **küçük** olmalıdır (0,055 m × 0,023 v hücreye karşı 0,062 m × 0,028 v çerçeve). Açıklık camdan bir hücre büyük kesildiği için, hücre çerçeveden büyükse kesim izi çerçevenin dışına taşar ve kokpitten bakınca testere dişi bir kenar görünür.
- Ön camın **önünde** bir koridor açıktır. Astar orada da devam ediyordu ve camdan çıkan bakış ışınını birkaç on santim sonra yeniden kesiyordu: pilot düz ileri baktığında dışarıyı göremiyor, kokpit dar bir kemer gibi duruyordu. Eşiğin altı ve tacın üstü kapalı kalır, yani burnun içinden aşağı ya da yukarı bakılamaz.

Pilot göz noktası tacın ~0,95 m altındadır (gerçek A320'de ~1,0-1,1 m). Ölçülen görüş: düz ileri −10°…+20°, yan pencerelerden −12°…+26°.

**Işıklar.** Seyir ve çakar ışıkları kanat ucu kaportasına oturur: kırmızı/yeşil hücum kenarında, beyaz flaşör firar kenarında — sharklet'in dibinde, gerçek A320neo'daki gibi. (Sharklet eklendikten sonra ışıklar bir süre ESKİ kanat ucu noktasında kalmış ve uçağın ~1 m yanında havada asılı duruyordu; konumlar artık doğrudan kanat geometrisinden türetilir ve `fleet.mjs` her ışığın gövdeye uzaklığını 0,15 m sınırıyla sınar.)

Dört yolcu kapısı, iki kanat üstü acil çıkış, iki kargo kapağı çerçeveleriyle birlikte modellenir; ayrıca VHF blade antenler, SATCOM, pitot ve AoA probları, APU egzozu ve dikey stabilizatör kökünde dorsal fileto vardır. Takım kapakları yalnızca takım hareket ederken açılır (gerçek davranış), takım tam açık ya da kapalıyken kapanır.

**Motorlar.** CFM LEAP-1A ölçülerinde büyük baypaslı nacelle (kamuya açık veriler: fan çapı 1,98 m, nacelle dış çapı ~2,42 m). Nacelle tek bir eksenel profilden döndürülerek üretilir ve uç uca eklenen üç parçadan oluşur: fan kaportası, ters itki derzi (sığ bir oluk) ve ters itki kaportası. Parçalar ORTAK yarıçapta birleşir — daha önce derz, daralan kaportanın içinden geçen ayrı bir silindirdi ve ekranda testere dişi gibi bir z-fighting bandı bırakıyordu.

Giriş dudağı, iç giriş kanalı, 18 geniş kirişli fan kanadı, spinner, fan lülesi, sıcak kısım kaportası, sıcak lüle ve merkez konisi ayrı ayrı modellenir. Fan kanatları yarıçapla birlikte burulur (kökte eksene ~30°, uçta ~62°), böylece fan diski önden bakıldığında gerçek bir fan gibi yoğun okunur. Kanat kökü göbeğin, ucu kanal duvarının içinde kalır; kapatılmamış uçlar hiçbir açıdan görünmez. Pilon dikey bir kanatçık olarak loft edilir: alt sıraları nacelle'in, üst sıraları kanadın İÇİNDE kalır, dolayısıyla iki uçta da ne boşluk ne taşma olur. Fan N1 ile orantılı döner.

**Kanat.** Sabit kanat TAM profil olarak (veterin %0'ından %100'üne) kapalı biçimde loft edilir. Daha önce yalnızca %13-74 arası bir "kutu" vardı; slat ve flap panellerinin arasındaki açıklıklarda kanadın içi görünüyor, hücum ve firar kenarları kesik duruyordu. Hareketli yüzeyler bu kapalı kabuğun 14 mm dışına oturur, böylece nötr konumda çakışıp z-fighting yapmazlar ve açıldıklarında altından gerçek kanat yapısı çıkar.

Sharklet'in kök kesiti kanadın uç kesitiyle birebir aynıdır (aynı veter, kalınlık ve y), yükselme ise dairesel bir kıvrımla başlayıp düz devam eder — A320neo'nun "yumuşak dip, dik uç" silueti. Kanat başına dört flap ray karinası (kano) firar kenarının ~1,5 m gerisine uzanır; A320 ailesinin en tanınır alt-kanat detayıdır.

**Kontrol yüzeyleri.** Aileron, asansör, dümen, Fowler flap (0 / 1 / 2 / 3 / FULL), öne-aşağı uzayan slat, kanat başına beş spoyler paneli. Spoyler panelleri artık düz kutular değil, üst yüzeyi izleyen ince levhalardır ve süpürülmüş menteşe çizgisi etrafında döner (düz X ekseni 45°'de panel uçlarında ~0,2 m sapma bırakıyordu). Yüzeyler mekanik hızla hareket eder (ani sıçrama yok), sol ve sağ birbirini doğru aynalar, flap kolu spoyleri hiç kıpırdatmaz.

**Kokpit.** A320 ailesine özgü düzen: iki sidestick, PFD ve ND ekranları, iki ECAM ekranı, glareshield üzerinde FCU, orta konsolda gaz kolları ile flap / hız freni / takım kolları, tavan paneli ve koltuklar. Gaz kolları, kollar ve sidestick'ler uçuş girdileriyle birlikte hareket eder.

**Uçuş modeli.** F-35'ten tamamen bağımsız katsayı takımı: 80 t kalkış ağırlığı, 128 m² kanat, 2 × 143 kN statik itki. Ağır jet karakteri ölçülerle doğrulanmıştır — ~30 s'de 150 kt'a ulaşan kalkış rulosu, ~2 500–3 000 ft/dk ilk tırmanış, 3° süzülme yolunda ~142–150 kt yaklaşma, flare, temas, otomatik yer spoyleri, ters itki ve duruş.

- **İtki kaybı:** yüksek baypaslı turbofanda net itki hızla belirgin düşer (M 0,23'te statiğin ~%78'i). Savaş uçağının düşük baypaslı motorunda ise ram basıncı itkiyi artırır; iki karakteristik `fleet.js` içinde ayrı parametrelenmiştir.
- **Spool gecikmesi:** rölantiden tam güce ~8 s (F-35'te ~3,5 s). Yaklaşmada gaz verince gecikmeyi hissedersiniz.
- **Hız freni / yer spoyleri:** havada spoyler yarım açılır (hız freni), yerde tam açılır. Temastan sonra fren komutuyla kendiliğinden devreye girer.
- **Ters itki:** yerde, 23 kt üzerinde ve fren komutuyla açılır; hız düşünce kendiliğinden kapanır.

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
| Tesisler | Paralel taksi yolları, apron, sundurmalar, hangarlar, korumalı sığınaklar, kule, park halinde F-35'ler | Paralel taksi yolu, apron ve duraklar, cam cepheli terminal + parmak iskele, körükler, kargo apronu, hangarlar, kule, park halinde yolcu uçakları |

İki havaalanı arası **yaklaşık 26 km (14 deniz mili)**: A321neo ile tırmanış-seyir-iniş içeren gerçek bir kısa hat uçuşu. Kalkış yeri **seçim ekranındaki KALKIŞ satırından** seçilir; kamera seçilen havaalanının üzerinde döner. Her iki havaalanı da her iki uçakla kalkış ve inişe uygundur.

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
- **RUDDER kaydırıcısı (alt orta):** yaylı analog dümen ve burun tekeri; parmağı/fareyi bırakınca tam merkeze döner. **Takım / Fren:** aç-kapat.
- **FLAPS kolu (sol alt):** gerçek bir kol gibi çalışan dikey kaydırıcı. Yukarı 0 (temiz), aşağı son kademe; sürüklerken en yakın kademeye oturur, ize dokunmak da o kademeye atlar. Topuz kademe adını ve **flap açısını** gösterir (A321neo: 0 / 1 = 10° / 2 = 15° / 3 = 20° / FULL = 40°). Kol her uçuşta **0'da** başlar. Klavyedeki **F** kademeleri sırayla gezer; kol onu da izler.
- **☰ Menü (sol üst):** Duraklat, Kamera, Ses ve Işık düğmeleri bu çekmecede toplanır; dokununca yumuşak bir geçişle açılır, 7 s hareketsizlikte veya duraklatınca kendini kapatır. Ekranda sürekli yalnızca uçuş için gerekli kontroller kalır. Çekmece açıkken joystick alanı onun altından başlar, böylece uçuş girişi ile menü dokunuşları çakışmaz.
- **Spoilers (yalnızca A321neo):** hız freni / yer spoyleri kolu. Klavyede **V**.
- **Kalkış durumu:** uçak piste **fren basılı DEĞİL**, gaz rölantide ve **flap 0** ile doğar. Yerinde durmasını fren değil, aşağıda anlatılan kopma sürtünmesi sağlar.
- **Uçak ve kamera düğmeleri İngilizcedir:** `Flaps`, `Spoilers`, `Camera`, `Landing Gear`. Kamera modu adları da İngilizcedir (CHASE / COCKPIT / FREE / FLYBY / LEFT WING / RIGHT WING / LANDING GEAR).
- **Kamera:** takip → kokpit → serbest (sürükleyerek döndür, iki parmakla yakınlaştır) → uçuş geçişi (sabit dış kamera, Doppler sesi) → sol kanat → sağ kanat → iniş takımı. Kanat ve takım görünümleri gövdeye sabittir ve her uçak için ayrı konumlanır. Tam HUD yalnızca kokpit görünümünde çizilir; tüm dış görünümlerde üst ortada kompakt bir şerit sürekli **IAS / ALT / VS / HDG** gösterir, A321neo'da ayrıca **THR / GEAR / FLAP / SPD BRK / WIND**; altında kısa uyarılar (STALL, İNİŞ TAKIMI) çıkar. Dar ekranda sığmayan alanlar sondan düşer.
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

Oyun **60 fps'e sabitlenmiştir**. Render döngüsü sürüklenmesiz bir hedef zamanla ilerler: 60 Hz ekranda hiçbir kare atlanmaz, 90/120/144/165 Hz ekranlarda fazla kareler atlanıp ortalama tam 60 fps olur, 60'ın altında kalan cihazlarda yapay kare eklenmez. Fizik bundan bağımsızdır ve her koşulda 120 Hz sabit adımla çalışır.

Hedefi tutturmak için **uyarlanabilir çözünürlük** vardır: kare süresi 19,5 ms'yi (≈51 fps) aşan süre birikince 3B render ölçeği kademeli düşer (en fazla %60'a kadar), cihaz 6 saniye boyunca hedefi tutturursa kademeli geri yükselir. Arayüz ve HUD her zaman tam çözünürlükte çizilir. Ayarlar → FPS göstergesi açıkken satır `58/60 fps · ölçek %88 · 134 çizim` biçiminde güncel durumu gösterir.

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
- Yunuslama sönümü: dış döngü kazancı dinamik basınca göre programlanır (kapalı döngü kısa periyot sönümü F-35'te ζ≈0,9, A321neo'da ζ≈0,95), çubuk girişine ön filtre ve kontrol momentlerine 0,04 s eyleyici gecikmesi uygulanır. Çubuk bırakıldığında uçak yeni uçuş yoluna tek ve düzgün bir geçişle oturur; burun aşağı-yukarı sekmesi yoktur. Fizik 120 Hz sabit adımlı olduğundan davranış kare hızından bağımsızdır.
- Taşıma/sürükleme: CL eğrisi tek sürekli ifadedir (eşik yok), indüklenmiş sürükleme (Oswald), girdap/ayrılma sürüklemesi, transonik dalga sürüklemesi, takım/flap sürüklemesi, yer etkisi (h/b oranına göre) ve ISA atmosferi.
- Motor: yavaş tepkili itki (spool), art yakıcı ayrı kademe, yakıt tüketimi; ses motoru rumble/türbin/egzoz/art yakıcı katmanlarını buna göre karıştırır. Ses tümüyle sentezlenir (döngüye alınmış motor kaydı yoktur): gürleme, kükreme, türbin ıslığı ve egzoz katmanlarının frekans ve seviyeleri N1'i sürekli izler, böylece rölanti, spool, kalkış, seyir, spool-down ve ters itki kendiliğinden ayrışır.
- Kullanılabilir yük katsayısı, içinde bulunulan konfigürasyonun azami taşımasıyla hesaplanır (flap ve slat katkısı dahil). Yalnızca temiz CLmax kullanılsaydı yolcu uçağı yaklaşmada 1 g'nin altında bir tavana takılır ve flare yapamazdı.
- Aerodinamik/itki katsayıları `js/aerodata.js`'te, kontrol kanunu kazançları ile sistem/kamera/ses/arayüz yapılandırması `js/fleet.js`'tedir; ikisi de uçak başına ayrıdır.
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
