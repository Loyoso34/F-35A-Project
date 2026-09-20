// Uçak boya şemaları (livery).
//
// Bu dosya YALNIZCA görsel veridir. Uçuş modeli, kontroller, kamera, ses ya da
// herhangi bir simülasyon mantığı buradan etkilenmez ve buraya hiçbir fizik
// modülü import edilmez. Uçak sınıfları bu tabloyu okuyup malzeme renklerini,
// kaplama dokusu paletini ve işaret/yazı dekallerini kurar.
//
// Yeni bir livery eklemek için ilgili dizinin sonuna bir girdi yazmak yeterlidir;
// arayüz listeyi kendisi üretir, başka hiçbir yerde değişiklik gerekmez.
//
// --- Savaş uçağı alanları ---
//   paint        gövde boyası (rengi panel dokusunu çarpar; doku paylaşılır, bellek artmaz)
//   paintDark    ikinci ton: radom, burun konisi, kontrol yüzeyi kenarları
//   metalTint    egzoz/metal parçaların tonu (isteğe bağlı)
//   insignia     'starbar' | 'navy' | 'ironcross' — kanat/gövde amblemi
//   insigniaSquare  true ise dekal düzlemi KARE olur (demir haçı gibi kare amblemler
//                   için; yıldız-çubuk doğal olarak geniştir ve geniş düzlem ister)
//   markColor    kuyruk kodu ve seri numarası yazı rengi
//   tailCode     kuyruktaki iki harfli birlik kodu
//   serial       gövde seri yazısı
//
// --- Yolcu uçağı alanları ---
//   skin         gövde kaplama paleti (makeAirlinerSkinTexture'a aynen geçer)
//   paint        kanat / motor kaportası / yatay stabilize boyası
//   accent       dikey kuyruk ve dümen rengi
//   belly        karın, kapaklar ve iniş takımı kapakları
//   door         yolcu/kargo kapağı rengi (verilmezse açık gri)
//   radome       burun radomu rengi (verilmezse açık gri)

