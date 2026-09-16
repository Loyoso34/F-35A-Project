#!/usr/bin/env python3
"""F-35 siluetli PWA ikonlarını üretir (yalnızca standart kütüphane, Pillow gerekmez).

Kullanım:  python3 tools/make_icons.py
Çıktı:     icons/icon-180.png, icons/icon-192.png, icons/icon-512.png
"""
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(os.path.dirname(HERE), 'icons')

# Üstten görünüm F-35 silueti, sağ yarı (x >= 0), y burun=0 -> kuyruk=1 (normalize).
HALF = [
    (0.000, 0.015), (0.030, 0.060), (0.058, 0.150), (0.085, 0.250), (0.115, 0.330),
    (0.135, 0.400), (0.150, 0.455),  # gövde / hava alığı
    (0.470, 0.655), (0.480, 0.690), (0.455, 0.720),  # kanat ucu
    (0.190, 0.775), (0.185, 0.790),  # kanat firar kenarı kök
    (0.400, 0.885), (0.395, 0.930), (0.150, 0.965),  # stabilator
    (0.070, 0.975), (0.055, 0.985), (0.000, 0.985),
]


def full_outline():
    right = HALF
    left = [(-x, y) for (x, y) in reversed(HALF[1:-1])]
    return right + left


def poly_coverage(poly, w, h, ss=4):
    """Çokgenin piksel kapsama (0..1) haritasını tarama çizgisi ile hesaplar."""
    cov = [[0.0] * w for _ in range(h)]
    edges = []
    n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]
        x1, y1 = poly[(i + 1) % n]
        if y0 == y1:
            continue
        edges.append((x0, y0, x1, y1))
    inc = 1.0 / ss
    for sy in range(h * ss):
        y = (sy + 0.5) / ss
        xs = []
        for (x0, y0, x1, y1) in edges:
            if (y0 <= y < y1) or (y1 <= y < y0):
                t = (y - y0) / (y1 - y0)
                xs.append(x0 + t * (x1 - x0))
        xs.sort()
        row = cov[sy // ss]
        for k in range(0, len(xs) - 1, 2):
            xa, xb = xs[k], xs[k + 1]
            if xb <= 0 or xa >= w:
                continue
            xa = max(0.0, xa)
            xb = min(float(w), xb)
            ia, ib = int(xa), int(xb)
            if ia == ib:
                row[ia] += (xb - xa) * inc
                continue
            row[ia] += (ia + 1 - xa) * inc
            for px in range(ia + 1, ib):
                row[px] += inc
            if ib < w:
                row[ib] += (xb - ib) * inc
    return cov


def rounded_rect_alpha(w, h, radius):
    a = [[1.0] * w for _ in range(h)]
    for y in range(h):
        for x in range(w):
            px, py = x + 0.5, y + 0.5
            dx = max(radius - px, px - (w - radius), 0)
            dy = max(radius - py, py - (h - radius), 0)
            d = math.hypot(dx, dy) - radius
            a[y][x] = min(1.0, max(0.0, 0.5 - d))
    return a


def render(size):
    w = h = size
    # Uçak, ikonun %78'ini kaplasın (maskable güvenli alan)
    scale = size * 0.78
    ox = size / 2
    oy = size * 0.11
    def tf(p):
        return (ox + p[0] * scale, oy + p[1] * scale)
    body = [tf(p) for p in full_outline()]
    body_cov = poly_coverage(body, w, h)
    # Dikey kuyruklar (üstten ince, eğik çizgiler)
    tails = []
    for s in (-1, 1):
        tails.append([tf((s * 0.105, 0.72)), tf((s * 0.140, 0.735)), tf((s * 0.175, 0.93)), tf((s * 0.145, 0.935))])
    tail_cov = [poly_coverage(t, w, h) for t in tails]
    # Kanopi
    canopy = []
    for i in range(24):
        a = i / 24 * 2 * math.pi
        canopy.append(tf((0.045 * math.cos(a), 0.235 + 0.075 * math.sin(a))))
    canopy_cov = poly_coverage(canopy, w, h)
    # Hava alıkları
    intakes = []
    for s in (-1, 1):
        intakes.append([tf((s * 0.09, 0.36)), tf((s * 0.145, 0.40)), tf((s * 0.150, 0.455)), tf((s * 0.10, 0.44))])
    intake_cov = [poly_coverage(t, w, h) for t in intakes]

    corner = rounded_rect_alpha(w, h, size * 0.2)
    rows = []
    for y in range(h):
        row = bytearray()
        for x in range(w):
            t = y / (h - 1)
            # Arka plan: koyu lacivert gradyan
            br, bg, bb = 14 + 12 * (1 - t), 22 + 20 * (1 - t), 36 + 26 * (1 - t)
            # Hafif ufuk çizgisi
            r, g, b = br, bg, bb
            c = min(1.0, body_cov[y][x] + tail_cov[0][y][x] + tail_cov[1][y][x])
            sr, sg, sb = 176, 184, 194
            r = r * (1 - c) + sr * c
            g = g * (1 - c) + sg * c
            b = b * (1 - c) + sb * c
            ic = min(1.0, intake_cov[0][y][x] + intake_cov[1][y][x])
            r = r * (1 - ic) + 110 * ic
            g = g * (1 - ic) + 116 * ic
            b = b * (1 - ic) + 124 * ic
            cc = canopy_cov[y][x]
            r = r * (1 - cc) + 208 * cc
            g = g * (1 - cc) + 160 * cc
            b = b * (1 - cc) + 62 * cc
            a = corner[y][x]
            row += bytes((int(r * a), int(g * a), int(b * a), int(255 * a)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + r for r in rows)
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (180, 192, 512):
        rows = render(size)
        out = os.path.join(OUT_DIR, f'icon-{size}.png')
        write_png(out, size, rows)
        print('yazıldı:', out)


if __name__ == '__main__':
    main()
