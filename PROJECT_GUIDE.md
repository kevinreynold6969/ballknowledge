# Ball Knowledge — Project Study Guide & Interview Prep 🎓⚽

Welcome to your personal study manual for **Ball Knowledge**.
This document was written specifically for you as a 2nd-year Computer Science student preparing for your technical project interview on **Nov 27**.

The interviewer is likely **not a football fan**, so this guide teaches you how to present the engineering, database architecture, algorithms, and web concepts clearly in simple words.

---

## 1. High-Level Architecture: How the Whole System Works

Think of Ball Knowledge as a three-tier system:

```
+-------------------------------------------------------------+
|                     1. CLIENT (BROWSER)                     |
|  - HTML: Page structure (index.html, compare.html, etc.)   |
|  - CSS: Styling (minimal sage/cream palette, typography)    |
|  - JavaScript (static/app.js): Listens to user clicks,      |
|    fetches data from API, renders cards & SVG radar chart.  |
+------------------------------+------------------------------+
                               |
                   HTTP GET /api/players?name=mbappe
                               |
                               v
+-------------------------------------------------------------+
|                     2. BACKEND (FASTAPI)                    |
|  - main.py: Python web server running on Uvicorn.           |
|  - Normalizes user text (strips accents: "mbappe" -> mbappe)|
|  - Normalizes league inputs ("laliga" -> "ESP-La Liga")     |
|  - Constructs safe SQL query with parameter binding (?).    |
|  - Runs NumPy cosine similarity for stylistic player twins. |
+------------------------------+------------------------------+
                               |
              SELECT * FROM player_seasons WHERE ...
                               |
                               v
+-------------------------------------------------------------+
|                    3. DATABASE (SQLITE)                     |
|  - ballknowledge.db: Single-file database (~2 MB).          |
|  - Table player_seasons: 5,693 rows (1 per player season).  |
|  - Fast indexed lookups (B-Tree indexes on player_search,   |
|    league, season_label, role, nineties).                   |
+-------------------------------------------------------------+
```

### The Request-Response Lifecycle in Plain English
1. **You type "mbappe" in the search box**: The browser's JavaScript event listener detects the keystroke. To avoid firing 6 requests if you type quickly, a **debounce timer** waits 250 milliseconds.
2. **JavaScript makes a request**: `fetch('/api/players?name=mbappe')` sends an HTTP GET request to FastAPI.
3. **FastAPI receives the request**: It normalizes `"mbappe"` by stripping accents using `strip_accents()`.
4. **FastAPI queries SQLite**: It executes `SELECT * FROM player_seasons WHERE player_search LIKE ?` passing `["%mbappe%"]` as a safe parameter.
5. **SQLite scans the index**: It finds rows where `player_search` contains `"mbappe"` (which matches Kylian Mbappé).
6. **SQLite returns the rows to Python**: FastAPI converts each database row into a Python dictionary.
7. **FastAPI responds with JSON**: The server sends back an array of player objects with an HTTP 200 OK status code.
8. **The browser receives the JSON**: `static/app.js` loops over the array, creates HTML elements (`<article class="player-card">`), and injects them into the webpage DOM.

---

## 2. File-by-File Tour

