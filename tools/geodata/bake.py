#!/usr/bin/env python3
"""Bake the Bodrum region tile pyramid (DEM + Sentinel-2 imagery) used by js/geoterrain.js.

Everything written here is derived from open data that may be redistributed with attribution:

  * Elevation: AWS Open Data "Terrain Tiles" (Mapzen/Tilezen Terrarium encoding). Around Bodrum
    the tiles carry EU-DEM (Copernicus) and SRTM data. Downloaded unchanged from
    https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png and re-quantised.
  * Imagery: Copernicus Sentinel-2 L2A surface reflectance (bands B04/B03/B02, 10 m), from the
    AWS Open Data "Sentinel-2 Cloud-Optimized GeoTIFFs" bucket (sentinel-cogs).

Output (same-origin static files, streamed by the simulator):

  geo/bodrum/manifest.json
  geo/bodrum/dem/{z}/{x}/{y}.png   Terrarium-compatible RGB PNG, heights quantised to 0.25 m,
                                    blue-channel bit 0 = water flag (Sentinel-2 SCL class 6 or
                                    seabed). Sea is clamped to 0 m MSL (the water surface).
  geo/bodrum/img/{z}/{x}/{y}.webp  256 px tiles. Pixel = sRGB(albedo * ALBEDO_SCALE).

Usage:  python3 -I tools/geodata/bake.py --cache <download dir> --out geo/bodrum
The cache dir must contain terrarium/{z}/{x}/{y}.png and s2/<scene>/{B02,B03,B04,SCL}.tif for the
core scenes; outer-ring scenes are read remotely from their cloud-optimised overviews.
"""
import argparse, json, math, os, sys
import numpy as np
from PIL import Image
import rasterio
from rasterio.enums import Resampling
from rasterio.warp import reproject
from rasterio.transform import Affine

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from tiles import tile_range, x2lon, y2lat  # noqa: E402

R_MERC = 6378137.0
ORIGIN_SHIFT = math.pi * R_MERC
# Deep-water reflectance (R, G, B) of the primary scene (35SNB 2024-10-03, NDWI > 0.35 median);
# typical of clear oligotrophic Mediterranean water. Other scenes' water is offset to it.
SEA_REF = (0.0006, 0.0035, 0.0110)
ALBEDO_SCALE = 1.6          # stored = albedo * 1.6 (clipped); the shader divides it back out
DEM_Q = 0.25                # metres
CORE = (27.00, 36.72, 28.10, 37.62)     # lon0, lat0, lon1, lat1  (high resolution)
OUTER = (25.92, 36.08, 29.30, 38.60)    # low-resolution ring (inside the 3x3 Sentinel-2 tile footprint)
DEM_CORE_Z, DEM_OUTER_Z = 12, 9
IMG_CORE_Z, IMG_CORE_MIN = 13, 11
IMG_OUTER_Z, IMG_OUTER_MIN = 10, 8
# Sentinel-2 geolocation correction (m, east/north), applied to every scene before reprojection.
# Measured by 2D correlation of rasterised OpenStreetMap features with the 10 m reflectance:
# LTFE runways/taxiways/aprons (-8 E, -12 N for OSM->S2), Bodrum town 839 OSM footprints (-4, -10),
# Milas 120 footprints (0, -20, weak). OSM is traced on sub-metre aerial imagery, so the imagery is
# moved onto OSM. Residual uncertainty ~ +/-5 m. (Scene geolocation tolerance of S2 L2A is ~10 m.)
IMG_SHIFT_EN = (6.0, 12.0)
AERODROME = {'lat': 37.249314, 'lon': 27.66401, 'axis': 106.6}   # LTFE ARP (OurAirports)
S2_BUCKET ='https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/35/S'
# Core scenes in priority order (first valid pixel wins). Dates chosen for ~0 % cloud.
CORE_SCENES = ['S2A_35SNB_20241003_0_L2A', 'S2A_35SNA_20241003_0_L2A', 'S2B_35SNA_20241005_0_L2A', 'S2B_35SPB_20241005_0_L2A']
OUTER_SCENES = [
    'S2A_35SNB_20241003_0_L2A', 'S2A_35SNA_20241003_0_L2A', 'S2A_35SMA_20241003_0_L2A', 'S2A_35SMB_20241003_0_L2A',
    'S2A_35SMC_20241003_0_L2A', 'S2A_35SNC_20241003_0_L2A', 'S2B_35SPA_20241005_0_L2A', 'S2B_35SPB_20241005_0_L2A',
    'S2B_35SPC_20241005_0_L2A', 'S2B_35SNA_20241005_0_L2A',
]


