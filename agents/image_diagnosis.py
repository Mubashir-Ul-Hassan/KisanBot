"""Image Diagnosis agent (multimodal).

Farmer uploads a photo -> probable diagnosis WITH an explicit confidence level.
If the photo is unusable, asks for a better one instead of guessing. Produces the
diagnosis only; the orchestrator hands it to the Crop Protection agent for the
treatment plan (Section 3.5).
"""

from typing import Dict, Any

from services.llm_client import LLMClient, LLMError
from .common import load_prompt


def run(llm: LLMClient, image_b64: str, mime_type: str,
        state: Dict[str, Any]) -> Dict[str, Any]:
    crop_hint = state.get("crop")
    prompt = ("Diagnose this plant photo. "
              f"Farmer says the crop is: {crop_hint or 'not specified'}. "
              "Judge photo quality first.")
    sources = ["gemini_vision"]
    try:
        findings = llm.analyze_image(image_b64, mime_type, prompt,
                                     system=load_prompt("image_diagnosis"))
    except LLMError:
        return {
            "ok": False, "sources": sources, "reason": "vision_error",
            "findings": {
                "usable": False,
                "retake_reason_ur": "تصویر کا تجزیہ اس وقت ممکن نہیں۔ براہ کرم دوبارہ کوشش کریں۔",
                "retake_reason_en": "Could not analyze the image right now. Please try again.",
            },
        }

    return {"ok": True, "sources": sources, "findings": findings}
