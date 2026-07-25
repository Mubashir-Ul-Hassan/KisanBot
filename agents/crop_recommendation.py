"""Crop Recommendation agent.

Grounds its advice in the ACTUAL retrieved soil + weather for the farmer's
specific location (Section 3.3). Calls the Weather agent for its context and the
cached SoilGrids service for soil, then asks the LLM to reason from those numbers.
"""

from typing import Dict, Any

from services import geocoding, soil as soil_svc
from services.llm_client import LLMClient, LLMError
from . import weather as weather_agent
from .common import load_prompt, current_season, season_names, month_name


def run(llm: LLMClient, state: Dict[str, Any]) -> Dict[str, Any]:
    loc = geocoding.resolve_location(
        place=state.get("place"), province=state.get("province"),
        district=state.get("district"))
    sources = [loc["source"]]

    if not loc["resolved"]:
        return {
            "ok": False, "sources": sources, "reason": "location_unresolved",
            "findings": {
                "summary_ur": "فصل کی سفارش کے لیے مجھے آپ کا علاقہ جاننا ضروری ہے۔ براہ کرم اپنا ضلع بتائیں۔",
                "summary_en": "I need your location to recommend crops. Please tell me your district.",
                "crops": [],
            },
        }

    # Real soil (cache-first) and real weather for THIS location.
    soil = soil_svc.get_soil(loc["lat"], loc["lon"])
    if soil.get("available"):
        sources.append(soil.get("source", "soil"))
    weather = weather_agent.run(llm, state)
    for s in weather.get("sources", []):
        if s not in sources:
            sources.append(s)

    season = current_season()
    s_en, s_ur = season_names(season)

    weather_summary = weather.get("current") if weather.get("ok") else {"available": False}
    soil_summary = soil.get("properties") if soil.get("available") else "unavailable"

    prompt = (
        f"Location: {loc['name']} (province: {state.get('province') or 'unknown'}).\n"
        f"Season now: {s_en} / {month_name('en')}.\n"
        f"Retrieved SOIL data for this point: {soil_summary}"
        f"{' (texture: ' + soil['texture_class'] + ')' if soil.get('texture_class') else ''}.\n"
        f"Weather summary: {weather_summary}.\n"
        f"Water availability: {state.get('water_availability') or 'unknown'}.\n"
        f"Land size (acres): {state.get('land_size_acres') or 'unknown'}.\n"
        "Recommend suitable crops, grounded in the soil and weather values above."
    )
    try:
        findings = llm.generate_json(prompt, system=load_prompt("crop_recommendation"))
    except LLMError:
        return {
            "ok": False, "sources": sources, "reason": "llm_error",
            "findings": {
                "summary_ur": "معذرت، اس وقت فصل کی سفارش تیار نہیں ہو سکی۔ براہ کرم تھوڑی دیر بعد کوشش کریں۔",
                "summary_en": "Sorry, crop recommendation could not be generated right now. Please try again shortly.",
                "crops": [],
            },
        }

    return {"ok": True, "sources": sources, "location": loc,
            "soil": soil, "weather_ok": weather.get("ok"),
            "season": {"en": s_en, "ur": s_ur}, "findings": findings}
