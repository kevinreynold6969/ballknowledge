/**
 * Ball Knowledge — Frontend Application Logic
 *
 * Designed to be clean, modular, and easy to explain during a college technical interview.
 * Uses vanilla JavaScript (ES6+), async/await, and direct DOM manipulation.
 *
 * Architecture:
 * - State Management: Centralized state for selected players and directory filters.
 * - API Layer: Clean fetch wrappers with error handling.
 * - Formatters: Honest handling of nulls (N/A) and numbers.
 * - Radar Visualizer: Standalone mathematical SVG radar chart avoiding third-party dependencies.
 * - Page Controllers: Dedicated handlers for Directory (/), Compare (/compare), and Profile (/player/{id}).
 */

// =============================================================================
// 1. GLOBAL APPLICATION STATE
// =============================================================================

const state = {
  // Array of player objects currently selected for head-to-head comparison (up to 4)
  selectedPlayers: [],

  // Directory listing state
  directoryPlayers: [],
  pageLimit: 60,
  currentOffset: 0,
  hasMore: true,
  isLoading: false,

  // Debounce timer for search input
  searchTimer: null,
};

// =============================================================================
// 2. DOM UTILITIES & HELPERS
// =============================================================================

/**
 * Shorthand helper for document.getElementById
 * @param {string} id - HTML element id
 * @returns {HTMLElement|null}
 */
const $ = (id) => document.getElementById(id);

/**
 * Generic fetch wrapper that parses JSON and throws on HTTP errors.
 * @param {string} url - API endpoint URL
 * @returns {Promise<any>}
 */
async function fetchAPI(url) {
  const response = await fetch(url);
  if (!response.ok) {
    const errorDetail = await response.text();
    throw new Error(`API Error ${response.status}: ${errorDetail}`);
  }
  return response.json();
}

/**
 * Honest numerical formatter.
 * Crucial rule: Missing values (null or undefined) MUST return "N/A" and NEVER 0.
 * @param {number|null|undefined} value - Numeric value from database
 * @param {number} decimals - Number of decimal places
 * @returns {string} Formatted string or "N/A"
 */
function formatNumber(value, decimals = 1) {
  if (value === null || value === undefined || value === "" || isNaN(Number(value))) {
    return "N/A";
  }
  return Number(value).toFixed(decimals);
}

/**
 * Formats a currency amount into a clean human-readable string (e.g. €75.0M).
 * Clearly labelled as an EA FC game estimate.
 * @param {number|null} value - Value in Euros
 * @returns {string} Formatted currency or "N/A"
 */
function formatCurrency(value) {
  if (value === null || value === undefined || isNaN(Number(value)) || Number(value) <= 0) {
    return "N/A";
  }
  const num = Number(value);
  if (num >= 1_000_000) {
    return `€${(num / 1_000_000).toFixed(1)}M`;
  }
  if (num >= 1_000) {
    return `€${(num / 1_000).toFixed(0)}K`;
  }
  return `€${num.toLocaleString()}`;
}

/**
 * Generates 1-2 letter initials from a player's full name.
 * @param {string} name - Player name
 * @returns {string} Two uppercase initials
 */
