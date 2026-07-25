"""In-memory shared session state.

Holds the farmer's location, land size, crops and short history so no specialist
agent asks for the same thing twice (Section 8). Keyed by a session id the
frontend supplies. The client also sends its own state snapshot each turn; the
orchestrator merges the two, so this store surviving a restart is not required.

Deliberately simple (a dict). Swap for Redis/DB when multi-instance is needed.
"""

from typing import Dict, Any, List

_STORE: Dict[str, Dict[str, Any]] = {}

_DEFAULT: Dict[str, Any] = {
    "province": None,
    "district": None,
    "place": None,
    "lat": None,
    "lon": None,
    "land_size_acres": None,
    "current_crops": [],
    "crop": None,
    "growth_stage": None,
    "water_availability": None,
    "symptoms": None,
    "last_diagnosis": None,
    "history": [],
}


def get(session_id: str) -> Dict[str, Any]:
    if session_id not in _STORE:
        _STORE[session_id] = {**_DEFAULT, "history": []}
    return _STORE[session_id]


def merge(session_id: str, incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Merge a client-supplied snapshot in, keeping existing non-empty values
    when the incoming value is empty (never lose known info)."""
    state = get(session_id)
    for k, v in (incoming or {}).items():
        if v in (None, "", []) and state.get(k) not in (None, "", []):
            continue
        state[k] = v
    return state


def update(session_id: str, **fields) -> Dict[str, Any]:
    state = get(session_id)
    for k, v in fields.items():
        if v not in (None, "", []):
            state[k] = v
    return state


def add_turn(session_id: str, role: str, text: str) -> None:
    state = get(session_id)
    hist: List[Dict[str, str]] = state.setdefault("history", [])
    hist.append({"role": role, "text": (text or "")[:500]})
    # Keep history light for patchy mobile data / small context.
    if len(hist) > 12:
        state["history"] = hist[-12:]
