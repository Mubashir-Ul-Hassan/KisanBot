"""Definition-of-Done scenario checks (Section 10).

Runs 10+ varied farmer messages plus a photo-diagnosis flow through the real
orchestrator, using a STUB LLM so the test needs no API key. The stub returns
canned-but-structured responses, letting us verify routing, clarifying-question
behaviour, the image -> crop-protection hand-off, the safety disclaimer, and the
banned-pesticide filter — deterministically.

Run:  python tests/scenarios.py
"""

import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from agents import orchestrator
from services import session
from services.llm_client import LLMError


class StubLLM:
    """Deterministic stand-in for Gemini. To exercise the REAL offline keyword
    router (the graceful-degradation path that must work on patchy data), it
    simulates an LLM outage on the classify call; the orchestrator then falls
    back to its own keyword classifier. Specialist/compose calls return canned
    but structured payloads so we can assert on flow and safety behaviour."""

    def generate_json(self, prompt, system=None, temperature=0.2):
        s = (system or "")
        if "routing brain" in s:
            raise LLMError("simulated classify outage -> exercise keyword fallback")
        if "Weather specialist" in s:
            return {"headline_ur": "کل بارش متوقع ہے۔", "implication_ur": "اسپرے مؤخر کریں۔",
                    "headline_en": "Rain expected tomorrow.", "implication_en": "Delay spraying."}
        if "Crop Recommendation specialist" in s:
            return {"summary_ur": "آپ کی مٹی کے مطابق گندم بہتر ہے۔",
                    "summary_en": "Given your soil, wheat fits well.",
                    "crops": [{"name_ur": "گندم", "name_en": "Wheat", "why_ur": "…", "why_en": "…",
                               "sowing_window": "Nov", "approx_yield": "40-50 maund/acre (approx)"}],
                    "grounding_note_en": "Based on soil pH 8.1 and loam texture."}
        if "Crop Protection specialist" in s:
            # Deliberately suggest a BANNED substance to test the safety filter.
            return {"need_more_info": False, "likely_cause_ur": "سنڈی کا حملہ",
                    "likely_cause_en": "Bollworm attack", "cultural_control_ur": "متاثرہ حصے ہٹائیں۔",
                    "cultural_control_en": "Remove affected parts.",
                    "chemical_option_ur": "monocrotophos استعمال کریں",
                    "chemical_option_en": "Use monocrotophos", "confidence": "medium"}
        if "market-price helper" in s:
            return {"summary_ur": "گندم کی تخمینی قیمت لوڈ ہو گئی۔", "summary_en": "Approx wheat price loaded."}
        if "composing" in s or "Saathi" in s:
            data = json.loads(prompt.split("relay:\n", 1)[-1])
            f = data.get("findings", {})
            ur = f.get("summary_ur") or f.get("headline_ur") or f.get("likely_cause_ur") or "جواب۔"
            return {"text_ur": ur, "text_en": "Composed reply."}
        return {"text_ur": "جواب۔", "text_en": "Reply."}

    def analyze_image(self, image_b64, mime_type, prompt, system=None, json_mode=True):
        return {"usable": True, "diagnosis_ur": "پتوں کا جھلساؤ",
                "diagnosis_en": "Leaf blight", "affected_part": "leaf",
                "crop_guess": "wheat", "confidence": "high",
                "confidence_statement_ur": "مجھے تقریباً 80 فیصد یقین ہے"}

    def _classify(self, prompt):
        # Only look at the farmer's message, not the state JSON in the prompt
        # (which contains field names like "growth_stage").
        msg = prompt.split('Farmer message:', 1)[-1]
        low = msg.lower()
        ents = {k: None for k in ["place", "province", "district", "crop",
                                  "growth_stage", "symptoms", "water_availability",
                                  "land_size_acres"]}
        for d in ["lahore", "multan", "hyderabad", "peshawar", "quetta"]:
            if d in low:
                ents["district"] = d
        for c in ["wheat", "rice", "cotton", "sugarcane", "maize"]:
            if c in low:
                ents["crop"] = c
        if any(w in low for w in ["weather", "rain", "spray"]):
            intent = "weather"
        elif any(w in low for w in ["grow", "plant", "sow", "which crop", "recommend"]):
            intent = "crop_recommendation"
        elif any(w in low for w in ["pest", "spots", "worm", "bollworm", "disease", "sick"]):
            intent = "pest_disease"
            ents["symptoms"] = "spots on leaves"
        elif any(w in low for w in ["price", "mandi", "rate", "sell"]):
            intent = "market"
        elif any(w in low for w in ["salam", "hello", "hi"]):
            intent = "greeting"
        else:
            intent = "unclear"

        needs, q_ur, q_en = False, "", ""
        # "my plant looks sick" -> ambiguous, must ask (Section 3.4)
        if intent == "pest_disease" and "sick" in low and "cotton" not in low and "wheat" not in low:
            needs, q_ur, q_en = True, "کون سی فصل متاثر ہے؟", "Which crop is affected?"
        return {"intent": intent, "needs_clarification": needs,
                "clarifying_question_ur": q_ur, "clarifying_question_en": q_en,
                "entities": ents}