function getInitials(name) {
  if (!name) return "??";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) {
    return parts[0].substring(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Generates HTML markup for a player's avatar.
 * Uses verified Wikipedia thumbnail if present, with an onerror fallback to a clean initials circle.
 * @param {Object} player - Player season object
 * @param {string} className - Additional CSS class name
 * @returns {string} HTML string
 */
function createAvatarHTML(player, className = "") {
  const initials = getInitials(player.player);
  if (player.image_url) {
    return `
      <img
        class="avatar ${className}"
        src="${player.image_url}"
        alt="${player.player}"
        loading="lazy"
        onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'avatar avatar-fallback ${className}\\'>${initials}</div>';"
      />
    `;
  }
  return `<div class="avatar avatar-fallback ${className}">${initials}</div>`;
}

// =============================================================================
// 3. PERSISTENT COMPARISON STATE (LOCAL STORAGE)
// =============================================================================

function saveSelectedToStorage() {
  try {
    const ids = state.selectedPlayers.map((p) => p.id);
    localStorage.setItem("bk_compare_ids", JSON.stringify(ids));
  } catch (e) {
    console.warn("Could not save comparison to localStorage:", e);
  }
}

function loadSelectedFromStorage() {
  try {
    const raw = localStorage.getItem("bk_compare_ids");
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

// =============================================================================
// 4. COMPARISON SELECTION TOGGLING
// =============================================================================

/**
 * Toggle a player in or out of the active comparison list.
 * Maximum 4 players allowed.
 * @param {Object} player - Player object
 */
function togglePlayerSelection(player) {
  const existingIndex = state.selectedPlayers.findIndex((p) => p.id === player.id);
  if (existingIndex >= 0) {
    // Remove from comparison
    state.selectedPlayers.splice(existingIndex, 1);
  } else {
    // Check upper limit of 4
    if (state.selectedPlayers.length >= 4) {
      alert("You can compare up to 4 players simultaneously. Remove a player first to add another.");
      return;
    }
    state.selectedPlayers.push(player);
  }

  saveSelectedToStorage();
  updateUISelectionStates();
}

/**
 * Synchronize UI elements (card border states, sticky bar, counts) with current selection.
 */
function updateUISelectionStates() {
  // Update card selected visual states in directory
  document.querySelectorAll(".player-card").forEach((card) => {
    const id = Number(card.dataset.id);
    const isSelected = state.selectedPlayers.some((p) => p.id === id);
    card.classList.toggle("selected", isSelected);
  });

  // Update sticky comparison bar
  renderStickyBar();

  // If on compare page, re-render the board
  if (window.location.pathname === "/compare") {
    renderComparisonBoard();
    renderRadarChart();
  }
}

/**
 * Render the floating sticky bar at the bottom of the screen.
 */
function renderStickyBar() {
  const bar = $("sticky-bar");
  const slots = $("sticky-slots");
  const countSpan = $("sticky-count");
  if (!bar || !slots) return;

  const count = state.selectedPlayers.length;
  if (count === 0) {
    bar.hidden = true;
    return;
  }

  bar.hidden = false;
  if (countSpan) {
    countSpan.textContent = `${count} / 4`;
  }

  slots.innerHTML = state.selectedPlayers
    .map(
      (p) => `
      <div class="sticky-chip">
        ${createAvatarHTML(p, "avatar-small")}
        <span>${p.player}</span>
        <button class="sticky-remove-btn" type="button" data-remove-id="${p.id}" title="Remove from comparison">×</button>
      </div>
    `
    )
    .join("");

  // Attach remove handlers
  slots.querySelectorAll("[data-remove-id]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.removeId);
      const player = state.selectedPlayers.find((p) => p.id === id);
      if (player) togglePlayerSelection(player);
    });
  });

  const compareBtn = $("sticky-compare-btn");
  if (compareBtn) {
    compareBtn.onclick = () => {
      const ids = state.selectedPlayers.map((p) => p.id).join(",");
      window.location.href = `/compare?ids=${ids}`;
    };
  }

  const clearBtn = $("sticky-clear-btn");
  if (clearBtn) {
    clearBtn.onclick = () => {
      state.selectedPlayers = [];
      saveSelectedToStorage();
      updateUISelectionStates();
    };
  }
}

// =============================================================================
// 5. DIRECTORY PAGE LOGIC (index.html)
// =============================================================================

async function initDirectoryPage() {
  const resultsContainer = $("results");
  const loadingIndicator = $("loading");
  const emptyState = $("empty");
  const loadMoreWrap = $("load-more-wrap");
  const loadMoreBtn = $("load-more-btn");
  const searchInput = $("search");
  const leagueSelect = $("league");
  const seasonSelect = $("season");
  const roleSelect = $("role");
  const lowMinCheckbox = $("include-low-minutes");
  const resultCount = $("result-count");

  // Load metadata filters from /api/meta
  try {
    const meta = await fetchAPI("/api/meta");

    meta.leagues.forEach((league) => {
      const displayName = league.replace(/^[A-Z]{3}-/, "");
      leagueSelect.insertAdjacentHTML("beforeend", `<option value="${league}">${displayName}</option>`);
    });

    meta.seasons.forEach((season) => {
      seasonSelect.insertAdjacentHTML("beforeend", `<option value="${season}">${season}</option>`);
    });

    meta.roles.forEach((role) => {
      roleSelect.insertAdjacentHTML("beforeend", `<option value="${role}">${role}</option>`);
    });
  } catch (err) {
    console.error("Could not load metadata:", err);
  }

  // Restore stored selected player IDs
  const storedIds = loadSelectedFromStorage();
  if (storedIds.length > 0) {
    try {
      state.selectedPlayers = await fetchAPI(`/api/compare?ids=${storedIds.join(",")}`);
      renderStickyBar();
    } catch (e) {
      console.warn("Could not restore selected players:", e);
    }
  }

  /**
   * Fetch player directory from backend with current filters and pagination.
   * @param {boolean} reset - If true, resets currentOffset and clears previous results.
   */
  async function fetchDirectory(reset = false) {
    if (state.isLoading) return;
    state.isLoading = true;

    if (reset) {
      state.currentOffset = 0;
      state.directoryPlayers = [];
      resultsContainer.innerHTML = "";
      emptyState.hidden = true;
      loadMoreWrap.hidden = true;
    }

    loadingIndicator.hidden = false;

    const params = new URLSearchParams({
      name: searchInput.value.trim(),
      league: leagueSelect.value,
      season: seasonSelect.value,
      role: roleSelect.value,
      include_low_minutes: lowMinCheckbox.checked ? "true" : "false",
      limit: state.pageLimit.toString(),
      offset: state.currentOffset.toString(),
    });

    try {
      const players = await fetchAPI(`/api/players?${params.toString()}`);

      if (reset) {
        state.directoryPlayers = players;
      } else {
        state.directoryPlayers = state.directoryPlayers.concat(players);
      }

      state.hasMore = players.length === state.pageLimit;
      state.currentOffset += players.length;

      renderPlayerCards(players, reset);

      if (resultCount) {
        resultCount.textContent = `SHOWING ${state.directoryPlayers.length} PLAYERS`;
      }

      emptyState.hidden = state.directoryPlayers.length > 0;
      loadMoreWrap.hidden = !state.hasMore;
    } catch (err) {
      console.error("Failed to load players:", err);
      resultsContainer.innerHTML = `<div class="empty-state"><p>Error loading directory. Please try again.</p></div>`;
    } finally {
      state.isLoading = false;
      loadingIndicator.hidden = true;
    }
  }

  /**
   * Append player cards to the directory grid.
   * @param {Array} players - List of player objects
   * @param {boolean} clear - Clear existing cards
   */
  function renderPlayerCards(players, clear = false) {
    if (clear) resultsContainer.innerHTML = "";

    const fragment = document.createDocumentFragment();

    players.forEach((p) => {
      const isSelected = state.selectedPlayers.some((s) => s.id === p.id);
      const isLowMinutes = p.nineties !== null && p.nineties < 5;

      const card = document.createElement("article");
      card.className = `player-card ${isSelected ? "selected" : ""}`;
      card.dataset.id = p.id;

      card.innerHTML = `
        <div class="card-selected-check" aria-hidden="true">✓</div>
        <div class="card-top">
          <span class="badge badge-role">${p.role || "Other"}</span>
          <span class="mono muted">${p.nation || "—"}</span>
        </div>
        ${isLowMinutes ? '<span class="badge badge-low-min" title="Under 5 nineties: per-90 metrics have high variance">⚠️ &lt;5 90s</span>' : ""}
        <div class="avatar-wrap">
          ${createAvatarHTML(p)}
        </div>
        <div class="card-info">
          <h3 class="player-name">
            <a href="/player/${p.id}" title="View ${p.player} scouting dossier">${p.player}</a>
          </h3>
          <div class="player-team">${p.team || "—"}</div>
          <div class="player-league-season">${p.season_label || "—"} · ${p.league ? p.league.replace(/^[A-Z]{3}-/, "") : "—"}</div>
        </div>
        <div class="card-bottom">
          <div class="rating-box">
            <span class="rating-val">${formatNumber(p.fifa_overall_rating, 0)}</span>
            <span class="rating-label">EA FC rating</span>
          </div>
          <div class="card-actions">
            <a class="profile-link" href="/player/${p.id}">Profile ↗</a>
          </div>
        </div>
      `;

      // Clicking card toggles comparison selection
      card.addEventListener("click", (e) => {
        // Allow direct links to navigate normally
        if (e.target.closest("a")) return;
        togglePlayerSelection(p);
      });

      fragment.appendChild(card);
    });

    resultsContainer.appendChild(fragment);
  }

  // Event Listeners for Filters
  searchInput.addEventListener("input", () => {
    clearTimeout(state.searchTimer);
    state.searchTimer = setTimeout(() => fetchDirectory(true), 250);
  });

  leagueSelect.addEventListener("change", () => fetchDirectory(true));
  seasonSelect.addEventListener("change", () => fetchDirectory(true));
  roleSelect.addEventListener("change", () => fetchDirectory(true));
  lowMinCheckbox.addEventListener("change", () => fetchDirectory(true));

  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => fetchDirectory(false));
  }

  const resetFiltersBtn = $("reset-filters");
  if (resetFiltersBtn) {
    resetFiltersBtn.addEventListener("click", () => {
      searchInput.value = "";
      leagueSelect.value = "";
      seasonSelect.value = "";
      roleSelect.value = "";
      lowMinCheckbox.checked = false;
      fetchDirectory(true);
    });
  }

  // Initial fetch
  await fetchDirectory(true);
}