export const LIVERIES = {
  // =========================================================================
  // F-35A Lightning II
  // =========================================================================
  f35a: [
    {
      id: 'usaf',
      name: 'USAF Standard',
      sub: 'Hazy gray, low-visibility USAF markings',
      paint: 0xdfe3e8, paintDark: 0x8b9096,
      insignia: 'starbar', markColor: '#9aa0a8',
      tailCode: 'LF', serial: 'AF 15-5108',
    },
    {
      id: 'navy',
      name: 'Navy Style',
      sub: 'Matte naval gray, low-visibility',
      // Donanma şemaları USAF grisinden biraz daha koyu ve hafif mavi-nötr.
      // Tuzlu hava için daha mat bir kaplama: roughness yüksek, metalness düşük.
      paint: 0xb9c0c7, paintDark: 0x767e86,
      roughness: 0.80, metalness: 0.16,
      metalTint: 0x6a6f75,
      insignia: 'navy', markColor: '#8d959d',
      tailCode: 'VX', serial: 'NAVY 169028',
    },
    {
      id: 'luftwaffe',
      name: 'Luftwaffe Style',
      sub: 'Modern German air force gray, restrained markings',
      // Modern Luftwaffe şemaları soğuk, hafif yeşile çalan bir gri kullanır;
      // işaretler düşük kontrastlı gri demir haçtır.
      paint: 0xc4c8c6, paintDark: 0x7b807e,
      roughness: 0.76, metalness: 0.20,
      insignia: 'ironcross', insigniaSquare: true, markColor: '#8e9490',
      tailCode: 'TLG', serial: '31+07',
    },
  ],

  // =========================================================================
  // FA-90 Vesper  (kurgusal 7. nesil hava üstünlüğü savaş uçağı)
  // =========================================================================
  fa90: [
    {
      id: 'graphite',
      name: 'Graphite Test',
      sub: 'Dark graphite low-observable finish, test squadron markings',
      // Düşük gözlenebilirlikli kaplamalar mat ve koyudur: roughness yüksek,
      // metalness düşük tutuldu; egzoz metali gövdeyle aynı soğuk tona çekildi.
      paint: 0x4d5257, paintDark: 0x33383c,
      roughness: 0.86, metalness: 0.12,
      metalTint: 0x5f656b,
      insignia: 'starbar', markColor: '#aeb5bc',
      tailCode: 'VX', serial: 'FA-90 001',
    },
    {
      id: 'arctic',
      name: 'Arctic Splinter',
      sub: 'Pale gray high-altitude scheme',
      paint: 0xb6bec6, paintDark: 0x767e86,
      roughness: 0.78, metalness: 0.18,
      insignia: 'navy', markColor: '#8d959d',
      tailCode: 'VF', serial: 'FA-90 014',
    },
    {
      id: 'midnight',
      name: 'Midnight Blue',
      sub: 'Near-black blue night-intercept scheme',
      paint: 0x2b3340, paintDark: 0x1b212b,
      roughness: 0.90, metalness: 0.10,
      metalTint: 0x4a5058,
      insignia: 'ironcross', insigniaSquare: true, markColor: '#7d848c',
      tailCode: 'NT', serial: 'FA-90 027',
    },
  ],

  // =========================================================================
  // Airbus A321neo  (A320 ailesi)
  // =========================================================================
  a321: [
    {
      id: 'atlantic',
      name: 'Atlantic Blue',
      sub: 'White fuselage, navy cheatline',
      skin: { base: '#f2f4f6', belt: '#1b3a6b', belt2: '#5a96d2', belly: '#b0b6bc', window: '#20262e' },
      paint: 0xf2f4f6, accent: 0x1b3a6b, belly: 0xb2b8be,
    },
    {
      id: 'aurora',
      name: 'Aurora Teal',
      sub: 'Light gray fuselage, teal tail',
      skin: { base: '#eef2f3', belt: '#0f6f74', belt2: '#4fc8c2', belly: '#a9b2b6', window: '#1d2529' },
      paint: 0xeef2f3, accent: 0x0f6f74, belly: 0xaab3b7,
    },
    {
      id: 'ember',
      name: 'Ember Red',
      sub: 'White fuselage, deep red cheatline and tail',
      skin: { base: '#f5f3f1', belt: '#9d2233', belt2: '#e0705f', belly: '#b4b0ad', window: '#241f21' },
      paint: 0xf5f3f1, accent: 0x9d2233, belly: 0xb6b2af,
    },
    {
      id: 'slate',
      name: 'Slate Charcoal',
      sub: 'Charcoal fuselage, light gray cheatline',
      // Koyu gövdeli şemalarda kabin pencereleri gövdeden AÇIK olmalı, yoksa kaybolur.
      skin: { base: '#414951', belt: '#cfd6dd', belt2: '#8ea6bd', belly: '#5a636b', window: '#151a1f' },
      paint: 0x414951, accent: 0xcfd6dd, belly: 0x5c656d,
      door: 0x4a535b, radome: 0x9aa3ab,
    },
  ],
};

/** Bir uçağın livery listesi (bilinmeyen uçak için boş dizi). */
export function liveriesFor(aircraftId) { return LIVERIES[aircraftId] || []; }

/**
 * Livery kaydını id ile bulur. Bulunamazsa o uçağın İLK liverysine düşer,
 * böylece kayıtlı ayar eskiyip geçersizleşse bile uçak her zaman boyanır.
 */
export function getLivery(aircraftId, liveryId) {
  const list = liveriesFor(aircraftId);
  if (!list.length) return null;
  return list.find((l) => l.id === liveryId) || list[0];
}

/** Varsayılan (ilk) livery kimliği. */
export function defaultLiveryId(aircraftId) {
  const list = liveriesFor(aircraftId);
  return list.length ? list[0].id : null;
}
