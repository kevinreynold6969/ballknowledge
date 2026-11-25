import sys
from pathlib import Path

# Ensure root directory is on Python path
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


def test_accent_insensitive_search():
    """Verify that searching with or without accents finds players like Mbappé and Ødegaard."""
    # Test 'mbappe' vs 'Mbappé'
    res_plain = client.get("/api/players?name=mbappe&limit=10").json()
    assert len(res_plain) > 0, "Expected at least one result for 'mbappe'"
    assert any("Mbappé" in p["player"] for p in res_plain), "Search for 'mbappe' should find Mbappé"

    res_accent = client.get("/api/players?name=Mbappé&limit=10").json()
    assert len(res_accent) > 0, "Expected at least one result for 'Mbappé'"

    # Test 'odegaard' vs 'Ødegaard'
    res_odegaard = client.get("/api/players?name=odegaard&limit=10").json()
    assert len(res_odegaard) > 0, "Expected at least one result for 'odegaard'"
    assert any("Ødegaard" in p["player"] for p in res_odegaard), "Search for 'odegaard' should find Ødegaard"


def test_league_filter_variants():
    """Verify that the league filter is forgiving across case, spaces, and dashes."""
    r_slug = client.get("/api/players?league=laliga&limit=10").json()
    r_spaced = client.get("/api/players?league=La%20Liga&limit=10").json()
    r_canonical = client.get("/api/players?league=ESP-La%20Liga&limit=10").json()

    assert len(r_slug) > 0, "Expected results for 'laliga'"
    assert len(r_slug) == len(r_spaced) == len(r_canonical), "All La Liga filter variants should return identical results"
    for p in r_slug:
        assert p["league"] == "ESP-La Liga"

    # Test Premier League variants
    r_epl1 = client.get("/api/players?league=premierleague&limit=10").json()
    r_epl2 = client.get("/api/players?league=Premier%20League&limit=10").json()
    assert len(r_epl1) == len(r_epl2)
    for p in r_epl1:
        assert p["league"] == "ENG-Premier League"


def test_role_filter_with_small_limit():
    """Verify that role filtering happens in SQL before LIMIT, returning the requested limit."""
    res = client.get("/api/players?role=Striker&limit=20").json()
    assert len(res) == 20, f"Expected 20 strikers, got {len(res)}"
    assert all(p["role"] == "Striker" for p in res), "All returned players must have role 'Striker'"

    # Check ordering by nineties desc
    for i in range(len(res) - 1):
        assert res[i]["nineties"] >= res[i + 1]["nineties"], "Results should be ordered by nineties descending"


def test_player_detail_and_404():
    """Verify that /api/players/{id} returns full data or 404 for missing IDs."""
    # Find a valid player ID first
    players = client.get("/api/players?limit=1").json()
    assert len(players) > 0
    valid_id = players[0]["id"]

    res_valid = client.get(f"/api/players/{valid_id}")
    assert res_valid.status_code == 200
    player_data = res_valid.json()
    assert player_data["id"] == valid_id
    assert "player" in player_data
    assert "role" in player_data

    # Test non-existent ID returns 404
    res_invalid = client.get("/api/players/999999")
    assert res_invalid.status_code == 404
    assert res_invalid.json()["detail"] == "Player not found"


def test_compare_across_different_seasons():
    """Verify that compare works across different seasons without dropping players."""
    # Get a 2024/25 player and a 2025/26 player
    p_2425 = client.get("/api/players?season=2024/25&limit=1").json()
    p_2526 = client.get("/api/players?season=2025/26&limit=1").json()

    assert len(p_2425) > 0 and len(p_2526) > 0
    id1 = p_2425[0]["id"]
    id2 = p_2526[0]["id"]

    res = client.get(f"/api/compare?ids={id1},{id2}")
    assert res.status_code == 200
    compared = res.json()
    assert len(compared) == 2
    seasons = {p["season_label"] for p in compared}
    assert "2024/25" in seasons
    assert "2025/26" in seasons


def test_compare_invalid_ids():
    """Verify that /api/compare rejects non-integers, empty IDs, or too many IDs."""
    # Non-integer IDs
    r_bad_text = client.get("/api/compare?ids=abc,xyz")
    assert r_bad_text.status_code == 400

    # Too many players (>4)
    r_too_many = client.get("/api/compare?ids=1,2,3,4,5")
    assert r_too_many.status_code == 400

    # No IDs
    r_empty = client.get("/api/compare?ids=")
    assert r_empty.status_code == 400


def test_missing_data_is_not_zero():
    """Verify that missing values remain null/None and are never coerced to 0."""
    # Retrieve players and check that players with null stats preserve null
    players = client.get("/api/players?include_low_minutes=true&limit=100").json()
    # Goalkeeper or player without attacking stats
    null_xg_found = any(p["us_xg"] is None for p in players)
    null_fifa_value_found = any(p["fifa_value_eur"] is None for p in players)
    assert null_xg_found or null_fifa_value_found, "Database must preserve NULLs as None, not 0"


def test_similar_players_endpoint():
    """Verify that the similar players endpoint uses cosine similarity on per-90 stats."""
    # Find a regular player with complete stats
    players = client.get("/api/players?role=Striker&season=2024/25&limit=5").json()
    target = None
    for p in players:
        if p["nineties"] and p["nineties"] >= 10:
            target = p
            break

    if target:
        res = client.get(f"/api/players/{target['id']}/similar?limit=5")
        assert res.status_code == 200
        data = res.json()
        assert data["player_id"] == target["id"]
        assert "similar" in data
        for s in data["similar"]:
            assert s["role"] == target["role"], "Similar players must share the same tactical role"
            assert s["season_label"] == target["season_label"], "Similar players must share the same season"
            assert s["nineties"] >= 10, "Similar players must have at least 10 nineties played"
            assert 0.0 <= s["similarity_pct"] <= 100.0, "Similarity percentage must be between 0 and 100"
