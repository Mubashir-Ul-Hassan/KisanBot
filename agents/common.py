"""Helpers shared by all agents: prompt loading and season/month naming."""

import os
from datetime import datetime
from functools import lru_cache

PROMPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "prompts")


@lru_cache(maxsize=None)
def load_prompt(name: str) -> str:
    """Load agents/prompts/<name>.txt (kept in its own file so each agent's
    system prompt can be edited independently — Section 8)."""
    with open(os.path.join(PROMPT_DIR, f"{name}.txt"), "r", encoding="utf-8") as f:
        return f.read()


def current_season() -> str:
    m = datetime.now().month
    if m in (10, 11, 12, 1, 2):
        return "rabi"
    if m in (5, 6, 7, 8, 9):
        return "kharif"
    return "zaid"


def season_names(season: str):
    names = {
        "rabi": ("Rabi (winter)", "ربیع (سردیوں کی فصل)"),
        "kharif": ("Kharif (summer)", "خریف (گرمیوں کی فصل)"),
        "zaid": ("Zaid (spring)", "زائد (بہار کی فصل)"),
    }
    return names.get(season, (season, season))


def month_name(lang: str = "en") -> str:
    m = datetime.now().month
    en = ["", "January", "February", "March", "April", "May", "June", "July",
          "August", "September", "October", "November", "December"]
    ur = ["", "جنوری", "فروری", "مارچ", "اپریل", "مئی", "جون", "جولائی",
          "اگست", "ستمبر", "اکتوبر", "نومبر", "دسمبر"]
    return ur[m] if lang == "ur" else en[m]
