// Board context rendering: hand row, melds, discards-by-seat, dora bar,
// scores, tenpai-wait row.

var WIND_DISPLAY = { "E": "East", "S": "South", "W": "West", "N": "North" };
var SEAT_NAMES = ["East", "South", "West", "North"];

// Derive the dealer (oya) seat from a mistake's snapshot. Needed to convert
// an absolute seat number into the correct round-relative wind letter (E/S
// /W/N rotates every round, so seat 0 isn't always East).
function mistakeOya(m) {
  const b = m && m.board_state;
  if (!b || !b.seat_wind) return null;
  const playerSeat = m.actual ? m.actual.actor : null;
  if (playerSeat == null) return null;
  const WINDS = ["E", "S", "W", "N"];
  const pw = WINDS.indexOf(b.seat_wind);
  if (pw < 0) return null;
  return ((playerSeat - pw) % 4 + 4) % 4;
}

function renderMeld(meld, tileClass = "action-tile-sm", actorSeat, doraTiles, oya = null) {
  const type = meld.type;
  const consumed = meld.consumed || [];
  const pai = meld.pai;
  const target = meld.target;

  function meldTile(t, extra = "") {
    let cls = tileClass;
    if (doraTiles && (t === "5mr" || t === "5pr" || t === "5sr" || doraTiles.has(tileBase(t)))) cls += " dora-highlight";
    if (extra) cls += " " + extra;
    return renderTile(t, cls);
  }
  function calledTile(t) { return `<span class="meld-called">${meldTile(t)}</span>`; }

  // Relative position: 1=right, 2=across, 3=left
  let relPos = null;
  const WINDS = ["E", "S", "W", "N"];
  let windChar = "";
  if (target != null && actorSeat != null) {
    relPos = ((target - actorSeat) % 4 + 4) % 4;
    // Wind badge = the target seat's wind for THIS round, not the absolute
    // seat number. In a non-East round the dealer isn't seat 0, so mapping
    // target directly to WINDS would put the wrong letter on the meld.
    windChar = oya != null
      ? WINDS[((target - oya) % 4 + 4) % 4]
      : WINDS[target % 4];
  }
  const windSup = windChar ? `<sup class="meld-wind">${windChar}</sup>` : "";

  if (type === "ankan") {
    const tile = consumed[0] || pai || "?";
    return `<span class="meld-group">${renderBackTile(tileClass)}${meldTile(tile)}${meldTile(tile)}${renderBackTile(tileClass)}</span>`;
  }

  if (type === "chi") {
    const own = [...consumed].sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    return `<span class="meld-group">${calledTile(pai)}${own.map(t => meldTile(t)).join("")}${windSup}</span>`;
  }

  if (type === "pon") {
    const ct = calledTile(pai);
    const ot = consumed.map(t => meldTile(t));
    if (relPos === 3) return `<span class="meld-group">${ct}${ot.join("")}${windSup}</span>`;
    if (relPos === 2) return `<span class="meld-group">${ot[0]}${ct}${ot[1]}${windSup}</span>`;
    return `<span class="meld-group">${ot.join("")}${ct}${windSup}</span>`;
  }

  if (type === "daiminkan") {
    const ct = calledTile(pai);
    const ot = consumed.map(t => meldTile(t));
    if (relPos === 3) return `<span class="meld-group">${ct}${ot.join("")}${windSup}</span>`;
    if (relPos === 2) return `<span class="meld-group">${ot[0]}${ct}${ot.slice(1).join("")}${windSup}</span>`;
    return `<span class="meld-group">${ot.join("")}${ct}${windSup}</span>`;
  }

  if (type === "kakan") {
    // Added kan: pon layout with 4th tile stacked on top of the rotated called tile
    const tile = consumed[0] || pai;
    const ct = `<span class="meld-called meld-kakan">${meldTile(tile)}<span class="meld-kakan-added">${meldTile(pai)}</span></span>`;
    const t1 = meldTile(tile);
    const t2 = meldTile(tile);
    if (relPos === 3) return `<span class="meld-group">${ct}${t1}${t2}${windSup}</span>`;
    if (relPos === 2) return `<span class="meld-group">${t1}${ct}${t2}${windSup}</span>`;
    return `<span class="meld-group">${t1}${t2}${ct}${windSup}</span>`;
  }

  // Fallback
  const all = [...consumed];
  if (pai) all.push(pai);
  return `<span class="meld-group">${all.map(t => meldTile(t)).join("")}</span>`;
}