| File | One-Sentence Summary | Detailed Purpose |
|---|---|---|
| `build_db.py` | The database ETL (Extract, Transform, Load) script that reads CSV data and builds the SQLite database. | Reads `data/player_seasons.csv`, casts numbers safely, removes diacritics for `player_search`, calculates scouting roles (`role`), attaches precomputed Wikipedia image URLs from `data/player_images.json`, creates table indexes, and writes `ballknowledge.db`. |
| `main.py` | The FastAPI backend server providing web routes and JSON REST API endpoints. | Serves the HTML templates, handles `/api/players` with combined filters, `/api/compare` for cross-season analysis, `/api/players/{id}` for dossiers, and `/api/players/{id}/similar` using NumPy cosine similarity. |
| `fetch_images.py` | Offline utility script to fetch and strictly verify Wikipedia images for players. | Queries the Wikipedia Search API with a polite User-Agent, verifies that page titles match player names and that article text mentions professional football, and saves verified image URLs to `data/player_images.json`. |
| `templates/index.html` | The homepage and directory template. | Renders the hero intro, filter controls bar (search, league, season, role, low-minutes toggle), player directory grid, load more button, and sticky comparison bar. |
| `templates/compare.html` | The head-to-head comparison board template. | Renders side-by-side player comparisons across any season, hosting the interactive SVG radar chart, relative metric bars, and player candidate search. |
| `templates/player.html` | The single-player dossier template. | Displays an individual player's complete statistical breakdown, EA FC game ratings, season totals, per-90 rate metrics, and stylistically similar player recommendations. |
| `static/app.js` | The complete, unminified, modular frontend JavaScript application. | Manages selection state, synchronizes `localStorage`, handles asynchronous `fetch` calls, draws dynamic SVG radar charts, and builds UI components without heavy frameworks like React. |
| `static/styles.css` | The responsive stylesheet implementing the warm sage/cream aesthetic. | Provides typography styling (`Manrope` + `DM Mono`), card grid layouts, hover states, sticky bar animations, comparison bar tracks, and phone-friendly media queries. |
| `tests/test_api.py` | Automated test suite using `pytest` and FastAPI's `TestClient`. | Verifies accent-insensitive search, forgiving league inputs, SQL role filtering, 404 handling, cross-season comparisons, invalid ID protection, and cosine similarity. |
| `requirements.txt` | Production Python package dependencies. | Lists `fastapi`, `uvicorn`, and `numpy`. |
| `requirements-dev.txt` | Development and testing dependencies. | Lists `pytest` and `httpx`. |
| `.gitignore` | Git rules specifying files to exclude from version control. | Excludes virtual environments (`.venv`), Python cache (`__pycache__`), OS artifacts (`.DS_Store`), and test caches. |
| `ballknowledge.db` | Pre-built SQLite database file (~2 MB). | Ready for deployment on platforms like Render without needing a slow database build step on the server. |

---

## 3. Important Functions Explained

### 1. `strip_accents(text)` (in `build_db.py`, `main.py`, `fetch_images.py`)
```python
def strip_accents(text: str) -> str:
    replacements = {"ø": "o", "Ø": "O", "ł": "l", "Ł": "L", "đ": "d", "ß": "ss", "æ": "ae", "Æ": "AE", "œ": "oe"}
    text = str(text).translate(str.maketrans(replacements))
    return "".join(c for c in unicodedata.normalize("NFKD", text) if not unicodedata.combining(c)).lower().strip()
```
- **Why we need it**: Standard SQLite `LIKE` operator does not understand UTF-8 accents. If you search for `"mbappe"`, SQLite will not match `"Mbappé"`.
- **How it works**:
  1. `maketrans()` replaces non-combining European characters (like Norwegian `Ø` -> `O` or German `ß` -> `ss`).
  2. `unicodedata.normalize("NFKD", ...)` splits accented characters into their base character plus a combining accent mark (e.g. `é` becomes `e` + `´`).
  3. `not unicodedata.combining(c)` strips the accent mark, leaving pure base ASCII (`e`).
  4. `.lower()` makes it case-insensitive.

### 2. `normalize_league_input(league_input)` (in `main.py`)
```python
def normalize_league_input(league_input: str) -> Optional[str]:
    cleaned = re.sub(r"[^a-zA-Z0-9]", "", league_input.lower())
    if cleaned in LEAGUE_ALIASES:
        return LEAGUE_ALIASES[cleaned]
    ...
```
- **Why we need it**: Users and APIs might type `"laliga"`, `"La Liga"`, `"la-liga"`, or `"ESP-La Liga"`.
- **How it works**: Strips all non-alphanumeric characters and checks against a canonical dictionary, ensuring any variation safely routes to `"ESP-La Liga"` in SQL.

