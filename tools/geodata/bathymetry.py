#!/usr/bin/env python3
"""v5.0 kıyı batimetrisi düzeltmesi (geo/bodrum/dem/{12,9}).

Sorun: z12/z9 Terrarium karolarında kıyıdan kilometrelerce açıkta deniz tabanı -1 m yer tutucu
(veri yok) olarak kalmıştı: açık deniz 1 m derinlikte turkuaz sığlık gibi çiziliyordu. Fizik
etkilenmez (fizik denizi 0 m MSL görür); yalnızca çizilen deniz tabanı ve su rengi değişir.

Yöntem: her deniz pikseli için karaya Öklid uzaklığı d (mozaik üzerinde, karo sınırları
kesintisiz). Kıyı profili modeli
    D(d) = 1,5 + 40·(1 − e^(−d/500)) + 70·(1 − e^(−d/5000))   [m]
(30 m'de ~4 m, 300 m'de ~24 m, 1 km'de ~49 m, 8 km'de ~97 m; Ege kıyılarının tipik kayalık
şelf profili, yaklaşık [E]) düşük frekanslı gürültüyle ±%15 değiştirilir. Veride 5 m'den derin
bir değer varsa (gerçek ölçüm) derin olan alınır. Sonuç hafifçe yumuşatılır. Göller (su bayraklı,
h >= 0) ve kara pikselleri değişmez. Su bayrağı (mavi bit 0) korunur.

    python3 -I tools/geodata/bathymetry.py geo/bodrum
"""
import math
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage


def decode(path):
    a = np.asarray(Image.open(path).convert('RGBA')).astype(np.float64)
    b = a[..., 2]
    h = a[..., 0] * 256 + a[..., 1] + (np.floor(b / 2) * 2) / 256 - 32768
    w = (b.astype(np.int32) & 1)
    return h, w


def encode(h, w, path):
    v = np.clip(h + 32768, 0, 65535.99)
    r = np.floor(v / 256)
    g = np.floor(v - r * 256)
    f = v - np.floor(v)
    b = (np.floor(f * 256).astype(np.int32) & 0xFE) | (w & 1)
    img = np.stack([r, g, b, np.full_like(r, 255)], axis=-1).astype(np.uint8)
    Image.fromarray(img, 'RGBA').save(path, optimize=True)


def process(root, z):
    d = os.path.join(root, 'dem', str(z))
    tiles = {}
    for xs in os.listdir(d):
        for f in os.listdir(os.path.join(d, xs)):
            tiles[(int(xs), int(f.split('.')[0]))] = os.path.join(d, xs, f)
    xs = [k[0] for k in tiles]
    ys = [k[1] for k in tiles]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    W, H = (x1 - x0 + 1) * 256, (y1 - y0 + 1) * 256
    hm = np.full((H, W), -50.0)
    wm = np.ones((H, W), np.int32)
    for (tx, ty), p in tiles.items():
        h, w = decode(p)
        hm[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = h
        wm[(ty - y0) * 256:(ty - y0 + 1) * 256, (tx - x0) * 256:(tx - x0 + 1) * 256] = w
    # piksel boyu (m): Web Merkatör, enleme göre
    n = 2 ** z

    def lat_of(py):
        yy = py / 256 / n
        return math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * yy))))
    lat_mid = lat_of((y0 + (y1 - y0 + 1) / 2) * 256)
    px_m = 40075016.686 * math.cos(math.radians(lat_mid)) / n / 256
    sea = (wm == 1) & (hm < 0.5)
    land = ~(wm == 1)
    dist = ndimage.distance_transform_edt(~land) * px_m
    D = 1.5 + 40 * (1 - np.exp(-dist / 500)) + 70 * (1 - np.exp(-dist / 5000))
    rng = np.random.default_rng(5150)
    noise = ndimage.gaussian_filter(rng.standard_normal((H // 16 + 2, W // 16 + 2)), 2.0)
    noise = ndimage.zoom(noise, 16, order=1)[:H, :W]
    noise = noise / (np.abs(noise).max() + 1e-9)
    D *= 0.85 + 0.15 * (noise + 1)
    data = np.where(hm < -5, -hm, 0)
    depth = np.maximum(D, data)
    depth = ndimage.gaussian_filter(depth, 1.2)
    depth = np.maximum(depth, 0.8)
    out = np.where(sea, -depth, hm)
    for (tx, ty), p in tiles.items():
        sl = (slice((ty - y0) * 256, (ty - y0 + 1) * 256), slice((tx - x0) * 256, (tx - x0 + 1) * 256))
        encode(out[sl], wm[sl], p)
    print(f'z{z}: {len(tiles)} tiles, pixel {px_m:.1f} m, sea px {int(sea.sum())}, '
          f'median sea depth before {np.median(-hm[sea]):.1f} m after {np.median(depth[sea]):.1f} m')


if __name__ == '__main__':
    root = sys.argv[1] if len(sys.argv) > 1 else 'geo/bodrum'
    for z in (12, 9):
        process(root, z)
