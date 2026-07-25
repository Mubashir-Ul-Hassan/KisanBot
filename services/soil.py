"""Soil data lookup, cache-first.

Per the spec (Section 4.3): ISRIC SoilGrids is beta, rate-limited (~5/min) and
must NOT be called live per farmer request. So we read from a pre-fetched cache
(data/soil_cache.json, populated by scripts/prefetch_soil.py). If a location is
not cached we do NOT silently hit the live API in the request path; we return
available=False and let the agent say so honestly.

Set SOIL_ALLOW_LIVE=1 only for offline cache-building, not for serving farmers.
"""

import os
import math
import requests
from typing import Dict, Any, Optional

from . import datastore

QUERY_URL = "https://rest.isric.org/soilgrids/v2.0/properties/query"

# Properties we surface, with the conversion factor from SoilGrids' integer
# storage to conventional units, and the unit label.
PROPERTIES = {
    "phh2o": (10.0, "pH"),
    "soc": (10.0, "g/kg organic carbon"),
    "sand": (10.0, "% sand"),
    "silt": (10.0, "% silt"),
    "clay": (10.0, "% clay"),
    "nitrogen": (100.0, "g/kg nitrogen"),
}


def get_soil(lat: float, lon: float, allow_live: Optional[bool] = None) -> Dict[str, Any]:
    """Return cached soil for the nearest cached point, or fetch live only when
    explicitly allowed (cache-building). {available, properties, source, ...}."""
    cached = _nearest_cached(lat, lon)
    if cached:
        return cached

    if allow_live is None:
        allow_live = os.environ.get("SOIL_ALLOW_LIVE") == "1"
    if allow_live:
        return fetch_live(lat, lon)

    return {"available": False, "reason": "not_cached",
            "note": "Soil not pre-fetched for this location."}


def fetch_live(lat: float, lon: float, timeout: int = 30) -> Dict[str, Any]:
    """Directly query SoilGrids. Used by the prefetch script, NOT the request path."""
    params = [("lon", lon), ("lat", lat), ("depth", "0-5cm"),
              ("depth", "5-15cm"), ("value", "mean")]
    for prop in PROPERTIES:
        params.append(("property", prop))
    try:
        resp = requests.get(QUERY_URL, params=params, timeout=timeout)
        resp.raise_for_status()
        return _parse_soilgrids(resp.json(), lat, lon)
    except (requests.RequestException, ValueError, KeyError) as e:
        print(f"[soil] live SoilGrids fetch failed: {e}")
        return {"available": False, "reason": "api_error"}


def _parse_soilgrids(data: Dict[str, Any], lat: float, lon: float) -> Dict[str, Any]:
    props: Dict[str, Any] = {}
    for layer in data.get("properties", {}).get("layers", []):
        name = layer.get("name")
        if name not in PROPERTIES:
            continue
        factor, unit = PROPERTIES[name]
        # Average the topsoil depths we requested (0-5, 5-15cm).
        vals = []
        for depth in layer.get("depths", []):
            mean = depth.get("values", {}).get("mean")
            if mean is not None:
                vals.append(mean / factor)
        if vals:
            props[name] = {"value": round(sum(vals) / len(vals), 2), "unit": unit}
    if not props:
        return {"available": False, "reason": "empty_response"}
    return {"available": True, "lat": lat, "lon": lon,
            "properties": props, "source": "isric_soilgrids_cached",
            "texture_class": _texture_class(props)}


def _texture_class(props: Dict[str, Any]) -> Optional[str]:
    """A coarse USDA-ish texture label from sand/clay percentages, for the agent
    to describe soil in plain terms."""
    sand = props.get("sand", {}).get("value")
    clay = props.get("clay", {}).get("value")
    if sand is None or clay is None:
        return None
    if clay >= 40:
        return "clay"
    if sand >= 70:
        return "sandy"
    if clay < 20 and sand < 52:
        return "silty/loam"
    return "loam"


def _nearest_cached(lat: float, lon: float,
                    max_km: float = 60.0) -> Optional[Dict[str, Any]]:
    cache = datastore.load("soil_cache")
    points = cache.get("points", []) if isinstance(cache, dict) else []
    best, best_d = None, max_km
    for pt in points:
        d = _haversine(lat, lon, pt.get("lat"), pt.get("lon"))
        if d is not None and d < best_d:
            best, best_d = pt, d
    if best:
        result = dict(best.get("soil", {}))
        result["source"] = "isric_soilgrids_cached"
        result["matched_km"] = round(best_d, 1)
        return result
    return None


def _haversine(lat1, lon1, lat2, lon2):
    try:
        r = 6371.0
        p1, p2 = math.radians(lat1), math.radians(lat2)
        dp = math.radians(lat2 - lat1)
        dl = math.radians(lon2 - lon1)
        a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
        return r * 2 * math.asin(math.sqrt(a))
    except (TypeError, ValueError):
        return None
