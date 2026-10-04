// Uçak boya şemaları (livery).
//
// Bu dosya YALNIZCA görsel veridir. Uçuş modeli, kontroller, kamera, ses ya da
// herhangi bir simülasyon mantığı buradan etkilenmez ve buraya hiçbir fizik
// modülü import edilmez. F-35A sınıfı bu tabloyu okuyup malzeme renklerini,
// kaplama dokusu paletini ve işaret/yazı dekallerini kurar.
//
// Yeni bir livery eklemek için ilgili dizinin sonuna bir girdi yazmak yeterlidir;
// arayüz listeyi kendisi üretir, başka hiçbir yerde değişiklik gerekmez.
//
// --- Alanlar ---
//   paint        gövde boyası (rengi panel dokusunu çarpar; doku paylaşılır, bellek artmaz)
//   paintDark    ikinci ton: radom, burun konisi, kontrol yüzeyi kenarları
//   metalTint    egzoz/metal parçaların tonu (isteğe bağlı)
//   insignia     'starbar' | 'navy' | 'ironcross' — kanat/gövde amblemi
//   insigniaSquare  true ise dekal düzlemi KARE olur (demir haçı gibi kare amblemler
//                   için; yıldız-çubuk doğal olarak geniştir ve geniş düzlem ister)
//   markColor    kuyruk kodu ve seri numarası yazı rengi
//   tailCode     kuyruktaki iki harfli birlik kodu
//   serial       gövde seri yazısı

export const LIVERIES = {
  // =========================================================================
  // F-35A Lightning II
  // =========================================================================
  f35a: [
    {
      id: 'usaf',
      name: 'USAF Standard',
      sub: 'Hazy gray, low-visibility USAF markings',
      paint: 0xe8e6e2, paintDark: 0x85898d,
      insignia: 'starbar', markColor: '#b9bcbf',
      tailCode: 'LF', serial: 'AF 15-5108',
    },
    {
      id: 'navy',
      name: 'Navy Style',
      sub: 'Matte Navy gray, low-visibility markings',
      // Donanma şemaları USAF grisinden biraz daha koyu ve hafif mavi-nötr.
      // Tuzlu hava için daha mat bir kaplama: roughness yüksek, metalness düşük.
      paint: 0xc9cdd1, paintDark: 0x727980,
      roughness: 0.74, metalness: 0.12,
      metalTint: 0x6a6f75,
      insignia: 'navy', markColor: '#a9afb4',
      tailCode: 'VX', serial: 'NAVY 169028',
    },
    {
      id: 'luftwaffe',
      name: 'Luftwaffe Style',
      sub: 'Modern Luftwaffe gray, subdued markings',
      // Modern Luftwaffe şemaları soğuk, hafif yeşile çalan bir gri kullanır;
      // işaretler düşük kontrastlı gri demir haçtır.
      paint: 0xd2d6d2, paintDark: 0x7b807e,
      roughness: 0.70, metalness: 0.15,
      insignia: 'ironcross', insigniaSquare: true, markColor: '#8e9490',
      tailCode: 'TLG', serial: '31+07',
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
