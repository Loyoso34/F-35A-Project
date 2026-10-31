// Gerçek dünya bölgesi: Bodrum (Muğla, Türkiye) ve Milas–Bodrum Havalimanı (LTFE).
//
// Her sayının kaynağı yanında yazılıdır. Doğrulanamayan veri (yaklaşma ışık sistemi, PAPI,
// taksi yolu çizgileri, bina yükseklikleri) UYDURULMAZ ve kurulmaz.
//
// Pist verisi (v3.9: OpenStreetMap geometrisi)
//  - İki paralel pist: 10L/28R ve 10R/28L. Uç koordinatları ve eksenler OpenStreetMap'ten
//    (Overture Maps 2026-10-21.0 üzerinden, aeroway=runway): 10L/28R 3000,6 m (yayımlanmış 3000 m),
//    10R/28L 2495,5 m. Eksen 106,6° gerçek; v3.8'de Sentinel-2'den ölçülen eksenle aynı.
//  - v3.8 düzeltmesi: 10R/28L 2940 m (OurAirports uzunluk alanı) DEĞİL ~2500 m'dir. OSM geometrisi
//    ve OurAirports'un kendi koordinatları (2500 m) uyuşur; güney kaplamanın doğu ~440 m'si OSM'de
//    taksi yoludur. 2940 m'lik değer görüntüdeki kaplama uzunluğuna dayanıyordu ve yanlıştı.
//  - Görüntü konumlandırma: Sentinel-2 görüntüsü OSM'ye göre ~14 m kaymıştı (uydu konum toleransı);
//    görüntü (+6 m D, +12 m K) düzeltilerek OSM'ye oturtuldu (tools/geodata/bake.py IMG_SHIFT_EN).
//  - Pist öncesi kaplama (pad): OSM aeroway=stopway uzunlukları (10L 60 m, 28R 62 m, 10R 61 m; 28L'de
//    stopway yok, kaplama taksi yolu olarak devam eder).
//  - Genişlik 45 m, eşik kotları (10L 9 ft, 28R 21 ft, 10R/28L 14 ft), meydan kotu 21 ft: OurAirports.
//    DEM bağımsız olarak 10L'de 2,9 m, 28R'de 5,6 m verir (±1 m uyum).
//  - Tanımlayıcılar yayımlanmış hâliyle; NOAA WMM-2025 sapması (5,41° D) ile 106,6° gerçek =
//    101,2° manyetik -> "10" (tutarlı).
//  - Taksi yolları, apronlar, terminal binaları: OSM (airport/ltfe.json, js/ltfe3d.js).
export const LTFE = {
  id: 'ltfe', icao: 'LTFE', iata: 'BJV', name: 'Milas–Bodrum Airport', kindLabel: 'Milas–Bodrum (LTFE)',
  arp: { lat: 37.249314, lon: 27.66401 }, elevFt: 21,
  runways: [
    {
      id: '10L/28R', width: 45, lengthM: 3000,
      ends: [
        { num: '10', suffix: 'L', lat: 37.2549592, lon: 27.6491660, elevFt: 9, pad: 60 },
        { num: '28', suffix: 'R', lat: 37.2472319, lon: 27.6815772, elevFt: 21, pad: 62 },
      ],
    },
    {
      id: '10R/28L', width: 45, lengthM: 2496,
      ends: [
        { num: '10', suffix: 'R', lat: 37.2533463, lon: 27.6486159, elevFt: 14, pad: 61 },
        { num: '28', suffix: 'L', lat: 37.2469313, lon: 27.6755746, elevFt: 14, pad: 0 },
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
