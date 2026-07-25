"""Orchestrator agent — "Saathi" (ساتھی).

Holds the conversation, classifies intent, asks ONE clarifying question when a
required detail is missing, routes to the right specialist(s), and composes a
single coherent Urdu reply. It never answers substantive agricultural questions
from its own knowledge — it only routes and composes (Section 3.1 / Section 6).
"""

import json
import re
from typing import Dict, Any, List

from services import session, logging_util, datastore
from services.llm_client import LLMClient, LLMError
from .common import load_prompt, current_season, season_names, month_name
from . import weather as weather_agent
from . import crop_recommendation as crop_agent
from . import crop_protection as protection_agent
from . import image_diagnosis as image_agent
from . import market as market_agent

# Fields we extract and persist in session state.
_ENTITY_FIELDS = ["place", "province", "district", "crop", "growth_stage",
                  "symptoms", "water_availability", "land_size_acres"]


def helpline() -> Dict[str, Any]:
    """Always-available "reach a real human" fallback (Section 7). Editable in
    data/helpline.json so it can be localized/verified by the developer."""
    h = datastore.load("helpline")
    return h or {
        "label_ur": "کسی مسئلے میں یقین نہ ہو تو اپنے قریبی زرعی توسیعی دفتر سے رابطہ کریں۔",
        "label_en": "If unsure, contact your nearest agriculture extension office.",
        "phone": "",
    }


def greet() -> Dict[str, Any]:
    s_en, s_ur = season_names(current_season())
    return {
        "type": "greeting",
        "text_ur": ("السلام علیکم! میں ساتھی ہوں، آپ کا زرعی مددگار۔ "
                    f"آج کل {s_ur} کا موسم ہے۔ بتائیں، میں آپ کی کیا مدد کر سکتا ہوں؟ "
                    "آپ فصل، موسم، کیڑے/بیماری، یا منڈی کے بارے میں پوچھ سکتے ہیں — "
                    "یا فصل کی تصویر بھی بھیج سکتے ہیں۔"),
        "text_en": ("Assalam-o-Alaikum! I am Saathi, your farming helper. "
                    f"It is currently the {s_en} season. How can I help you today? "
                    "You can ask about crops, weather, pests/disease, or market prices — "
                    "or send a photo of your crop."),
        "helpline": helpline(),
        "sources": ["orchestrator"],
    }


# --- Intent classification --------------------------------------------------

