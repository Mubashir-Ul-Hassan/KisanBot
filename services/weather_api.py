"""Google Weather API client (current conditions + daily forecast).

Needs GOOGLE_MAPS_API_KEY. On any failure returns {available: False} with a
reason — the Weather agent then tells the farmer honestly and points to the
PMD helpline rather than showing invented numbers. (The old server.py fabricated
weather by month; that is deliberately removed.)
"""

import os
import requests
from typing import Dict, Any, Optional

CURRENT_URL = "https://weather.googleapis.com/v1/currentConditions:lookup"
FORECAST_URL = "https://weather.googleapis.com/v1/forecast/days:lookup"


def _key() -> str:
    return os.environ.get("GOOGLE_MAPS_API_KEY", "")


def get_current(lat: float, lon: float, timeout: int = 12) -> Dict[str, Any]:
    key = _key()
    if not key:
        return {"available": False, "reason": "no_key"}
    try:
        resp = requests.get(
            CURRENT_URL,
            params={"key": key, "location.latitude": lat,
                    "location.longitude": lon, "unitsSystem": "METRIC"},
            timeout=timeout,
        )
        resp.raise_for_status()
        d = resp.json()
        return {
            "available": True,
            "temp_c": _num(d.get("temperature", {}).get("degrees")),
            "feels_like_c": _num(d.get("feelsLikeTemperature", {}).get("degrees")),
            "humidity": d.get("relativeHumidity"),
            "wind_kph": _num(d.get("wind", {}).get("speed", {}).get("value")),
            "precip_prob": d.get("precipitation", {}).get("probability", {}).get("percent"),
            "condition": d.get("weatherCondition", {}).get("description", {}).get("text", ""),
            "cloud_cover": d.get("cloudCover"),
            "source": "google_weather",
        }
    except (requests.RequestException, ValueError) as e:
        print(f"[weather] current lookup failed: {e}")
        return {"available": False, "reason": "api_error"}


def get_forecast(lat: float, lon: float, days: int = 5,
                 timeout: int = 12) -> Dict[str, Any]:
    key = _key()
    if not key:
        return {"available": False, "reason": "no_key"}
    try:
        resp = requests.get(
            FORECAST_URL,
            params={"key": key, "location.latitude": lat,
                    "location.longitude": lon, "days": days,
                    "unitsSystem": "METRIC"},
            timeout=timeout,
        )
        resp.raise_for_status()
        d = resp.json()
        out = []
        for day in d.get("forecastDays", [])[:days]:
            disp = day.get("displayDate", {})
            out.append({
                "date": f"{disp.get('year')}-{disp.get('month'):02d}-{disp.get('day'):02d}"
                        if disp.get("year") else None,
                "temp_max_c": _num(day.get("maxTemperature", {}).get("degrees")),
                "temp_min_c": _num(day.get("minTemperature", {}).get("degrees")),
                "condition": day.get("daytimeForecast", {})
                                .get("weatherCondition", {})
                                .get("description", {}).get("text", ""),
                "precip_prob": day.get("daytimeForecast", {})
                                  .get("precipitation", {})
                                  .get("probability", {}).get("percent"),
                "precip_mm": _num(day.get("daytimeForecast", {})
                                     .get("precipitation", {})
                                     .get("qpf", {}).get("quantity")),
            })
        return {"available": True, "days": out, "source": "google_weather"}
    except (requests.RequestException, ValueError, TypeError) as e:
        print(f"[weather] forecast lookup failed: {e}")
        return {"available": False, "reason": "api_error"}


def _num(v):
    try:
        return round(float(v), 1)
    except (TypeError, ValueError):
        return None
