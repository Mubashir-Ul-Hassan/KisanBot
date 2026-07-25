# KisanBot — Multi-Agent Farm Advisory (architecture)

An Urdu-speaking advisory assistant for small-scale Pakistani farmers, powered by
a small team of cooperating specialist agents. Refactored from a monolithic /
simulated-multi-agent build into a real orchestrator + specialists that are
grounded in real data and honest about uncertainty.

## The persona

The assistant introduces itself to the farmer as **"ساتھی" (Saathi)** — a warm,
simple, trustworthy companion name chosen to avoid collision with existing
Pakistani agri-apps (e.g. "Zarai Mandi", "Kissan Dost").

## Flow

```
Farmer (text / voice / photo)
        │
        ▼
  Orchestrator ("Saathi")  ── classify intent, ask ONE clarifying question if needed
        │  (routes; never answers agri questions from its own knowledge)
        ├──────────────┬────────────────┬─────────────────┬───────────────┐
        ▼              ▼                ▼                 ▼               ▼
   Weather        Crop Rec.       Crop Protection    Image Diagnosis   Market
   agent          agent           agent              agent (vision)    agent
   │              │  ▲            ▲                   │                 │
   │ Google       │  │ soil+wx    │ pesticide screen  │ hands diagnosis │ reference
   │ Weather+Geo  │  │            │ + disclaimer      └───► to Crop      │ prices
   ▼              ▼  │            ▼                        Protection    ▼
        └──────────────┴──── Orchestrator composes ONE Urdu reply ──────┘
```

## Layout (Section 8 of the spec)

```
agents/
  orchestrator.py        # holds conversation, classifies, routes, composes Urdu reply
  weather.py             # geocode -> Google Weather -> farming implication
  crop_recommendation.py # grounded in retrieved soil + weather for THIS location
  crop_protection.py     # pest/disease/pesticide; cultural-first; banned-list screen
  image_diagnosis.py     # Gemini vision; explicit confidence; hands off to protection
  market.py              # approximate reference prices (honest, labelled)
  common.py              # prompt loading + season helpers
  prompts/*.txt          # each agent's system prompt in its own editable file
services/
  llm_client.py          # thin, swappable LLM interface (Gemini today)
  geocoding.py           # Google Geocoding + regions.json fallback
  weather_api.py         # Google Weather API (current + forecast)
  soil.py                # cache-first ISRIC SoilGrids (never live per request)
  pesticide.py           # banned-list screening + disclaimer (curated reference)
  session.py             # shared session state (no repeated questions)
  logging_util.py        # records agent + data source per answer (traceability)
  datastore.py           # loads bundled JSON knowledge base
scripts/prefetch_soil.py # builds data/soil_cache.json occasionally (rate-limited)
tests/scenarios.py       # 10+ routing scenarios + safety checks (no key needed)
server.py                # thin FastAPI: /api/chat, /api/diagnose, /api/health, /api/trace
```

## Running

```bash
pip install -r requirements.txt
cp .env.example .env         # fill in GEMINI_API_KEY and GOOGLE_MAPS_API_KEY
python scripts/prefetch_soil.py   # once, to populate soil cache (optional but recommended)
python server.py             # serves on :8000
# then open index.html (Settings ⚙️ -> AI mode is the default; enter your Gemini key)
python tests/scenarios.py    # runs the Definition-of-Done routing/safety checks
```

## Non-hallucination / trust guarantees (Section 6)

- **No fabricated data.** The old `calculate_satellite_data()` (random-seed NDVI)
  and month-hardcoded weather were removed. Every substantive answer is grounded
  in a real tool result or clearly marked "unavailable".
- **Honest failures.** If weather/soil/geocoding is unavailable, the agent says so
  in Urdu and points to a human, instead of guessing.
- **Ask, don't assume.** Missing location/crop/symptom → one clarifying question.
- **Confidence stated** for diagnosis answers; low confidence + high-stakes advice
  triggers a "confirm with your agriculture officer / helpline" nudge.
- **Pesticide safety.** Cultural controls first; the banned list is screened and
  stripped; a disclaimer is always attached; no invented brand or dose.
- **Traceability.** `services/logging_util` records which agent + which sources
  produced each answer; see `GET /api/trace`.

## ⚠️ Items that need the developer's sign-off before production

1. **Pesticide list** — `data/pesticide_reference.json` is a *curated* safety net,
   NOT DPP's authoritative live list (published only as PDFs; DPP is being
   reorganized). Verify and keep it current against the official source.
2. **Helpline number** — `data/helpline.json` ships an example (Punjab Agriculture
   Helpline). Verify and localize per your users' province.
3. **Market prices** — v1 serves approximate reference ranges only. A real feed
   needs a Zarai Mandi / PAR data partnership (Section 4.7).
4. **Voice** — v1 uses the browser Web Speech API (`ur-PK`). Google Cloud STT /
   Azure neural Urdu TTS are the recommended upgrade; the code keeps this swappable.
5. **API keys** — never hardcoded; env vars only. Google AI weather can be less
   precise in sparse-station rural areas — spot-check before fully trusting it.
6. **Urdu wording** — have a native speaker review agent prompt tone before shipping.
```
