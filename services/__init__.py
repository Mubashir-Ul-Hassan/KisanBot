"""Shared service layer for KisanBot: LLM client, external data APIs, session, logging.

Every external call in this package degrades gracefully: on failure it returns a
structured "unavailable" result instead of raising, so the agents can tell the
farmer honestly that data is missing rather than inventing it.
"""
