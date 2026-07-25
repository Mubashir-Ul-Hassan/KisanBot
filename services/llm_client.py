"""Thin, swappable LLM interface.

The rest of the codebase talks to `get_llm()` and never to a provider SDK
directly, so switching from Gemini to Claude (or adding a second provider)
later is a change to this one file, not a rewrite. See Section 9 of the spec.

Current implementation: Google Gemini via its REST API (no extra dependency).
"""

import os
import json
import time
import requests
from typing import List, Dict, Any, Optional


class LLMError(Exception):
    """Raised when the model call fails after the client has done its best."""


class LLMClient:
    """Abstract interface every provider implementation must satisfy."""

    def generate(self, prompt: str, system: Optional[str] = None,
                 json_mode: bool = False, temperature: float = 0.3) -> str:
        raise NotImplementedError

    def generate_json(self, prompt: str, system: Optional[str] = None,
                      temperature: float = 0.2) -> Dict[str, Any]:
        """Return a parsed JSON object. Raises LLMError if the model does not
        return valid JSON, so callers can fall back rather than trust garbage."""
        raw = self.generate(prompt, system=system, json_mode=True,
                            temperature=temperature)
        return _parse_json_block(raw)

    def analyze_image(self, image_b64: str, mime_type: str, prompt: str,
                      system: Optional[str] = None,
                      json_mode: bool = True) -> Dict[str, Any]:
        raise NotImplementedError

    @property
    def name(self) -> str:
        return "unknown"


class GeminiClient(LLMClient):
    """Google Gemini implementation over the public generateContent REST API."""

    BASE = "https://generativelanguage.googleapis.com/v1beta/models"

    def __init__(self, api_key: Optional[str] = None,
                 text_model: Optional[str] = None,
                 vision_model: Optional[str] = None,
                 timeout: int = 25):
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")
        # Model is overridable via env. Default gemini-2.5-flash: capable,
        # multimodal, and available on the free tier (2.0-flash free quota can be 0).
        self.text_model = (text_model or os.environ.get("GEMINI_TEXT_MODEL")
                           or "gemini-2.5-flash")
        self.vision_model = (vision_model or os.environ.get("GEMINI_VISION_MODEL")
                             or "gemini-2.5-flash")
        self.timeout = timeout

    @property
    def name(self) -> str:
        return f"gemini:{self.text_model}"

    def _post(self, model: str, parts: List[Dict[str, Any]],
              system: Optional[str], json_mode: bool,
              temperature: float) -> str:
        if not self.api_key:
            raise LLMError("Gemini API key is missing.")

        url = f"{self.BASE}/{model}:generateContent?key={self.api_key}"
        payload: Dict[str, Any] = {
            "contents": [{"parts": parts}],
            "generationConfig": {"temperature": temperature},
        }
        if system:
            payload["systemInstruction"] = {"parts": [{"text": system}]}
        if json_mode:
            payload["generationConfig"]["responseMimeType"] = "application/json"

        # Retry transient rate-limit / overload responses (429/503) with backoff —
        # common on the Gemini free tier when several agents fire in quick succession.
        last_err = None
        for attempt in range(3):
            try:
                resp = requests.post(url, json=payload, timeout=self.timeout)
                if resp.status_code in (429, 503) and attempt < 2:
                    time.sleep(2 * (attempt + 1))
                    continue
                resp.raise_for_status()
                data = resp.json()
                return data["candidates"][0]["content"]["parts"][0]["text"]
            except (requests.RequestException, KeyError, IndexError, ValueError) as e:
                last_err = e
                if attempt < 2 and isinstance(e, requests.RequestException):
                    time.sleep(2 * (attempt + 1))
                    continue
                break
        raise LLMError(f"Gemini call failed: {last_err}")

    def generate(self, prompt: str, system: Optional[str] = None,
                 json_mode: bool = False, temperature: float = 0.3) -> str:
        return self._post(self.text_model, [{"text": prompt}], system,
                          json_mode, temperature)

    def analyze_image(self, image_b64: str, mime_type: str, prompt: str,
                      system: Optional[str] = None,
                      json_mode: bool = True) -> Dict[str, Any]:
        parts = [
            {"inline_data": {"mime_type": mime_type, "data": image_b64}},
            {"text": prompt},
        ]
        raw = self._post(self.vision_model, parts, system, json_mode, 0.2)
        return _parse_json_block(raw) if json_mode else {"text": raw}


def _parse_json_block(raw: str) -> Dict[str, Any]:
    """Parse a JSON object out of a model response, tolerating stray prose or
    ```json fences that models sometimes add despite being told not to."""
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        pass
    start, end = raw.find("{"), raw.rfind("}")
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end + 1])
        except json.JSONDecodeError as e:
            raise LLMError(f"Model did not return valid JSON: {e}") from e
    raise LLMError("Model response contained no JSON object.")


# --- Provider selection -----------------------------------------------------

def get_llm(api_key: Optional[str] = None) -> LLMClient:
    """Factory. Reads LLM_PROVIDER (default 'gemini'). Per-request api_key wins
    over the environment so the frontend can pass a farmer/session key."""
    provider = os.environ.get("LLM_PROVIDER", "gemini").lower()
    if provider == "gemini":
        return GeminiClient(api_key=api_key)
    # Placeholder for a future Claude implementation (Claude Agent SDK / Messages
    # API). Kept as an explicit error so a mis-set env var fails loudly.
    raise LLMError(f"Unknown LLM_PROVIDER '{provider}'. Supported: gemini.")
