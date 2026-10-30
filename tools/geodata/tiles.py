"""Web Mercator (XYZ / slippy) tile math shared by the bake scripts."""
import math

def lon2x(lon, z):
    return (lon + 180.0) / 360.0 * (1 << z)

def lat2y(lat, z):
    r = math.radians(lat)
    return (1.0 - math.asinh(math.tan(r)) / math.pi) / 2.0 * (1 << z)

def x2lon(x, z):
    return x / (1 << z) * 360.0 - 180.0

def y2lat(y, z):
    n = math.pi * (1.0 - 2.0 * y / (1 << z))
    return math.degrees(math.atan(math.sinh(n)))

def tile_range(bounds, z):
    """bounds = (lon0, lat0, lon1, lat1) -> inclusive x0, x1, y0, y1"""
    lon0, lat0, lon1, lat1 = bounds
    x0 = int(math.floor(lon2x(lon0, z))); x1 = int(math.floor(lon2x(lon1, z) - 1e-9))
    y0 = int(math.floor(lat2y(lat1, z))); y1 = int(math.floor(lat2y(lat0, z) - 1e-9))
    return x0, x1, y0, y1