// =============================================================================
// 6. DEDICATED COMPARE PAGE LOGIC (compare.html)
// =============================================================================

async function initComparePage() {
  const urlParams = new URLSearchParams(window.location.search);
  const idsQuery = urlParams.get("ids");

  let idsToFetch = [];
  if (idsQuery) {
    idsToFetch = idsQuery.split(",").map((id) => Number(id.trim())).filter((id) => !isNaN(id) && id > 0);
  } else {
    idsToFetch = loadSelectedFromStorage();
  }

  if (idsToFetch.length > 0) {
    try {
      state.selectedPlayers = await fetchAPI(`/api/compare?ids=${idsToFetch.join(",")}`);
      saveSelectedToStorage();
    } catch (e) {
      console.error("Failed to load compared players:", e);
    }
  }

  renderComparisonBoard();
  renderRadarChart();
  setupCompareCandidateSearch();

  const clearBtn = $("clear-board-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.selectedPlayers = [];
      saveSelectedToStorage();
      window.history.pushState({}, "", "/compare");
      renderComparisonBoard();
      renderRadarChart();
    });
  }
}

/**
 * Render comparison board with:
 * - Profile and game estimates
 * - Season totals (scaled relative to board leader)
 * - Per 90 minutes (scaled relative to board leader)
 * Highlights the best value in each row and strictly displays "N/A" for nulls.
 */
