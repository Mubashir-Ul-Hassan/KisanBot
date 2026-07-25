"""Loads the bundled JSON knowledge base once and caches it in memory."""

import os
import json
from functools import lru_cache
from typing import Dict, Any

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


@lru_cache(maxsize=None)
def load(name: str) -> Dict[str, Any]:
    """Load data/<name>.json. Returns {} if the file is missing or invalid so
    callers can degrade gracefully instead of crashing at import time."""
    path = os.path.join(DATA_DIR, f"{name}.json")
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as e:
        print(f"[datastore] could not load {name}.json: {e}")
        return {}
