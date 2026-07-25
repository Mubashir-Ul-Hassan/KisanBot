"""Resolve a farmer's spoken/typed place name to coordinates.

Primary: Google Geocoding API (needs GOOGLE_MAPS_API_KEY). Biased to Pakistan.
Fallback: the bundled regions.json division table, so the app still resolves
major districts with no key and no network. Never invents coordinates: if
nothing matches, returns resolved=False and the caller tells the farmer.
"""

import os
import requests
from typing import Dict, Any, Optional

from . import datastore

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


def resolve_location(place: Optional[str] = None,
                     province: Optional[str] = None,
                     district: Optional[str] = None,
                     timeout: int = 10) -> Dict[str, Any]:
    """Return {resolved, lat, lon, name, source}. `place` is free text; province
    and district are optional structured hints from session state."""
    query_parts = [p for p in (place, district, province, "Pakistan") if p]
    query = ", ".join(query_parts)

    key = os.environ.get("GOOGLE_MAPS_API_KEY", "")
    if key and (place or district):
        try:
            resp = requests.get(
                GEOCODE_URL,
                params={"address": query, "region": "pk", "key": key},
                timeout=timeout,
            )
            resp.raise_for_status()
            data = resp.json()
            if data.get("status") == "OK" and data.get("results"):
                top = data["results"][0]
                loc = top["geometry"]["location"]
                return {
                    "resolved": True,
                    "lat": loc["lat"],
                    "lon": loc["lng"],
                    "name": top.get("formatted_address", query),
                    "source": "google_geocoding",
                }
        except (requests.RequestException, KeyError, ValueError) as e:
            print(f"[geocoding] Google lookup failed, trying local table: {e}")

    local = _resolve_from_regions(province, district, place)
    if local:
        return local

    return {"resolved": False, "lat": None, "lon": None,
            "name": query, "source": "none"}


def _resolve_from_regions(province: Optional[str], district: Optional[str],
                          place: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """Match against regions.json divisions using lat/lon already in the data.
    Also matches the free-text `place` (the LLM often puts a place name there
    rather than in `district`), and checks the district_lookup table."""
    regions = datastore.load("regions")
    provinces = regions.get("provinces", {})
    p_key = (province or "").lower()
    # A place/district name to look for — take the district, else the free text.
    d_key = (district or place or "").lower().strip()

    def pack(name, div):
        return {"resolved": True, "lat": div.get("lat"), "lon": div.get("lon"),
                "name": div.get("name_en", name), "source": "regions.json"}

    # 1) district_lookup maps many district names -> their division centroid.
    if d_key:
        hit = regions.get("district_lookup", {}).get(d_key)
        if hit:
            prov = provinces.get(hit.get("province"), {})
            div = prov.get("divisions", {}).get(hit.get("division"))
            if div:
                return pack(hit.get("division"), div)

    # 2) Match division name / listed districts, searching the named province first.
    search_order = [provinces[p_key]] if p_key in provinces else provinces.values()
    for prov in search_order:
        for div_name, div in prov.get("divisions", {}).items():
            names = [div_name.lower(), div.get("name_en", "").lower()]
            districts = [x.lower() for x in div.get("districts", [])]
            if d_key and (d_key in names or d_key in districts):
                return pack(div_name, div)

    # 3) Province given but no district: use the province's first division centroid.
    if p_key in provinces:
        divs = provinces[p_key].get("divisions", {})
        if divs:
            first = next(iter(divs.items()))
            return pack(first[0], first[1])
    return None