### 3. `get_similar_players(player_id)` (in `main.py`)
```python
# Cosine similarity formula: dot(u, v) / (norm(u) * norm(v))
similarity = float(np.dot(target_vec, cand_vec) / (target_norm * cand_norm))
```
- **Why we need it**: To recommend players who play with a similar tactical style (e.g. creative wingers who take many shots and key passes).
- **How it works**:
  1. Represents each player as a 6-dimensional mathematical vector representing per-90 rates: `[non-pen xG, xA, key passes, shots, tackles won, interceptions]`.
  2. Calculates the angle between the two vectors using the dot product divided by the Euclidean lengths ($L_2$ norms).
  3. Returns a similarity score between 0% and 100%. Two players with the exact same output ratio score 100%, regardless of club.
  4. Only compares players in the **same tactical role**, in the **same season**, with **nineties $\ge$ 10**, and **zero missing metrics** (never zeroes out missing data).

### 4. `renderRadarChart()` (in `static/app.js`)
- **Why we need it**: Visually portrays the shape of a player's game on a multi-axis spider/radar web.
- **Why vanilla SVG instead of Chart.js?**: Standard libraries often force missing values to 0, which would draw a false drop to the center of the web. Our mathematical SVG skips missing metrics and documents them in the legend, preventing false representation.

---

## 4. Key Syntax & Concepts for Beginners

### Python / FastAPI Concepts
- **Type Annotations (`name: str = "", limit: int = 60`)**: Tells Python and FastAPI what type of data to expect. FastAPI automatically validates query parameters against these types.
- **Optional (`Optional[str] = None`)**: Indicates that a parameter is not required. If omitted from the URL, it defaults to `None`.
- **Path Parameters (`@app.get("/player/{player_id}")`)**: Grabs values directly from the URL path (e.g. `/player/42` sets `player_id = 42`).
- **SQL Parameter Binding (`WHERE player_search LIKE ?`, [param])**: Replaces `?` with the sanitized value. **Never concatenate user input directly into SQL strings** (`WHERE name = '` + user_input + `'`), as that allows SQL Injection attacks.

### JavaScript (ES6) Concepts
- **`async` / `await`**: Makes asynchronous code (like fetching data from a server over the network) look and behave like synchronous code without freezing the user interface.
- **Template Literals (``` `${player.player}` ```)**: Strings enclosed in backticks that allow embedding variables and expressions directly.
- **Nullish Coalescing (`??`) and Optional Chaining (`?.`)**: Safely accesses properties or provides fallback defaults if a value is null or undefined (`player.league?.name ?? 'Unknown'`).

---

## 5. Every Bug Fixed & Change Made

1. **Bug 1: Accent-Insensitive Search**:
   - *Was*: `main.py` searched the raw `player` column (`LIKE ?`). Searching `"mbappe"` returned 0 results.
   - *Fix*: Made search query the pre-normalized `player_search` column, and normalized the user's input with `strip_accents()`. Now `"mbappe"` matches *Kylian Mbappé*, and `"odegaard"` matches *Martin Ødegaard*.
2. **Bug 2: Role Filter in SQL & Load More**:
   - *Was*: Role was filtered in Python *after* the SQL `LIMIT`, causing `role=Striker&limit=20` to return 0 records if the first 20 records weren't strikers.
   - *Fix*: Computed `role` during database construction, stored it in a dedicated SQLite column with a B-tree index, and filtered in SQL before the `LIMIT`. Implemented page size 60 with a "Load more" button.
3. **Bug 3: Compare Page Cross-Season Loading**:
   - *Was*: Compare page fetched only latest-season players, silently dropping players with 2024/25 IDs.
   - *Fix*: Compare page now fetches `/api/compare?ids=...` directly, which loads any ID regardless of season. The candidate search on the compare page searches across all seasons and displays `Player · Club (Season)`.
4. **Bug 4: Mislabelled Stats Split & Relative Bars**:
   - *Was*: Goals and Assists were shown under "PER 90", even though they were season totals.
   - *Fix*: Split comparison into "Season totals" and "Per 90 minutes". Scaled bars relative to the board leader ($100\% = \text{max value on board}$) and highlighted leaders.
