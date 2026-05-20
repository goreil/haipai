// Sidebar game list + game-detail (rounds & summary) view + game-rating
// thresholds + categorization polling + delete.

// --- Game rating ---

function computeRatingThresholds() {
  // Compute percentile thresholds from all games with ev_per_decision
  const evpts = state.games
    .map(g => (g.summary || {}).ev_per_decision)
    .filter(v => v != null)
    .sort((a, b) => a - b);
  if (evpts.length < 3) return { p25: 0.14, p50: 0.19 };
  const p25 = evpts[Math.floor(evpts.length * 0.25)];
  const p50 = evpts[Math.floor(evpts.length * 0.50)];
  return { p25, p50 };
}

function gameRating(summary) {
  if (!summary || !summary.total_decisions) return { icon: "", label: "", cls: "" };
  const evpt = summary.ev_per_decision;
  if (evpt == null) return { icon: "", label: "", cls: "" };

  const th = computeRatingThresholds();
  // Top 25%: excellent
  if (evpt <= th.p25) return { icon: "★", label: "One of your best", cls: "rating-excellent" };
  // Top 50%: good
  if (evpt <= th.p50) return { icon: "☆", label: "Above your average", cls: "rating-great" };
  return { icon: "", label: "", cls: "" };
}

// --- Fetch ---

async function fetchGames() {
  const res = await fetch("/api/games");
  state.games = await res.json();
  renderGameList();
  if (state.games.length === 0 && !state.currentGame) {
    showOnboarding();
  }
}

function showOnboarding() {
  document.getElementById("content").innerHTML = `
    <div class="onboarding">
      <h2>Welcome to Haipai</h2>
      <p>Haipai analyzes your Riichi Mahjong games using Mortal AI to help you study your mistakes and track improvement over time.</p>
      <h3>How to add your first game</h3>
      <ol>
        <li>Play a game on <a href="https://tenhou.net" target="_blank">Tenhou</a> or <a href="https://mahjongsoul.game.yo-star.com" target="_blank">Mahjong Soul</a></li>
        <li>Go to <a href="https://mjai.ekyu.moe" target="_blank">mjai.ekyu.moe</a> and paste your replay link</li>
        <li>Wait for Mortal AI to finish analysis</li>
        <li>Download the analysis JSON:
          <ul class="onboarding-sub">
            <li>In the address bar, find the part that says <code>/report/...json</code></li>
            <li>Open that path directly: <code>https://mjai.ekyu.moe/report/abc123.json</code></li>
            <li>You'll see a page of raw data &mdash; press <b>Ctrl+S</b> (Cmd+S on Mac) to save it</li>
          </ul>
        </li>
        <li>Click <strong>+ Add Game</strong> below and upload the saved file</li>
      </ol>
      <button class="btn btn-primary" onclick="showAddModal()">+ Add Game</button>
    </div>
  `;
}

async function fetchGame(id) {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) {
    // Bad deep-link or game not owned: drop the hash so the listener doesn't
    // re-fire, and leave the user on the game list.
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
    state.currentGame = null;
    state.currentGameData = null;
    document.getElementById("content").innerHTML = '<div class="empty-state">Game not found</div>';
    return;
  }
  state.currentGameData = await res.json();
  state.currentGame = id;
  const want = `#game=${id}`;
  if (window.location.hash !== want) history.replaceState(null, "", want);
  // First render uses any stored prep fields (advisory) + JS categorize so
  // the user sees the game immediately. Then refreshPrepAndRecategorize
  // re-runs prep on the live mortal_data — JS prep is authoritative.
  recategorizeGameInPlace(state.currentGameData);
  state.currentGameData.summary = recomputeSummaryByCategory(state.currentGameData);
  state.prepProgress = _prepProgressInitial(state.currentGameData);
  autoSetSeverityFilters(state.currentGameData);
  if (state.scrollToMistakeId != null) {
    ensureMistakeVisible(state.currentGameData, state.scrollToMistakeId);
  }
  renderGame();
  await refreshPrepAndRecategorize(state.currentGameData, id);
}

