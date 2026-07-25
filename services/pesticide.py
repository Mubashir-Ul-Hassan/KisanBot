"""Pesticide safety screening for the Crop Protection agent.

IMPORTANT (Section 4.5 caveat): Pakistan's official registered/banned pesticide
lists are published by the Department of Plant Protection (DPP) as PDFs, not a
queryable API, and DPP is being reorganized. This module therefore reads a
CURATED, BUNDLED reference file (data/pesticide_reference.json) that a human must
verify and keep current — it is a safety net, NOT an authoritative live feed.

The agent uses this to (a) refuse to suggest anything on the banned list and
(b) always attach a disclaimer telling the farmer to confirm dosage with the
local agriculture extension office. It never asserts a product is "approved"
on its own authority.
"""

import re
from typing import Dict, Any, List

from . import datastore


def _ref() -> Dict[str, Any]:
    return datastore.load("pesticide_reference")


def banned_names() -> List[str]:
    return [str(x).lower() for x in _ref().get("banned", [])]


def screen_text(text: str) -> Dict[str, Any]:
    """Scan a proposed treatment string for any banned active ingredient/product.
    Returns {flagged, hits} so the agent can strip/replace them before replying."""
    if not text:
        return {"flagged": False, "hits": []}
    low = text.lower()
    hits = [b for b in banned_names() if b and re.search(r"\b" + re.escape(b) + r"\b", low)]
    return {"flagged": bool(hits), "hits": sorted(set(hits))}


def is_banned(name: str) -> bool:
    return screen_text(name)["flagged"]


def disclaimer() -> Dict[str, str]:
    ref = _ref()
    d = ref.get("disclaimer", {})
    return {
        "en": d.get("en",
            "This is general guidance. Confirm the exact product, dose and safety "
            "precautions with your nearest agriculture extension office before spraying."),
        "ur": d.get("ur",
            "یہ عمومی رہنمائی ہے۔ اسپرے سے پہلے صحیح دوا، مقدار اور احتیاطی تدابیر اپنے قریبی "
            "زرعی توسیعی دفتر سے ضرور تصدیق کریں۔"),
    }


def reference_note() -> str:
    """Human-facing provenance note for logging/traceability."""
    ref = _ref()
    return ref.get("source_note", "Curated reference list — pending DPP verification.")