5. **Bug 5: Forgiving League Filter**:
   - *Was*: Strict equality required exact string `"ESP-La Liga"`.
   - *Fix*: Added `normalize_league_input()` so `"laliga"`, `"La Liga"`, `"la-liga"`, and `"ESP-La Liga"` all match seamlessly.
6. **Bug 6: Ordering by Minutes Played**:
   - *Was*: Ordered alphabetically by league and team.
   - *Fix*: Ordered by `nineties DESC NULLS LAST, player ASC`.
7. **Step 2: Honest Missing Data & Game Labels**:
   - *Was*: Missing values risk coercion to 0, and EA ratings were ambiguous.
   - *Fix*: Nulls display as `"N/A"` with no visual bar. EA FC ratings/values are explicitly labeled as *"EA FC rating (game rating)"* and *"EA FC value (game estimate)"*. Added a low-minutes badge for $<5$ nineties and a toggle to filter them.
8. **Step 4: Precomputed Verified Images**:
   - *Was*: Live search for `"<name> footballer"` pulled incorrect Wikipedia people live.
   - *Fix*: Created `fetch_images.py` with title matching and footballer verification. Saved 509 verified player photos with Wikimedia attribution.
9. **Step 5: Code Quality & UI Polish**:
   - *Was*: `app.js` was minified one-liners.
   - *Fix*: Completely rewritten into clean, multi-line, modular functions with full documentation. Added SVG radar chart.
10. **Step 7: Stylistic Player Similarity**:
    - *Added*: `/api/players/{id}/similar` using pure NumPy cosine similarity across 6 per-90 metrics on players with $\ge 10$ nineties and complete data.

---

## 6. The 2-Minute Interview Demo Script (For a Non-Football Interviewer)

> *"Good morning! For my project, I built **Ball Knowledge**, a full-stack web application designed for football player scouting and comparison.*
>
> *I built this because in sports discussions, players are often judged on misleading headline stats or video game numbers. For instance, a substitute who scored 8 goals in just a few matches might actually be far more efficient than a starter who scored 9 goals playing every minute all year.*
>
> *Let me demonstrate 3 key technical features:*
>
> 1. *First, **Data Integrity and Normalization**: European player names often have special accents. If I type `mbappe` without accents, or `odegaard`, my search still finds Kylian Mbappé and Martin Ødegaard instantly. Behind the scenes, my database ETL process builds a normalized ASCII search index so the SQL query is fast and accent-insensitive.*
> 2. *Second, **Transparent Rate Metrics vs. Season Totals**: When I compare players, I don't mix up raw season totals with rate metrics. My backend separates total goals from per-90 rate metrics like Expected Goals and Chance Creation. Furthermore, when a statistic is missing from the data provider, my system displays it honestly as `N/A` rather than converting it to zero, which would falsely distort the comparison.*
> 3. *Third, **Mathematical Player Twins**: On every player profile, I built a 'Stylistically Similar Players' engine. Using NumPy, it calculates the **Cosine Similarity** between players based on a 6-dimensional vector of per-90 metrics. This algorithm identifies players who share the same playing style, not just the same club or hype.*
>
> *The entire app is built with FastAPI, SQLite, and vanilla HTML/CSS/JavaScript—with zero bulky frameworks, keeping it lightweight, fast, and completely understandable."*

---

## 7. 12 Likely Interview Questions & Simple Answers

### Q1: Why did you choose SQLite instead of PostgreSQL or MongoDB?
> **Answer**: *"SQLite is serverless, zero-configuration, and stores everything in a single portable file (`ballknowledge.db`). Because this dataset is a read-heavy historical snapshot of ~5,700 rows, SQLite provides sub-millisecond query performance using B-Tree indexes without the resource overhead, hosting cost, or connection pooling complexity of a separate database server. If we expand to live concurrent match writes across decades of data, we can migrate to PostgreSQL."*

### Q2: What is the difference between Season Totals and Per-90 Statistics?
> **Answer**: *"Season totals measure **aggregate volume** (how many total goals or minutes a player accumulated). Per-90 stats measure **rate efficiency** (output normalized to a standard 90-minute match). Because players have different playing time due to injuries or substitutions, per-90 metrics allow a fair rate-of-output comparison between a starter and an impact substitute."*