// Pick a default severity filter for the loaded game: severe is always on,
// then enable Mistake → Light → Unsure cumulatively until at least 5 cards
// are visible. The user can still toggle off afterwards — this just avoids
// the case where a quiet game shows only 1-2 severe cards by default.
function autoSetSeverityFilters(game) {
  state.showMistake = false;
  state.showLight = false;
  state.showUnsure = false;
  const counts = { severe: 0, mistake: 0, light: 0, unsure: 0 };
  for (const rnd of game.rounds || []) {
    for (const m of rnd.mistakes || []) counts[sevTier(m.ev_loss)]++;
  }
  let visible = counts.severe;
  if (visible < 5) { state.showMistake = true; visible += counts.mistake; }
  if (visible < 5) { state.showLight = true; visible += counts.light; }
  if (visible < 5) { state.showUnsure = true; }
  _syncSeverityCheckboxes();
}

// Force the filter for `mistakeId`'s tier on so a #mistake=<id> deep-link
// can't land on a hidden card. Severe is always visible, so no-op there.
function ensureMistakeVisible(game, mistakeId) {
  if (!game || mistakeId == null) return;
  let target = null;
  for (const rnd of game.rounds || []) {
    for (const m of rnd.mistakes || []) {
      if (m.id === mistakeId) { target = m; break; }
    }
    if (target) break;
  }
  if (!target) return;
  const tier = sevTier(target.ev_loss);
  if (tier === "mistake") state.showMistake = true;
  else if (tier === "light") state.showLight = true;
  else if (tier === "unsure") state.showUnsure = true;
  _syncSeverityCheckboxes();
}

// Mirror state.show* into the toolbar checkboxes. The checkboxes live in
// index.html (not re-rendered), so we write their `.checked` property
// directly. Order matches index.html: Mistake, Light, Unsure.
function _syncSeverityCheckboxes() {
  const filters = document.getElementById("severity-filters");
  if (!filters) return;
  const cbs = filters.querySelectorAll("input[type=checkbox]");
  if (cbs[0]) cbs[0].checked = state.showMistake;
  if (cbs[1]) cbs[1].checked = state.showLight;
  if (cbs[2]) cbs[2].checked = state.showUnsure;
}

function _prepProgressInitial(game) {
  if (!game || typeof haipaiPrep === "undefined" || !game.mortal_data) return null;
  const kyokus = ((game.mortal_data.review || {}).kyokus) || [];
  if (!kyokus.length) return null;
  return { done: 0, total: kyokus.length };
}

// Async refresh: re-run JS prep on the live mortal_data, ticking the banner
// per kyoku. When prep completes, re-categorize, recompute summary, drop the
// banner, and re-render. Bails out if the user navigates to a different game
// mid-flight (a stale prep result must not overwrite the new game's state).
async function refreshPrepAndRecategorize(game, gameId) {
  if (!game || typeof haipaiPrep === "undefined" || !game.mortal_data) {
    state.prepProgress = null;
    return;
  }
  try {
    await haipaiPrep.prepGameAsync(game, game.mortal_data, (done, total) => {
      if (state.currentGame !== gameId) return;
      state.prepProgress = { done, total };
      _updatePrepBannerDOM();
    });
  } finally {
    if (state.currentGame === gameId) {
      recategorizeGameInPlace(game);
      game.summary = recomputeSummaryByCategory(game);
      state.prepProgress = null;
      renderGame();
    }
  }
}

// In-place DOM update for the prep progress bar — avoids re-rendering the
// entire game body on every kyoku tick (rounds + mistake cards are expensive
// to rebuild). Falls through silently if the banner isn't on screen, since
// re-render will pick up the latest state.prepProgress anyway.
function _updatePrepBannerDOM() {
  const banner = document.getElementById("prep-progress-banner");
  if (!banner) return;
  const p = state.prepProgress;
  if (!p) {
    banner.style.display = "none";
    return;
  }
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  const label = banner.querySelector(".prep-progress-label");
  const fill = banner.querySelector(".cat-progress-fill");
  if (label) label.textContent = `Re-analyzing categories… ${p.done}/${p.total} rounds`;
  if (fill) fill.style.width = pct + "%";
}

// Run the JS categorizer over every mistake, overwriting category /
// categorize_data / labels in place. Same shape as what the backend
// stored — downstream renderers read these fields and don't care that
// they were rewritten client-side.
function recategorizeGameInPlace(game) {
  if (!game || !game.rounds) return;
  if (typeof haipaiCategorize === "undefined") return;
  for (const rnd of game.rounds) {
    for (const m of rnd.mistakes || []) {
      const out = haipaiCategorize.categorize(m);
      m.category = out.category;
      m.categorize_data = out.categorize_data;
      m.labels = out.labels;
    }
  }
}