function renderHand(tiles, draw, mistake, doraTiles) {
  if (!tiles || !tiles.length) return "";
  // Prefer the new KD-derived deal-in data when present — tooltip becomes
  // "<tile> — Type · X.X%" and the underline matches the EV table's
  // green / yellow-red gradient. Falls back to the legacy 0-15 suji rating
  // for mistakes that haven't been re-backfilled.
  const useKd = mistake
    && mistake.dealin_rates
    && Object.keys(mistake.dealin_rates).length > 0;
  return tiles.map((t, i) => {
    let extra = "";
    let title = null;
    let extraAttrs = "";
    if (draw && i === tiles.length - 1 && t === draw) extra = "draw";
    if (useKd) {
      const rate = getFieldForTile(mistake.dealin_rates, t);
      const coarse = coarseSafetyLabelForTile(mistake, t);
      const fine = fineLabelForTile(mistake, t);
      if (rate != null && coarse) {
        const isSafe = rate === 0 || coarse === "genbutsu" || fine === "genbutsu";
        const labelText = isSafe ? "Safe" : (fine || dealinLabelText(coarse));
        title = `${t} — ${labelText} · ${rate.toFixed(1)}%`;
        if (isSafe) {
          extra += " hand-tile-safe";
        } else {
          extraAttrs = `style="border-bottom:3px solid ${dealinColor(rate)}"`;
        }
      }
    } else {
      const sr = getSafetyRating(mistake && mistake.safety_ratings, t);
      if (sr != null) {
        extra += ` ${safetyClass(sr)}`;
        title = `${t} — ${safetyLabel(sr)} (${sr}/15)`;
      }
    }
    if (t === "5mr" || t === "5pr" || t === "5sr" || (doraTiles && doraTiles.has(tileBase(t)))) {
      extra += " dora-highlight";
    }
    return renderTile(t, extra, title, extraAttrs);
  }).join("");
}

function renderTenpaiWaitsRow(m) {
  // Shown only when we've stored waits on the mistake — currently 5A (after
  // removing the chosen riichi tile) and 5B (after the silently-discarded
  // would-be riichi tile). Placement directly below the discards block so
  // the student can see their hand's waits against what's been thrown away.
  const waits = tenpaiWaitTiles(m);
  if (!waits.length) return "";
  const total = waits.reduce((a, w) => a + (w.count || 0), 0);
  const furitenSet = new Set(m.furiten_tiles || []);
  const chips = waits.map(w => {
    const dead = (w.count || 0) === 0;
    const isFuriten = furitenSet.has(w.tile);
    const clsList = ["ukeire-chip"];
    if (dead) clsList.push("ukeire-chip-dead");
    if (isFuriten) clsList.push("ukeire-chip-furiten");
    return `<span class="${clsList.join(" ")}" title="${w.tile}: ${w.count} left${isFuriten ? " — furiten (already discarded)" : ""}">`
      + renderTile(w.tile, "tile-sm ukeire-tile-img")
      + `<span class="ukeire-chip-count">×${w.count}</span>`
      + `</span>`;
  }).join("");
  const label = waits.length === 1
    ? `Tenpai wait (${total} tile${total === 1 ? "" : "s"}):`
    : `Tenpai waits (${waits.length} types, ${total} tiles):`;
  return `<div class="tenpai-waits-row">
    <span class="tenpai-waits-label">${label}</span>
    <span class="tenpai-waits-tiles">${chips}</span>
  </div>`;
}

// Normalise tenpai_waits so existing code can iterate {tile, count} regardless
// of whether a mistake was written with the old flat-string format.
function tenpaiWaitTiles(m) {
  const waits = m.tenpai_waits;
  if (!Array.isArray(waits) || !waits.length) return [];
  if (typeof waits[0] === "string") return waits.map(t => ({tile: t, count: 0}));
  return waits;
}

