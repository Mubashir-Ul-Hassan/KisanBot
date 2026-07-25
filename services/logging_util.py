"""Traceability logging (Section 6, rule 5).

Records which agent and which data source produced each answer, so problems are
traceable and the farmer's trust is earned. Keeps a rolling in-memory buffer and
also prints a compact line to stdout.
"""

from collections import deque
from typing import Dict, Any, List, Deque

_LOG: Deque[Dict[str, Any]] = deque(maxlen=500)


def record(session_id: str, agent: str, sources: List[str],
           intent: str = "", note: str = "") -> None:
    entry = {
        "session": session_id,
        "agent": agent,
        "intent": intent,
        "sources": sources,
        "note": note,
    }
    _LOG.append(entry)
    print(f"[trace] session={session_id} agent={agent} intent={intent} "
          f"sources={sources} {note}".rstrip())


def recent(limit: int = 50) -> List[Dict[str, Any]]:
    return list(_LOG)[-limit:]
