"""
Lucide Icon Catalog & Fast In-Memory Search Engine.

Provides instant (<0.5ms) semantic and fuzzy search across Lucide icons
for the AI generation pipeline, the pywebview ApiBridge, and the local file server.
"""

from typing import List, Dict, Any
import re

# Comprehensive Lucide icon catalog with categories and semantic search synonyms
LUCIDE_ICONS: List[Dict[str, Any]] = [
    # Finance, Economy, Crypto & Growth
    {"name": "trending-up", "category": "finance", "tags": ["growth", "profit", "bull", "stock", "increase", "rise", "market", "success", "chart", "metrics"]},
    {"name": "trending-down", "category": "finance", "tags": ["loss", "drop", "bear", "crash", "decrease", "fall", "decline", "recession", "bankruptcy"]},
    {"name": "dollar-sign", "category": "finance", "tags": ["money", "currency", "cash", "wealth", "usd", "cost", "price", "revenue", "capital"]},
    {"name": "coins", "category": "finance", "tags": ["crypto", "tokens", "gold", "change", "savings", "investment", "bitcoin"]},
    {"name": "wallet", "category": "finance", "tags": ["money", "funds", "balance", "crypto-wallet", "payment", "bank"]},
    {"name": "banknote", "category": "finance", "tags": ["cash", "paper-money", "currency", "bill", "payment"]},
    {"name": "landmark", "category": "finance", "tags": ["bank", "institution", "federal", "government", "treasury", "central-bank"]},
    {"name": "credit-card", "category": "finance", "tags": ["payment", "visa", "mastercard", "charge", "debit", "transaction", "swipe"]},
    {"name": "scale", "category": "finance", "tags": ["balance", "justice", "law", "comparison", "weigh", "equality", "court"]},
    {"name": "piggy-bank", "category": "finance", "tags": ["savings", "deposit", "investment", "accumulate"]},
    {"name": "percent", "category": "finance", "tags": ["percentage", "discount", "interest", "rate", "inflation", "tax"]},
    {"name": "receipt", "category": "finance", "tags": ["bill", "invoice", "proof", "accounting", "statement"]},

    # Security, Law, Defense & Investigation
    {"name": "shield-alert", "category": "security", "tags": ["threat", "breach", "warning", "cyberattack", "danger", "vulnerability", "hack"]},
    {"name": "shield-check", "category": "security", "tags": ["safe", "verified", "protected", "secure", "passed", "compliance"]},
    {"name": "shield", "category": "security", "tags": ["armor", "defense", "protection", "guard", "security"]},
    {"name": "lock", "category": "security", "tags": ["private", "encrypted", "confidential", "secure", "locked", "classified"]},
    {"name": "unlock", "category": "security", "tags": ["leak", "decrypted", "exposed", "open", "unlocked", "breached"]},
    {"name": "key", "category": "security", "tags": ["access", "credential", "auth", "crypto-key", "secret", "password"]},
    {"name": "fingerprint", "category": "security", "tags": ["biometrics", "identity", "forensics", "evidence", "dna"]},
    {"name": "gavel", "category": "law", "tags": ["court", "judge", "ruling", "lawsuit", "verdict", "trial", "legal", "justice"]},
    {"name": "siren", "category": "security", "tags": ["police", "alarm", "emergency", "raid", "alert", "danger"]},
    {"name": "skull", "category": "danger", "tags": ["fatal", "toxic", "poison", "lethal", "piracy", "death", "danger"]},
    {"name": "flame", "category": "danger", "tags": ["fire", "burn", "destruction", "hot", "trending", "crisis"]},
    {"name": "bomb", "category": "danger", "tags": ["explosion", "blast", "attack", "terror", "critical"]},
    {"name": "biohazard", "category": "danger", "tags": ["virus", "pathogen", "biological", "infection", "epidemic"]},
    {"name": "radiation", "category": "danger", "tags": ["nuclear", "atomic", "fallout", "reactor", "radioactive"]},

    # Tech, Data, Cloud & Engineering
    {"name": "database", "category": "tech", "tags": ["storage", "data", "records", "sql", "warehouse", "leak", "archive"]},
    {"name": "server", "category": "tech", "tags": ["infrastructure", "datacenter", "hosting", "cloud", "backend", "hardware"]},
    {"name": "cpu", "category": "tech", "tags": ["processor", "chip", "semiconductor", "silicon", "hardware", "ai-chip", "nvidia"]},
    {"name": "code", "category": "tech", "tags": ["software", "programming", "developer", "script", "algorithm", "source"]},
    {"name": "terminal", "category": "tech", "tags": ["cli", "console", "command", "bash", "hack", "prompt"]},
    {"name": "globe", "category": "tech", "tags": ["world", "global", "internet", "network", "worldwide", "earth", "international"]},
    {"name": "wifi", "category": "tech", "tags": ["wireless", "signal", "internet", "broadband", "connectivity"]},
    {"name": "radio", "category": "tech", "tags": ["broadcast", "frequency", "telecom", "signal", "transmission"]},
    {"name": "cable", "category": "tech", "tags": ["wire", "fiber", "submarine", "optical", "connection", "infrastructure"]},
    {"name": "activity", "category": "tech", "tags": ["pulse", "heartbeat", "monitoring", "traffic", "telemetry", "frequency"]},
    {"name": "zap", "category": "tech", "tags": ["electricity", "power", "energy", "instant", "lightning", "speed", "fast"]},
    {"name": "bot", "category": "tech", "tags": ["ai", "robot", "automation", "llm", "agent", "synthetic"]},
    {"name": "binary", "category": "tech", "tags": ["data", "bits", "code", "digital", "machine"]},

    # Geography, Maritime & Logistics
    {"name": "map-pin", "category": "geo", "tags": ["location", "place", "city", "target", "coordinate", "gps", "destination"]},
    {"name": "navigation", "category": "geo", "tags": ["route", "compass", "direction", "gps", "travel", "waypoint"]},
    {"name": "compass", "category": "geo", "tags": ["direction", "orientation", "north", "maritime", "navigation"]},
    {"name": "anchor", "category": "geo", "tags": ["ship", "ocean", "maritime", "seabed", "port", "vessel", "naval"]},
    {"name": "ship", "category": "geo", "tags": ["vessel", "cargo", "tanker", "container", "freight", "maritime", "ocean"]},
    {"name": "plane", "category": "geo", "tags": ["flight", "aviation", "travel", "international", "airline", "transport"]},
    {"name": "truck", "category": "logistics", "tags": ["transport", "delivery", "shipping", "supply-chain", "cargo"]},
    {"name": "package", "category": "logistics", "tags": ["box", "cargo", "goods", "shipping", "container", "delivery"]},
    {"name": "container", "category": "logistics", "tags": ["freight", "intermodal", "shipping", "trade", "cargo"]},

    # Media, Document & Journalism
    {"name": "file-text", "category": "media", "tags": ["document", "memo", "report", "paper", "contract", "dossier", "leak"]},
    {"name": "folder", "category": "media", "tags": ["directory", "classified", "archive", "collection", "files"]},
    {"name": "newspaper", "category": "media", "tags": ["press", "journalism", "headline", "news", "investigation", "article"]},
    {"name": "camera", "category": "media", "tags": ["photo", "footage", "surveillance", "evidence", "record", "lens"]},
    {"name": "video", "category": "media", "tags": ["film", "clip", "footage", "broadcast", "stream", "cctv"]},
    {"name": "mic", "category": "media", "tags": ["audio", "voice", "podcast", "interview", "wiretap", "recording"]},
    {"name": "eye", "category": "media", "tags": ["surveillance", "vision", "watch", "view", "witness", "look", "spy"]},
    {"name": "eye-off", "category": "media", "tags": ["covert", "hidden", "secret", "invisible", "blindspot", "censored"]},
    {"name": "sparkles", "category": "media", "tags": ["ai", "magic", "highlight", "new", "special", "effect", "clean"]},

    # Alerts, Status & General Icons
    {"name": "alert-triangle", "category": "status", "tags": ["warning", "caution", "alert", "issue", "problem", "danger"]},
    {"name": "alert-circle", "category": "status", "tags": ["error", "info", "notice", "attention", "alert"]},
    {"name": "alert-octagon", "category": "status", "tags": ["stop", "critical", "halt", "emergency", "danger"]},
    {"name": "check-circle", "category": "status", "tags": ["success", "approved", "verified", "done", "resolved", "completed"]},
    {"name": "check", "category": "status", "tags": ["tick", "confirm", "yes", "correct", "true"]},
    {"name": "x-circle", "category": "status", "tags": ["error", "fail", "rejected", "cancel", "wrong", "denied"]},
    {"name": "clock", "category": "status", "tags": ["time", "delay", "history", "duration", "timeline", "schedule", "chronological"]},
    {"name": "calendar", "category": "status", "tags": ["date", "year", "event", "milestone", "schedule"]},
    {"name": "target", "category": "status", "tags": ["goal", "objective", "aim", "crosshair", "hit", "mission"]},
    {"name": "crosshair", "category": "status", "tags": ["aim", "focus", "sniper", "locate", "target", "tracking"]},
    {"name": "award", "category": "status", "tags": ["trophy", "prize", "medal", "achievement", "victory", "winner"]},
    {"name": "briefcase", "category": "business", "tags": ["business", "corporate", "executive", "job", "company", "career"]},
    {"name": "building", "category": "business", "tags": ["headquarters", "company", "corporation", "office", "bank", "firm"]},
    {"name": "users", "category": "social", "tags": ["people", "crowd", "population", "team", "network", "community", "public"]},
    {"name": "user", "category": "social", "tags": ["person", "individual", "ceo", "whistleblower", "founder", "suspect"]},
    {"name": "search", "category": "ui", "tags": ["find", "investigate", "explore", "query", "lookup", "zoom", "magnifier"]},
    {"name": "layers", "category": "ui", "tags": ["stack", "depth", "composite", "structure", "multi-layer", "hierarchy"]},
    {"name": "refresh-cw", "category": "ui", "tags": ["sync", "reload", "update", "loop", "cycle", "rotate"]},
    {"name": "arrow-up-right", "category": "ui", "tags": ["external", "growth", "jump", "link", "surge"]},
    {"name": "arrow-down-right", "category": "ui", "tags": ["drop", "plunge", "collapse", "decline"]},
    {"name": "help-circle", "category": "ui", "tags": ["question", "mystery", "unsolved", "inquiry", "doubt"]},
]


