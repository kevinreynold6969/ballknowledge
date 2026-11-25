import math
import re
import sqlite3
import unicodedata
from pathlib import Path
from typing import Optional

import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
app = FastAPI(title="Ball Knowledge")
app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")

KNOWN_LEAGUES = [
    "ENG-Premier League",
    "ESP-La Liga",
    "FRA-Ligue 1",
    "GER-Bundesliga",
    "ITA-Serie A",
]

# Forgiving lookup map for common league aliases
LEAGUE_ALIASES = {
    "premierleague": "ENG-Premier League",
    "engpremierleague": "ENG-Premier League",
    "epl": "ENG-Premier League",
    "premier": "ENG-Premier League",
    "laliga": "ESP-La Liga",
    "esplaliga": "ESP-La Liga",
    "liga": "ESP-La Liga",
    "ligue1": "FRA-Ligue 1",
    "fraligue1": "FRA-Ligue 1",
    "ligue": "FRA-Ligue 1",
    "bundesliga": "GER-Bundesliga",
    "gerbundesliga": "GER-Bundesliga",
    "seriea": "ITA-Serie A",
    "itaseriea": "ITA-Serie A",
}

ROLES = ["GK", "Centre-back", "Full-back", "DM", "CM", "AM", "Winger", "Striker", "Other"]

# Per-90 stats used for stylistic cosine similarity comparison
SIMILARITY_METRICS = [
    "np_xg_p90",
    "xa_p90",
    "key_passes_p90",
    "shots_p90",
    "tackles_won_p90",
    "interceptions_p90",
]


def strip_accents(text: str) -> str:
    """Normalize text by stripping accents and special diacritics."""
    if not text:
        return ""
    replacements = {
        "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "ß": "ss",
        "æ": "ae", "Æ": "AE", "œ": "oe", "’": "'", "´": "'"
    }
    text = str(text).translate(str.maketrans(replacements))
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower().strip()


def normalize_league_input(league_input: str) -> Optional[str]:
    """
    Forgiving league matcher:
    Matches 'laliga', 'La Liga', 'ESP-La Liga', 'Premier League', 'epl', etc.
    Ignores case, spaces, and dashes.
    """
    if not league_input or not league_input.strip():
        return None
    cleaned = re.sub(r"[^a-zA-Z0-9]", "", league_input.lower())
    if cleaned in LEAGUE_ALIASES:
        return LEAGUE_ALIASES[cleaned]
    # Check if cleaned input is a substring of any known league cleaned name
    for known in KNOWN_LEAGUES:
        known_cleaned = re.sub(r"[^a-zA-Z0-9]", "", known.lower())
        if cleaned in known_cleaned or known_cleaned in cleaned:
            return known
    return league_input.strip()


def get_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(ROOT / "ballknowledge.db")
    conn.row_factory = sqlite3.Row
    return conn


@app.get("/")
def home():
    """Serve the main player directory page."""
    return FileResponse(ROOT / "templates" / "index.html")


@app.get("/compare")
def compare_page():
    """Serve the player comparison page."""
    return FileResponse(ROOT / "templates" / "compare.html")


@app.get("/player/{player_id}")
def player_profile_page(player_id: int):
    """Serve the individual player profile page."""
    conn = get_connection()
    row = conn.execute("SELECT id FROM player_seasons WHERE id = ?", (player_id,)).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return FileResponse(ROOT / "templates" / "player.html")


@app.get("/api/meta")
def metadata():
    """Return available leagues, seasons, and scouting roles."""
    conn = get_connection()
    leagues = [row[0] for row in conn.execute("SELECT DISTINCT league FROM player_seasons WHERE league IS NOT NULL ORDER BY league")]
    seasons = [row[0] for row in conn.execute("SELECT DISTINCT season_label FROM player_seasons WHERE season_label IS NOT NULL ORDER BY season_label DESC")]
    conn.close()
    return {
        "leagues": leagues,
        "seasons": seasons,
        "roles": ROLES,
    }


@app.get("/api/players")
def search_players(
    name: str = "",
    league: Optional[str] = None,
    pos: Optional[str] = None,
    role: Optional[str] = None,
    season: Optional[str] = None,
    include_low_minutes: bool = False,
    limit: int = Query(default=60, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
):
    """
    Search players with combined filters.
    - Accent-insensitive search using player_search column.
    - Forgiving league matching.
    - Database-level role filtering.
    - Ordered by minutes played (nineties) descending.
    - By default, hides low-minutes players (<5 nineties) unless include_low_minutes=True.
    """
    query = "SELECT * FROM player_seasons WHERE 1=1"
    params = []

    if name.strip():
        clean_name = strip_accents(name)
        query += " AND player_search LIKE ?"
        params.append(f"%{clean_name}%")

    if league and league.strip():
        canonical_league = normalize_league_input(league)
        if canonical_league:
            query += " AND league = ?"
            params.append(canonical_league)

    if pos and pos.strip():
        query += " AND pos LIKE ?"
        params.append(f"%{pos.strip().upper()}%")

    if role and role.strip():
        query += " AND role = ?"
        params.append(role.strip())

    if season and season.strip():
        query += " AND season_label = ?"
        params.append(season.strip())

    if not include_low_minutes:
        query += " AND nineties >= 5"

    query += " ORDER BY nineties DESC NULLS LAST, player ASC LIMIT ? OFFSET ?"
    params.extend([limit, offset])

    conn = get_connection()
    rows = conn.execute(query, params).fetchall()
    conn.close()

    return [dict(row) for row in rows]


@app.get("/api/players/{player_id}")
def get_player(player_id: int):
    """Return complete details for a single player season."""
    conn = get_connection()
    row = conn.execute("SELECT * FROM player_seasons WHERE id = ?", (player_id,)).fetchone()
    conn.close()

    if row is None:
        raise HTTPException(status_code=404, detail="Player not found")
    return dict(row)


@app.get("/api/compare")
def compare_players(ids: str):
    """
    Return data for 1 to 4 players by ID across any season.
    Preserves the order of requested IDs.
    """
    try:
        player_ids = [int(v.strip()) for v in ids.split(",") if v.strip()]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="ids must be comma-separated integers") from exc

    if not 1 <= len(player_ids) <= 4:
        raise HTTPException(status_code=400, detail="Choose between 1 and 4 players to compare")

    placeholders = ",".join("?" for _ in player_ids)
    conn = get_connection()
    rows = conn.execute(f"SELECT * FROM player_seasons WHERE id IN ({placeholders})", player_ids).fetchall()
    conn.close()

    by_id = {row["id"]: dict(row) for row in rows}
    # Return in the exact order requested
    return [by_id[pid] for pid in player_ids if pid in by_id]