// Recompute summary.by_category from the JS-categorized mistakes so
// per-game stats line up with what the user sees. The backend's
// stored stats_json was written off the (now potentially stale)
// server-side categories.
function recomputeSummaryByCategory(game) {
  const summary = { ...(game.summary || {}) };
  const byCat = {};
  let total = 0, evLoss = 0;
  for (const rnd of game.rounds || []) {
    for (const m of rnd.mistakes || []) {
      total++;
      const ev = m.ev_loss || 0;
      evLoss += ev;
      if (m.category) {
        if (!byCat[m.category]) byCat[m.category] = { count: 0, ev: 0 };
        byCat[m.category].count++;
        byCat[m.category].ev = +(byCat[m.category].ev + ev).toFixed(2);
      }
    }
  }
  summary.by_category = byCat;
  summary.total_mistakes = total;
  summary.total_ev_loss = +evLoss.toFixed(2);
  return summary;
}

async function saveAnnotation(gameId, round, turn, index, note) {
  const res = await apiPost(`/api/games/${gameId}/annotate`, { round, turn, index, note });
  const data = await res.json();
  if (data.ok) {
    state.currentGameData.summary = data.summary;
    const gameInfo = state.games.find(g => g.id === gameId);
    if (gameInfo) {
      gameInfo.summary = data.summary;
      renderGameList();
    }
  }
  return data;
}

async function addGameWithProgress(mortalData, date, onProgress) {
  const res = await apiPost("/api/games/add", { mortal_data: mortalData, date: date || undefined });
  if (!res.ok) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: `Server error ${res.status}: ${text.slice(0, 200)}` }; }
  }
  return await res.json();
}

// --- Render: Game List ---

function renderGameList() {
  const list = document.getElementById("game-list");
  const sorted = [...state.games].sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
  let lastDate = "";
  list.innerHTML = sorted.map(g => {
    const s = g.summary || {};
    const active = g.id === state.currentGame ? "active" : "";
    const rating = gameRating(s);
    const dateObj = new Date(g.date + "T00:00:00");
    const shortDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    let sep = "";
    if (g.date !== lastDate) {
      lastDate = g.date;
      sep = `<div class="date-separator">${shortDate}</div>`;
    }
    return `${sep}
      <div class="game-item ${active}" onclick="fetchGame(${g.id})">
        <div class="date"><span class="dev-id" title="game id">#${g.id}</span>${rating.icon ? ` <span class="game-rating-icon" title="${rating.label}">${rating.icon}</span>` : ""} ${
          s.total_mistakes || 0} mistakes &middot; ${(s.total_ev_loss || 0).toFixed(2)} EV${
          s.total_decisions ? ` &middot; ${s.ev_per_decision.toFixed(4)}/D` : ""}</div>
      </div>
    `;
  }).join("");
}

// --- Render: Game Detail ---

function setSeverityFiltersVisible(show) {
  const el = document.getElementById("severity-filters");
  if (el) el.style.display = show ? "" : "none";
}

