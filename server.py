"""KisanBot backend — thin FastAPI layer over the multi-agent orchestrator.

All intelligence lives in /agents and /services. This file only:
  - loads env,
  - validates requests,
  - hands each request to the Orchestrator ("Saathi"),
  - returns the composed reply.

The previous version simulated CrewAI/AutoGen/LangGraph/BeeAI with single Gemini
role-play prompts and fabricated satellite/weather data; that is all removed in
favour of real specialist agents grounded in real tools (Sections 3, 6).
"""

import os
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

from services.llm_client import get_llm
from services import logging_util
from agents import orchestrator

app = FastAPI(title="KisanBot Multi-Agent Farm Advisory")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    text: str
    session_id: str = "default"
    state: Dict[str, Any] = {}
    # Optional per-request keys (frontend Settings). Fall back to env if absent.
    gemini_key: Optional[str] = None


class DiagnoseRequest(BaseModel):
    image_base64: str
    mime_type: str = "image/jpeg"
    session_id: str = "default"
    state: Dict[str, Any] = {}
    gemini_key: Optional[str] = None


def _llm(req_key: Optional[str]):
    key = req_key or os.environ.get("GEMINI_API_KEY", "")
    if not key:
        raise HTTPException(
            status_code=400,
            detail="No Gemini API key. Set GEMINI_API_KEY in the environment or Settings.")
    return get_llm(api_key=key)


@app.post("/api/chat")
async def chat(req: ChatRequest):
    llm = _llm(req.gemini_key)
    try:
        return orchestrator.handle_message(llm, req.session_id, req.text, req.state)
    except Exception as e:  # last-resort guard — never leak a raw stack to the farmer
        logging_util.record(req.session_id, "server_error", [], note=str(e))
        raise HTTPException(status_code=500, detail="Internal error. Please try again.")


@app.post("/api/diagnose")
async def diagnose(req: DiagnoseRequest):
    """Photo upload -> Image Diagnosis agent -> Crop Protection agent."""
    llm = _llm(req.gemini_key)
    try:
        return orchestrator.handle_image(
            llm, req.session_id, req.image_base64, req.mime_type, req.state)
    except Exception as e:
        logging_util.record(req.session_id, "server_error", [], note=str(e))
        raise HTTPException(status_code=500, detail="Internal error. Please try again.")


@app.get("/api/health")
def health():
    return {
        "status": "healthy",
        "llm_provider": os.environ.get("LLM_PROVIDER", "gemini"),
        "gemini_key_present": bool(os.environ.get("GEMINI_API_KEY")),
        "google_maps_key_present": bool(os.environ.get("GOOGLE_MAPS_API_KEY")),
        "agents": ["orchestrator", "weather", "crop_recommendation",
                   "crop_protection", "image_diagnosis", "market"],
    }


@app.get("/api/trace")
def trace(limit: int = 50):
    """Recent agent/source trace for debugging (Section 6, rule 5)."""
    return {"entries": logging_util.recent(limit)}


# --- Serve the frontend (index.html, CSS, JS) from the same port. -----------
_STATIC_DIR = Path(__file__).resolve().parent


@app.get("/")
def root():
    return FileResponse(_STATIC_DIR / "index.html")


# Mount static assets (css, js) — must be AFTER API routes so /api/* wins.
app.mount("/js", StaticFiles(directory=_STATIC_DIR / "js"), name="js")
app.mount("/", StaticFiles(directory=_STATIC_DIR), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