function renderComparisonBoard() {
  const container = $("comparison-target");
  if (!container) return;

  const ps = state.selectedPlayers;

  if (ps.length === 0) {
    container.innerHTML = `
      <div class="board-placeholder">
        <span>+</span>
        <p>No players currently selected. Add players using the search below or select them from the directory.</p>
        <a href="/" class="button button-outline" style="margin-top:12px;">Go to Player Directory ↗</a>
      </div>
    `;
    const radar = $("radar-section");
    if (radar) radar.hidden = true;
    return;
  }

  // Show radar section when at least 2 players are selected
  const radar = $("radar-section");
  if (radar) radar.hidden = ps.length < 2;

  // Comparison metrics definition
  const seasonTotalRows = [
    { label: "Goals", key: "fb_gls", decimals: 0 },
    { label: "Assists", key: "fb_ast", decimals: 0 },
    { label: "Minutes played", key: "playing_time_min", decimals: 0 },
    { label: "Matches played", key: "playing_time_mp", decimals: 0 },
    { label: "90s completed", key: "nineties", decimals: 1 },
    { label: "Expected goals (xG)", key: "us_xg", decimals: 2 },
    { label: "Expected assists (xA)", key: "us_xa", decimals: 2 },
  ];

  const per90Rows = [
    { label: "Non-pen xG / 90", key: "np_xg_p90", decimals: 2 },
    { label: "Expected assists / 90", key: "xa_p90", decimals: 2 },
    { label: "Key passes / 90", key: "key_passes_p90", decimals: 2 },
    { label: "Shots / 90", key: "shots_p90", decimals: 2 },
    { label: "Tackles won / 90", key: "tackles_won_p90", decimals: 2 },
    { label: "Interceptions / 90", key: "interceptions_p90", decimals: 2 },
  ];

  /**
   * Generates grid cells for a numerical metric row with relative bar scaling.
   */
  function renderMetricRow(label, key, decimals) {
    // Find valid numerical values across players (excluding null/undefined)
    const validValues = ps
      .map((p) => p[key])
      .filter((v) => v !== null && v !== undefined && !isNaN(Number(v)))
      .map(Number);

    const maxVal = validValues.length > 0 ? Math.max(...validValues) : 0;

    let html = `<div class="grid-cell stat-label-cell">${label}</div>`;

    ps.forEach((p) => {
      const val = p[key];
      const isMissing = val === null || val === undefined || isNaN(Number(val));
      const numVal = isMissing ? null : Number(val);

      // Best value highlight (only when multiple players have valid data)
      const isLeader = !isMissing && validValues.length > 1 && numVal === maxVal && maxVal > 0;

      // Bar percentage: relative to highest player on the board (leader = 100%)
      const barPct = !isMissing && maxVal > 0 ? Math.min(100, Math.max(0, (numVal / maxVal) * 100)) : 0;

      html += `
        <div class="grid-cell stat-value-cell ${isLeader ? "is-leader" : ""}">
          ${
            isMissing
              ? '<span class="na-text">N/A</span>'
              : `
                <div class="stat-bar-track">
                  <div class="stat-bar-fill ${isLeader ? "leader-fill" : ""}" style="width: ${barPct}%;"></div>
                </div>
                <span class="stat-number ${isLeader ? "leader-val" : ""}">${formatNumber(val, decimals)}</span>
              `
          }
        </div>
      `;
    });

    return html;
  }

  let tableHTML = `
    <div class="comparison-board">
      <div class="compare-grid" style="--players: ${ps.length};">
        <!-- Player Header Row -->
        <div class="grid-cell header-cell">
          <span class="eyebrow">HEAD TO HEAD</span>
          <span class="mono muted">${ps.length} / 4 PLAYERS</span>
        </div>
        ${ps
          .map(
            (p) => `
          <div class="grid-cell header-cell">
            <button class="remove-btn" data-remove-id="${p.id}" title="Remove ${p.player}">✕</button>
            ${createAvatarHTML(p)}
            <h3 class="player-name">
              <a href="/player/${p.id}">${p.player}</a>
            </h3>
            <div class="player-team">${p.team || "—"}</div>
            <div class="player-league-season">${p.season_label || "—"} · ${p.league ? p.league.replace(/^[A-Z]{3}-/, "") : "—"}</div>
          </div>
        `
          )
          .join("")}

        <!-- Section: Profile & Game Ratings -->
        <div class="section-row-label">PROFILE & EA FC RATINGS</div>

        <div class="grid-cell stat-label-cell">Role & Position</div>
        ${ps.map((p) => `<div class="grid-cell">${p.role || "—"} (${p.pos || "—"})</div>`).join("")}

        <div class="grid-cell stat-label-cell">Age</div>
        ${ps.map((p) => `<div class="grid-cell">${formatNumber(p.age, 0)}</div>`).join("")}

        <div class="grid-cell stat-label-cell">Nationality</div>
        ${ps.map((p) => `<div class="grid-cell">${p.nation || "—"}</div>`).join("")}

        <div class="grid-cell stat-label-cell">EA FC rating (game rating)</div>
        ${ps.map((p) => `<div class="grid-cell stat-number">${formatNumber(p.fifa_overall_rating, 0)} <span class="muted mono">/ 99</span></div>`).join("")}

        <div class="grid-cell stat-label-cell">EA FC value (game estimate)</div>
        ${ps.map((p) => `<div class="grid-cell stat-number">${formatCurrency(p.fifa_value_eur)}</div>`).join("")}

        <!-- Section: Season Totals -->
        <div class="section-row-label">SEASON TOTALS (AGGREGATE OUTPUT)</div>
        ${seasonTotalRows.map((r) => renderMetricRow(r.label, r.key, r.decimals)).join("")}

        <!-- Section: Per 90 Minutes -->
        <div class="section-row-label">PER 90 MINUTES (RATE METRICS)</div>
        ${per90Rows.map((r) => renderMetricRow(r.label, r.key, r.decimals)).join("")}
      </div>
    </div>
  `;

  container.innerHTML = tableHTML;

  // Attach remove handlers
  container.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.removeId);
      const player = state.selectedPlayers.find((p) => p.id === id);
      if (player) {
        togglePlayerSelection(player);
        const newIds = state.selectedPlayers.map((p) => p.id).join(",");
        window.history.pushState({}, "", newIds ? `/compare?ids=${newIds}` : "/compare");
        renderComparisonBoard();
        renderRadarChart();
      }
    });
  });
}

