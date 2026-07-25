"""Market Price agent.

Honest v1: there is no free, reliable, live mandi-price API for Pakistan (Section
4.7 suggests a Zarai Mandi / PAR data partnership instead). So this agent serves
the bundled reference ranges from market_info.json and clearly labels them as
approximate, never presenting them as today's live rate. When a real feed is wired
in, only services/market_api needs to change.
"""

from typing import Dict, Any

from services import datastore
from services.llm_client import LLMClient, LLMError
from .common import load_prompt  # noqa: F401  (kept for symmetry; market uses inline prompt)

_DISCLAIMER = {
    "en": "These are approximate reference ranges, not today's live mandi rate. "
          "Please confirm the current price at your local mandi before selling.",
    "ur": "یہ تخمینی حوالہ قیمتیں ہیں، آج کا اصل منڈی ریٹ نہیں۔ بیچنے سے پہلے اپنی مقامی "
          "منڈی سے موجودہ قیمت ضرور معلوم کریں۔",
}

_SYSTEM = (
    "You are a market-price helper for Pakistani farmers. You are given approximate "
    "reference price ranges from a local database (NOT a live feed). Summarize them "
    "simply in Urdu, always making clear they are approximate and the farmer should "
    "confirm at their local mandi. Never present a number as today's guaranteed rate. "
    'Return ONLY JSON: {"summary_ur": "...", "summary_en": "..."}'
)


def run(llm: LLMClient, state: Dict[str, Any]) -> Dict[str, Any]:
    crop = (state.get("crop") or "").lower()
    prices = datastore.load("market_info").get("prices", {})
    entry = prices.get(crop)
    sources = ["market_info.json (approximate reference)"]

    if not entry and not prices:
        return {
            "ok": False, "sources": sources, "reason": "no_data",
            "findings": {
                "summary_ur": "معذرت، اس وقت منڈی کی قیمتوں کا ڈیٹا دستیاب نہیں۔",
                "summary_en": "Sorry, market price data is unavailable right now.",
            },
            "disclaimer": _DISCLAIMER,
        }

    context = entry if entry else {k: v for k, v in list(prices.items())[:6]}
    prompt = (f"Crop: {crop or 'several major crops'}.\n"
              f"Reference price data: {context}\n"
              "Summarize for the farmer.")
    try:
        findings = llm.generate_json(prompt, system=_SYSTEM)
    except LLMError:
        # Fall back to the raw reference numbers, clearly labelled.
        findings = {
            "summary_ur": "منڈی کی تخمینی قیمتیں لوڈ ہو گئی ہیں (تفصیل نیچے)۔",
            "summary_en": "Approximate market prices loaded (details below).",
        }

    return {"ok": True, "sources": sources, "crop": crop,
            "reference": context, "findings": findings, "disclaimer": _DISCLAIMER}
