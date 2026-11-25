import csv
import json
import math
import sqlite3
import unicodedata
from pathlib import Path

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"

columns = [
    "player", "team", "league", "season_label", "nation", "pos", "age", "born", "nineties", "playing_time_mp", "playing_time_min",
    "fb_gls", "fb_ast", "us_xg", "us_xa", "us_np_xg", "np_xg_p90", "xa_p90", "key_passes_p90", "shots_p90", "tackles_won_p90", "interceptions_p90",
    "ss_keyPasses", "ss_tackles", "ss_interceptions", "ss_clearances", "fifa_id", "fifa_overall_rating", "fifa_potential", "fifa_best_position",
    "fifa_pace", "fifa_face_shooting", "fifa_face_passing", "fifa_face_dribbling", "fifa_face_defending", "fifa_face_physical", "fifa_value_eur", "fifa_height", "fifa_foot",
]

numeric = {
    "age", "born", "nineties", "playing_time_mp", "playing_time_min",
    "fb_gls", "fb_ast", "us_xg", "us_xa", "us_np_xg",
    "np_xg_p90", "xa_p90", "key_passes_p90", "shots_p90", "tackles_won_p90", "interceptions_p90",
    "ss_keyPasses", "ss_tackles", "ss_interceptions", "ss_clearances",
    "fifa_id", "fifa_overall_rating", "fifa_potential",
    "fifa_pace", "fifa_face_shooting", "fifa_face_passing", "fifa_face_dribbling", "fifa_face_defending", "fifa_face_physical",
    "fifa_value_eur"
}


def cast(key: str, value: str):
    """Cast empty strings to None and numeric strings to floats."""
    if value is None or value == "":
        return None
    if key in numeric:
        try:
            number = float(value)
            return number if math.isfinite(number) else None
        except ValueError:
            return None
    return value.strip()


def strip_accents(text: str) -> str:
    """Normalize text by removing accents, special diacritics, and converting to lowercase."""
    if not text:
        return ""
    replacements = {
        "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "ß": "ss",
        "æ": "ae", "Æ": "AE", "œ": "oe", "’": "'", "´": "'"
    }
    text = str(text).translate(str.maketrans(replacements))
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower().strip()


def detailed_role(fifa_best_pos: str, broad_pos: str) -> str:
    """Compute scouting tactical role from FIFA best position and broad position."""
    position = (fifa_best_pos or "").upper().strip()
    broad = (broad_pos or "").upper().strip()

    if position == "GK" or broad == "GK":
        return "GK"
    if position in {"LB", "RB", "LWB", "RWB"}:
        return "Full-back"
    if position in {"CB", "LCB", "RCB"}:
        return "Centre-back"
    if position in {"CDM", "LDM", "RDM"}:
        return "DM"
    if position in {"CAM", "LAM", "RAM"}:
        return "AM"
    if position in {"CM", "LCM", "RCM"}:
        return "CM"
    if position in {"LW", "RW", "LM", "RM"}:
        return "Winger"
    if position in {"ST", "CF", "LS", "RS"}:
        return "Striker"
    if "DF" in broad:
        return "Centre-back"
    if "FW" in broad:
        return "Striker"
    return "CM" if "MF" in broad else "Other"


def build_database():
    csv_file = DATA_DIR / "player_seasons.csv"
    images_file = DATA_DIR / "player_images.json"

    images_cache = {}
    if images_file.exists():
        try:
            with images_file.open("r", encoding="utf-8") as f:
                images_cache = json.load(f)
        except Exception as e:
            print(f"Warning: could not read {images_file}: {e}")

    rows = []
    with csv_file.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        for index, row in enumerate(reader, 1):
            player_name = (row.get("player") or "").strip()
            fifa_pos = row.get("fifa_best_position") or ""
            broad_pos = row.get("pos") or ""
            role = detailed_role(fifa_pos, broad_pos)
            player_search = strip_accents(player_name)

            img_entry = images_cache.get(player_name, {})
            image_url = img_entry.get("image_url") if isinstance(img_entry, dict) else None
            source_url = img_entry.get("source_url") if isinstance(img_entry, dict) else None

            row_data = [index]
            for key in columns:
                row_data.append(cast(key, row.get(key, "")))
            row_data.append(role)
            row_data.append(player_search)
            row_data.append(image_url)
            row_data.append(source_url)
            rows.append(tuple(row_data))

    db_path = ROOT / "ballknowledge.db"
    conn = sqlite3.connect(db_path)
    conn.execute("DROP TABLE IF EXISTS player_seasons")

    field_sql = ", ".join([f'"{key}" REAL' if key in numeric else f'"{key}" TEXT' for key in columns])
    create_table_sql = (
        f'CREATE TABLE player_seasons ('
        f'id INTEGER PRIMARY KEY, '
        f'{field_sql}, '
        f'role TEXT, '
        f'player_search TEXT, '
        f'image_url TEXT, '
        f'image_source_url TEXT'
        f')'
    )
    conn.execute(create_table_sql)

    placeholders = ",".join("?" for _ in range(len(columns) + 5))
    conn.executemany(f"INSERT INTO player_seasons VALUES ({placeholders})", rows)

    # Create indexes for speed and efficiency
    conn.execute("CREATE INDEX IF NOT EXISTS idx_player_search ON player_seasons(player_search)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_league ON player_seasons(league)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_season ON player_seasons(season_label)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_role ON player_seasons(role)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_nineties ON player_seasons(nineties)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_player ON player_seasons(player)")

    conn.commit()
    conn.close()
    print(f"Loaded {len(rows)} player seasons into {db_path.name}")


if __name__ == "__main__":
    build_database()