/**
 * Renders an SVG Radar Chart comparing 2-4 players.
 *
 * Mathematical SVG Radar Implementation:
 * - 6 axes corresponding to key per-90 metrics.
 * - Scaled from 0 to the maximum among the compared players.
 * - Missing values (null) are NOT drawn as 0! They are safely omitted or marked in legend.
 */
function renderRadarChart() {
  const chartWrap = $("radar-chart-wrap");
  const legendWrap = $("radar-legend");
  if (!chartWrap || !legendWrap) return;

  const ps = state.selectedPlayers;
  if (ps.length < 2) {
    chartWrap.innerHTML = "";
    legendWrap.innerHTML = "";
    return;
  }

  const radarMetrics = [
    { key: "np_xg_p90", label: "Non-pen xG" },
    { key: "xa_p90", label: "Expected Ast" },
    { key: "key_passes_p90", label: "Key Passes" },
    { key: "shots_p90", label: "Shots" },
    { key: "tackles_won_p90", label: "Tackles Won" },
    { key: "interceptions_p90", label: "Interceptions" },
  ];

  // Distinct theme colors for up to 4 players
  const playerColors = ["#374a3a", "#a85848", "#365b73", "#b67828"];

  // Find max value for each metric across the selected players
  const metricMaxes = radarMetrics.map((m) => {
    const vals = ps.map((p) => p[m.key]).filter((v) => v !== null && !isNaN(Number(v))).map(Number);
    return vals.length > 0 ? Math.max(...vals, 0.05) : 1;
  });

  const width = 560;
  const height = 440;
  const centerX = width / 2;
  const centerY = height / 2;
  const radius = 140;
  const numAxes = radarMetrics.length;

  // Background concentric polygon webs (25%, 50%, 75%, 100%)
  const rings = [0.25, 0.5, 0.75, 1.0];
  let ringsSVG = "";
  rings.forEach((ringPct) => {
    const ringRadius = radius * ringPct;
    const points = [];
    for (let i = 0; i < numAxes; i++) {
      const angle = (i / numAxes) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + ringRadius * Math.cos(angle);
      const y = centerY + ringRadius * Math.sin(angle);
      points.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    ringsSVG += `<polygon points="${points.join(" ")}" fill="none" stroke="#dedcd5" stroke-width="1" />`;
  });

  // Radial axes lines & labels
  let axesSVG = "";
  radarMetrics.forEach((m, i) => {
    const angle = (i / numAxes) * 2 * Math.PI - Math.PI / 2;
    const endX = centerX + radius * Math.cos(angle);
    const endY = centerY + radius * Math.sin(angle);
    axesSVG += `<line x1="${centerX}" y1="${centerY}" x2="${endX.toFixed(1)}" y2="${endY.toFixed(1)}" stroke="#dedcd5" stroke-width="1.2" />`;

    // Outer label placement
    const labelRadius = radius + 28;
    const labelX = centerX + labelRadius * Math.cos(angle);
    const labelY = centerY + labelRadius * Math.sin(angle);

    let textAnchor = "middle";
    if (Math.abs(Math.cos(angle)) > 0.3) {
      textAnchor = Math.cos(angle) > 0 ? "start" : "end";
    }

    axesSVG += `
      <text
        x="${labelX.toFixed(1)}"
        y="${(labelY + 4).toFixed(1)}"
        font-family="DM Mono, monospace"
        font-size="11"
        font-weight="600"
        fill="#6f7872"
        text-anchor="${textAnchor}"
      >${m.label}</text>
    `;
  });

  // Player radar polygons
  let playersPolygonsSVG = "";
  let legendHTML = "";

  ps.forEach((p, pIndex) => {
    const color = playerColors[pIndex % playerColors.length];
    const points = [];
    let missingNotes = [];

    radarMetrics.forEach((m, mIndex) => {
      const val = p[m.key];
      const maxVal = metricMaxes[mIndex];

      if (val === null || val === undefined || isNaN(Number(val))) {
        missingNotes.push(m.label);
        return; // Exclude missing points: NEVER plot as 0!
      }

      const ratio = Math.min(1.0, Math.max(0.02, Number(val) / maxVal));
      const angle = (mIndex / numAxes) * 2 * Math.PI - Math.PI / 2;
      const x = centerX + ratio * radius * Math.cos(angle);
      const y = centerY + ratio * radius * Math.sin(angle);

      points.push({ x, y, val: Number(val), label: m.label });
    });

    if (points.length >= 3) {
      const pointsStr = points.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(" ");
      playersPolygonsSVG += `
        <polygon
          points="${pointsStr}"
          fill="${color}"
          fill-opacity="0.18"
          stroke="${color}"
          stroke-width="2.5"
        />
      `;

      // Plot point circles
      points.forEach((pt) => {
        playersPolygonsSVG += `
          <circle
            cx="${pt.x.toFixed(1)}"
            cy="${pt.y.toFixed(1)}"
            r="4.5"
            fill="${color}"
            stroke="#ffffff"
            stroke-width="1.5"
          >
            <title>${p.player} — ${pt.label}: ${pt.val.toFixed(2)}</title>
          </circle>
        `;
      });
    }

    // Legend item
    legendHTML += `
      <div class="legend-item">
        <span class="legend-color" style="background-color: ${color};"></span>
        <span><strong>${p.player}</strong> (${p.season_label})</span>
        ${missingNotes.length > 0 ? `<small class="muted">· [N/A: ${missingNotes.join(", ")}]</small>` : ""}
      </div>
    `;
  });

  chartWrap.innerHTML = `
    <svg class="radar-svg" viewBox="0 0 ${width} ${height}" aria-label="Tactical per-90 radar comparison">
      ${ringsSVG}
      ${axesSVG}
      ${playersPolygonsSVG}
    </svg>
  `;

  legendWrap.innerHTML = legendHTML;
}

/**
 * Setup candidate search on compare page to easily search and add players from any season.
 */
function setupCompareCandidateSearch() {
  const searchInput = $("compare-search");
  const candidatesContainer = $("compare-candidates");
  if (!searchInput || !candidatesContainer) return;

  let timer = null;

  async function searchCandidates() {
    const query = searchInput.value.trim();
    if (!query) {
      candidatesContainer.innerHTML = '<span class="mono muted">Type a name above to search candidates across all seasons.</span>';
      return;
    }

    try {
      const players = await fetchAPI(`/api/players?name=${encodeURIComponent(query)}&include_low_minutes=true&limit=12`);
      const existingIds = new Set(state.selectedPlayers.map((p) => p.id));
      const available = players.filter((p) => !existingIds.has(p.id));

      if (available.length === 0) {
        candidatesContainer.innerHTML = '<span class="mono muted">No matching players found.</span>';
        return;
      }

      candidatesContainer.innerHTML = available
        .map(
          (p) => `
          <button class="candidate-chip" type="button" data-add-id="${p.id}">
            + ${p.player} · ${p.team || "—"} (${p.season_label}) · ${p.role}
          </button>
        `
        )
        .join("");

      candidatesContainer.querySelectorAll("[data-add-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = Number(btn.dataset.addId);
          const target = available.find((p) => p.id === id);
          if (target) {
            togglePlayerSelection(target);
            const newIds = state.selectedPlayers.map((p) => p.id).join(",");
            window.history.pushState({}, "", `/compare?ids=${newIds}`);
            renderComparisonBoard();
            renderRadarChart();
            searchCandidates();
          }
        });
      });
    } catch (e) {
      console.error("Candidate search failed:", e);
    }
  }

  searchInput.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(searchCandidates, 200);
  });
}

