// Gerçek dünya bölgesi: Bodrum (Muğla, Türkiye) ve Milas–Bodrum Havalimanı (LTFE).
//
// Her sayının kaynağı yanında yazılıdır. Doğrulanamayan veri (yaklaşma ışık sistemi, PAPI,
// taksi yolu çizgileri, bina yükseklikleri) UYDURULMAZ ve kurulmaz.
//
// Pist verisi
//  - İki paralel pist: 10L/28R ve 10R/28L (OurAirports runways.csv, kayıt 239233 ve 336567).
//  - Eksen yönü ve pist merkez çizgileri Sentinel-2 L2A görüntüsünden (2024-10-03, 10 m) ÖLÇÜLDÜ:
//    en keskin enine profil 106,2° (UTM 35N ızgarası) = 106,6° gerçek; OurAirports'un 10L/28R uç
//    koordinatları aynı yönü verir (106,21°). Kuzey pist merkez çizgisi güney pistin 185 m
//    kuzeyindedir (görüntüde iki kaplama şeridi; ICAO kod E pist–taksi yolu aralığı 182,5 m).
//  - Uzunluk/genişlik: OurAirports (10L/28R 9843 ft = 3000 m, 10R/28L 9646 ft = 2940 m, ikisi de
//    148 ft = 45 m). 10L ucu OurAirports koordinatı, merkez çizgisine izdüşürüldü. 10R ucu OurAirports;
//    OurAirports'un 28L koordinatı görüntüyle çelişir (kaplama 500 m daha doğuya uzanır) ve
//    kullanılmadı: 28L = 10R + 2940 m.
//  - Eşik kotları: OurAirports (10L 9 ft, 28R 21 ft, 10R/28L 14 ft). DEM bağımsız olarak 10L'de 2,9 m,
//    28R'de 5,6 m verir (±1 m uyum). Meydan kotu 21 ft (OurAirports airports.csv).
//  - Uç koordinatları: görüntüden ölçülen pist merkezi korunarak yayımlanmış GERÇEK uzunluğa
//    (yerel TM, ölçek 1,000000) ayarlandı; UTM ızgara metresiyle ölçüm 0,036 % kısa kalıyordu.
//  - Pist öncesi kaplama (pad): görüntüde kaplamanın eşikten taşan uzunluğu (±10 m).
//  - Tanımlayıcılar yayımlanmış hâliyle (10L/28R, 10R/28L) kullanılır; NOAA WMM-2025 sapması
//    (5,41° D, manifest) ile 106,6° gerçek = 101,2° manyetik -> "10" (tutarlı).
export const LTFE = {
  id: 'ltfe', icao: 'LTFE', iata: 'BJV', name: 'Milas–Bodrum Airport', kindLabel: 'Milas–Bodrum (LTFE)',
  arp: { lat: 37.249314, lon: 27.66401 }, elevFt: 21,
  runways: [
    {
      id: '10L/28R', width: 45, lengthM: 3000,
      ends: [
        { num: '10', suffix: 'L', lat: 37.2548587, lon: 27.6490877, elevFt: 9, pad: 65 },
        { num: '28', suffix: 'R', lat: 37.2471350, lon: 27.6814928, elevFt: 21, pad: 85 },
      ],
    },
    {
      id: '10R/28L', width: 45, lengthM: 2940,
      ends: [
        { num: '10', suffix: 'R', lat: 37.2532466, lon: 27.6485513, elevFt: 14, pad: 55 },
        { num: '28', suffix: 'L', lat: 37.2456775, lon: 27.6803077, elevFt: 14, pad: 70 },
      ],
    },
  ],
  // Fizik sürtünmesi için apron bölgesi (pist çerçevesinde, ARP'ye göre): görüntüde güney pistin
  // güneyindeki geniş açık renkli kaplama. Yalnızca yüzey tipi; çizim uydu görüntüsündendir.
  apron: { u0: -350, u1: 1500, v0: -2, v1: 330 },
  // Meydan düzleştirme kutusu (ARP çerçevesi, m): DEM gürültüsü (±3 m) kaplamada tümsek yapmasın
  flat: { u0: -1720, u1: 1850, v0: -340, v1: 340, fade: 260 },
};

export const BODRUM = {
  id: 'bodrum', name: 'Bodrum, Türkiye', base: './geo/bodrum/',
  airports: [LTFE],
  // Kalkış noktaları: eşikten 100 m içeride, pist yönünde
  spawns: [
    { id: 'ltfe-10l', airport: 'ltfe', runway: 0, end: 0, name: 'Milas–Bodrum', kindLabel: 'Bodrum, real terrain' },
    { id: 'ltfe-28r', airport: 'ltfe', runway: 0, end: 1, name: 'Milas–Bodrum', kindLabel: 'Bodrum, real terrain' },
  ],
};