def scene_url(scene, band):
    tile = scene.split('_')[1]              # 35SNB
    date = scene.split('_')[2]              # 20241003
    return f'{S2_BUCKET}/{tile[3:5]}/{date[:4]}/{int(date[4:6])}/{scene}/{band}.tif'


def merc_transform(z, gx0, gy0):
    """Affine for a grid of global pixels (256 px tiles) at zoom z starting at (gx0, gy0)."""
    res = 2 * ORIGIN_SHIFT / (256 * (1 << z))
    return Affine(res, 0, -ORIGIN_SHIFT + gx0 * res, 0, -res, ORIGIN_SHIFT - gy0 * res)


def srgb_encode(lin):
    lin = np.clip(lin, 0.0, 1.0)
    return np.where(lin <= 0.0031308, 12.92 * lin, 1.055 * np.power(lin, 1 / 2.4) - 0.055)


# ---------------------------------------------------------------------------------------------
# Imagery
# ---------------------------------------------------------------------------------------------
def mosaic(z, rng, scenes, src_path, depth, overview=None):
    """Reflectance mosaic (H, W, 3) float32 in EPSG:3857 at zoom z. NaN = no data.
    depth: DEM heights (m, negative = seabed) on the same grid, used to find deep water."""
    x0, x1, y0, y1 = rng
    W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    dst_tr = merc_transform(z, x0 * 256, y0 * 256)
    out = np.full((H, W, 3), np.nan, np.float32)
    # Açık su: DEM kıyı çizgisinden uzaklık (piksel). Reflektanstan ve batimetriden bağımsızdır
    # (çekim kaybında yeşil/NIR ~0, EU-DEM denizi 0 m verir: derinlik yoktur).
    from scipy import ndimage
    land = depth > 0.5
    shore = ndimage.distance_transform_edt(~land).astype(np.float32)
    px_m = 2 * ORIGIN_SHIFT / (256 * (1 << z)) * math.cos(math.radians(37.2))
    open_px = 500.0 / px_m                     # 500 m açık: medyan için derin su
    full_px = max(1.0, 60.0 / px_m)            # 60 m açıktan itibaren tam düzeltme
    for sc in scenes:
        need = np.isnan(out[..., 0])
        if not need.any():
            break
        got = []
        for b in ('B04', 'B03', 'B02', 'B08'):
            path = src_path(sc, b)
            kw = {'overview_level': overview} if overview is not None else {}
            with rasterio.open(path, **kw) as ds:
                dst = np.zeros((H, W), np.float32)
                src_tr = Affine.translation(*IMG_SHIFT_EN) * ds.transform
                reproject(ds.read(1), dst, src_transform=src_tr, src_crs=ds.crs, src_nodata=0, dst_nodata=0, dst_transform=dst_tr,
                          dst_crs='EPSG:3857', resampling=Resampling.average, num_threads=4)
            got.append(dst)
        valid = (got[0] > 0) & (got[1] > 0) & (got[2] > 0) & (got[3] > 0)
        fill = need & valid
        # Element84 sentinel-cogs are harmonised (no -0.1 offset in practice: dark targets have
        # DN ~ 1..100, which the metadata offset would turn into impossible negative reflectance).
        rho = [g * 1e-4 for g in got[:3]]
        # Sen2Cor's atmospheric correction over water differs between scenes (deep-sea blue
        # reflectance from ~0.0004 to ~0.02 here), which leaves rectangular seams in the sea. That
        # error is an additive path-radiance offset, so each scene's water is shifted until its
        # deep-water median matches the reference; shallow-water and coastal detail is kept.
        # Open water by distance from the DEM coastline, not by reflectance: in the over-corrected
        # scenes green and NIR are both ~0 over the sea and NDWI is meaningless.
        wsoft = np.clip(shore / full_px, 0.0, 1.0) * valid
        deep = valid & (shore > open_px)
        if deep.sum() > 200:
            for c in range(3):
                off = SEA_REF[c] - float(np.median(rho[c][deep]))
                rho[c] = np.maximum(rho[c] + off * wsoft, 0.0)
        for c in range(3):
            out[..., c][fill] = rho[c][fill]
        print(f'  z{z} {sc}: filled {fill.sum() / fill.size * 100:.1f}% of grid, deep-water px {int(deep.sum())}', flush=True)
    return out