// =============================================================================
// 7. PLAYER PROFILE PAGE LOGIC (player.html)
// =============================================================================

async function initProfilePage() {
  const container = $("profile-container");
  const headActions = $("profile-head-actions");
  if (!container) return;

  // Extract ID from pathname: /player/{id}
  const match = window.location.pathname.match(/\/player\/(\d+)/);
  if (!match) {
    container.innerHTML = `<div class="empty-state"><h3>Invalid Player Profile URL</h3></div>`;
    return;
  }

  const playerId = Number(match[1]);

  try {
    const player = await fetchAPI(`/api/players/${playerId}`);

    // Update document title
    document.title = `${player.player} — Ball Knowledge Scouting Dossier`;

    const isLowMinutes = player.nineties !== null && player.nineties < 5;

    // Render Hero Card
    container.innerHTML = `
      <section class="profile-hero-card">
        <div class="profile-hero-grid">
          <div>
            ${createAvatarHTML(player, "profile-avatar")}
          </div>
          <div class="profile-hero-info">
            <span class="eyebrow">${player.role || "Other"} · ${player.pos || "—"}</span>
            <h1>${player.player}</h1>
            <div class="player-team" style="font-size:15px; margin-bottom:6px;">
              <strong>${player.team || "—"}</strong> · ${player.season_label} · ${player.league ? player.league.replace(/^[A-Z]{3}-/, "") : "—"}
            </div>
            <div class="profile-badges">
              <span class="badge badge-role">Nationality: ${player.nation || "—"}</span>
              <span class="badge badge-role">Age: ${formatNumber(player.age, 0)}</span>
              <span class="badge badge-role">Height: ${player.fifa_height ? player.fifa_height + " cm" : "N/A"}</span>
              <span class="badge badge-role">Foot: ${player.fifa_foot || "N/A"}</span>
              ${isLowMinutes ? '<span class="badge badge-low-min">⚠️ Low Minutes (&lt;5 90s)</span>' : ""}
            </div>
          </div>
          <div class="profile-ratings-badge">
            <div class="profile-ovr">${formatNumber(player.fifa_overall_rating, 0)}</div>
            <span>EA FC rating (game rating)</span>
            <div style="margin-top:10px; font-weight:700; font-size:16px;">${formatCurrency(player.fifa_value_eur)}</div>
            <span>EA FC value (game estimate)</span>
          </div>
        </div>
      </section>

      <!-- Season Totals Grid -->
      <h3 class="profile-section-title">Season Totals (Absolute Output)</h3>
      <div class="stats-card-grid">
        <div class="stat-box">
          <div class="stat-label">Goals</div>
          <div class="stat-val">${formatNumber(player.fb_gls, 0)}</div>
          <div class="stat-sub">Season total</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Assists</div>
          <div class="stat-val">${formatNumber(player.fb_ast, 0)}</div>
          <div class="stat-sub">Season total</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Minutes Played</div>
          <div class="stat-val">${formatNumber(player.playing_time_min, 0)}</div>
          <div class="stat-sub">${formatNumber(player.playing_time_mp, 0)} matches</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">90s Completed</div>
          <div class="stat-val">${formatNumber(player.nineties, 1)}</div>
          <div class="stat-sub">Full matches equiv.</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Expected Goals (xG)</div>
          <div class="stat-val">${formatNumber(player.us_xg, 2)}</div>
          <div class="stat-sub">Understat quality model</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Expected Assists (xA)</div>
          <div class="stat-val">${formatNumber(player.us_xa, 2)}</div>
          <div class="stat-sub">Understat chance model</div>
        </div>
      </div>

      <!-- Per 90 Rate Statistics Grid -->
      <h3 class="profile-section-title">Per 90 Minutes Output (Rate Normalized)</h3>
      <div class="stats-card-grid">
        <div class="stat-box">
          <div class="stat-label">Non-Penalty xG / 90</div>
          <div class="stat-val">${formatNumber(player.np_xg_p90, 2)}</div>
          <div class="stat-sub">Open play finishing rate</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Expected Assists / 90</div>
          <div class="stat-val">${formatNumber(player.xa_p90, 2)}</div>
          <div class="stat-sub">Chance creation rate</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Key Passes / 90</div>
          <div class="stat-val">${formatNumber(player.key_passes_p90, 2)}</div>
          <div class="stat-sub">Shot assists</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Shots / 90</div>
          <div class="stat-val">${formatNumber(player.shots_p90, 2)}</div>
          <div class="stat-sub">Shooting volume</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Tackles Won / 90</div>
          <div class="stat-val">${formatNumber(player.tackles_won_p90, 2)}</div>
          <div class="stat-sub">Ground challenges</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Interceptions / 90</div>
          <div class="stat-val">${formatNumber(player.interceptions_p90, 2)}</div>
          <div class="stat-sub">Passing lane breaks</div>
        </div>
      </div>
    `;

    // Action button in header
    if (headActions) {
      const isSelected = state.selectedPlayers.some((p) => p.id === player.id);
      headActions.innerHTML = `
        <button id="profile-compare-btn" class="button ${isSelected ? "button-outline" : "button-primary"}" type="button">
          ${isSelected ? "Remove from Comparison ✕" : "Add to Comparison Board ↗"}
        </button>
      `;

      $("profile-compare-btn").addEventListener("click", () => {
        togglePlayerSelection(player);
        initProfilePage(); // Refresh button state
      });
    }

    // Load Step 7: Similar Players
    loadSimilarPlayers(playerId);
  } catch (err) {
    console.error("Profile load error:", err);
    container.innerHTML = `
      <div class="empty-state">
        <h3>Player Not Found</h3>
        <p>The requested player record could not be found in the database.</p>
        <a href="/" class="button button-outline">Return to Directory</a>
      </div>
    `;
  }
}

