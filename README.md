# Ball Knowledge ⚽

**Ball Knowledge** is a football player scouting and comparison web application built with FastAPI, SQLite, and vanilla HTML/CSS/JavaScript. It enables objective, transparent head-to-head analysis of footballers across Europe's top 5 leagues (Premier League, La Liga, Serie A, Bundesliga, Ligue 1) across the 2024/25 and 2025/26 seasons.

---

## Why Ball Knowledge?

In football discussions and mainstream scouting tools, players are frequently reduced to a single video game rating or misleading raw totals. For example, a striker who scored 12 goals in 900 minutes (a goal every 75 minutes) might look worse on a spreadsheet than a striker who scored 14 goals playing 3,200 minutes.

**Ball Knowledge** was built to provide clarity:
- **Separates Aggregate Volume from Output Rate**: Clearly distinguishes between Season Totals (goals, assists, minutes) and Per-90 Metrics (expected goals, chance creation, defensive interventions).
- **Honest Missing Data**: Stats that were not tracked for a player appear strictly as `N/A`. They are *never* converted to zero, which prevents biased averages and misleading radar charts.
- **Game Ratings Labeled Truthfully**: Video game attributes (EA FC / SoFIFA) are explicitly labeled as *game ratings* and *game estimates*, never disguised as real transfer valuations.
- **Zero Heavy Frameworks**: Built using clean, understandable Python, SQLite, and vanilla JavaScript so every line of code can be explained simply.

---

## Data Source & Dataset Specifications