def fill_nodata(img):
    """Fill gaps (outside the scene footprints) by pull-push: the hole takes the smooth average
    colour of its surroundings at ever coarser scales. No streaks, no hard edges."""
    bad = np.isnan(img[..., 0])
    if not bad.any():
        return img
    w = (~bad).astype(np.float32)
    c = np.where(bad[..., None], 0.0, img).astype(np.float32) * w[..., None]
    pyr = [(c, w)]
    while min(pyr[-1][1].shape) > 2:
        c0, w0 = pyr[-1]
        h, ww = c0.shape[0] // 2 * 2, c0.shape[1] // 2 * 2
        c1 = c0[:h:2, :ww:2] + c0[1:h:2, :ww:2] + c0[:h:2, 1:ww:2] + c0[1:h:2, 1:ww:2]
        w1 = w0[:h:2, :ww:2] + w0[1:h:2, :ww:2] + w0[:h:2, 1:ww:2] + w0[1:h:2, 1:ww:2]
        pyr.append((c1, w1))
    col = pyr[-1][0] / np.maximum(pyr[-1][1], 1e-6)[..., None]
    for c0, w0 in reversed(pyr[:-1]):
        up = np.repeat(np.repeat(col, 2, 0), 2, 1)
        pad = ((0, c0.shape[0] - up.shape[0]), (0, c0.shape[1] - up.shape[1]), (0, 0))
        up = np.pad(up, pad, mode='edge')
        own = c0 / np.maximum(w0, 1e-6)[..., None]
        a = np.clip(w0, 0, 1)[..., None]
        col = own * a + up * (1 - a)
    return np.where(bad[..., None], col, img).astype(np.float32)


def depth_grid(cache, z_img, rng_img, z_dem):
    """Original (unclamped) Terrarium heights resampled (nearest) onto an imagery grid."""
    rd = tile_range_cover(rng_img, z_img, z_dem)
    h = dem_grid(cache, z_dem, rd)
    k = 1 << (z_img - z_dem)
    up = np.repeat(np.repeat(h, k, 0), k, 1)
    ox, oy = rng_img[0] * 256 - rd[0] * 256 * k, rng_img[2] * 256 - rd[2] * 256 * k
    W, H = (rng_img[1] - rng_img[0] + 1) * 256, (rng_img[3] - rng_img[2] + 1) * 256
    return up[oy:oy + H, ox:ox + W].astype(np.float32)


def tile_range_cover(rng, z, zc):
    s = 1 << (z - zc)
    return rng[0] // s, rng[1] // s, rng[2] // s, rng[3] // s


def to_tile_bytes(rgb_lin_albedo):
    v = srgb_encode(rgb_lin_albedo * ALBEDO_SCALE)
    return (v * 255 + 0.5).astype(np.uint8)


def write_img_level(img, z, rng, out_dir, quality=78):
    x0, x1, y0, y1 = rng
    n = 0
    total = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            a = img[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256]
            d = os.path.join(out_dir, 'img', str(z), str(tx))
            os.makedirs(d, exist_ok=True)
            f = os.path.join(d, f'{ty}.webp')
            Image.fromarray(to_tile_bytes(a)).save(f, 'WEBP', quality=quality, method=6)
            total += os.path.getsize(f)
            n += 1
    print(f'  img z{z}: {n} tiles, {total / 1e6:.2f} MB', flush=True)
    return total


def downsample2(img):
    h, w = img.shape[0] // 2 * 2, img.shape[1] // 2 * 2
    a = img[:h, :w]
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) * 0.25