def search_lucide_icons(query: str, limit: int = 8) -> List[Dict[str, Any]]:
    """
    Lightning-fast semantic and keyword search across the Lucide icon catalog.

    Args:
        query: Search string (e.g. "profit", "security", "dollar", "cyberattack", "ocean")
        limit: Max number of icon candidates to return (default 8)

    Returns:
        List of matching icon objects ordered by relevance score.
    """
    try:
        limit = max(1, int(limit))
    except (ValueError, TypeError):
        limit = 8

    if not query or not query.strip():
        # Return popular default motion graphic icons if query empty
        return LUCIDE_ICONS[:limit]

    cleaned_query = query.lower().strip()
    query_tokens = re.split(r"[\s\-_,]+", cleaned_query)
    query_tokens = [t for t in query_tokens if len(t) > 1] or [cleaned_query]

    matches = []

    for icon in LUCIDE_ICONS:
        name = icon["name"]
        tags = icon.get("tags", [])
        category = icon.get("category", "")

        score = 0
        name_tokens = name.split("-")

        # 1. Exact name match gets highest score
        if cleaned_query == name:
            score += 150
        elif cleaned_query in name:
            score += 80

        # 2. Token match on icon name
        for q_tok in query_tokens:
            if q_tok in name_tokens:
                score += 50
            elif any(q_tok in n_tok for n_tok in name_tokens):
                score += 30

        # 3. Token match on tags and synonyms
        for q_tok in query_tokens:
            for tag in tags:
                if q_tok == tag:
                    score += 40
                elif q_tok in tag or tag in q_tok:
                    score += 20

        # 4. Category match
        if any(q_tok == category for q_tok in query_tokens):
            score += 25

        if score > 0:
            matches.append({
                "name": name,
                "category": category,
                "tags": tags,
                "score": score
            })

    # Sort descending by score
    matches.sort(key=lambda x: x["score"], reverse=True)

    # Return top matches
    results = matches[:limit]

    # If no matches found, fallback to top standard icons
    if not results:
        return LUCIDE_ICONS[:min(limit, 4)]

    return results


def get_icon_names() -> List[str]:
    """Returns a list of all registered Lucide icon names."""
    return [icon["name"] for icon in LUCIDE_ICONS]