SCENARIOS = [
    ("greeting",            "Assalam o alaikum",                                   "greeting"),
    ("weather",             "Lahore mein aaj mosam kaisa hai?",                    "weather"),
    ("crop (with loc)",     "Multan mein kaunsi fasal lagaon?",                    "crop_recommendation"),
    ("crop (no loc)",       "mujhe fasal ka mashwara chahiye",                     "crop_recommendation"),
    ("pest by text",        "meri cotton par sundi lag gayi hai",                  "pest_disease"),
    ("pest ambiguous",      "meri fasal bimar lag rahi hai",                       "pest_disease"),
    ("market",              "wheat ka mandi rate kya hai?",                        "market"),
    ("spray timing",        "kya main aaj spray kar sakta hoon Lahore?",           "weather"),
    ("what to plant Sindh", "Hyderabad mein is season kya boyon?",                 "crop_recommendation"),
    ("rice pest",           "rice ke patton par peele dhabbe hain",                "pest_disease"),
    ("unclear",             "xyz random gibberish",                                "unclear"),
]


def main():
    llm = StubLLM()
    passed = 0
    print("=== Routing scenarios ===")
    for label, text, expect in SCENARIOS:
        sid = f"test_{label}"
        session._STORE.pop(sid, None)
        r = orchestrator.handle_message(llm, sid, text, {})
        ok = r["intent"] == expect
        passed += ok
        flag = "OK " if ok else "XX "
        note = ""
        if r["type"] == "question":
            note = f"  (asked: {r['text_en']})"
        print(f"{flag} {label:22s} -> {r['intent']:20s} type={r['type']:14s}{note}")

    print(f"\nRouting: {passed}/{len(SCENARIOS)} correct")

    print("\n=== Photo diagnosis -> crop protection hand-off ===")
    sid = "test_photo"
    session._STORE.pop(sid, None)
    r = orchestrator.handle_image(llm, sid, "ZmFrZQ==", "image/jpeg", {"crop": "wheat"})
    print("reply (ur):", r["text_ur"])
    checks = {
        "has confidence in diagnosis": "80" in json.dumps(r, ensure_ascii=False),
        "disclaimer attached": bool(r.get("disclaimer")),
        "needs_human flag present": "needs_human" in r,
        "sources logged": bool(r.get("sources")),
    }
    for k, v in checks.items():
        print(f"  {'OK ' if v else 'XX '} {k}")

    print("\n=== Banned-pesticide safety filter ===")
    sid = "test_pest"
    session._STORE.pop(sid, None)
    r = orchestrator.handle_message(llm, sid, "cotton par sundi hai", {"crop": "cotton"})
    dump = json.dumps(r, ensure_ascii=False).lower()
    print(f"  {'OK ' if 'monocrotophos' not in dump else 'XX '} banned substance stripped from reply")
    print(f"  {'OK ' if r.get('disclaimer') else 'XX '} pesticide disclaimer attached")

    all_ok = passed == len(SCENARIOS)
    print("\n" + ("ALL ROUTING PASSED" if all_ok else "SOME ROUTING FAILED"))
    sys.exit(0 if all_ok else 1)


if __name__ == "__main__":
    main()
