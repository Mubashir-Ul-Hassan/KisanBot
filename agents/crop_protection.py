"""Crop Protection agent.

Handles pest/disease/pesticide questions, whether typed by the farmer or handed a
diagnosis from the Image Diagnosis agent. Enforces the Section 3.4/6 safety rules:
prefer cultural controls, screen against the banned pesticide list, never invent a
dose, and always attach the extension-office disclaimer.
"""

from typing import Dict, Any, Optional

from services import pesticide
from services.llm_client import LLMClient, LLMError
from .common import load_prompt


def run(llm: LLMClient, state: Dict[str, Any],
        diagnosis: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    crop = state.get("crop") or (diagnosis or {}).get("crop_guess")
    symptoms = state.get("symptoms")
    sources = ["crop_protection_knowledge", pesticide.reference_note()]

    handed_off = ""
    if diagnosis:
        handed_off = (f"\nHanded over from Image Diagnosis agent: "
                      f"{diagnosis.get('diagnosis_en')} "
                      f"(confidence {diagnosis.get('confidence')}, "
                      f"affected part {diagnosis.get('affected_part')}).")

    banned = ", ".join(pesticide.banned_names()) or "none listed"
    prompt = (
        f"Crop: {crop or 'unknown'}.\n"
        f"Growth stage: {state.get('growth_stage') or 'unknown'}.\n"
        f"Farmer's described symptoms: {symptoms or 'none given'}.{handed_off}\n"
        f"Substances currently on Pakistan's banned list (never recommend these): {banned}.\n"
        "Diagnose the likely cause and give treatment following the safety rules."
    )
    try:
        findings = llm.generate_json(prompt, system=load_prompt("crop_protection"))
    except LLMError:
        return {
            "ok": False, "sources": sources, "reason": "llm_error",
            "findings": {
                "need_more_info": False,
                "likely_cause_ur": "معذرت، اس وقت تشخیص دستیاب نہیں۔",
                "likely_cause_en": "Sorry, diagnosis is unavailable right now.",
            },
            "disclaimer": pesticide.disclaimer(),
        }

    # Safety net: if the model still named a banned substance, strip and flag it.
    for field in ("chemical_option_en", "chemical_option_ur"):
        text = findings.get(field, "")
        if pesticide.screen_text(text)["flagged"]:
            findings[field] = ("" if field.endswith("ur") else
                               "A safer alternative is needed — please ask your local "
                               "agriculture extension office.")
            findings["_banned_flagged"] = True

    return {
        "ok": True, "sources": sources, "crop": crop,
        "from_image": bool(diagnosis), "findings": findings,
        # Every crop-protection answer carries the disclaimer (Section 6, rule 4).
        "disclaimer": pesticide.disclaimer(),
    }