function renderBoardContext(m) {
  const b = m.board_state;
  if (!b) return "";

  // BoardState is the canonical owner of the wall position — `b.tiles_left`
  // is emitted by lib/categorize.py::extract_board_state and lives on every
  // mistake's board_state blob (CS-02 collapse). Read it from here rather
  // than counting [data-tile] DOM nodes; older mistakes have it backfilled
  // by backfill_board_state_db.

  let html = `<div class="board-context">`;

  // Wind + Dora bar
  html += `<div class="board-info-bar">`;
  if (b.round_wind) {
    html += `<span class="wind-badge round-wind" title="Round wind">${renderTile(b.round_wind, "tile-sm wind-tile")}<span class="wind-label">Round</span></span>`;
  }
  if (b.seat_wind) {
    html += `<span class="wind-badge seat-wind" title="Seat wind">${renderTile(b.seat_wind, "tile-sm wind-tile")}<span class="wind-label">Seat</span></span>`;
  }
  if (b.dora_indicators && b.dora_indicators.length) {
    // CS-02: dora_tiles is the canonical resolved list emitted by
    // extract_board_state — same length/order as dora_indicators.
    const doraList = b.dora_tiles || [];
    html += `<span class="dora-section"><span class="dora-label">Dora</span>`;
    for (let i = 0; i < b.dora_indicators.length; i++) {
      const d = b.dora_indicators[i];
      const actual = doraList[i] || d;
      html += renderTile(actual, "tile-sm dora-indicator", `Dora ${actual} (from indicator ${d})`);
    }
    html += `</span>`;
  }
  html += `</div>`;

  // Build seat -> melds lookup for inline rendering
  const meldsBySeat = {};
  if (b.opponent_melds) {
    for (const om of b.opponent_melds) {
      meldsBySeat[om.seat] = om.melds;
    }
  }

  // All player discards + inline melds (collapsible).
  // Auto-expand for meld/riichi/kan mistakes, any Defense category, when
  // there's a riichi threat, or if the category is unset.
  if (b.all_discards && b.all_discards.length) {
    const hasDiscards = b.all_discards.some(d => d.discards.length > 0 || meldsBySeat[d.seat]);
    if (hasDiscards) {
      const doraTiles = getDoraTiles(b);
      const cat = m.category || "";
      const expandDiscards = !cat || m.safety_ratings
                             || /^[3-6]/.test(cat) || /^D/.test(cat);
      const playerSeat = m.actual ? m.actual.actor : null;
      // Each seat's wind label rotates from the dealer (oya). We derive oya
      // from the player's absolute actor id + their stored seat wind — the
      // backend doesn't serialize oya directly.
      const WINDS = ["E", "S", "W", "N"];
      let oya = null;
      if (playerSeat != null && b.seat_wind) {
        const pw = WINDS.indexOf(b.seat_wind);
        if (pw >= 0) oya = ((playerSeat - pw) % 4 + 4) % 4;
      }
      function seatWindLabel(seat) {
        if (oya == null) return SEAT_NAMES[seat] || `P${seat}`;
        return WIND_DISPLAY[WINDS[(seat - oya + 4) % 4]];
      }
      // Sort rows so wind order is East, South, West, North regardless of
      // which absolute seat the dealer occupies.
      const sortedDiscards = oya != null
        ? [...b.all_discards].sort((a, c) =>
            ((a.seat - oya + 4) % 4) - ((c.seat - oya + 4) % 4))
        : b.all_discards;

      // Reconstruct absolute turn order from per-player discard lists. Pon
      // and daiminkan can skip the seat(s) between the discarder and the
      // caller; chi only ever comes from the player on the left, so it
      // doesn't skip anyone. Either way, the caller is encoded on the
      // called tile as `called_by` and becomes the next discarder. Without
      // this reconstruction, tiles at the same per-player index across
      // rows are not actually from the same turn — e.g. North's tile 5
      // lands after East's tile 5, since East discards first each cycle.
      const discardBySeat = new Map();
      for (const dd of sortedDiscards) discardBySeat.set(dd.seat, dd);
      const turnSeq = []; // ordered [{seat, idx}]
      {
        const ptr = new Map();
        for (const dd of sortedDiscards) ptr.set(dd.seat, 0);
        const startSeat = oya != null ? oya : (sortedDiscards[0] ? sortedDiscards[0].seat : 0);
        let cur = startSeat;
        let safety = 0;
        while (safety++ < 400) {
          const dd = discardBySeat.get(cur);
          const p = ptr.get(cur) ?? 0;
          if (dd && p < dd.discards.length) {
            turnSeq.push({ seat: cur, idx: p });
            ptr.set(cur, p + 1);
            const raw = dd.discards[p];
            const calledBy = (typeof raw === "object" && raw !== null) ? raw.called_by : undefined;
            cur = (calledBy != null) ? calledBy : (cur + 1) % 4;
          } else {
            // current seat has no (more) discards — advance to next seat
            // that still has tiles left, or stop if none remain.
            let found = null;
            for (let step = 1; step <= 4; step++) {
              const cand = (cur + step) % 4;
              const cd = discardBySeat.get(cand);
              const cp = ptr.get(cand) ?? 0;
              if (cd && cp < cd.discards.length) { found = cand; break; }
            }
            if (found == null) break;
            cur = found;
          }
        }
      }
      // Absolute turn per (seat, idx), so we can stamp data-turn on tiles
      // and reason about pre/post-riichi ordering on hover.
      const absTurnMap = new Map();
      for (let t = 0; t < turnSeq.length; t++) {
        const e = turnSeq[t];
        absTurnMap.set(`${e.seat}_${e.idx}`, t);
      }
      // For each seat's discards, the list of caller-seats that pon/kan'd
      // past this seat before their i-th discard. Empty = no skips. A seat
      // is "skipped" only when the natural E→S→W→N rotation would have
      // handed them the turn but a call jumped past them; normal turns
      // where another seat legitimately discards next are NOT skips. The
      // caller is the seat that took the called tile — i.e. the seat
      // whose discard immediately follows the skipped slot.
      const skipCallersBefore = new Map();
      for (const dd of sortedDiscards) {
        skipCallersBefore.set(dd.seat, Array.from({length: dd.discards.length}, () => []));
      }
      {
        const pending = { 0: [], 1: [], 2: [], 3: [] };
        let prevSeat = null;
        for (const e of turnSeq) {
          if (prevSeat != null) {
            let natural = (prevSeat + 1) % 4;
            while (natural !== e.seat) {
              pending[natural].push(e.seat);
              natural = (natural + 1) % 4;
            }
          }
          const row = skipCallersBefore.get(e.seat);
          if (row) row[e.idx] = pending[e.seat].slice();
          pending[e.seat] = [];
          prevSeat = e.seat;
        }
      }

      html += `<details class="all-discards"${expandDiscards ? " open" : ""}>`;

      html += `<summary>Discards</summary>`;
      for (const d of sortedDiscards) {
        const seatMelds = meldsBySeat[d.seat];
        if (!d.discards.length && !seatMelds) continue;
        const seatName = seatWindLabel(d.seat);
        const isYou = playerSeat != null && d.seat === playerSeat;
        // Threatening: opponent with 3+ open calls (not you). Defense code
        // uses the same 3-meld threshold to trigger the defense gate.
        const openMeldCount = seatMelds ? seatMelds.filter(mm => mm.type !== "ankan").length : 0;
        const isDanger = !isYou && openMeldCount >= 3;
        const isRiichiOpp = !isYou && d.riichi_idx != null;
        let rowCls = "discard-row";
        if (isYou) rowCls += " you-row";
        if (isDanger) rowCls += " danger-row";
        if (isRiichiOpp) rowCls += " riichi-row";
        html += `<div class="${rowCls}">`;
        html += `<span class="discard-label">${seatName}`;
        if (isYou) html += `<span class="you-tag">(you)</span>`;
        if (isRiichiOpp) html += `<span class="riichi-tag">RIICHI</span>`;
        if (isDanger) html += `<span class="danger-tag" title="${openMeldCount} open calls">⚠ ${openMeldCount} melds</span>`;
        html += `</span>`;
        html += `<span class="tiles">`;
        const seatSkipCallers = skipCallersBefore.get(d.seat) || [];
        for (let i = 0; i < d.discards.length; i++) {
          // Insert invisible placeholder tiles only for real pon/kan skips
          // that precede this discard. Each carries a tooltip naming the
          // caller so hovering explains the gap.
          const callers = seatSkipCallers[i] || [];
          for (const callerSeat of callers) {
            const callerWind = seatWindLabel(callerSeat);
            const title = `Skipped — ${callerWind} called pon / kan`;
            html += `<img class="tile action-tile-sm skip-placeholder" src="/tiles/Blank.svg" alt="" title="${title}" aria-hidden="true">`;
          }
          const raw = d.discards[i];
          const tile = typeof raw === "string" ? raw : raw.tile;
          const calledBy = (typeof raw === "object" && raw !== null) ? raw.called_by : undefined;
          const isRiichi = i === d.riichi_idx;
          const absTurn = absTurnMap.get(`${d.seat}_${i}`);
          const posAttrs = `data-turn="${absTurn}" data-seat="${d.seat}"`;
          const isDora = tile === "5mr" || tile === "5pr" || tile === "5sr"
            || doraTiles.has(tileBase(tile));
          let cls = `action-tile-sm${isDora ? " dora-highlight" : ""}`;
          if (calledBy != null) cls += " ghost-tile";
          if (isRiichi) {
            const riichiAttrs = `${posAttrs} data-riichi-turn="${absTurn}" data-riichi-seat="${d.seat}"`;
            html += renderTile(tile, cls + " riichi-tile",
              "Riichi declared here — hover to see tiles safe against this riichi",
              riichiAttrs);
          } else {
            html += renderTile(tile, cls, null, posAttrs);
          }
        }
        html += `</span>`;
        if (seatMelds) {
          html += `<span class="inline-melds">`;
          for (const meld of seatMelds) {
            html += renderMeld(meld, "action-tile-sm", d.seat, doraTiles, oya) + " ";
          }
          html += `</span>`;
        }
        html += `</div>`;
      }
      html += `</details>`;
    }
  }

  // Scores inline in info bar — use seat winds relative to oya like the
  // discard rows above.
  if (b.scores && b.scores.length) {
    const WINDS = ["E", "S", "W", "N"];
    const playerSeat = m.actual ? m.actual.actor : null;
    let oya = null;
    if (playerSeat != null && b.seat_wind) {
      const pw = WINDS.indexOf(b.seat_wind);
      if (pw >= 0) oya = ((playerSeat - pw) % 4 + 4) % 4;
    }
    html += `<div class="scores-bar">`;
    for (let i = 0; i < b.scores.length; i++) {
      const name = oya != null
        ? WIND_DISPLAY[WINDS[(i - oya + 4) % 4]]
        : (SEAT_NAMES[i] || `P${i}`);
      const youTag = playerSeat === i ? '<span class="you-tag">(you)</span>' : '';
      html += `<span class="score-item"><span class="score-seat">${name}${youTag}</span> ${b.scores[i].toLocaleString()}</span>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// --- Action formatting ---

function formatAction(action) {
  if (!action) return "?";
  switch (action.type) {
    case "dahai": return action.pai;
    case "chi": return `chi ${(action.consumed || []).join("")}+${action.pai || "?"}`;
    case "pon": return `pon ${(action.consumed || []).join("")}+${action.pai || "?"}`;
    case "reach": return "riichi";
    case "hora": return "win";
    case "none": return "pass";
    case "ankan": return `ankan ${(action.consumed || ["?"])[0]}`;
    default: return action.type;
  }
}

function renderAction(action, cls = "") {
  if (!action) return `<span class="action-text ${cls}">?</span>`;
  switch (action.type) {
    case "dahai":
      return renderTile(action.pai, `action-tile ${cls}`);
    case "chi":
    case "pon":
    case "ankan":
    case "daiminkan":
    case "kakan":
      return `<span class="action-meld ${cls}">${renderMeld(action, "action-tile-sm", action.actor)}</span>`;
    case "reach":
      return `<span class="action-pill action-riichi ${cls}">RIICHI</span>`;
    case "hora":
      return `<span class="action-pill action-win ${cls}">WIN</span>`;
    case "none":
      return `<span class="action-pill action-pass ${cls}">PASS</span>`;
    default: return `<span class="action-text ${cls}">${action.type}</span>`;
  }
}