def _classify(llm: LLMClient, text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    """LLM classification with a keyword fallback so routing still works with no
    key or on API failure (keeps the app usable on patchy data)."""
    try:
        prompt = (f"Session state: {json.dumps(_public_state(state), ensure_ascii=False)}\n"
                  f"Farmer message: \"{text}\"")
        result = llm.generate_json(prompt, system=load_prompt("orchestrator_classify"))
        if "intent" in result:
            return result
    except LLMError:
        pass
    return _keyword_classify(text, state)


# Keyword fallback lists (English + Roman Urdu + Urdu script). Used only when the
# LLM is unavailable, so the app still routes on patchy/no connectivity.
_KEYWORDS = {
    "weather": ["weather", "rain", "temperature", "forecast", "spray", "mosam",
                "mausam", "mausim", "barish", "baarish", "barsaat", "toofan",
                "garmi", "sardi", "موسم", "بارش", "طوفان"],
    "market": ["price", "market", "mandi", "rate", "sell", "bechna", "becho",
               "qeemat", "qimat", "daam", "bhao", "bhaw", "munafa",
               "منڈی", "قیمت", "ریٹ", "بھاؤ", "دام", "بیچنا"],
    "pest_disease": ["pest", "disease", "insect", "worm", "spot", "spots", "fungus",
                     "blight", "rust", "wilting", "yellow", "pesticide", "medicine",
                     "keera", "keeray", "keere", "sundi", "tela", "makora", "bimar",
                     "bimari", "beemari", "dhabbe", "dhabba", "peele", "peela",
                     "murjha", "ilaj", "dawai", "دھبے", "کیڑا", "کیڑے", "بیماری",
                     "پیلے", "سنڈی", "پھپھوندی", "زنگ", "دوائی"],
    "crop_recommendation": ["grow", "plant", "sow", "cultivate", "which crop",
                            "what crop", "recommend", "lagao", "lagaon", "lagayen",
                            "ugao", "boyon", "bojo", "kasht", "kashtkari", "fasal",
                            "kaunsi fasal", "konsi fasal", "mashwara",
                            "کاشت", "فصل", "لگاؤں", "بوؤں", "مشورہ", "کون سی فصل"],
    "greeting": ["hello", "hey", "salam", "assalam", "aslam", "adab",
                 "kaise ho", "kya haal", "سلام", "السلام", "آداب"],
}


def _keyword_classify(text: str, state: Dict[str, Any]) -> Dict[str, Any]:
    low = text.lower()
    intent, best = "unclear", 0
    for name, words in _KEYWORDS.items():
        score = sum(1 for w in words if w in low or w in text)
        if score > best:
            intent, best = name, score

    entities = {f: None for f in _ENTITY_FIELDS}
    for prov in ["punjab", "sindh", "kpk", "balochistan"]:
        if prov in low:
            entities["province"] = prov
    # Detect a known district by name so offline mode can resolve location too.
    for dist, info in datastore.load("regions").get("district_lookup", {}).items():
        if dist and dist in low:
            entities["district"] = dist
            entities["province"] = entities["province"] or info.get("province")
            break
    for crop in ["wheat", "rice", "cotton", "sugarcane", "maize", "potato",
                 "gandum", "chawal", "kapas", "ganna", "گندم", "چاول", "کپاس"]:
        if crop in low or crop in text:
            entities["crop"] = _norm_crop(crop)
    if intent == "pest_disease":
        entities["symptoms"] = text

    needs = False
    q_ur = q_en = ""
    if intent in ("weather", "crop_recommendation") and not (
            state.get("place") or state.get("district") or entities["province"]):
        needs, q_ur, q_en = True, "آپ کس ضلع یا گاؤں میں ہیں؟", "Which district or village are you in?"
    elif intent == "pest_disease" and not (state.get("crop") or entities["crop"]):
        needs, q_ur, q_en = True, "کون سی فصل متاثر ہے؟", "Which crop is affected?"

    return {"intent": intent, "needs_clarification": needs,
            "clarifying_question_ur": q_ur, "clarifying_question_en": q_en,
            "entities": entities}


def _norm_crop(c: str) -> str:
    m = {"gandum": "wheat", "گندم": "wheat", "chawal": "rice", "چاول": "rice",
         "kapas": "cotton", "کپاس": "cotton", "ganna": "sugarcane"}
    return m.get(c, c)


# --- Main entry points ------------------------------------------------------

def handle_message(llm: LLMClient, session_id: str, text: str,
                   client_state: Dict[str, Any]) -> Dict[str, Any]:
    state = session.merge(session_id, client_state or {})
    session.add_turn(session_id, "farmer", text)

    parsed = _classify(llm, text, state)
    intent = parsed.get("intent", "unclear")
    _apply_entities(session_id, parsed.get("entities", {}))
    state = session.get(session_id)

    if intent == "greeting":
        return _finish(session_id, greet(), intent)

    if parsed.get("needs_clarification"):
        q = _question(parsed)
        return _finish(session_id, q, intent)

    if intent == "weather":
        result = weather_agent.run(llm, state)
        return _finish(session_id, _compose(llm, "weather", result, state), intent)

    if intent == "crop_recommendation":
        result = crop_agent.run(llm, state)
        return _finish(session_id, _compose(llm, "crop_recommendation", result, state), intent)

    if intent == "pest_disease":
        # Ask for a symptom if we still have nothing to go on.
        if not state.get("symptoms") and not state.get("crop"):
            return _finish(session_id, _question({
                "clarifying_question_ur": "کون سی فصل متاثر ہے اور کیا علامات ہیں؟",
                "clarifying_question_en": "Which crop is affected and what symptoms do you see?",
            }), intent)
        result = protection_agent.run(llm, state)
        return _finish(session_id, _compose(llm, "pest_disease", result, state), intent)

    if intent == "market":
        result = market_agent.run(llm, state)
        return _finish(session_id, _compose(llm, "market", result, state), intent)

    # Unclear: ask, don't guess (Section 6, rule 2).
    return _finish(session_id, _unclear(), "unclear")


def handle_image(llm: LLMClient, session_id: str, image_b64: str,
                 mime_type: str, client_state: Dict[str, Any]) -> Dict[str, Any]:
    state = session.merge(session_id, client_state or {})
    session.add_turn(session_id, "farmer", "[photo uploaded]")

    diag = image_agent.run(llm, image_b64, mime_type, state)
    findings = diag.get("findings", {})

    # Bad photo -> ask for a better one, no guessing (Section 3.5).
    if not findings.get("usable", False):
        resp = {
            "type": "question",
            "text_ur": findings.get("retake_reason_ur",
                       "براہ کرم متاثرہ حصے کی ایک صاف، روشن تصویر دوبارہ بھیجیں۔"),
            "text_en": findings.get("retake_reason_en",
                       "Please resend a clear, well-lit photo of the affected part."),
            "helpline": helpline(),
            "sources": diag.get("sources", []),
        }
        return _finish(session_id, resp, "pest_disease_image")

    # Good photo -> record diagnosis, hand off to Crop Protection for treatment.
    session.update(session_id, last_diagnosis=findings,
                   crop=findings.get("crop_guess") or state.get("crop"))
    state = session.get(session_id)
    protection = protection_agent.run(llm, state, diagnosis=findings)

    combined = {
        "ok": protection.get("ok", False),
        "sources": diag.get("sources", []) + protection.get("sources", []),
        "image": findings,
        "protection": protection.get("findings", {}),
        "disclaimer": protection.get("disclaimer"),
    }
    return _finish(session_id, _compose(llm, "pest_disease_image", combined, state),
                   "pest_disease_image")


# --- Composition ------------------------------------------------------------

def _compose(llm: LLMClient, intent: str, result: Dict[str, Any],
             state: Dict[str, Any]) -> Dict[str, Any]:
    """Turn a specialist's structured findings into one Urdu reply, append the
    required disclaimers, and build a details card for the dashboard."""
    findings = result.get("findings", {})

    # For pest/image results, hand the model the diagnosis + treatment together.
    payload = {"intent": intent, "findings": findings}
    if "protection" in result:
        payload["image_diagnosis"] = result.get("image")
        payload["treatment"] = result.get("protection")
    if result.get("disclaimer"):
        payload["disclaimer"] = result["disclaimer"]

    text_ur = text_en = None
    try:
        composed = llm.generate_json(
            f"Specialist findings to relay:\n{json.dumps(payload, ensure_ascii=False)}",
            system=load_prompt("orchestrator_compose"))
        text_ur, text_en = composed.get("text_ur"), composed.get("text_en")
    except LLMError:
        pass

    if not text_ur:  # Fallback: use the specialist's own Urdu summary fields.
        text_ur, text_en = _fallback_text(intent, result)

    disclaimer = result.get("disclaimer")
    low_confidence = _is_low_confidence(intent, result)
    resp = {
        "type": _response_type(intent),
        "text_ur": text_ur,
        "text_en": text_en,
        "dashboard_html": _details_html(intent, result),
        "sources": result.get("sources", []),
        "needs_human": (not result.get("ok", True)) or low_confidence,
        "helpline": helpline(),
    }
    if disclaimer:
        resp["disclaimer"] = disclaimer
    return resp


def _fallback_text(intent: str, result: Dict[str, Any]):
    f = result.get("findings", {})
    if intent == "weather":
        return (f.get("headline_ur", "") + " " + f.get("implication_ur", "")).strip(), \
               (f.get("headline_en", "") + " " + f.get("implication_en", "")).strip()
    if intent == "crop_recommendation":
        return f.get("summary_ur", ""), f.get("summary_en", "")
    if intent == "market":
        return f.get("summary_ur", ""), f.get("summary_en", "")
    if intent == "pest_disease":
        return f.get("likely_cause_ur", "") or f.get("clarifying_question_ur", ""), \
               f.get("likely_cause_en", "") or f.get("clarifying_question_en", "")
    if intent == "pest_disease_image":
        img = result.get("image", {})
        tr = result.get("protection", {})
        ur = f"{img.get('diagnosis_ur','')} ({img.get('confidence_statement_ur','')}). {tr.get('cultural_control_ur','')}"
        en = f"{img.get('diagnosis_en','')} (confidence: {img.get('confidence','')}). {tr.get('cultural_control_en','')}"
        return ur.strip(), en.strip()
    return "معذرت، جواب تیار نہیں ہو سکا۔", "Sorry, no answer could be prepared."


def _is_low_confidence(intent: str, result: Dict[str, Any]) -> bool:
    if intent == "pest_disease":
        return result.get("findings", {}).get("confidence") == "low"
    if intent == "pest_disease_image":
        return (result.get("image", {}).get("confidence") == "low" or
                result.get("protection", {}).get("confidence") == "low")
    return False


def _response_type(intent: str) -> str:
    return {"weather": "weather_report",
            "crop_recommendation": "recommendation",
            "pest_disease": "pest_advice",
            "pest_disease_image": "pest_advice",
            "market": "market_info"}.get(intent, "help")


# --- Small helpers ----------------------------------------------------------

def _apply_entities(session_id: str, entities: Dict[str, Any]) -> None:
    clean = {k: entities.get(k) for k in _ENTITY_FIELDS if entities.get(k)}
    # Auto-resolve province from district via regions lookup when possible.
    if clean.get("district") and not clean.get("province"):
        lookup = datastore.load("regions").get("district_lookup", {})
        hit = lookup.get(str(clean["district"]).lower())
        if hit:
            clean["province"] = hit.get("province")
    if clean:
        session.update(session_id, **clean)


def _question(parsed: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "type": "question",
        "text_ur": parsed.get("clarifying_question_ur") or "براہ کرم تھوڑی مزید تفصیل بتائیں۔",
        "text_en": parsed.get("clarifying_question_en") or "Please share a little more detail.",
        "helpline": helpline(),
        "sources": ["orchestrator"],
    }


def _unclear() -> Dict[str, Any]:
    return {
        "type": "help",
        "text_ur": ("معاف کیجیے، میں سمجھ نہیں پایا۔ آپ فصل کی سفارش، موسم، "
                    "کیڑے/بیماری، یا منڈی کی قیمت کے بارے میں پوچھ سکتے ہیں۔"),
        "text_en": ("Sorry, I didn't understand. You can ask about crop advice, "
                    "weather, pests/disease, or market prices."),
        "helpline": helpline(),
        "sources": ["orchestrator"],
    }


def _public_state(state: Dict[str, Any]) -> Dict[str, Any]:
    return {k: state.get(k) for k in _ENTITY_FIELDS + ["lat", "lon", "current_crops"]}


def _finish(session_id: str, resp: Dict[str, Any], intent: str) -> Dict[str, Any]:
    logging_util.record(session_id, resp.get("type", "?"),
                        resp.get("sources", []), intent=intent)
    session.add_turn(session_id, "saathi", resp.get("text_ur", ""))
    resp["state"] = _public_state(session.get(session_id))
    resp["intent"] = intent
    return resp


def _esc(s: Any) -> str:
    return (str(s or "")).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def _details_html(intent: str, result: Dict[str, Any]) -> str:
    """Simple, self-contained detail card for the Live Insights dashboard.
    Kept minimal and honest — shows sources and any disclaimer."""
    f = result.get("findings", {})
    rows = []
    if intent == "crop_recommendation":
        for c in f.get("crops", []) or []:
            rows.append(
                f"<div class='crop-card'><div class='crop-header'>"
                f"<span class='crop-name'>{_esc(c.get('name_ur'))} / {_esc(c.get('name_en'))}</span></div>"
                f"<div class='crop-notes ur-text'>{_esc(c.get('why_ur'))}</div>"
                f"<div class='detail-row'>📅 {_esc(c.get('sowing_window'))} · 🌾 {_esc(c.get('approx_yield'))}</div></div>")
        note = f.get("grounding_note_en")
        if note:
            rows.append(f"<div class='detail-row'>🔬 {_esc(note)}</div>")
    elif intent == "weather":
        cur = result.get("current", {})
        if cur.get("available"):
            rows.append(f"<div class='weather-stats'>🌡️ {_esc(cur.get('temp_c'))}°C · "
                        f"💧 {_esc(cur.get('humidity'))}% · ☔ {_esc(cur.get('precip_prob'))}%</div>")
        rows.append(f"<div class='ur-text'>{_esc(f.get('implication_ur'))}</div>")
    elif intent in ("pest_disease", "pest_disease_image"):
        img = result.get("image")
        if img:
            rows.append(f"<div class='pest-name'>🔬 {_esc(img.get('diagnosis_ur'))} "
                        f"— {_esc(img.get('confidence_statement_ur'))}</div>")
        tr = result.get("protection", f)
        rows.append(f"<div class='pest-section remedy-organic'><div class='section-title'>🌿 پہلے یہ آزمائیں</div>"
                    f"<p class='ur-text'>{_esc(tr.get('cultural_control_ur'))}</p></div>")
        if tr.get("chemical_option_ur"):
            rows.append(f"<div class='pest-section remedy-chemical'><div class='section-title'>🧪 دوا</div>"
                        f"<p class='ur-text'>{_esc(tr.get('chemical_option_ur'))}</p></div>")
    elif intent == "market":
        rows.append(f"<div class='ur-text'>{_esc(f.get('summary_ur'))}</div>"
                    f"<pre style='white-space:pre-wrap;font-size:0.75rem;opacity:0.8'>"
                    f"{_esc(json.dumps(result.get('reference', {}), ensure_ascii=False, indent=1))}</pre>")

    disc = result.get("disclaimer")
    if disc:
        rows.append(f"<div class='advisory advisory-warning ur-text'>⚠️ {_esc(disc.get('ur'))}</div>")
    src = ", ".join(_esc(s) for s in result.get("sources", []))
    rows.append(f"<div class='data-source'>📚 ذرائع: {src}</div>")
    return "<div class='response-card'>" + "".join(rows) + "</div>"
