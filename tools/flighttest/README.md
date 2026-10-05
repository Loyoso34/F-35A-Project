# Uçuş fiziği test matrisi

`js/physics.js`, `js/fcs.js`, `js/aero.js` ve `js/rigidbody.js`'in **kendisini** Node'da
çalıştırır; tarayıcı, WebGL ya da sahne gerekmez. `main.js` döngüsü birebir taklit edilir:
girdi karede bir örneklenir, fizik 120 Hz sabit adımla ilerler, çubuk yumuşatması alt
adımlarda uygulanır, karede en fazla 12 adım.

```bash
cd tools/flighttest
npm install          # yalnızca three@0.170.0 (uygulamanın CDN'den aldığı sürüm)
npm test             # 21 senaryo + kabul denetimleri; başarısızlıkta çıkış kodu 1
npm run nosedown     # tam ileri çubuk zaman serisi -> nosedown.csv
```

Senaryolar: tam ileri / tam geri çubuk, nötr çubuk sönümü, azami +g ve −g, yüksek ve düşük
hızda burun aşağı, ses üstü yunuslama, yüksek AoA, stall toparlanması (bırakılmış ve tam geri
çubuk), tam yatış, tam dümen, yunuslama + yatış, yunuslama + sapma, kalkış (dört farklı çubuk
miktarı), 3° yaklaşma ve flare, takım yukarı seyir, takım aşağı yavaş uçuş, 30 / 60 fps ve
değişken kare süresi (120 fps referansıyla zaman serisi RMS farkı).

`nosedown.csv` sütunları: çubuk (ham / eğrili / ön filtreli), stabilatör komutu ve gerçek
konumu (firar kenarı aşağı +), yunuslama ivmesi ve oranı, yunuslama açısı, AoA, yük faktörü,
kare ve fizik adım süresi.

Ortam değişkenleri:

- `APP=<kök>` başka bir kopyayı (ör. eski sürüm) test eder.
- `MODE=zoh` v3.4.0 ve öncesinin döngüsünü taklit eder (kare sonu çubuk değeri tüm alt
  adımlarda sabit). Eski sürümle karşılaştırma içindir.
- `OUT=dosya.json` ölçütleri JSON olarak yazar.
- `THREE_PATH=<three klasörü>` `npm install` yerine mevcut bir three kopyasını kullanır.

Test pilotları (kalkış ve iniş) insan gibi tutum uçar: istenen yol açısı + AoA = istenen
yunuslama; çubuk tutum hatası ve yunuslama oranıyla orantılıdır.
