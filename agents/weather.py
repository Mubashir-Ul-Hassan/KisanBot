"""Weather agent: resolve location -> fetch real weather -> farming implication."""

from typing import Dict, Any

from services import geocoding, weather_api
from services.llm_client import LLMClient, LLMError
from .common import load_prompt


def run(llm: LLMClient, state: Dict[str, Any]) -> Dict[str, Any]:
    """Return a structured result for the orchestrator. Always includes
    `sources` for traceability and never fabricates conditions."""
    loc = geocoding.resolve_location(
        place=state.get("place"), province=state.get("province"),
        district=state.get("district"))
    sources = [loc["source"]]

    if not loc["resolved"]:
        return {
            "ok": False, "sources": sources, "location": None,
            "reason": "location_unresolved",
            "findings": {
                "headline_ur": "مجھے آپ کے علاقے کا پتہ نہیں چل سکا، اس لیے موسم کی درست معلومات نہیں دے سکتا۔",
                "implication_ur": "براہ کرم اپنا ضلع یا گاؤں بتائیں تاکہ میں موسم دیکھ سکوں۔",
                "headline_en": "Could not resolve your location, so I can't fetch reliable weather.",
                "implication_en": "Please tell me your district or village so I can check the weather.",
            },
        }

    current = weather_api.get_current(loc["lat"], loc["lon"])
    forecast = weather_api.get_forecast(loc["lat"], loc["lon"])
    if current.get("available"):
        sources.append(current["source"])

    if not current.get("available") and not forecast.get("available"):
        # Honest failure — no invented numbers (Section 6, rule 1).
        return {
            "ok": False, "sources": sources, "location": loc,
            "reason": current.get("reason", "weather_unavailable"),
            "findings": {
                "headline_ur": f"{loc['name']} کے لیے تازہ موسم اس وقت دستیاب نہیں ہے۔",
                "implication_ur": "براہ کرم تھوڑی دیر بعد کوشش کریں، یا سرکاری محکمہ موسمیات (PMD) کی ہیلپ لائن سے رابطہ کریں۔",
                "headline_en": f"Live weather for {loc['name']} is not available right now.",
                "implication_en": "Please try again shortly, or contact the PMD helpline.",
            },
        }

    prompt = (
        f"Location: {loc['name']}.\n"
        f"Crop in focus: {state.get('crop') or 'none specified'}.\n"
        f"Current conditions: {current}\n"
        f"Forecast (next days): {forecast}\n"
        "Give the farming implication."
    )
    try:
        findings = llm.generate_json(prompt, system=load_prompt("weather"))
    except LLMError:
        # Data is real; only the phrasing model failed. Report the raw facts.
        temp = current.get("temp_c")
        findings = {
            "headline_ur": f"{loc['name']} میں درجہ حرارت {temp}°C ہے۔",
            "implication_ur": "تفصیلی مشورہ اس وقت دستیاب نہیں، مگر یہ موجودہ موسم ہے۔",
            "headline_en": f"Temperature in {loc['name']} is {temp}°C.",
            "implication_en": "Detailed advisory unavailable, but this is the current weather.",
        }

    return {"ok": True, "sources": sources, "location": loc,
            "current": current, "forecast": forecast, "findings": findings}