function renderGame() {
  setSeverityFiltersVisible(true);
  const game = state.currentGameData;
  if (!game) return;
  const content = document.getElementById("content");

  const s = game.summary || {};

  // Recount by UI tier (server-side by_severity only has 3 buckets).
  const tierCounts = { severe: 0, mistake: 0, light: 0, unsure: 0 };
  for (const rnd of game.rounds) {
    for (const mi of rnd.mistakes) tierCounts[sevTier(mi.ev_loss)]++;
  }

  const dateObj = new Date(game.date + "T00:00:00");
  const displayDate = dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  let html = `
    <div class="game-header">
      <h2>${displayDate}<span class="dev-id" title="game id">#${state.currentGame}</span>
        <button class="btn btn-delete" onclick="deleteGame(${state.currentGame})" title="Delete game">Delete</button>
      </h2>
      ${game.log_url ? `<div class="log-link"><a href="${game.log_url}" target="_blank">${game.log_url}</a></div>` : ""}
    </div>


    <div class="summary-bar">
      <div class="stat"><span class="value">${s.total_mistakes || 0}</span><span class="label">Mistakes</span></div>
      <div class="stat"><span class="value">${(s.total_ev_loss || 0).toFixed(2)}</span><span class="label">EV Loss</span></div>
      ${s.total_decisions ? `<div class="stat"><span class="value">${s.total_decisions}</span><span class="label">Decisions</span></div>
      <div class="stat"><span class="value">${s.ev_per_decision.toFixed(4)}</span><span class="label">EV/Decision</span></div>` : ""}
      <div class="stat" title="EV loss > 1.0"><span class="value" style="color:var(--sev-major)">${tierCounts.severe}</span><span class="label">Severe</span></div>
      <div class="stat" title="EV loss 0.5–1.0"><span class="value" style="color:var(--sev-medium)">${tierCounts.mistake}</span><span class="label">Mistake</span></div>
      <div class="stat" title="EV loss 0.2–0.5"><span class="value" style="color:var(--sev-light)">${tierCounts.light}</span><span class="label">Light</span></div>
      <div class="stat" title="EV loss < 0.2 — AI not confident"><span class="value" style="color:var(--sev-minor)">${tierCounts.unsure}</span><span class="label">Unsure</span></div>
    </div>
  `;

  // JS prep banner. Categorization itself runs in JS at render time
  // (see recategorizeGameInPlace); the only progress worth showing is the
  // ~700 ms async re-prep on the live mortal_data. _updatePrepBannerDOM
  // ticks the bar in place without re-rendering the whole game body.
  if (state.prepProgress) {
    const p = state.prepProgress;
    const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
    html += `<div id="prep-progress-banner" class="categorization-banner pending">
      <span class="prep-progress-label">Re-analyzing categories… ${p.done}/${p.total} rounds</span>
      <div class="cat-progress-bar"><div class="cat-progress-fill" style="width:${pct}%"></div></div>
    </div>`;
  }

  // Positive feedback banner
  const rating = gameRating(s);
  if (rating.icon) {
    const cleanRounds = game.rounds.filter(r => r.mistakes.length === 0).length;
    html += `<div class="game-rating ${rating.cls}">
      <span class="game-rating-star">${rating.icon}</span>
      <span>${rating.label}</span>
      ${cleanRounds > 0 ? `<span class="game-rating-detail">${cleanRounds}/${game.rounds.length} clean rounds</span>` : ""}
    </div>`;
  }

  // Filter banner (7b): show when severity filters hide some mistakes
  const totalMistakes = game.rounds.reduce((sum, r) => sum + r.mistakes.length, 0);
  const visibleMistakes = game.rounds.reduce((sum, r) => sum + r.mistakes.filter(m => {
    const t = sevTier(m.ev_loss);
    if (t === "unsure" && !state.showUnsure) return false;
    if (t === "light" && !state.showLight) return false;
    if (t === "mistake" && !state.showMistake) return false;
    return true;
  }).length, 0);
  if (totalMistakes > 0 && visibleMistakes < totalMistakes && state.gameView === "rounds") {
    const hidden = totalMistakes - visibleMistakes;
    html += `<div class="filter-banner">Showing ${visibleMistakes} of ${totalMistakes} mistakes. ${hidden} hidden by severity filter.</div>`;
  }

  // View tabs
  html += `<div class="game-tabs">
    <button class="game-tab ${state.gameView === "rounds" ? "active" : ""}" onclick="switchGameView('rounds')">Rounds</button>
    <button class="game-tab ${state.gameView === "summary" ? "active" : ""}" onclick="switchGameView('summary')">Summary</button>
  </div>`;

  if (state.gameView === "rounds") {
  // Rounds
  for (const rnd of game.rounds) {
    const visible = rnd.mistakes.filter(m => {
      const t = sevTier(m.ev_loss);
      if (t === "unsure" && !state.showUnsure) return false;
      if (t === "light" && !state.showLight) return false;
      if (t === "mistake" && !state.showMistake) return false;
      return true;
    });

    const outcomeStr = rnd.outcome ? (OUTCOME_EMOJI[rnd.outcome] || rnd.outcome) : "";
    const turnStr = rnd.turn_count ? `T${rnd.turn_count}` : "";

    const isClean = rnd.mistakes.length === 0;
    html += `<div class="round${isClean ? " round-clean" : ""}">`;
    html += `<div class="round-header">
      <span>${rnd.round}${turnStr}</span>
      ${outcomeStr ? `<span class="outcome">${outcomeStr}</span>` : ""}
      ${isClean ? '<span class="clean-badge">Clean</span>' : ""}
      ${!isClean && visible.length !== rnd.mistakes.length ?
        `<span style="font-size:12px;color:var(--text-dim)">(${visible.length}/${rnd.mistakes.length})</span>` : ""}
    </div>`;

    // Track turn index for duplicate turn disambiguation
    const turnCounts = {};
    for (const m of rnd.mistakes) {
      const key = m.turn;
      turnCounts[key] = (turnCounts[key] || 0) + 1;
    }
    const turnSeen = {};

    for (const m of rnd.mistakes) {
      const turnKey = m.turn;
      const idx = turnSeen[turnKey] = (turnSeen[turnKey] || 0);
      turnSeen[turnKey]++;

      const mTier = sevTier(m.ev_loss);
      if (mTier === "unsure" && !state.showUnsure) continue;
      if (mTier === "light" && !state.showLight) continue;
      if (mTier === "mistake" && !state.showMistake) continue;

      const sc = sevClass(m);
      const dataAttrs = `data-game="${state.currentGame}" data-round="${rnd.round}" data-turn="${m.turn}" data-index="${idx}"`;
      const midAttr = m.id ? ` data-mid="${m.id}"` : "";
      const catGrpColor = GROUP_COLORS[catGroup(m.category)] || null;
      const cardStyle = catGrpColor ? ` style="border-left-color:${catGrpColor}"` : "";

      html += `<div class="mistake ${sc}" ${dataAttrs}${midAttr}${cardStyle}>`;
      html += `<div class="mistake-top">`;
      html += `<span class="turn-num">T${m.turn}</span>`;
      if (m.id) html += `<span class="dev-id" title="mistake id">#${m.id}</span>`;
      html += `<span class="severity ${sc}" title="${sevTooltip(m)}">${sevLabel(m)}</span>`;
      html += `<span class="ev-loss">${m.ev_loss.toFixed(2)} EV</span>`;
      if (m.category) {
        const grp = catGroup(m.category);
        const color = GROUP_COLORS[grp] || "#888";
        const desc = catDesc(m.category);
        html += `<span class="cat-badge" style="background:${color}20;color:${color};border:1px solid ${color}40" title="${desc}">${catLabel(m.category)}</span>`;
      }
      if (m.bad_riichi_reason === "furiten") {
        const tip = (m.furiten_tiles || []).length
          ? `Already discarded ${m.furiten_tiles.join(", ")} — can't ron.`
          : "Wait includes a tile you've already discarded — can't ron.";
        html += `<span class="furiten-badge" title="${tip}">Furiten</span>`;
      }
      const raised = mortalRaisedShanten(m);
      if (raised) {
        const tip = `Your ${raised.userTile} keeps ${raised.userSh}-shanten; Mortal's ${raised.mortalTile} goes to ${raised.mortalSh}-shanten — Mortal is breaking up the hand for a strategic reason (likely yaku or value), not for tile efficiency.`;
        html += `<span class="raised-shanten-badge" title="${tip}">Mortal raised shanten</span>`;
      }
      if (m.shanten != null) {
        html += `<span class="shanten">${m.shanten}-shanten</span>`;
      }
      if (m.actual && m.expected) {
        const actStr = formatAction(m.actual);
        const expStr = formatAction(m.expected);
        if (actStr !== expStr) {
          html += `<span class="discard-comparison">
            <span class="played">${renderAction(m.actual, "played")}</span>
            <span class="arrow">&rarr;</span>
            <span class="ai">${renderAction(m.expected, "ai")}</span>
          </span>`;
        }
      }
      html += `</div>`;

      // Hand + melds on same row
      if (m.hand && m.hand.length) {
        const doraTiles = getDoraTiles(m.board_state);
        html += `<div class="hand-row">
          <span class="label">Hand</span>
                    <span class="tiles">${renderHand(m.hand, m.draw, m, doraTiles)}</span>`;
        if (m.melds && m.melds.length) {
          const playerSeat = m.actual ? m.actual.actor : null;
          const oya = mistakeOya(m);
          html += `<span class="inline-melds">`;
          for (const meld of m.melds) {
            html += renderMeld(meld, "action-tile-sm", playerSeat, doraTiles, oya) + " ";
          }
          html += `</span>`;
        }
        html += `</div>`;
      }

      // Board context (dora, winds, all discards, scores, opponent melds)
      html += renderBoardContext(m);
      html += renderTenpaiWaitsRow(m);

      // Fallback: old opponent_discards (for mistakes without board_state)
      if (!m.board_state && m.opponent_discards && m.opponent_discards.length) {
        html += `<div class="opp-discards">`;
        for (const opp of m.opponent_discards) {
          const seatName = SEAT_NAMES[opp.seat] || `P${opp.seat}`;
          html += `<div class="opp-discard-row">`;
          html += `<span class="opp-label">${seatName}</span>`;
          html += `<span class="tiles">`;
          for (let di = 0; di < opp.discards.length; di++) {
            const isRiichi = di === opp.riichi_idx;
            html += renderTile(opp.discards[di], `action-tile-sm${isRiichi ? " riichi-tile" : ""}`);
          }
          html += `</span></div>`;
        }
        html += `</div>`;
      }

      // EV Comparison table (Mortal vs local shanten/ukeire)
      if (m.top_actions && m.top_actions.length && m.discard_stats && m.discard_stats.length) {
        html += renderEvComparison(m);
      } else if (m.top_actions && m.top_actions.length) {
        // Fallback: just show mortal top actions
        html += `<div class="top-actions">`;
        for (const a of m.top_actions) {
          html += `<span class="top-action">${renderAction(a.action)} <b>${a.q_value.toFixed(2)}</b></span>`;
        }
        html += `</div>`;
      }

      // Explanation
      {
        const explanation = generateExplanation(m);
        if (explanation) {
          html += `<div class="mascot-speech"><img src="/static/mascot.svg" class="mascot-avatar" alt="""><div class="speech-bubble">${explanation}</div></div>`;
        }
      }

      // Note input (always visible)
      {
        html += `<div class="note-row">
          <input type="text" class="note-input" placeholder="Add a note..." value="${(m.note || "").replace(/"/g, "&quot;")}"
                 onchange="onAnnotate(this)" ${dataAttrs}>
          <span class="save-indicator">Saved</span>
        </div>`;
      }

      // Category feedback (one-click agree / two disagreement kinds).
      if (m.id) {
        html += renderReportRow(m);
      }

      html += `</div>`; // .mistake
    }

    html += `</div>`; // .round
  }
  } // end if rounds view

  if (state.gameView === "summary") {
  // Category summary - grouped by skill area, scoped to this game
  {
    // Collect all mistakes from this game — and remember each one's round
    // name + per-turn index so the summary-view note/report inputs know where
    // to write via the shared annotate handler.
    const allMistakes = [];
    const mistakeLoc = new Map();  // mistake obj -> {round, index}
    for (const rnd of game.rounds || []) {
      const byTurn = {};
      for (const m of rnd.mistakes || []) {
        const idx = byTurn[m.turn] || 0;
        byTurn[m.turn] = idx + 1;
        m.round_name = rnd.round;
        allMistakes.push(m);
        mistakeLoc.set(m, {round: rnd.round, index: idx});
      }
    }

    // Build by_category from this game's mistakes
    const gameByCat = {};
    for (const m of allMistakes) {
      const cat = m.category;
      if (!cat) continue;
      if (!gameByCat[cat]) gameByCat[cat] = { count: 0, ev: 0, mistakes: [] };
      gameByCat[cat].count += 1;
      gameByCat[cat].ev = Math.round((gameByCat[cat].ev + (m.ev_loss || 0)) * 100) / 100;
      gameByCat[cat].mistakes.push(m);
    }

    if (Object.keys(gameByCat).length) {
      html += `<div class="game-summary"><h3>Mistake Breakdown</h3>`;

      // Group by skill area
      const groups = {};
      for (const [cat, data] of Object.entries(gameByCat)) {
        const grp = catGroup(cat);
        if (!groups[grp]) groups[grp] = { count: 0, ev: 0, subs: {}, mistakes: [] };
        groups[grp].count += data.count;
        groups[grp].ev += data.ev;
        groups[grp].subs[cat] = data;
        groups[grp].mistakes.push(...data.mistakes);
      }

      html += `<div class="category-groups">`;
      for (const [grp, data] of Object.entries(groups).sort((a, b) => b[1].ev - a[1].ev)) {
        const color = GROUP_COLORS[grp] || "#888";
        const grpId = grp.replace(/\s/g, "-").toLowerCase();
        html += `<div class="cat-group" style="border-left: 3px solid ${color}">
          <div class="cat-group-header" onclick="toggleGameMistakes('${grpId}')" style="cursor:pointer">
            <span class="cat-group-name" style="color:${color}">${grp}</span>
            <span class="cat-group-stat">${data.count} mistakes &middot; ${data.ev.toFixed(2)} EV <span class="cat-expand">&#9660;</span></span>
          </div>`;
        // Subcategories
        const subs = Object.entries(data.subs).sort((a, b) => b[1].ev - a[1].ev);
        for (const [cat, sub] of subs) {
          const info = CATEGORY_INFO[cat];
          const label = info ? info.label : cat;
          const desc = info ? info.desc : "";
          const tiers = { severe: 0, mistake: 0, light: 0, unsure: 0 };
          for (const m of sub.mistakes) tiers[sevTier(m.ev_loss)]++;
          html += `<div class="cat-sub" title="${desc}">
            <span class="cat-sub-label">${label}</span>
            <span class="cat-sub-count">${sub.count}</span>
            <span class="cat-sub-ev">${sub.ev.toFixed(2)} EV</span>
            <span class="tier-count sev-major" title="Severe">${tiers.severe} Severe</span>
            <span class="tier-count sev-medium" title="Mistake">${tiers.mistake} Mistake</span>
            <span class="tier-count sev-light" title="Light">${tiers.light} Light</span>
            <span class="tier-count sev-minor" title="Unsure">${tiers.unsure} Unsure</span>
          </div>`;
        }
        // Inline mistake list (hidden by default) with explanatory text
        const sorted = [...data.mistakes].sort((a, b) => (b.ev_loss || 0) - (a.ev_loss || 0));
        let panelHtml = sorted.map(m => {
          const explanation = generateExplanation(m);
          const explSpan = explanation ? `<div class="mascot-speech"><img src="/static/mascot.svg" class="mascot-avatar" alt="""><div class="speech-bubble">${explanation}</div></div>` : "";
          const loc = mistakeLoc.get(m) || {};
          const cardOpts = {
            annotate: true,
            gameId: state.currentGame,
            round: loc.round,
            index: loc.index,
          };
          return renderMistakeCard(m, cardOpts) + explSpan;
        }).join("");
        html += `<div id="game-mistakes-${grpId}" class="top-mistakes-panel" style="display:none">${panelHtml}</div>`;
        html += `</div>`;
      }
      html += `</div></div>`;
    }
  }
  } // end if summary view

  content.innerHTML = html;

  // Re-highlight active game in sidebar
  renderGameList();

  // Honour a pending scroll-to-mistake request from the #mistake=<id>
  // deep-link router. Only scrolls in the rounds view — the summary view
  // collapses cards into expandable groups, so there's nothing to scroll to.
  if (state.scrollToMistakeId && state.gameView === "rounds") {
    const target = state.scrollToMistakeId;
    requestAnimationFrame(() => {
      const el = document.querySelector(`.mistake[data-mid="${target}"]`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      el.classList.add("mistake-flash");
      setTimeout(() => el.classList.remove("mistake-flash"), 2000);
    });
    state.scrollToMistakeId = null;
  }
}

function switchGameView(view) {
  state.gameView = view;
  renderGame();
}

// --- Toggles for group panels (game-summary + trends + top-mistakes) ---

function toggleGameMistakes(grpId) {
  const panel = document.getElementById(`game-mistakes-${grpId}`);
  if (!panel) return;
  panel.style.display = panel.style.display === "none" ? "" : "none";
}

// Trends drill-down: panel content is pre-rendered by renderCategoryTrend —
// this is just a show/hide toggle. (`group` kept as arg for the onclick
// signature used in trends.js even though it's unused here.)
function toggleTrendMistakes(group, grpId) {
  const panel = document.getElementById(grpId);
  if (!panel) return;
  panel.style.display = panel.style.display === "none" ? "" : "none";
}


// --- Delete game ---

async function deleteGame(id) {
  if (!confirm(`Delete this game? This cannot be undone.`)) return;
  const res = await apiDelete(`/api/games/${id}`);
  const data = await res.json();
  if (data.ok) {
    state.currentGame = null;
    state.currentGameData = null;
    document.getElementById("content").innerHTML = '<div class="empty-state">Game deleted</div>';
    await fetchGames();
  }
}

function navigateHome() {
  state.currentGame = null;
  state.currentGameData = null;
  if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  renderGameList();
  document.getElementById("content").innerHTML = '<div class="empty-state">Select a game to review</div>';
}