### Q3: Why is treating missing data (NULL) as zero dangerous in sports analytics?
> **Answer**: *"NULL represents unknown or uncollected information, not an absence of skill. If a data provider did not track tackles for a particular league or match, converting NULL to 0 falsely claims the player attempted zero tackles. This drags down averages, skews radar charts, and corrupts similarity models. In Ball Knowledge, missing values are strictly preserved as `N/A` and excluded from visual polygons."*

### Q4: How does the frontend communicate with the backend?
> **Answer**: *"The frontend uses the native JavaScript `fetch()` API to make asynchronous HTTP GET requests to FastAPI REST endpoints (like `/api/players` or `/api/compare`). The server returns structured JSON data, and the browser uses vanilla JavaScript DOM methods to dynamically create and insert HTML elements without needing a page refresh."*

### Q5: What is SQL Injection, and how did you prevent it?
> **Answer**: *"SQL Injection occurs when untrusted user input is directly concatenated into a SQL command string, allowing an attacker to inject malicious SQL commands (like `' OR 1=1; DROP TABLE users; --`). I prevented this by using **parameterized queries** (prepared statements with `?` placeholders). The database treats the input strictly as literal data, never as executable code."*

### Q6: Why did you precompute Wikipedia images rather than fetching them live?
> **Answer**: *"Fetching live Wikipedia thumbnails in the browser made dozens of external network calls per search, slowing down page rendering and triggering Wikipedia rate limits. Worse, a live text search for common names often returned the wrong person (like a politician or singer). Precomputing them via `fetch_images.py` allowed us to verify that the article explicitly describes a professional footballer, saving verified URLs to SQLite for instant, reliable loading."*

### Q7: How does your 'Similar Players' algorithm work? What does Cosine Similarity measure?
> **Answer**: *"Each player is modeled as a 6-dimensional vector representing their per-90 rate metrics (like shots, chance creation, and tackles). Cosine similarity calculates the cosine of the angle between two vectors: $\frac{u \cdot v}{\|u\| \|v\|}$. A score of 100% means both players distribute their output in the exact same tactical proportions. It measures **stylistic playing profile**, not overall skill level."*

### Q8: What would you improve or build next?
> **Answer**: *"Three things: First, track career historical progression so a user can see a player's trajectory over 5+ seasons. Second, compute percentile ranks against positional benchmarks rather than just head-to-head board maximums. Third, add automated data ingestion pipelines to ingest new matchdays automatically."*

### Q9: Why did you use vanilla JavaScript instead of React or Vue?
> **Answer**: *"For an educational project of this scale, vanilla JavaScript is ideal: it has zero build steps, zero external npm package dependencies, loads instantaneously in the browser, and ensures that as a student I understand core web fundamentals (the DOM, asynchronous promises, event bubbling) rather than relying on framework abstractions."*

### Q10: What is a B-Tree index in SQLite, and where did you use it?
> **Answer**: *"A B-Tree index is a balanced tree data structure that allows the database engine to find matching rows in $O(\log N)$ time rather than performing a full table scan of $O(N)$. I created indexes on `player_search`, `league`, `season_label`, `role`, and `nineties` to ensure instant filtering across 5,693 records."*

### Q11: What is 'debounce', and why did you use it on the search input?
> **Answer**: *"Debouncing is a programming pattern that delays invoking a function until a certain amount of time has passed since the last event. On the search input, if a user types 'Mbappe', without debouncing we would send 6 separate API requests (one per keystroke). With a 250ms debounce timer, we wait until the user pauses typing and send only a single request, reducing unnecessary server load."*

### Q12: Why did you add a low-minutes warning badge?
> **Answer**: *"Per-90 metrics on small sample sizes suffer from extreme variance. For example, a youth player who plays 15 minutes and scores 1 goal has a per-90 rate of 6.0 goals per match, which is statistically misleading. We flag players with fewer than 5 full matches (450 minutes) and filter them out by default to preserve analytical integrity."*
