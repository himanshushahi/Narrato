import pytest
from backend.pipeline.icons import search_lucide_icons, get_icon_names
from backend.core.bridge import api_bridge

def test_exact_icon_search():
    res = search_lucide_icons("shield-alert", limit=5)
    assert len(res) > 0
    assert res[0]["name"] == "shield-alert"
    assert res[0]["category"] == "security"

def test_conceptual_semantic_search():
    # Searching "profit" should rank trending-up or dollar-sign or coins high
    res = search_lucide_icons("profit", limit=5)
    names = [r["name"] for r in res]
    assert "trending-up" in names or "dollar-sign" in names or "coins" in names

    # Searching "cyberattack" or "hack" should return security / threat icons
    res_sec = search_lucide_icons("cyberattack", limit=5)
    names_sec = [r["name"] for r in res_sec]
    assert any("shield" in n or "lock" in n or "terminal" in n for n in names_sec)

    # Searching "court" should return gavel or scale
    res_law = search_lucide_icons("court", limit=5)
    names_law = [r["name"] for r in res_law]
    assert "gavel" in names_law or "scale" in names_law

def test_empty_query_returns_defaults():
    res = search_lucide_icons("", limit=6)
    assert len(res) == 6
    assert isinstance(res[0]["name"], str)

def test_nonexistent_query_fallback():
    res = search_lucide_icons("xyz123nonexistentword999", limit=4)
    assert len(res) > 0
    assert "name" in res[0]

def test_bridge_search_lucide_icons():
    res = api_bridge.search_lucide_icons("growth", limit=5)
    assert res.get("success") is True
    assert isinstance(res.get("data"), list)
    assert len(res["data"]) > 0
