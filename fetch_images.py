"""
Fetch Wikipedia / Wikimedia images for players with nineties >= 5.

Features:
- Polite User-Agent and rate limiting.
- Resumable: reads existing data/player_images.json and only fetches missing players.
- Strict verification: checks that the Wikipedia page title matches the player name
  (ignoring accents and disambiguation) and that the page extract or description
  explicitly mentions football/footballer/soccer.
- Saves image_url, source_url, and verified_title to data/player_images.json.
"""

import concurrent.futures
import csv
import json
import random
import re
import sqlite3
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent
DATA_DIR = ROOT / "data"
IMAGES_FILE = DATA_DIR / "player_images.json"
USER_AGENT = "BallKnowledge/1.0 (educational sports analytics student project; https://github.com/ball-knowledge)"


def strip_accents(text: str) -> str:
    """Normalize text by stripping diacritics and converting to lowercase."""
    if not text:
        return ""
    replacements = {
        "ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "ß": "ss",
        "æ": "ae", "Æ": "AE", "œ": "oe", "’": "'", "´": "'"
    }
    text = str(text).translate(str.maketrans(replacements))
    normalized = unicodedata.normalize("NFKD", text)
    cleaned = "".join(c for c in normalized if not unicodedata.combining(c))
    return cleaned.lower().strip()


def normalize_title(title: str) -> str:
    """Remove disambiguation parentheses and normalize."""
    cleaned = re.sub(r"\s*\([^)]*\)", "", title).strip()
    return strip_accents(cleaned)


def is_footballer_page(page: dict) -> bool:
    """Verify that the page actually describes a footballer."""
    desc = page.get("description", "").lower()
    extract = page.get("extract", "")[:350].lower()
    combined = f"{desc} {extract}"
    keywords = ["footballer", "football player", "professional footballer", "soccer player", "association football", "football club"]
    return any(k in combined for k in keywords)


def title_matches_player(page_title: str, player_name: str) -> bool:
    """Verify the page title corresponds to the player's name."""
    norm_title = normalize_title(page_title)
    norm_player = strip_accents(player_name)
    if not norm_title or not norm_player:
        return False
    # Exact match
    if norm_title == norm_player:
        return True
    # Substring match (e.g. "Martin Odegaard" in "Martin Odegaard (footballer)" or full names)
    if norm_player in norm_title or norm_title in norm_player:
        return True
    # Compare parts (last name and first name)
    player_parts = set(norm_player.split())
    title_parts = set(norm_title.split())
    if player_parts and player_parts.issubset(title_parts):
        return True
    return False


def fetch_player_image(player_name: str) -> dict:
    """Search Wikipedia for the player and return verified image metadata."""
    encoded_query = urllib.parse.quote(f"{player_name} footballer")
    url = (
        f"https://en.wikipedia.org/w/api.php?action=query&generator=search"
        f"&gsrsearch={encoded_query}&gsrlimit=3"
        f"&prop=pageimages|extracts|description&exintro=1&explaintext=1"
        f"&piprop=thumbnail&pithumbsize=320&format=json"
    )
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=6) as response:
            data = json.loads(response.read().decode("utf-8"))
            pages = data.get("query", {}).get("pages", {})
            for page in pages.values():
                title = page.get("title", "")
                thumb = page.get("thumbnail", {}).get("source")
                if not thumb:
                    continue
                # Do not accept generic wiki logos or svg files
                if thumb.lower().endswith(".svg") or "disambig" in title.lower():
                    continue
                if is_footballer_page(page) and title_matches_player(title, player_name):
                    page_slug = urllib.parse.quote(title.replace(" ", "_"))
                    return {
                        "image_url": thumb,
                        "source_url": f"https://en.wikipedia.org/wiki/{page_slug}",
                        "verified_title": title,
                    }
    except Exception:
        pass
    return {"image_url": None, "source_url": None, "verified_title": None}


def get_qualifying_players() -> list[tuple[str, float]]:
    """Return distinct player names with nineties >= 5, sorted by nineties descending."""
    db_path = ROOT / "ballknowledge.db"
    if db_path.exists():
        conn = sqlite3.connect(db_path)
        rows = conn.execute(
            "SELECT player, MAX(nineties) as max_nineties FROM player_seasons WHERE nineties >= 5 GROUP BY player ORDER BY max_nineties DESC"
        ).fetchall()
        conn.close()
        return [(row[0], float(row[1] or 0)) for row in rows]

    # Fallback to CSV
    csv_path = DATA_DIR / "player_seasons.csv"
    players = {}
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for r in reader:
            p = r.get("player")
            try:
                n = float(r.get("nineties") or 0)
            except ValueError:
                n = 0.0
            if p and n >= 5:
                players[p] = max(players.get(p, 0.0), n)
    return sorted(players.items(), key=lambda x: x[1], reverse=True)


def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    images_data = {}
    if IMAGES_FILE.exists():
        try:
            with IMAGES_FILE.open("r", encoding="utf-8") as f:
                images_data = json.load(f)
        except Exception:
            images_data = {}

    qualifying = get_qualifying_players()
    print(f"Total qualifying players (nineties >= 5): {len(qualifying)}")

    to_fetch = [p for p, _ in qualifying if p not in images_data]
    print(f"Already cached: {len(qualifying) - len(to_fetch)} | To fetch: {len(to_fetch)}")

    if to_fetch:
        batch_size = 30
        completed = 0
        total_to_fetch = len(to_fetch)

        # Worker function with delay
        def worker(p):
            time.sleep(0.05)
            res = fetch_player_image(p)
            return p, res

        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as executor:
            futures = [executor.submit(worker, p) for p in to_fetch]
            for future in concurrent.futures.as_completed(futures):
                p, res = future.result()
                images_data[p] = res
                completed += 1
                if completed % batch_size == 0 or completed == total_to_fetch:
                    print(f"Progress: {completed}/{total_to_fetch} players processed ({(completed / total_to_fetch) * 100:.1f}%)")
                    with IMAGES_FILE.open("w", encoding="utf-8") as f:
                        json.dump(images_data, f, indent=2, ensure_ascii=False)

    # Final save
    with IMAGES_FILE.open("w", encoding="utf-8") as f:
        json.dump(images_data, f, indent=2, ensure_ascii=False)

    found_photos = [k for k, v in images_data.items() if v.get("image_url")]
    print(f"\nCompleted image fetching!")
    print(f"Total players in cache: {len(images_data)}")
    print(f"Players with verified photos: {len(found_photos)} ({(len(found_photos) / max(len(images_data), 1)) * 100:.1f}%)")

    # Sample 10 random matches to display
    if found_photos:
        sample_size = min(10, len(found_photos))
        sample = random.sample(found_photos, sample_size)
        print("\n--- 10 RANDOM VERIFIED PLAYER PHOTO MATCHES ---")
        for p in sample:
            info = images_data[p]
            print(f"- {p} -> {info['verified_title']}")
            print(f"  Photo: {info['image_url']}")
            print(f"  Source: {info['source_url']}")


if __name__ == "__main__":
    main()
