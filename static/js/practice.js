// Practice mode: fetch a problem, render hand for click, score answer,
// show full analysis with EV table on reveal. Filters + opt-in popup live
// here too.

async function fetchPractice() {
  const params = new URLSearchParams();
  if (practice.filterSeverity) params.set("severity", practice.filterSeverity);
  if (practice.filterDefense) params.set("defense", "1");
  if (practice.filterGroup) params.set("group", practice.filterGroup);
  else params.set("calc_agree", "1");  // default: push categories only
  const qs = params.toString();
  const usePublic = isAnonymous || practiceSource === "all";
  const endpoint = usePublic ? "/api/practice/public" : "/api/practice";
  const res = await fetch(`${endpoint}${qs ? "?" + qs : ""}`);
  if (!res.ok) return null;
  return await res.json();
}

async function showPractice() {
  setSeverityFiltersVisible(false);
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");
  content.innerHTML = '<div class="empty-state">Loading practice problem...</div>';

  const data = await fetchPractice();
  if (!data || data.error) {
    practice.problem = null;
    practice.poolSize = 0;
  } else {
    practice.problem = data;
    practice.poolSize = data.pool_size;
  }
  practice.answered = false;
  practice.userPick = null;
  renderPractice();
}

function renderPracticeHand(tiles, draw, doraTiles) {
  if (!tiles || !tiles.length) return "";
  return tiles.map((t, i) => {
    const isDraw = draw && i === tiles.length - 1 && t === draw;
    let extra = isDraw ? "draw" : "";
    if (t === "5mr" || t === "5pr" || t === "5sr" || (doraTiles && doraTiles.has(tileBase(t)))) {
      extra += " dora-highlight";
    }
    // Escape single quotes in tile names for onclick
    const safe = t.replace(/'/g, "\\'");
    return `<span class="practice-tile" onclick="submitPracticeAnswer('${safe}')">${renderTile(t, extra)}</span>`;
  }).join("");
}

function submitPracticeAnswer(tile) {
  if (practice.answered) return;
  practice.answered = true;
  practice.userPick = tile;
  practice.total++;

  const m = practice.problem.mistake;
  const expected = m.expected.pai;
  // Correct if matches expected (normalize red fives)
  const isCorrect = tile === expected || normalizeRed(tile) === normalizeRed(expected);
  if (isCorrect) practice.correct++;

  // Record result for spaced repetition (own mistakes only)
  if (!isAnonymous && practiceSource === "mine" && practice.problem.mistake_id) {
    apiPost("/api/practice/result", { mistake_id: practice.problem.mistake_id, correct: isCorrect });
  }

  renderPractice();
}

function renderPractice() {
  const content = document.getElementById("content");
  const p = practice.problem;

  const showTutorial = !localStorage.getItem("practiceTutorialDismissed");
  const showFilters = localStorage.getItem("practiceShowFilters") === "1";

  let html = `
    <div class="practice-header">
      <h2><a href="/" class="practice-back" title="Back to home">&larr;</a> Practice</h2>
      <div class="practice-score">
        <span class="practice-score-num">${practice.correct}</span>/<span>${practice.total}</span> correct
      </div>
    </div>`;

  if (showTutorial) {
    html += `
    <div class="practice-tutorial">
      <button class="practice-tutorial-close" onclick="localStorage.setItem('practiceTutorialDismissed','1'); this.parentElement.remove()">&times;</button>
      <h3>How it works</h3>
      <p>You'll see a mahjong hand after drawing a tile. Pick which tile you would discard.</p>
      <ul>
        <li>Problems come from real games analyzed by <strong>Mortal AI</strong></li>
        <li>The correct answer is Mortal's recommendation &mdash; considering efficiency, defense, and hand value</li>
        <li>A <span style="color:#ef5350"><b>RIICHI</b></span> badge means an opponent declared riichi &mdash; tiles are colored by safety (green = safe, red = dangerous)</li>
        <li>The draw (last tile added to your hand) is shown with a small gap</li>
      </ul>
    </div>`;
  }

  html += `${isAnonymous ? `<div class="practice-login-banner"><strong>Haipai</strong> &mdash; Riichi Mahjong mistake trainer. Pick the best discard below!
    <span class="banner-links"><a href="/register">Register</a> or <a href="/login">log in</a> to save your games. <a href="/about">Learn more</a></span></div>` : ''}`;

  // Collapsible filters
  html += `<div class="practice-filters-toggle" onclick="togglePracticeFilters()">Filters ${showFilters ? '&#9650;' : '&#9660;'}</div>`;
  html += `<div class="practice-filters" style="display:${showFilters ? 'flex' : 'none'}">
      ${!isAnonymous ? `<label class="practice-filter-check"><input type="checkbox" ${practiceSource === "mine" ? "checked" : ""} onchange="setPracticeSource(this.checked ? 'mine' : 'all')"> My mistakes only</label>` : ''}
      <select onchange="setPracticeFilter('group', this.value)">
        <option value="" ${!practice.filterGroup ? "selected" : ""}>All groups</option>
        <option value="Attack" ${practice.filterGroup === "Attack" ? "selected" : ""}>Attack only</option>
        <option value="Defense" ${practice.filterGroup === "Defense" ? "selected" : ""}>Defense only</option>
      </select>
      <select onchange="setPracticeFilter('severity', this.value)">
        <option value="" ${!practice.filterSeverity ? "selected" : ""}>All severity</option>
        <option value="???" ${practice.filterSeverity === "???" ? "selected" : ""}>Severe only</option>
        <option value="??" ${practice.filterSeverity === "??" ? "selected" : ""}>Mistake+ only</option>
      </select>
      <label class="practice-filter-check"><input type="checkbox" ${practice.filterDefense ? "checked" : ""} onchange="setPracticeFilter('defense', this.checked)"> Riichi only</label>
      ${!isAnonymous ? `<label class="practice-filter-check practice-opt-in"><input type="checkbox" ${practiceOptIn ? "checked" : ""} onchange="togglePracticeOptIn(this.checked)"> Share my games in community pool</label>` : ''}
    </div>`;

  if (!p) {
    const hint = practiceSource === "mine"
      ? "No eligible problems in your games. Uncheck \"My mistakes only\" to try the community pool."
      : "No problems available yet. Users need to opt in to share their games.";
    html += `<div class="empty-state">${hint}</div>`;
    content.innerHTML = html;
    return;
  }

  const m = p.mistake;
  const answered = practice.answered;

  const sc = sevClass(m);
  const shantenStr = m.shanten != null ? `${m.shanten}-shanten` : "";

  html += `

    <div class="practice-context">
      ${p.game_date ? `<span>${p.game_date}</span>` : ''}
      <span>${p.round}</span>
      <span class="severity ${sc}" title="${sevTooltip(m)}">${sevLabel(m)}</span>
      ${shantenStr ? `<span class="shanten">${shantenStr}</span>` : ""}
      <span class="ev-loss">${m.ev_loss.toFixed(2)} EV</span>
    </div>
  `;

  // Hand
  const doraTiles = getDoraTiles(m.board_state);

  // Melds
  if (m.melds && m.melds.length) {
    const playerSeat = m.actual ? m.actual.actor : null;
    const oya = mistakeOya(m);
    html += `<div class="practice-melds">`;
    for (const meld of m.melds) {
      html += renderMeld(meld, "action-tile-sm", playerSeat, doraTiles, oya);
    }
    html += `</div>`;
  }

  if (answered) {
    // Show hand with answer indicators
    html += `<div class="practice-hand-area">`;
    html += `<div class="hand-row"><span class="label">Hand</span>`;
    html += `<span class="tiles">`;
    const expected = m.expected.pai;
    const actual = m.actual ? m.actual.pai : null;
    const useKd = m.dealin_rates && Object.keys(m.dealin_rates).length > 0;
    html += m.hand.map((t, i) => {
      const isDraw = m.draw && i === m.hand.length - 1 && t === m.draw;
      let cls = isDraw ? "draw" : "";
      let title = t;
      let extraAttrs = "";
      if (useKd) {
        const rate = getFieldForTile(m.dealin_rates, t);
        const coarse = coarseSafetyLabelForTile(m, t);
        const fine = fineLabelForTile(m, t);
        if (rate != null && coarse) {
          const isSafe = rate === 0 || coarse === "genbutsu" || fine === "genbutsu";
          const labelText = isSafe ? "Safe" : (fine || dealinLabelText(coarse));
          title = `${t} — ${labelText} · ${rate.toFixed(1)}%`;
          if (isSafe) {
            cls += " hand-tile-safe";
          } else {
            extraAttrs = `style="border-bottom:3px solid ${dealinColor(rate)}"`;
          }
        }
      } else {
        const sr = getSafetyRating(m.safety_ratings, t);
        if (sr != null) {
          cls += ` ${safetyClass(sr)}`;
          title = `${t} — ${safetyLabel(sr)} (${sr}/15)`;
        }
      }
      if (t === "5mr" || t === "5pr" || t === "5sr" || doraTiles.has(tileBase(t))) cls += " dora-highlight";

      const isUserPick = t === practice.userPick || normalizeRed(t) === normalizeRed(practice.userPick);
      const isExpected = t === expected || normalizeRed(t) === normalizeRed(expected);
      let marker = "";
      if (isExpected) marker = "practice-correct";
      if (isUserPick && !isExpected) marker = "practice-wrong";

      return `<span class="practice-tile-result ${marker}">${renderTile(t, cls, title, extraAttrs)}</span>`;
    }).join("");
    html += `</span></div>`;

    // Board context
    html += renderBoardContext(m);

    html += `</div>`; // .practice-hand-area
  } else {
    // Clickable hand
    html += `<div class="practice-hand-area">`;
    html += `<div class="practice-prompt">Pick a tile to discard</div>`;
    html += `<div class="hand-row"><span class="label">Hand</span>`;
    html += `<span class="tiles">${renderPracticeHand(m.hand, m.draw, doraTiles)}</span>`;
    html += `</div>`;
    // Board context (dora, discards, etc.)
    html += renderBoardContext(m);
    html += `</div>`;
  }

  // Answer section
  if (answered) {
    const isCorrect = normalizeRed(practice.userPick) === normalizeRed(m.expected.pai);
    html += `<div class="practice-result ${isCorrect ? "practice-result-correct" : "practice-result-wrong"}">`;
    if (isCorrect) {
      html += `<div class="practice-result-label">Correct!</div>`;
    } else {
      html += `<div class="practice-result-label">Mortal recommends: ${renderTile(m.expected.pai, "action-tile")}</div>`;
    }
    html += `<div class="practice-result-detail">`;
    html += `<span>You picked: </span><span class="played">${renderTile(practice.userPick, "action-tile")}</span>`;
    if (m.actual) {
      html += `<span class="arrow"> &rarr; </span>`;
      html += `<span>Original play: </span><span class="played">${renderTile(m.actual.pai, "action-tile")}</span>`;
    }
    if (m.category) {
      const grp = catGroup(m.category);
      const color = GROUP_COLORS[grp] || "#888";
      html += ` <span class="cat-badge" style="background:${color}20;color:${color};border:1px solid ${color}40">${catLabel(m.category)}</span>`;
    }
    html += `</div>`;

    // EV comparison table — practice mode shows top 3 so the learner sees
    // the full ranking, not just the best answer vs their pick.
    if (m.top_actions && m.top_actions.length && m.discard_stats && m.discard_stats.length) {
      html += renderEvComparison(m, {showTop3: true});
    } else if (m.top_actions && m.top_actions.length) {
      html += `<div class="top-actions">`;
      for (const a of m.top_actions) {
        html += `<span class="top-action">${renderAction(a.action)} <b>${a.q_value.toFixed(2)}</b></span>`;
      }
      html += `</div>`;
    }

    // Note if present
    if (m.note) {
      html += `<div class="practice-note">${m.note}</div>`;
    }

    html += `</div>`; // .practice-result

    html += `<div class="practice-actions">`;
    html += `<button class="btn btn-primary" onclick="showPractice()">Next Problem <span class="shortcut-hint">Space</span></button>`;
    html += `<button class="btn" onclick="resetPracticeScore()">Reset Score</button>`;
    html += `</div>`;
  }

  content.innerHTML = html;
}

function resetPracticeScore() {
  practice.correct = 0;
  practice.total = 0;
  renderPractice();
}

function setPracticeFilter(key, value) {
  if (key === "group") practice.filterGroup = value;
  else if (key === "severity") practice.filterSeverity = value;
  else if (key === "defense") practice.filterDefense = value;
  else if (key === "calc_agree") practice.filterCalcAgree = value;
  // Reset score and fetch new problem with new filters
  practice.correct = 0;
  practice.total = 0;
  showPractice();
}

function togglePracticeFilters() {
  const show = localStorage.getItem("practiceShowFilters") !== "1";
  localStorage.setItem("practiceShowFilters", show ? "1" : "0");
  renderPractice();
}

function setPracticeSource(value) {
  practiceSource = value;
  practice.correct = 0;
  practice.total = 0;

  // Show opt-in prompt on first switch to "My mistakes only"
  if (value === "mine" && !isAnonymous && !localStorage.getItem("practiceOptInPrompted")) {
    localStorage.setItem("practiceOptInPrompted", "1");
    showPracticeOptInPopup();
    return;
  }

  showPractice();
}

function showPracticeOptInPopup() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay show";
  overlay.innerHTML = `
    <div class="modal" style="max-width:420px">
      <h3 style="margin-bottom:12px">Share your games?</h3>
      <p style="margin-bottom:16px;color:var(--text-dim);font-size:14px;line-height:1.5">
        Would you like to contribute your mistakes to the community practice pool?
        Other players can practice on anonymized versions of your mistakes (no names or notes shared), and you can practice on theirs.
      </p>
      <div style="display:flex;gap:10px;justify-content:flex-end">
        <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove(); showPractice()">No thanks</button>
        <button class="btn btn-primary" onclick="togglePracticeOptIn(true); this.closest('.modal-overlay').remove(); showPractice()">Yes, share my games</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
}

async function togglePracticeOptIn(checked) {
  practiceOptIn = checked;
  await apiPost("/api/me/practice-opt-in", { opt_in: checked });
}
