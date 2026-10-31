// Güneş konumu (gün saati seçimi için). Astronomical Almanac düşük duyarlıklı formülleri
// (1950–2050 arası ~0,01°; kırılma eklenmez): ortalama boylam + merkez denklemi -> ekliptik boylam,
// eğiklik -> sağ açıklık / dik açıklık, GMST -> saat açısı -> yükseklik ve kuzeyden saat yönünde azimut.
// Doğrulama: Sentinel-2 sahne meta verisindeki güneş açısıyla karşılaştırılır (tools/flighttest/geo.mjs).

const DEG = Math.PI / 180;

/**
 * @param {Date|number} date UTC an (Date ya da ms)
 * @param {number} latDeg
 * @param {number} lonDeg doğu pozitif
 * @returns {{azimuthDeg:number, elevationDeg:number}}
 */
export function solarPosition(date, latDeg, lonDeg) {
  const ms = typeof date === 'number' ? date : date.getTime();
  const n = ms / 86400000 + 2440587.5 - 2451545.0;            // J2000.0'dan gün
  const L = (280.460 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * DEG;
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * DEG;
  const eps = (23.439 - 0.0000004 * n) * DEG;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const gmstH = ((18.697374558 + 24.06570982441908 * n) % 24 + 24) % 24;
  const ha = (gmstH * 15 + lonDeg) * DEG - ra;
  const lat = latDeg * DEG;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { azimuthDeg: ((az / DEG) % 360 + 360) % 360, elevationDeg: el / DEG };
}

/**
 * Gün saati ön ayarları: yerel saat (Türkiye, UTC+3, yaz saati yok). Tarih bölgenin görüntü
 * tarihidir (gölgeler ve güneş yolu görüntüyle aynı mevsimde). 'default' sahnenin kendi güneşidir
 * (gerçek bölgede: görüntünün çekim anı).
 */
export const TIME_PRESETS = {
  default: null,
  morning: { h: 8, m: 30 },
  afternoon: { h: 16, m: 30 },
  evening: { h: 18, m: 25 },
};

/** Yerel saatten (UTC+3) UTC ms. date: 'YYYY-MM-DD'. */
export function localTimeMs(date, h, m, utcOffsetH = 3) {
  const [Y, M, D] = date.split('-').map(Number);
  return Date.UTC(Y, M - 1, D, h - utcOffsetH, m);
}

/** Azimut/yükseklikten yerel çerçevede birim güneş yönü (x doğu, y yukarı, z güney). */
export function sunVector(azDeg, elDeg, out) {
  const az = azDeg * DEG, el = elDeg * DEG;
  return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).normalize();
}
