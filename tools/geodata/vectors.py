#!/usr/bin/env python3
"""Bake 3D-world vector data for the Bodrum region (run after overture_extract.py).

Outputs (geo/bodrum/...):
  airport/ltfe.json        OpenStreetMap aeroway features of LTFE (via Overture base/infrastructure and
                           buildings): runways, taxiway centrelines, aprons, stopways, gates, helipads,
                           aerodrome boundary, building footprints. WGS84 lon/lat.
  bld/14/{x}/{y}.bin       Buildings (Overture: OSM + Microsoft ML footprints) as oriented boxes.
  road/14/{x}/{y}.bin      Roads (Overture transportation, OSM) clipped per tile.
  veg/12/{x}/{y}.png       Land cover fractions from ESA WorldCover 2021 (10 m) on the DEM grid (30 m):
                           R = tree cover, G = shrubland, B = grassland + cropland (0..255).

Binary tiles are little-endian. Positions are uint16 fractions of the Web Mercator tile (1/65535).
  bld: u32 n, then n x 12-byte {u16 ux, u16 uy, u16 w(0.05 m), u16 d(0.05 m), u16 azimuth (true, 0..pi),
       u8 height (0.25 m), u8 flags (bits0-3 kind, bit4 pitched roof, bits5-6 colour, bit7 OSM)}
  road: u16 n, then n x {u8 class, u8 flags (bit0 bridge, bit1 unpaved), u16 nv, nv x {u16 ux, u16 uy}}

Heights: OSM height, else OSM building:levels x 3.0 m + 1.0 m, else the documented footprint-area
heuristic in approx_height() (Overture carries a height for 41 of 308 572 buildings here).

  python3 -I tools/geodata/vectors.py --cache <dir> --out geo/bodrum
"""
import argparse, json, math, os, struct, sys, zlib
import numpy as np
import pyarrow.parquet as pq
import shapely
from shapely import wkb
from rasterio.warp import transform as rtransform

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiles import lon2x, lat2y, x2lon, y2lat  # noqa: E402

Z = 14
UTM = 'EPSG:32635'
ROAD_CLASS = {'motorway': 1, 'trunk': 2, 'primary': 3, 'secondary': 4, 'tertiary': 5, 'unclassified': 6,
              'residential': 7, 'living_street': 8, 'service': 9, 'track': 10, 'unknown': 11}
UNPAVED = {'unpaved', 'dirt', 'gravel', 'ground', 'sand', 'grass', 'compacted', 'fine_gravel', 'earth', 'mud'}
KIND = {'house': 0, 'detached': 0, 'residential': 0, 'apartments': 1, 'hotel': 2, 'commercial': 3, 'retail': 3,
        'industrial': 4, 'warehouse': 4, 'hangar': 4, 'greenhouse': 5, 'mosque': 6, 'chapel': 6, 'church': 6,
        'school': 3, 'roof': 7, 'shed': 8, 'garage': 8}