/**
 * Step 7: Fetches and displays stylistically similar players via cosine similarity.
 * @param {number} playerId - Player ID
 */
async function loadSimilarPlayers(playerId) {
  const container = $("similar-grid");
  if (!container) return;

  try {
    const data = await fetchAPI(`/api/players/${playerId}/similar?limit=5`);

    if (!data.similar || data.similar.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1 / -1; padding: 24px; background: var(--panel); border: 1px dashed var(--line); border-radius: var(--radius-md);">
          <p class="mono muted" style="margin:0;">${data.message || "No qualifying similar players found with sufficient minutes (≥10 nineties)."}</p>
        </div>
      `;
      return;
    }

    container.innerHTML = data.similar
      .map(
        (sim) => `
        <article class="similar-card">
          <div class="similarity-badge">${sim.similarity_pct}% Similarity</div>
          ${createAvatarHTML(sim, "avatar-small")}
          <h4 class="player-name" style="margin: 8px 0 2px;">
            <a href="/player/${sim.id}">${sim.player}</a>
          </h4>
          <div class="player-team" style="font-size:11px;">${sim.team}</div>
          <div class="player-league-season" style="margin-bottom:12px;">${sim.league.replace(/^[A-Z]{3}-/, "")} · ${sim.season_label}</div>
          <div style="margin-top:auto; display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--line); padding-top:8px;">
            <span class="mono muted" style="font-size:10px;">${sim.fifa_overall_rating ? sim.fifa_overall_rating + " OVR" : "N/A"}</span>
            <a href="/compare?ids=${playerId},${sim.id}" class="profile-link" style="font-size:10px;">Compare ↗</a>
          </div>
        </article>
      `
      )
      .join("");
  } catch (e) {
    console.warn("Could not load similar players:", e);
    container.innerHTML = '<span class="mono muted">Stylistic similarity profile unavailable.</span>';
  }
}

// =============================================================================
// 8. ROUTING & ENTRY POINT INITIALIZATION
// =============================================================================

document.addEventListener("DOMContentLoaded", () => {
  const path = window.location.pathname;

  if (path === "/" || path === "/index.html") {
    initDirectoryPage().catch((err) => console.error("Directory init failed:", err));
  } else if (path === "/compare") {
    initComparePage().catch((err) => console.error("Compare init failed:", err));
  } else if (path.startsWith("/player/")) {
    initProfilePage().catch((err) => console.error("Profile init failed:", err));
  }
});