def crop_to_level(img, z_from, rng_from, z_to):
    """Downsample a mosaic from z_from to z_to and crop to whole tiles."""
    for _ in range(z_from - z_to):
        img = downsample2(img)
    s = 1 << (z_from - z_to)
    x0, x1, y0, y1 = rng_from
    # Tile range at z_to that is fully covered by the source grid
    nx0, ny0 = -(-x0 // s), -(-y0 // s)
    nx1, ny1 = (x1 + 1) // s - 1, (y1 + 1) // s - 1
    ox, oy = (nx0 * s - x0) * 256 // s, (ny0 * s - y0) * 256 // s
    sub = img[oy:oy + (ny1 - ny0 + 1) * 256, ox:ox + (nx1 - nx0 + 1) * 256]
    return sub, (nx0, nx1, ny0, ny1)


# ---------------------------------------------------------------------------------------------
# DEM
# ---------------------------------------------------------------------------------------------
def terrarium_decode(path):
    a = np.asarray(Image.open(path).convert('RGB')).astype(np.float64)
    return a[..., 0] * 256 + a[..., 1] + a[..., 2] / 256 - 32768


def terrarium_encode(h, water):
    v = np.round((h + 32768) / DEM_Q) * DEM_Q
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    b = np.round((v - r * 256 - g) * 256)          # multiples of 64 (0.25 m)
    b = np.clip(b, 0, 192).astype(np.uint8) | water.astype(np.uint8)
    return np.stack([r, g, b], -1).astype(np.uint8)


def dem_grid(cache, z, rng):
    x0, x1, y0, y1 = rng
    H = np.zeros(((y1 - y0 + 1) * 256, (x1 - x0 + 1) * 256))
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            f = os.path.join(cache, 'terrarium', str(z), str(tx), f'{ty}.png')
            H[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = terrarium_decode(f)
    return H


def despike(h, thresh, iters=4):
    """Terrarium z9 has isolated bad cells in the Aegean islands (e.g. 4952 m on Leros at
    37.19 N 26.77 E, real summit ~320 m; 3546 m near Arki; 1202 m on Symi, real ~616 m). A cell more
    than `thresh` metres above the median of its 5x5 neighbourhood is replaced by that median,
    repeated so that multi-cell spikes collapse from the top. Real relief at z9 (~245 m cells)
    stays far below the threshold: the steepest massif in the box (Babadağ, 1969 m) drops < 200 m
    within the window."""
    from scipy.ndimage import median_filter
    h = h.copy()
    total = 0
    for _ in range(iters):
        med = median_filter(h, size=5, mode='nearest')
        bad = (h - med) > thresh
        n = int(bad.sum())
        if not n:
            break
        h[bad] = med[bad]
        total += n
    return h, total


def land_fraction_grid(cache, z, rng, ss=4):
    """Fraction of OSM land per DEM cell (Overture base/land, subtype 'land': polygons built from
    OSM coastlines; ODbL). ss x ss supersampling. None when the layer was not extracted."""
    p = os.path.join(cache, 'overture', 'land.parquet')
    if not os.path.exists(p):
        return None
    import pyarrow.parquet as pq
    import shapely
    from shapely import wkb
    from rasterio.features import rasterize
    R = 6378137.0
    merc = lambda c: np.column_stack([np.radians(c[:, 0]) * R, np.log(np.tan(np.pi / 4 + np.radians(c[:, 1]) / 2)) * R])
    shapes = []
    for r in pq.read_table(p, columns=['geometry', 'subtype']).to_pylist():
        if r['subtype'] != 'land':
            continue
        g = wkb.loads(r['geometry'])
        if g.geom_type in ('Polygon', 'MultiPolygon'):
            shapes.append((shapely.transform(g, merc), 1))
    x0, x1, y0, y1 = rng
    W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    m = rasterize(shapes, out_shape=(H * ss, W * ss), transform=merc_transform(z, x0 * 256, y0 * 256) * Affine.scale(1 / ss),
                  fill=0, dtype='uint8')
    return m.reshape(H, ss, W, ss).mean(axis=(1, 3))


def water_mask_grid(z, rng, s2dir):
    """Fraction of open water per DEM cell, from the core scenes (NaN = no data).

    A 10 m pixel is water when NDWI = (B03 - B08) / (B03 + B08) >= 0.1. The Sentinel-2 scene
    classification (SCL class 6) alone is not used: it labels the dark asphalt of LTFE's north
    runway as water, whereas asphalt reflects near-infrared strongly (NDWI ~ -0.2)."""
    x0, x1, y0, y1 = rng
    W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    dst_tr = merc_transform(z, x0 * 256, y0 * 256)
    acc = np.full((H, W), np.nan, np.float32)
    for sc in CORE_SCENES:
        with rasterio.open(os.path.join(s2dir, sc, 'B03.tif')) as g, rasterio.open(os.path.join(s2dir, sc, 'B08.tif')) as n:
            gg = g.read(1).astype(np.float32)
            nn = n.read(1).astype(np.float32)
            wat = ((gg - nn) / np.maximum(gg + nn, 1.0) >= 0.1).astype(np.float32)
            wat[(gg == 0) | (nn == 0)] = np.nan
            dst = np.full((H, W), np.nan, np.float32)
            reproject(wat, dst, src_transform=Affine.translation(*IMG_SHIFT_EN) * g.transform, src_crs=g.crs, src_nodata=np.nan, dst_nodata=np.nan,
                      dst_transform=dst_tr, dst_crs='EPSG:3857', resampling=Resampling.average)
        fill = np.isnan(acc) & ~np.isnan(dst)
        acc[fill] = dst[fill]
        print(f'  water mask {sc}: filled {fill.mean() * 100:.1f}%', flush=True)
    return acc


def write_dem_tiles(h, water, z, rng, out_dir):
    x0, x1, y0, y1 = rng
    total = 0
    for ty in range(y0, y1 + 1):
        for tx in range(x0, x1 + 1):
            sl = (slice((ty - y0) * 256, (ty - y0 + 1) * 256), slice((tx - x0) * 256, (tx - x0 + 1) * 256))
            d = os.path.join(out_dir, 'dem', str(z), str(tx))
            os.makedirs(d, exist_ok=True)
            f = os.path.join(d, f'{ty}.png')
            Image.fromarray(terrarium_encode(h[sl], water[sl])).save(f, 'PNG', optimize=True)
            total += os.path.getsize(f)
    print(f'  dem z{z}: {(x1 - x0 + 1) * (y1 - y0 + 1)} tiles, {total / 1e6:.2f} MB', flush=True)
    return total


def bake_dem(cache, out_dir):
    s2dir = os.path.join(cache, 's2')
    rc = tile_range(CORE, DEM_CORE_Z)
    h = dem_grid(cache, DEM_CORE_Z, rc)
    wm = water_mask_grid(DEM_CORE_Z, rc, s2dir)
    # Outer z9 grid first: despiked, and used to fill the z12 sea where Terrarium z12 has no
    # bathymetry (exactly 0 m) outside the Sentinel-2 core scenes (west of ~27.0 E). Without this
    # a 2 km strip of open sea was baked as 0.5 m land (dark line seen from altitude).
    ro = tile_range(OUTER, DEM_OUTER_Z)
    ho, nsp = despike(dem_grid(cache, DEM_OUTER_Z, ro), 400.0)
    print(f'  z9 despike: {nsp} cells', flush=True)
    k = 1 << (DEM_CORE_Z - DEM_OUTER_Z)
    from scipy.ndimage import map_coordinates
    gy9, gx9 = np.mgrid[0:h.shape[0], 0:h.shape[1]]
    h9 = map_coordinates(ho, [(rc[2] * 256 + gy9 + 0.5) / k - 0.5 - ro[2] * 256, (rc[0] * 256 + gx9 + 0.5) / k - 0.5 - ro[0] * 256], order=1, mode='nearest')
    del gy9, gx9
    # Terrarium z12 has no bathymetry: the sea is exactly 0 m. Where the coarse z9 grid has seabed
    # (or there is no Sentinel-2 coverage), take the z9 value. Sentinel-2 NDWI alone cannot be
    # trusted at sea: sun glint on the 2024-10-03 scenes pushes NDWI below 0.1 over most of the
    # Gulf of Gökova (~2.4 M z12 cells), which used to bake open sea as 0.5 m land.
    nodata = (h == 0.0) & ((h9 < 0.0) | np.isnan(wm))
    h[nodata] = h9[nodata]
    print(f'  z12 no-data (0 m) filled from z9: {int(nodata.sum())} cells', flush=True)
    # Water. With the OSM coastline (Overture base/land; the imagery is registered to OSM): sea =
    # outside OSM land, unless the DEM there is >= 15 m (a coastline offset at a cliff: left as
    # land); inland water = Sentinel-2 NDWI on OSM land (lakes, reservoirs). Without it: Sentinel-2
    # says water, or the DEM is clearly seabed (> 1 m below MSL). Land the DEM puts below 0.5 m is
    # raised to 0.5 m.
    lf = land_fraction_grid(cache, DEM_CORE_Z, rc)
    if lf is not None:
        osm_sea = lf < 0.5
        water = (osm_sea & (h < 15.0)) | (~osm_sea & (np.nan_to_num(wm, nan=0.0) >= 0.5))
        print(f'  OSM coastline: sea {osm_sea.mean() * 100:.1f}% of cells, {int((osm_sea & (h >= 15.0)).sum())} sea cells left as land (DEM >= 15 m)', flush=True)
    else:
        osm_sea = np.zeros(h.shape, bool)
        water = (np.nan_to_num(wm, nan=0.0) >= 0.5) | (h < -1.0)
    # Fresh/dark asphalt on LTFE's runways gives noisy NDWI: no open water inside the aerodrome
    # (runway axis 106.6 deg true through the ARP; box covers both runways, aprons and margins).
    x0, x1, y0, y1 = rc
    gy, gx = np.mgrid[y0 * 256:(y1 + 1) * 256, x0 * 256:(x1 + 1) * 256].astype(np.float64)
    lon = (gx + 0.5) / (256 << DEM_CORE_Z) * 360 - 180
    lat = np.degrees(np.arctan(np.sinh(np.pi * (1 - 2 * (gy + 0.5) / (256 << DEM_CORE_Z)))))
    dx = (lon - AERODROME['lon']) * math.cos(math.radians(AERODROME['lat'])) * 111320.0
    dy = (lat - AERODROME['lat']) * 110950.0
    b = math.radians(AERODROME['axis'])
    u, v = dx * math.sin(b) + dy * math.cos(b), dx * math.cos(b) - dy * math.sin(b)
    water &= ~((np.abs(u - 50) < 1800) & (v > -330) & (v < 330))
    # Sentinel-2 water above coarse seabed while z12 says land (EU-DEM noise at sea, e.g. 6-15 m
    # "hills" south of Bodrum at 37.00 N): the sea surface. Inland reservoirs have z9 > 0 and stay.
    noise = water & (h >= 0.5) & (h9 < -2.0)
    print(f'  z12 water cells raised above coarse seabed, clamped to sea: {int(noise.sum())}', flush=True)
    sea = water & ((h < 0.5) | noise | osm_sea)
    h = np.where(sea, 0.0, h)                       # the sea surface is 0 m MSL
    h = np.where(~water & (h < 0.5), 0.5, h)
    stats = {'core_min': float(h.min()), 'core_max': float(h.max()), 'water_frac': float(water.mean())}
    size = write_dem_tiles(h, water, DEM_CORE_Z, rc, out_dir)
    # Outer ring at z9 (Terrarium z9; seabed -> 0 m sea surface). Inside the core it is replaced by
    # the processed z12 data box-filtered 8x so that both levels agree.
    wo = ho < 0.0
    ho = np.where(wo, 0.0, ho)
    hc = h.reshape(h.shape[0] // k, k, h.shape[1] // k, k).mean(axis=(1, 3))
    wc = water.reshape(water.shape[0] // k, k, water.shape[1] // k, k).mean(axis=(1, 3)) >= 0.5
    ox, oy = rc[0] * 256 // k - ro[0] * 256, rc[2] * 256 // k - ro[2] * 256
    ho[oy:oy + hc.shape[0], ox:ox + hc.shape[1]] = hc
    wo[oy:oy + hc.shape[0], ox:ox + hc.shape[1]] = wc
    size += write_dem_tiles(ho, wo, DEM_OUTER_Z, ro, out_dir)
    return {'levels': {str(DEM_CORE_Z): rng_obj(rc), str(DEM_OUTER_Z): rng_obj(ro)}, 'bytes': size, 'stats': stats}


def rng_obj(r):
    return {'x0': r[0], 'x1': r[1], 'y0': r[2], 'y1': r[3]}


def bake_imagery(cache, out_dir):
    s2dir = os.path.join(cache, 's2')
    levels = {}
    size = 0
    rc = tile_range(CORE, IMG_CORE_Z)
    dcore = depth_grid(cache, IMG_CORE_Z, rc, DEM_CORE_Z)
    core = fill_nodata(mosaic(IMG_CORE_Z, rc, CORE_SCENES, lambda sc, b: os.path.join(s2dir, sc, b + '.tif'), dcore))
    del dcore
    for z in range(IMG_CORE_Z, IMG_CORE_MIN - 1, -1):
        img, r = crop_to_level(core, IMG_CORE_Z, rc, z)
        size += write_img_level(img, z, r, out_dir)
        levels[str(z)] = rng_obj(r)
    # Outer ring: remote cloud-optimised overviews (80 m) of the surrounding scenes.
    ro = tile_range(OUTER, IMG_OUTER_Z)
    douter = depth_grid(cache, IMG_OUTER_Z, ro, DEM_OUTER_Z)
    outer = mosaic(IMG_OUTER_Z, ro, OUTER_SCENES, lambda sc, b: '/vsicurl/' + scene_url(sc, b), douter, overview=2)
    outer = fill_nodata(outer)
    # Inside the core use the (better) core mosaic, downsampled, so the levels agree.
    cz, crr = crop_to_level(core, IMG_CORE_Z, rc, IMG_OUTER_Z)
    ox, oy = (crr[0] - ro[0]) * 256, (crr[2] - ro[2]) * 256
    outer[oy:oy + cz.shape[0], ox:ox + cz.shape[1]] = cz
    for z in range(IMG_OUTER_Z, IMG_OUTER_MIN - 1, -1):
        img, r = crop_to_level(outer, IMG_OUTER_Z, ro, z)
        size += write_img_level(img, z, r, out_dir, quality=74)
        levels[str(z)] = rng_obj(r)
    return {'levels': levels, 'bytes': size}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--skip-imagery', action='store_true')
    ap.add_argument('--skip-dem', action='store_true')
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    mf = os.path.join(a.out, 'manifest.json')
    man = json.load(open(mf)) if os.path.exists(mf) else {}
    os.environ.setdefault('GDAL_DISABLE_READDIR_ON_OPEN', 'EMPTY_DIR')
    os.environ.setdefault('CPL_VSIL_CURL_ALLOWED_EXTENSIONS', '.tif')
    if not a.skip_dem:
        print('DEM', flush=True)
        man['dem'] = bake_dem(a.cache, a.out)
    if not a.skip_imagery:
        print('Imagery', flush=True)
        man['imagery'] = bake_imagery(a.cache, a.out)
    man['bounds'] = {'core': CORE, 'outer': OUTER}
    man['id'] = 'bodrum'
    man['name'] = 'Bodrum, Muğla, Türkiye'
    # Local Transverse Mercator origin = LTFE aerodrome reference point (OurAirports, airports.csv)
    man['reference'] = {'lat': AERODROME['lat'], 'lon': AERODROME['lon'], 'name': 'LTFE ARP'}
    man['dem'].update({'url': 'dem/{z}/{x}/{y}.png', 'encoding': 'terrarium', 'quantM': DEM_Q, 'waterBit': 0,
                       'vertical': 'MSL (EGM96 geoid; sea clamped to 0 m)'})
    man['imagery'].update({'url': 'img/{z}/{x}/{y}.webp', 'albedoScale': ALBEDO_SCALE,
                           'note': 'pixel = sRGB(BOA reflectance * albedoScale); deep water offset to SEA_REF'})
    meta = json.load(open(os.path.join(a.cache, 's2', CORE_SCENES[0], CORE_SCENES[0] + '.json')))['properties']
    man['sun'] = {'azimuthDeg': round(meta['view:sun_azimuth'], 2), 'elevationDeg': round(meta['view:sun_elevation'], 2),
                  'datetime': meta['datetime'], 'note': 'sun at the acquisition of the primary scene'}
    # Diğer araçların (vectors.py: OSM/Overture, WorldCover) kaynak kayıtları korunur
    own = ('Elevation', 'Imagery', 'Aerodrome reference point')
    keep = [x for x in man.get('sources', []) if x.get('what') not in own]
    man['sources'] = keep + [
        {'what': 'Elevation', 'name': 'Terrain Tiles (Terrarium) on AWS Open Data; EU-DEM / SRTM / ETOPO1 sources',
         'url': 'https://registry.opendata.aws/terrain-tiles/',
         'attribution': 'Produced using Copernicus data and information funded by the European Union - EU-DEM layers; '
                        'SRTM courtesy of the U.S. Geological Survey; ETOPO1 courtesy of NOAA; tiles by Mapzen/Tilezen.'},
        {'what': 'Imagery', 'name': 'Copernicus Sentinel-2 L2A (sentinel-cogs on AWS Open Data)',
         'url': 'https://registry.opendata.aws/sentinel-2-l2a-cogs/',
         'scenes': sorted(set(CORE_SCENES + OUTER_SCENES)),
         'attribution': 'Contains modified Copernicus Sentinel data 2024.'},
        {'what': 'Aerodrome reference point', 'name': 'OurAirports (public domain)', 'url': 'https://ourairports.com/data/'},
    ]
    json.dump(man, open(mf, 'w'), indent=1)
    print('done', mf)


if __name__ == '__main__':
    main()
