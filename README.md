# Uçuş Simülatörü — F-35A Lightning II & Airbus A321neo (PWA)

iPhone Safari (iOS 17+), Android Chrome ve masaüstü tarayıcılarda çalışan, ana ekrana eklenebilen (PWA) bir uçuş simülatörü. Derleme adımı yoktur; yalnızca statik dosyalardan oluşur ve Three.js CDN üzerinden sabit sürümle yüklenir.

Açılışta **uçak seçim ekranı** gelir: **F-35A Lightning II** (savaş uçağı) ve **Airbus A321neo** (dar gövdeli yolcu uçağı). Her uçağın kendi 3B modeli, kokpiti, uçuş modeli, sistemleri, sesi, arayüzü ve kamera konumları vardır.

## Dosya yapısı

```
index.html              Sayfa iskeleti, CSS, arayüz, import map
manifest.webmanifest    PWA bildirimi
sw.js                   Service worker (önbellek, çevrimdışı, güncelleme)
js/main.js              Uygulama girişi, oyun döngüsü, menüler
js/world.js             Arazi, gökyüzü, su, ormanlar, iki havaalanı, kasabalar, yollar
js/aircraft.js          Prosedürel F-35A modeli (fasetli alt gövde, silah yuvası kapakları, düz kokpit güvertesi)
js/a321.js              Prosedürel Airbus A321neo modeli (gövde, kanat, LEAP motorlar, kapılar, A320 kokpiti)
js/fleet.js             Uçak kayıt defteri: her uçağın aerodinamiği, kontrol kanunu, sistemleri, kamerası, sesi
js/physics.js           Uçuş dinamiği (120 Hz sabit adım), uçaktan bağımsız; katsayıları fleet.js'ten alır
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

## Uçak seçimi

- Oyun açılınca **UÇAK SEÇ** ekranı gelir. İki büyük kart yan yana durur (dar ekranda alt alta); her kartta uçağın **oyun içi modelinden anlık üretilmiş** önizlemesi, adı ve teknik bilgileri vardır. Önizlemeler dışarıdan indirilmez; `WebGLRenderTarget` ile o anda render edilir.
- Karta dokunulduğunda yalnızca seçilen uçak sahneye kurulur: modeli, fiziği, kokpiti, sesi, HUD biçimi, arayüz düğmeleri ve kamera konumları birlikte değişir. İki uçak aynı anda sahnede bulunmaz; önceki model ve tüm kaynakları (`dispose`) serbest bırakılır.
- Uçuş sırasında **☰ Menü → Duraklat → Uçak Değiştir** ile seçim ekranına dönülür.
- Yeni uçak eklemek için `js/fleet.js` içine bir yapılandırma nesnesi eklemek yeterlidir; kodun geri kalanında uçağa özel dallanma yoktur.

## Airbus A321neo

**Model.** Gerçek ölçüler: uzunluk 44,51 m, kanat açıklığı 35,8 m (sharklet dahil), yükseklik 11,8 m. Yuvarlatılmış gövde kesiti 20 istasyonluk bir tablodan loft edilir (düz alt yüzey yok).

**Burun ve radom.** Kesit tablosu merkez kaçıklığı (kambur) taşır: A320 ailesinde olduğu gibi radom ekseni gövde ekseninin ~0,56 m altındadır ve burun ucundan ön cama doğru yükselen bir sırt oluşur. Radom **ayrı bir küre değildir**; aynı kesit tablosunun ilk parçasının loft'udur, yalnızca malzemesi farklıdır. Radom ile kaplama aynı halkayı paylaştığı için geçişte ne dikiş ne çap sıçraması olur. Kokpit camları A320 ailesinin altı pencereli düzenindedir (iki ön cam, açılabilir DV penceresi, arka yan pencere) ve gövde eğrisini izleyen, koyu çerçeveli paneller olarak kurulur.

Dört yolcu kapısı, iki kanat üstü acil çıkış, iki kargo kapağı çerçeveleriyle birlikte modellenir; ayrıca VHF blade antenler, SATCOM, pitot ve AoA probları, APU egzozu ve dikey stabilizatör kökünde dorsal fileto vardır. Takım kapakları yalnızca takım hareket ederken açılır (gerçek davranış), takım tam açık ya da kapalıyken kapanır.

**Motorlar.** CFM LEAP-1A benzeri büyük baypaslı nacelle: giriş dudağı, fan kanalı, 18 kanatlı fan, spinner, pilon ve egzoz. Fan N1 ile orantılı döner.

**Kontrol yüzeyleri.** Aileron, asansör, dümen, Fowler flap (0 / 1 / 2 / 3 / FULL), öne-aşağı uzayan slat, kanat başına beş spoyler paneli. Yüzeyler mekanik hızla hareket eder (ani sıçrama yok), sol ve sağ birbirini doğru aynalar, flap kolu spoyleri hiç kıpırdatmaz.

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

## Rüzgâr

Aerodinamik her zaman **havaya göre bağıl hızla** hesaplanır, yer hızıyla değil. Varsayılan rüzgâr pist 09 için hafif karşı rüzgâr ve ~3 kt çapraz bileşendir (110°/9 kt, 4 kt patlamalı). Yüzeye yakın sürtünme katmanında hız düşer, yön ve şiddet yavaşça gezinir. Sonuçlar:

- Park halindeyken hız göstergesi rüzgârı gösterir (gerçek uçakta olduğu gibi).
- Çapraz rüzgârda uçak yanal olarak sürüklenir; pist eksenini tutmak için yengeç açısı gerekir.
- Üsteki rüzgâr tulumu gerçek rüzgâr yönüne döner ve şiddete göre dolar.
- Dış kamera şeridinde **WIND 110/9 KT** olarak görünür.

## Kontroller

- **Sol joystick:** yunuslama ve yatış. **Sağ kaydırıcı:** gaz kolu; üstteki turuncu bölge art yakıcı.
- **RUDDER kaydırıcısı (alt orta):** yaylı analog dümen ve burun tekeri; parmağı/fareyi bırakınca tam merkeze döner. **Takım / Flap / Fren:** aç-kapat.
- **☰ Menü (sol üst):** Duraklat, Kamera, Ses ve Işık düğmeleri bu çekmecede toplanır; dokununca yumuşak bir geçişle açılır, 7 s hareketsizlikte veya duraklatınca kendini kapatır. Ekranda sürekli yalnızca uçuş için gerekli kontroller kalır. Çekmece açıkken joystick alanı onun altından başlar, böylece uçuş girişi ile menü dokunuşları çakışmaz.
- **Spoilers (yalnızca A321neo):** hız freni / yer spoyleri kolu. Klavyede **V**.
- **Flaps:** F-35'te aç/kapat, A321neo'da kol 0 → 1 → 2 → 3 → FULL sırayla ilerler; düğme etiketi geçerli kademeyi gösterir.
- **Uçak ve kamera düğmeleri İngilizcedir:** `Flaps`, `Spoilers`, `Camera`, `Landing Gear`. Kamera modu adları da İngilizcedir (CHASE / COCKPIT / FREE / FLYBY / LEFT WING / RIGHT WING / LANDING GEAR).
- **Kamera:** takip → kokpit → serbest (sürükleyerek döndür, iki parmakla yakınlaştır) → uçuş geçişi (sabit dış kamera, Doppler sesi) → sol kanat → sağ kanat → iniş takımı. Kanat ve takım görünümleri gövdeye sabittir ve her uçak için ayrı konumlanır. Tam HUD yalnızca kokpit görünümünde çizilir; tüm dış görünümlerde üst ortada kompakt bir şerit sürekli **IAS / ALT / VS / HDG** gösterir, A321neo'da ayrıca **THR / GEAR / FLAP / SPD BRK / WIND**; altında kısa uyarılar (STALL, İNİŞ TAKIMI) çıkar. Dar ekranda sığmayan alanlar sondan düşer.
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

## Kare hızı

Oyun **60 fps'e sabitlenmiştir**. Render döngüsü sürüklenmesiz bir hedef zamanla ilerler: 60 Hz ekranda hiçbir kare atlanmaz, 90/120/144/165 Hz ekranlarda fazla kareler atlanıp ortalama tam 60 fps olur, 60'ın altında kalan cihazlarda yapay kare eklenmez. Fizik bundan bağımsızdır ve her koşulda 120 Hz sabit adımla çalışır.

Hedefi tutturmak için **uyarlanabilir çözünürlük** vardır: kare süresi 19,5 ms'yi (≈51 fps) aşan süre birikince 3B render ölçeği kademeli düşer (en fazla %60'a kadar), cihaz 6 saniye boyunca hedefi tutturursa kademeli geri yükselir. Arayüz ve HUD her zaman tam çözünürlükte çizilir. Ayarlar → FPS göstergesi açıkken satır `58/60 fps · ölçek %88 · 134 çizim` biçiminde güncel durumu gösterir.

## Kalite ayarları

| Ayar | Piksel oranı | Gölge | Çizim mesafesi | Ağaç | Bulut | Su dalga detayı |
|------|-------------|-------|----------------|------|-------|-----------------|
| Düşük | 1 | yok | 16 km | 19 000 | 46 | düşük |
| Orta (varsayılan) | 1.5 | 1024 | 26 km | 42 000 | 80 | tam |
| Yüksek | 2 | 2048 | 42 km | 72 000 | 125 | tam |

Dünya 72 × 72 km'dir: kenarlarda dağlar, ortada düzlükler ve tarlalar, sekiz göl, bir nehir, yollar, iki kasaba, bir askeri hava üssü ve bir sivil havalimanı (paralel taksi yolları, apron, güneşlikler, hangarlar, korumalı sığınaklar, kule, park halinde F-35'ler, bakım atölyeleri, kışla ve filo binaları, yakıt sahası, mühimmat igloları, dikenli telli çevre çiti, nöbetçi kulübeli kapılar, çevre/servis yolları, otoparklar, askeri araçlar ve bitki örtüsü). Su yüzeyleri derinliğe göre renklenir (sığ turkuaz → derin koyu), kıyılar yumuşak geçişlidir ve gökyüzü/güneş yansıması Fresnel ile hesaplanır.

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
- Taşıma/sürükleme: CL eğrisi stall sonrası düşer, indüklenmiş sürükleme (Oswald), ayrılma sürüklemesi, takım/flap sürüklemesi, yer etkisi (h/b oranına göre) ve ISA atmosferi.
- Motor: yavaş tepkili itki (spool), art yakıcı ayrı kademe, yakıt tüketimi; ses motoru rumble/türbin/egzoz/art yakıcı katmanlarını buna göre karıştırır. Ses tümüyle sentezlenir (döngüye alınmış motor kaydı yoktur): gürleme, kükreme, türbin ıslığı ve egzoz katmanlarının frekans ve seviyeleri N1'i sürekli izler, böylece rölanti, spool, kalkış, seyir, spool-down ve ters itki kendiliğinden ayrışır.
- Kullanılabilir yük katsayısı, içinde bulunulan konfigürasyonun azami taşımasıyla hesaplanır (flap ve slat katkısı dahil). Yalnızca temiz CLmax kullanılsaydı yolcu uçağı yaklaşmada 1 g'nin altında bir tavana takılır ve flare yapamazdı.
- Tüm katsayılar (`js/fleet.js`) uçak başına ayrıdır: kütle, atalet, kanat, itki ve spool, taşıma/sürükleme eğrileri, kontrol gücü, kontrol kanunu kazançları, yer davranışı, limitler, sistemler, kameralar, ses profili ve arayüz bayrakları.

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
