// Presentation layer for the game list/detail flow: sidebar list with date
// separators + ratings, game-detail render (rounds + summary tabs),
// mistake/category-group rendering, view-toggle helpers, and the
// navigate-home action that wipes the detail pane and re-renders the list.

// --- Game rating ---
// Thresholds + sevTier/sevClass/sevLabel/sevTooltip live in
// static/js/severity.js. gameRating() converts the threshold pair into the
// star icon + tooltip used in the sidebar list.

function gameRating(summary) {
  if (!summary || !summary.total_decisions) return { icon: "", label: "", cls: "" };
  const evpt = summary.ev_per_decision;
  if (evpt == null) return { icon: "", label: "", cls: "" };

  const th = computeThresholds(state.games);
  // Top 25%: excellent
  if (evpt <= th.p25) return { icon: "★", label: "One of your best", cls: "rating-excellent" };
  // Top 50%: good
  if (evpt <= th.p50) return { icon: "☆", label: "Above your average", cls: "rating-great" };
  return { icon: "", label: "", cls: "" };
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
      <div class="game-item ${active}" data-action="fetchGame" data-game-id="${g.id}">
        <div class="date"><a class="dev-id" href="#g${g.id}" data-action="openHash" title="Deep-link to this game">#g${g.id}</a>${rating.icon ? ` <span class="game-rating-icon" title="${rating.label}">${rating.icon}</span>` : ""} ${
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
      <h2>${displayDate}<a class="dev-id" href="#g${state.currentGame}" data-action="openHash" title="Deep-link to this game">#g${state.currentGame}</a>
        <button class="btn btn-delete" data-action="deleteGame" title="Delete game">Delete</button>
      </h2>
      ${game.log_url ? `<div class="log-link"><a href="${game.log_url}" target="_blank">${game.log_url}</a></div>` : ""}
    </div>


    <div class="summary-bar">
      <div class="stat"><span class="value">${s.total_mistakes || 0}</span><span class="label">Mistakes</span></div>
      <div class="stat" title="Total expected value lost to mistakes this game, compared to Mortal's (the AI) preferred plays."><span class="value">${(s.total_ev_loss || 0).toFixed(2)}</span><span class="label">EV Loss</span></div>
      ${s.total_decisions ? `<div class="stat" title="How many of your decisions Mortal reviewed this game."><span class="value">${s.total_decisions}</span><span class="label">Decisions</span></div>
      <div class="stat" title="Average expected value lost per decision — lower is better."><span class="value">${s.ev_per_decision.toFixed(4)}</span><span class="label">EV/Decision</span></div>` : ""}
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
    <button class="game-tab ${state.gameView === "rounds" ? "active" : ""}" data-action="switchGameView" data-view="rounds">Rounds</button>
    <button class="game-tab ${state.gameView === "summary" ? "active" : ""}" data-action="switchGameView" data-view="summary">Summary</button>
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
    // Prefer the decision count; old games stored before it existed only
    // have turn_count, so fall back to that.
    const nDec = rnd.decision_count || 0;
    const countStr = nDec
      ? `${nDec} decision${nDec === 1 ? "" : "s"}`
      : (rnd.turn_count ? `${rnd.turn_count} turn${rnd.turn_count === 1 ? "" : "s"}` : "");

    const isClean = rnd.mistakes.length === 0;
    html += `<div class="round${isClean ? " round-clean" : ""}">`;
    html += `<div class="round-header">
      <span>${formatRoundLabel(rnd.round)}${countStr ? ` <span class="round-count" title="How many of your decisions Mortal reviewed in this round.">&middot; ${countStr}</span>` : ""}</span>
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

      // Arm the ambient active-dora set up front so the action chips below
      // (renderAction) and every later renderTile() in this card auto-highlight
      // dora.
      setActiveDora(getDoraTiles(m.board_state));
      html += `<div class="mistake ${sc}" ${dataAttrs}${midAttr}${cardStyle}>`;
      html += `<div class="mistake-top">`;
      if (m.is_all_last) {
        html += `<span class="all-last-badge" title="Final round of the hand — placement matters more than raw EV here.">All last</span>`;
      }
      html += formatTurnBadge(m.turn);
      if (m.id) html += `<a class="dev-id" href="#m${m.id}" data-action="openHash" title="Deep-link to this mistake">#m${m.id}</a>`;
      html += `<span class="severity ${sc}" title="${sevTooltip(m)}">${sevLabel(m)}</span>`;
      html += `<span class="ev-loss" title="${EV_LOSS_TOOLTIP}">${m.ev_loss.toFixed(2)} EV</span>`;
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
                 data-change-action="onAnnotate" ${dataAttrs}>
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
          <div class="cat-group-header" data-action="toggleGameMistakes" data-group-id="${grpId}" style="cursor:pointer">
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

  // Honour a pending scroll-to-mistake request from the #m<id>
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
// signature used in trends-analysis.js even though it's unused here.)
function toggleTrendMistakes(group, grpId) {
  const panel = document.getElementById(grpId);
  if (!panel) return;
  panel.style.display = panel.style.display === "none" ? "" : "none";
}

function navigateHome() {
  state.currentGame = null;
  state.currentGameData = null;
  if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
  renderGameList();
  document.getElementById("content").innerHTML = '<div class="empty-state">Select a game to review</div>';
}