- **Source Dataset**: `data/player_seasons.csv` from the open-source repository [`m-mahadi/top5-football-dataset`](https://github.com/m-mahadi/top5-football-dataset).
- **Underlying Sources**: Integrates match feeds and advanced metrics from **FBref** (playing time, basic output), **Understat** (expected goals `xG`, expected assists `xA`), **SofaScore** (defensive clearances, tackles, key passes), and **EA FC / SoFIFA** (height, foot, game overall rating, game market estimate).
- **Coverage**: 5,693 player-season records across 2 seasons (`2024/25` and `2025/26`) and 5 leagues (`ENG-Premier League`, `ESP-La Liga`, `ITA-Serie A`, `GER-Bundesliga`, `FRA-Ligue 1`).
- **Research Disclaimer**: This project is built strictly for educational and sports analytics research purposes.

---

## Running Locally

### Prerequisites
- Python 3.10+ (tested on Python 3.11, 3.12, and 3.13)
- Git

### Windows
```powershell
# 1. Clone repository
git clone https://github.com/your-username/ball-knowledge.git
cd ball-knowledge

# 2. Create virtual environment
python -m venv .venv
.\.venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Optional: run database builder (ballknowledge.db is pre-built and committed)
python build_db.py

# 5. Start development server
uvicorn main:app --reload
```

### macOS & Linux
```bash
# 1. Clone repository
git clone https://github.com/your-username/ball-knowledge.git
cd ball-knowledge

# 2. Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Optional: run database builder
python3 build_db.py

# 5. Start development server
uvicorn main:app --reload
```

Open `http://127.0.0.1:8000` in your browser.

---

## Running Tests

Automated tests are written with `pytest` and FastAPI's `TestClient`:

```bash
# Install development / test dependencies
pip install -r requirements-dev.txt

# Run test suite
pytest tests -v
```

The test suite validates:
1. Accent-insensitive search (`mbappe` finds *Mbappé*, `odegaard` finds *Ødegaard*).
2. Forgiving league filter variants (`laliga`, `La Liga`, and `ESP-La Liga` return identical results).
3. Role filtering in SQL before `LIMIT` (no empty lists when requesting 20 strikers).
4. Full player detail endpoint and 404 error handling.
5. Cross-season comparison without dropping players from older seasons.
6. Input validation and error handling on comparison IDs.
7. Preservation of honest `NULL` values (never coerced to 0).
8. Cosine similarity player recommendation endpoint.

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/` | `GET` | Main player directory page. |
| `/compare?ids=1,2` | `GET` | Head-to-head comparison board. |
| `/player/{id}` | `GET` | Individual player profile dossier. |
| `/api/meta` | `GET` | Available leagues, seasons, and scouting roles. |
| `/api/players` | `GET` | Search and filter players (`name`, `league`, `season`, `role`, `include_low_minutes`, `limit`, `offset`). |
| `/api/players/{id}` | `GET` | Complete details for a single player season. |
| `/api/compare?ids=1,2,3` | `GET` | Compare 1–4 players by ID across any season. |
| `/api/players/{id}/similar` | `GET` | Top 5 stylistically similar players via cosine similarity. |
| `/api/player-image` | `GET` | Safe fallback returning verified pre-cached Wikipedia image. |

---

## Architecture & Design Decisions

### 1. Why SQLite?
- **Zero Configuration**: A single, portable file (`ballknowledge.db`) committed directly to Git. Deployed cloud instances (like Render or Fly.io) run instantly without setting up or paying for a separate database server.
- **Fast Read Performance**: SQLite handles thousands of read queries per second with indexed queries (`B-Trees` on `player_search`, `league`, `season_label`, `role`, `nineties`).
- **Simplicity**: Perfect for beginner explanations during technical interviews.

### 2. Why Per-90 Statistics?
- In football, playing time varies dramatically due to substitutions, injuries, and squad rotation. A player who played 500 minutes cannot be judged on raw goals against someone who played 3,000 minutes.
- Rate statistics ($metric\_p90 = \frac{metric}{minutes} \times 90$) normalize output per 90-minute game, revealing efficiency.
- **Low-Minutes Guard**: However, per-90 metrics on small sample sizes (e.g. 1 goal in 20 minutes = 4.5 goals/90) have high variance. Ball Knowledge flags players with $<5$ nineties and filters them by default.

### 3. Why Accent-Insensitive Search in SQL?
- Many European players have diacritics in their names (*Kylian Mbappé*, *Martin Ødegaard*, *Luka Modrić*).
- Standard SQLite `LIKE` is case-insensitive for ASCII but accent-sensitive for UTF-8 characters.
- Solution: During database construction, `build_db.py` creates a normalized `player_search` column (`strip_accents()`). When the user types `mbappe`, the query searches `player_search LIKE '%mbappe%'`, guaranteeing instant, reliable search results.

### 4. Why Missing Data Shows as N/A (Never 0)?
- In data analysis, **missing data ($\text{NULL}$) is not zero**. If a dataset did not track clearances for a midfielder, treating it as 0 falsely accuses the player of making zero clearances.
- Converting missing values to zero severely distorts averages, radar charts, and machine learning models. Ball Knowledge strictly preserves `null` values as `N/A` and excludes them from visual comparison bars and polygons.

### 5. Why Precomputed Wikipedia Images?
- Real-time live image lookups during card rendering make dozens of external HTTP calls, slow down page loads, trigger Wikipedia rate-limits, and frequently pull photos of the wrong person (e.g. historical namesakes or politicians).
- `fetch_images.py` runs once, validates that the page title matches the player name and confirms the article text describes a professional footballer, then saves verified Wikimedia URLs.

### 6. Why Relative Scaling on Comparison Bars?
- Fixed arbitrary maximums (e.g. capping goals at 25) compress differences and make defensive players look empty.
- Relative scaling sets the highest value on the active comparison board as 100%, allowing immediate visual comparison of who leads each metric and by what relative margin.

---

## Known Limitations

1. **Static Dataset Snapshot**: The underlying dataset represents seasons 2024/25 and 2025/26 up to the dataset's release date. It does not update with live matchday feeds in real-time.
2. **Goalkeeper Metrics**: Advanced goalkeeper metrics (post-shot expected goals minus goals allowed, cross-stopping percentage) are not available in the public CSV, so goalkeepers share broad match metrics.
3. **Top 5 Leagues Only**: Covers English Premier League, Spanish La Liga, Italian Serie A, German Bundesliga, and French Ligue 1. Other leagues (e.g. Dutch Eredivisie, Portuguese Primeira Liga) are not included.

---

## Future Roadmap

1. **Career History & Season Progression**: Linking records of the same player across multiple seasons to visualize trajectory and performance trends.
2. **Composite Scouting Index**: Developing role-specific radar percentiles compared against positional benchmarks rather than simple head-to-head maximums.
3. **PostgreSQL Migration**: Upgrading from SQLite to PostgreSQL with full-text search (`tsvector`) if the application expands to historical decades and worldwide leagues.