@app.get("/api/players/{player_id}/similar")
def get_similar_players(player_id: int, limit: int = 5):
    """
    Find the top 5 most similar players using cosine similarity on per-90 stats.
    Rules:
    - Same tactical role and same season.
    - Only players with nineties >= 10.
    - Only players with complete (non-NULL) metrics across all comparison features.
    - Never fills missing values with 0.
    - Uses NumPy for vector calculations (no scikit-learn).
    """
    conn = get_connection()
    target_row = conn.execute("SELECT * FROM player_seasons WHERE id = ?", (player_id,)).fetchone()
    if target_row is None:
        conn.close()
        raise HTTPException(status_code=404, detail="Player not found")

    target = dict(target_row)

    # Check if target player has all required similarity metrics
    target_values = [target.get(m) for m in SIMILARITY_METRICS]
    if any(v is None or not math.isfinite(v) for v in target_values):
        conn.close()
        return {
            "player_id": player_id,
            "player": target["player"],
            "role": target["role"],
            "season": target["season_label"],
            "similar": [],
            "message": "Player has incomplete per-90 metrics for stylistic similarity profiling.",
        }

    target_vec = np.array(target_values, dtype=float)
    target_norm = np.linalg.norm(target_vec)
    if target_norm == 0:
        conn.close()
        return {
            "player_id": player_id,
            "player": target["player"],
            "role": target["role"],
            "season": target["season_label"],
            "similar": [],
            "message": "Player per-90 metric vector has zero magnitude.",
        }

    # Query candidate pool: same role, same season, nineties >= 10, other players
    columns_str = ", ".join(f'"{m}"' for m in SIMILARITY_METRICS)
    metric_conditions = " AND ".join(f'"{m}" IS NOT NULL' for m in SIMILARITY_METRICS)
    cand_query = f"""
        SELECT id, player, team, league, season_label, role, nineties, fifa_overall_rating, image_url, {columns_str}
        FROM player_seasons
        WHERE role = ?
          AND season_label = ?
          AND nineties >= 10
          AND id != ?
          AND {metric_conditions}
    """
    cand_rows = conn.execute(cand_query, (target["role"], target["season_label"], player_id)).fetchall()
    conn.close()

    candidates = [dict(r) for r in cand_rows]
    if not candidates:
        return {
            "player_id": player_id,
            "player": target["player"],
            "role": target["role"],
            "season": target["season_label"],
            "similar": [],
            "message": "No qualifying players found with identical role, season, and sufficient minutes.",
        }

    # Calculate cosine similarity for each candidate
    scored = []
    for cand in candidates:
        cand_vec = np.array([cand[m] for m in SIMILARITY_METRICS], dtype=float)
        cand_norm = np.linalg.norm(cand_vec)
        if cand_norm == 0:
            continue
        # Cosine similarity: (u . v) / (||u|| * ||v||)
        similarity = float(np.dot(target_vec, cand_vec) / (target_norm * cand_norm))
        # Ensure clamped to [-1.0, 1.0] for precision safety
        similarity = max(-1.0, min(1.0, similarity))

        scored.append({
            "id": cand["id"],
            "player": cand["player"],
            "team": cand["team"],
            "league": cand["league"],
            "season_label": cand["season_label"],
            "role": cand["role"],
            "nineties": cand["nineties"],
            "fifa_overall_rating": cand["fifa_overall_rating"],
            "image_url": cand["image_url"],
            "similarity_pct": round(similarity * 100, 1),
        })

    # Sort descending by similarity
    scored.sort(key=lambda x: x["similarity_pct"], reverse=True)
    top_similar = scored[:limit]

    return {
        "player_id": player_id,
        "player": target["player"],
        "role": target["role"],
        "season": target["season_label"],
        "similar": top_similar,
        "metrics_used": SIMILARITY_METRICS,
        "explanation": "Stylistic similarity calculated via cosine similarity on per-90 metrics. This measures playing style, not overall ability.",
    }


@app.get("/api/player-image")
def player_image_fallback(name: str = "", player_id: Optional[int] = None):
    """
    Safe fallback: returns pre-stored image from SQLite database if available.
    Does NOT fetch live or overwrite with wrong images.
    """
    if player_id:
        conn = get_connection()
        row = conn.execute("SELECT image_url FROM player_seasons WHERE id = ?", (player_id,)).fetchone()
        conn.close()
        if row and row["image_url"]:
            return {"url": row["image_url"]}
    return {"url": None}