def tile_index(keys):
    """Compact existence index: bounding range + base64 bitset (row-major), so the app never requests
    a tile that does not exist (no 404s in the console)."""
    import base64
    xs = [k[0] for k in keys]; ys = [k[1] for k in keys]
    x0, y0, w, h = min(xs), min(ys), max(xs) - min(xs) + 1, max(ys) - min(ys) + 1
    bits = bytearray((w * h + 7) // 8)
    for x, y in keys:
        i = (y - y0) * w + (x - x0); bits[i >> 3] |= 1 << (i & 7)
    return {'x0': x0, 'y0': y0, 'w': w, 'h': h, 'bits': base64.b64encode(bytes(bits)).decode()}


def h32(s):
    return zlib.crc32(s.encode()) & 0xffffffff


def approx_height(kind, area, hsh):
    """Documented approximation when OSM has neither height nor levels (most buildings here).
    Low-rise Aegean coastal housing: 1-2 storeys (3 m + parapet); larger footprints are apartment /
    hotel blocks of 2-4 storeys; sheds/roofs 3 m; greenhouses 4 m; industrial 7-9 m; mosques 9 m."""
    r = (hsh % 1000) / 1000.0
    if kind == 5: return 4.0
    if kind in (7, 8): return 3.0
    if kind == 4: return 7.0 + 2.0 * r
    if kind == 6: return 9.0
    if area < 60: floors = 1
    elif area < 250: floors = 1 if r < 0.45 else 2
    elif area < 1000: floors = 2 if r < 0.6 else 3
    else: floors = 2 + int(r * 3)
    if kind in (1, 2): floors = max(floors, 2 + (1 if r > 0.5 else 0))
    return floors * 3.0 + 0.6


def to_utm(geoms):
    def f(c):
        X, Y = rtransform('EPSG:4326', UTM, c[:, 0].tolist(), c[:, 1].tolist())
        return np.column_stack([X, Y])
    return shapely.transform(geoms, f)


def bake_buildings(cache, out, exclude_poly):
    t = pq.read_table(os.path.join(cache, 'overture', 'buildings.parquet'))
    g = shapely.from_wkb(t.column('geometry').to_numpy(zero_copy_only=False))
    ids = t.column('id').to_pylist()
    hgt = t.column('height').to_pylist(); flo = t.column('num_floors').to_pylist(); cls = t.column('class').to_pylist()
    roof = t.column('roof_shape').to_pylist(); und = t.column('is_underground').to_pylist()
    src = [s[0]['dataset'] if s else '' for s in t.column('sources').to_pylist()]
    keep = np.array([gt in ('Polygon', 'MultiPolygon') for gt in shapely.get_type_id(g).astype(object)], bool) if False else np.isin(shapely.get_type_id(g), [3, 6])
    cen = shapely.centroid(g)
    if exclude_poly is not None:
        keep &= ~shapely.contains(exclude_poly, cen)
    keep &= ~np.array([bool(u) for u in und])
    gu = to_utm(g)
    area = shapely.area(gu)
    keep &= (area >= 12) & (area <= 60000)
    idx = np.nonzero(keep)[0]
    obb = shapely.oriented_envelope(gu[idx])
    tiles = {}
    stats = {'n': 0, 'osm': 0, 'height': 0, 'levels': 0}
    for k, i in enumerate(idx):
        o = obb[k]
        if o.geom_type != 'Polygon':
            continue
        c = np.array(o.exterior.coords)[:4]
        e1, e2 = c[1] - c[0], c[2] - c[1]
        w, d = np.hypot(*e1), np.hypot(*e2)
        if w < 1 or d < 1:
            continue
        s = math.sqrt(area[i] / (w * d))            # keep the true footprint area
        w, d = w * s, d * s
        ang = math.atan2(e1[0], e1[1])               # grid azimuth of the w edge (from north)
        cx, cy = c.mean(axis=0)
        lon, lat = rtransform(UTM, 'EPSG:4326', [cx], [cy]); lon, lat = lon[0], lat[0]
        ang += math.atan(math.tan(math.radians(lon - 27.0)) * math.sin(math.radians(lat)))   # UTM convergence -> true
        ang %= math.pi
        kind = KIND.get(cls[i] or '', 0)
        hs = h32(ids[i])
        if hgt[i]: H = float(hgt[i]); stats['height'] += 1
        elif flo[i]: H = float(flo[i]) * 3.0 + 1.0; stats['levels'] += 1
        else: H = approx_height(kind, area[i], hs)
        H = min(H, 63.0)
        # Roof: OSM roof:shape when present; else regional heuristic (peninsula: mostly flat white
        # roofs, inland Milas side: more hipped tile roofs). Approximation, not data.
        if roof[i]: pitched = roof[i] not in ('flat',)
        else: pitched = ((hs >> 10) % 100) < (25 if lon < 27.55 else 60) and kind in (0, 1) and area[i] < 600
        colour = (hs >> 17) & 3
        osm = src[i] == 'OpenStreetMap'
        stats['osm'] += osm
        fx, fy = lon2x(lon, Z), lat2y(lat, Z)
        tx, ty = int(fx), int(fy)
        rec = struct.pack('<HHHHHBB', min(65535, int((fx - tx) * 65535 + 0.5)), min(65535, int((fy - ty) * 65535 + 0.5)),
                          min(65535, int(w / 0.05 + 0.5)), min(65535, int(d / 0.05 + 0.5)), int(ang / math.pi * 65535 + 0.5) % 65536,
                          min(255, int(H / 0.25 + 0.5)), (kind & 15) | (16 if pitched else 0) | (colour << 5) | (128 if osm else 0))
        tiles.setdefault((tx, ty), []).append(rec)
        stats['n'] += 1
    size = 0
    for (tx, ty), recs in tiles.items():
        d = os.path.join(out, 'bld', str(Z), str(tx)); os.makedirs(d, exist_ok=True)
        f = os.path.join(d, f'{ty}.bin')
        with open(f, 'wb') as fh:
            fh.write(struct.pack('<I', len(recs))); fh.write(b''.join(recs))
        size += os.path.getsize(f)
    xs = [k[0] for k in tiles]; ys = [k[1] for k in tiles]
    print(f'buildings: {stats} in {len(tiles)} tiles, {size / 1e6:.2f} MB', flush=True)
    del xs, ys
    return {'z': Z, 'url': 'bld/{z}/{x}/{y}.bin', 'index': tile_index(tiles.keys()), 'bytes': size, 'count': stats['n'],
            'osm': stats['osm'], 'withHeight': stats['height'], 'withLevels': stats['levels']}


def bake_roads(cache, out):
    t = pq.read_table(os.path.join(cache, 'overture', 'segments.parquet')).to_pylist()
    tiles = {}
    n = 0
    for r in t:
        if r['subtype'] != 'road' or r['class'] not in ROAD_CLASS:
            continue
        flags = [v for f in (r['road_flags'] or []) for v in (f.get('values') or [])]
        if 'is_tunnel' in flags:
            continue
        surf = [s.get('value') for s in (r['road_surface'] or [])]
        unpaved = r['class'] == 'track' or any(s in UNPAVED for s in surf)
        fl = (1 if 'is_bridge' in flags else 0) | (2 if unpaved else 0)
        g = wkb.loads(r['geometry'])
        c = np.array(g.coords)
        fx = np.array([lon2x(lon, Z) for lon in c[:, 0]]); fy = np.array([lat2y(lat, Z) for lat in c[:, 1]])
        line = shapely.LineString(np.column_stack([fx, fy]))
        x0, x1, y0, y1 = int(fx.min()), int(fx.max()), int(fy.min()), int(fy.max())
        for tx in range(x0, x1 + 1):
            for ty in range(y0, y1 + 1):
                part = shapely.clip_by_rect(line, tx, ty, tx + 1, ty + 1)
                if part.is_empty: continue
                parts = [part] if part.geom_type == 'LineString' else list(getattr(part, 'geoms', []))
                for p in parts:
                    if p.geom_type != 'LineString' or p.length < 1e-6: continue
                    p = p.simplify(0.0006)                      # ~1.2 m at z14 (1953 m tiles)
                    cc = np.array(p.coords)
                    q = np.clip(np.round((cc - [tx, ty]) * 65535), 0, 65535).astype('<u2')
                    rec = struct.pack('<BBH', ROAD_CLASS[r['class']], fl, len(q)) + q.tobytes()
                    tiles.setdefault((tx, ty), []).append(rec)
                    n += 1
    size = 0
    for (tx, ty), recs in tiles.items():
        d = os.path.join(out, 'road', str(Z), str(tx)); os.makedirs(d, exist_ok=True)
        f = os.path.join(d, f'{ty}.bin')
        with open(f, 'wb') as fh:
            fh.write(struct.pack('<H', len(recs))); fh.write(b''.join(recs))
        size += os.path.getsize(f)
    print(f'roads: {n} pieces in {len(tiles)} tiles, {size / 1e6:.2f} MB', flush=True)
    return {'z': Z, 'url': 'road/{z}/{x}/{y}.bin', 'index': tile_index(tiles.keys()), 'bytes': size, 'classes': ROAD_CLASS}


def bake_airport(cache, out):
    inf = pq.read_table(os.path.join(cache, 'overture', 'infrastructure.parquet')).to_pylist()
    ap = [r for r in inf if r['class'] == 'international_airport' and 'Bodrum' in (((r['names'] or {}).get('primary')) or '')]
    poly = wkb.loads(ap[0]['geometry'])
    box = poly.buffer(0.004)
    feat = {'runway': [], 'taxiway': [], 'apron': [], 'stopway': [], 'airport_gate': [], 'helipad': []}
    rnd = lambda cs: [[round(x, 7), round(y, 7)] for x, y in cs]
    for r in inf:
        if r['subtype'] != 'airport' or r['class'] not in feat:
            continue
        g = wkb.loads(r['geometry'])
        if not box.intersects(g):
            continue
        item = {'id': r['id'], 'surface': r.get('surface')}
        if g.geom_type == 'Point': item['p'] = rnd(g.coords)[0]
        elif g.geom_type == 'LineString': item['line'] = rnd(g.coords)
        elif g.geom_type == 'Polygon': item['poly'] = rnd(g.exterior.coords)
        else: continue
        feat[r['class']].append(item)
    b = pq.read_table(os.path.join(cache, 'overture', 'buildings.parquet')).to_pylist()
    blds = []
    for r in b:
        g = wkb.loads(r['geometry'])
        if g.geom_type != 'Polygon' or not poly.contains(g.centroid):
            continue
        name = (r['names'] or {}).get('primary') if r['names'] else None
        area = shapely.area(to_utm(np.array([g]))[0])
        blds.append({'id': r['id'], 'name': name, 'class': r['class'], 'height': r['height'], 'levels': r['num_floors'],
                     'area': round(float(area)), 'poly': rnd(g.exterior.coords),
                     'source': r['sources'][0]['dataset'] if r['sources'] else None})
    data = {'source': 'OpenStreetMap contributors via Overture Maps (ODbL)', 'aerodrome': rnd(poly.exterior.coords),
            'features': feat, 'buildings': blds}
    os.makedirs(os.path.join(out, 'airport'), exist_ok=True)
    json.dump(data, open(os.path.join(out, 'airport', 'ltfe.json'), 'w'), separators=(',', ':'))
    print('airport:', {k: len(v) for k, v in feat.items()}, 'buildings', len(blds), flush=True)
    return poly


def bake_vegetation(out, man):
    import rasterio
    from rasterio.enums import Resampling
    from rasterio.warp import reproject
    from rasterio.windows import from_bounds
    from PIL import Image
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from bake import merc_transform
    url = '/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N36E027_Map.tif'
    lon0, lat0, lon1, lat1 = man['bounds']['core']
    with rasterio.open(url) as ds:
        w = from_bounds(lon0 - 0.01, lat0 - 0.01, lon1 + 0.01, lat1 + 0.01, ds.transform)
        lc = ds.read(1, window=w); tr = ds.window_transform(w); crs = ds.crs
    r = man['dem']['levels']['12']
    total = 0
    keys = []
    for ty in range(r['y0'], r['y1'] + 1):
        for tx in range(r['x0'], r['x1'] + 1):
            dt = merc_transform(12, tx * 256, ty * 256)
            chans = []
            for classes in ((10,), (20,), (30, 40)):
                m = np.isin(lc, classes).astype(np.float32)
                dst = np.zeros((256, 256), np.float32)
                reproject(m, dst, src_transform=tr, src_crs=crs, dst_transform=dt, dst_crs='EPSG:3857', resampling=Resampling.average)
                chans.append(np.clip(dst * 255 + 0.5, 0, 255).astype(np.uint8))
            img = np.stack(chans, -1)
            if img.max() == 0:
                continue
            d = os.path.join(out, 'veg', '12', str(tx)); os.makedirs(d, exist_ok=True)
            f = os.path.join(d, f'{ty}.png')
            Image.fromarray(img).save(f, optimize=True)
            total += os.path.getsize(f)
            keys.append((tx, ty))
    print(f'vegetation: {total / 1e6:.2f} MB', flush=True)
    # Boş (deniz) karolar yazılmaz; index olmadan istemci onları 404 ile isterdi.
    return {'z': 12, 'url': 'veg/{z}/{x}/{y}.png', 'index': tile_index(keys), 'bytes': total,
            'channels': 'R tree, G shrub, B grass+crop (fraction*255)'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    only = set(a.only.split(',')) if a.only else None
    mf = os.path.join(a.out, 'manifest.json')
    man = json.load(open(mf))
    poly = bake_airport(a.cache, a.out)
    man['airport'] = {'url': 'airport/ltfe.json'}
    if not only or 'buildings' in only: man['buildings'] = bake_buildings(a.cache, a.out, poly)
    if not only or 'roads' in only: man['roads'] = bake_roads(a.cache, a.out)
    if not only or 'veg' in only: man['vegetation'] = bake_vegetation(a.out, man)
    srcs = [s for s in man.get('sources', []) if s.get('what') not in ('Buildings, roads, aeroways', 'Land cover')]
    srcs.append({'what': 'Buildings, roads, aeroways', 'name': 'Overture Maps Foundation release 2026-10-21.0 (OpenStreetMap; Microsoft ML Building Footprints)',
                 'url': 'https://overturemaps.org', 'attribution': '© OpenStreetMap contributors (ODbL); Microsoft Building Footprints (ODbL); Overture Maps Foundation'})
    srcs.append({'what': 'Land cover', 'name': 'ESA WorldCover 10 m 2021 v200', 'url': 'https://esa-worldcover.org',
                 'attribution': '© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0)'})
    man['sources'] = srcs
    json.dump(man, open(mf, 'w'), indent=1)


if __name__ == '__main__':
    main()
