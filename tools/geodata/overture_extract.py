#!/usr/bin/env python3
"""Extract the Bodrum core box from an Overture Maps release (AWS Open Data, anonymous S3).

Overture's buildings, transportation and base/infrastructure themes are derived from
OpenStreetMap (ODbL) plus, for buildings, Microsoft / Google / Esri ML footprints (CDLA /
ODbL / CC-BY). Only rows whose bbox intersects the box are read (parquet row-group pruning on the
bbox struct), so nothing close to the full release is downloaded.

  python3 -I tools/geodata/overture_extract.py --cache <dir> [--release 2026-10-21.0]

Writes <cache>/overture/{buildings,segments,infrastructure,land_use,land}.parquet
"""
import argparse, os
import pyarrow.dataset as ds
import pyarrow.fs as pafs
import pyarrow.parquet as pq

BOX = (27.00, 36.72, 28.10, 37.62)      # lon0, lat0, lon1, lat1 (same as bake.py CORE)
COLS = {
    'buildings': ('buildings', 'building', ['id', 'geometry', 'bbox', 'height', 'num_floors', 'class', 'subtype',
                                            'roof_shape', 'roof_material', 'facade_material', 'is_underground', 'names', 'level', 'min_height', 'sources']),
    'segments': ('transportation', 'segment', ['id', 'geometry', 'bbox', 'subtype', 'class', 'subclass', 'road_surface',
                                                'road_flags', 'width_rules', 'level_rules', 'names', 'sources']),
    'infrastructure': ('base', 'infrastructure', ['id', 'geometry', 'bbox', 'subtype', 'class', 'names', 'height', 'surface', 'sources']),
    'land_use': ('base', 'land_use', ['id', 'geometry', 'bbox', 'subtype', 'class', 'names', 'sources']),
    # Kıyı çizgisi: OSM kıyı çizgilerinden kara çokgenleri (deniz/kara ayrımı, bake.py)
    'land': ('base', 'land', ['id', 'geometry', 'bbox', 'subtype', 'class', 'sources']),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', required=True)
    ap.add_argument('--release', default='2026-10-21.0')
    ap.add_argument('--only', default='')
    a = ap.parse_args()
    out = os.path.join(a.cache, 'overture')
    os.makedirs(out, exist_ok=True)
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    kw = dict(anonymous=True, region='us-west-2')
    if proxy:
        kw['proxy_options'] = proxy
    ca = os.environ.get('AWS_CA_BUNDLE') or ('/root/.ccr/ca-bundle.crt' if os.path.exists('/root/.ccr/ca-bundle.crt') else None)
    if ca:
        kw['tls_ca_file_path'] = ca
    fs = pafs.S3FileSystem(**kw)
    x0, y0, x1, y1 = BOX
    for name, (theme, typ, cols) in COLS.items():
        if a.only and name not in a.only.split(','):
            continue
        path = f'overturemaps-us-west-2/release/{a.release}/theme={theme}/type={typ}/'
        d = ds.dataset(path, filesystem=fs, format='parquet')
        have = set(d.schema.names)
        b = ds.field('bbox')
        flt = (ds.field('bbox', 'xmin') <= x1) & (ds.field('bbox', 'xmax') >= x0) & (ds.field('bbox', 'ymin') <= y1) & (ds.field('bbox', 'ymax') >= y0)
        del b
        t = d.to_table(columns=[c for c in cols if c in have], filter=flt)
        pq.write_table(t, os.path.join(out, name + '.parquet'), compression='zstd')
        print(f'{name}: {t.num_rows} rows', flush=True)


if __name__ == '__main__':
    main()
