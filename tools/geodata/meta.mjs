// Bölge manifestine jeodezik meta veriyi yazar (uygulama çalışırken bu paketler YÜKLENMEZ):
//  - EGM96 geoid ondülasyonu ızgarası (egm96-universal, MIT): elipsoit yüksekliği = MSL + N
//  - Manyetik sapma (geomagnetism, Apache-2.0, NOAA WMM-2025 katsayıları) havaalanı referans noktasında
//   node meta.mjs <manifest.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { meanSeaLevel } from 'egm96-universal';
import geomagnetism from 'geomagnetism';
const file = process.argv[2];
const man = JSON.parse(readFileSync(file, 'utf8'));
const [lon0, lat0, lon1, lat1] = man.bounds.outer;
const dlat = 0.1, dlon = 0.1;
const la0 = Math.floor(lat0 / dlat) * dlat, lo0 = Math.floor(lon0 / dlon) * dlon;
const nlat = Math.ceil((lat1 - la0) / dlat) + 1, nlon = Math.ceil((lon1 - lo0) / dlon) + 1;
const v = [];
for (let i = 0; i < nlat; i++) for (let j = 0; j < nlon; j++) v.push(+meanSeaLevel(la0 + i * dlat, lo0 + j * dlon).toFixed(2));
man.geoid = { model: 'EGM96 (egm96-universal 1.1.1)', lat0: +la0.toFixed(4), lon0: +lo0.toFixed(4), dlat, dlon, nlat, nlon, v };
const date = new Date(process.argv[3] || '2026-10-30');
const m = geomagnetism.model(date);
const ref = man.reference;
man.magnetic = { model: 'NOAA WMM-2025 via geomagnetism 0.2.0', date: date.toISOString().slice(0, 10), declinationDeg: +m.point([ref.lat, ref.lon]).decl.toFixed(2) };
writeFileSync(file, JSON.stringify(man, null, 1));
console.log('geoid grid', nlat, 'x', nlon, 'N range', Math.min(...v), Math.max(...v), '| declination', man.magnetic.declinationDeg);
