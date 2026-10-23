// Board context rendering: hand row, discards-by-seat, dora bar, scores,
// tenpai-wait row. Inline melds come from board-melds.js (renderMeld); per-seat
// yaku pills come from board-yaku-panel.js (renderYakuStrip). Both must load
// before this file.

var WIND_DISPLAY = { "E": "East", "S": "South", "W": "West", "N": "North" };
var SEAT_NAMES = ["East", "South", "West", "North"];

// Open calls that signal a developing hand — same set the categorizer's
// open-threat trigger uses (static/js/prep/defense.js::_is_open_threat). A
// kakan upgrades an existing pon, so it's intentionally excluded: the pon is
// already counted, and counting both would disagree with the gate.
var OPEN_MELD_TYPES = new Set(["chi", "pon", "daiminkan"]);

// Value-han for the open-defense gate, mirroring defense.js::_open_value_han
// (the V8 model). Every open hand needs a yaku, so the floor is 1: a single
// yakuhai IS that yaku (1 han), a double wind counts twice, and each exposed
// dora adds 1. Used only to decide whether a single high-value call trips the
// gate — the displayed total stays threatGuaranteedHan.
function openValueHan(yakuHan, meldDora) {
  return Math.max(1, yakuHan) + meldDora;
}

// Confidence band for a non-riichi open threat, mirroring the shipped trigger
// (defense.js::_is_open_threat V8: 2+ open calls, OR a single high-value call
// whose value-han >= 3 — a dora-laden pon, double-wind+dora, etc.). Returns
// "strong" | "moderate" | null. The guaranteed-han floor drives strong/moderate:
// a hand is "strong" once it's locked into 2+ han (see threatGuaranteedHan —
// exposed dora plus the yaku every win needs, and/or melded yakuhai); below that
// floor the open hand is still a threat but cheaper ("moderate"). A single call
// only trips the gate when it's high-value, so it always lands "strong".
function openThreatBand(openMeldCount, guaranteedHan, valueHan) {
  if (openMeldCount < 1) return null;
  if (openMeldCount < 2 && valueHan < 3) return null;
  return guaranteedHan >= 2 ? "strong" : "moderate";
}

// The han an open hand is *locked into*, given its melded yaku and exposed
// dora. Guaranteed yaku han stands alone; dora only counts
// toward a win alongside a yaku, so a dora-only hand adds 1 for the yaku it still
// has to find. (A hand with both takes the yakuhai as that yaku — no extra +1.)
function threatGuaranteedHan(yakuHan, doraCount) {
  if (yakuHan > 0) return yakuHan + doraCount;
  return doraCount > 0 ? doraCount + 1 : 0;
}

// Popover breaking down an open threat's guaranteed han — a sibling of the yaku
// strip's hover detail (board-yaku-panel.js). One row per guaranteed melded yaku (tile +
// name + "N han"), one row for exposed dora (the tiles + "N han"), and, for a
// dora-only hand, the "1 han" yaku it still needs. Header carries the ≥N-han total.
function renderThreatDetail(openMeldCount, turn, yakuList, doraTilesList, guaranteedHan,
    entries, isDanger = true) {
  let rows = "";
  for (const y of yakuList) {
    rows += `<div class="td-row">`
      + `<span class="td-tile">${y.tile ? renderTile(y.tile, "") : ""}</span>`
      + `<span class="td-name">${y.name}</span>`
      + `<span class="td-han">${y.han} han</span></div>`;
  }
  if (doraTilesList.length) {
    const chips = doraTilesList.map(t => renderTile(t, "")).join("");
    rows += `<div class="td-row">`
      + `<span class="td-tile">${chips}</span>`
      + `<span class="td-name">Dora</span>`
      + `<span class="td-han">${doraTilesList.length} han</span></div>`;
  }
  if (!yakuList.length && doraTilesList.length) {
    rows += `<div class="td-row td-needed">`
      + `<span class="td-tile"></span>`
      + `<span class="td-name">Yaku to win</span>`
      + `<span class="td-han">1 han</span></div>`;
  }
  return `<span class="threat-detail">`
    + `<div class="td-head"><span class="td-title">${isDanger ? "⚠ " : ""}Open</span>`
    + (guaranteedHan > 0 ? `<span class="td-total">≥${guaranteedHan} han</span>` : "")
    + `</div>`
    + (rows ? `<div class="td-section-label">Visible value</div><div class="td-rows">${rows}</div>` : "")
    + (entries ? renderYakuStrip(entries, yakuList) : "")
    + (!rows && !entries ? `<div class="td-empty">No guaranteed yaku or dora shown.</div>` : "")
    + `<div class="td-foot">${openMeldCount} open call${openMeldCount === 1 ? "" : "s"} by turn ${turn || 0}</div>`
    + `</span>`;
}

// The player's own seat for a mistake. Most carry it on the action the player
// took (`actual.actor`), but a pass/skip decision is `actual = {type:"none"}`
// with no actor — fall back to the expected action, whose actor is still the
// player. Without this fallback, pon/chi/riichi-pass cards lose the "(you)" tag
// and (in non-East rounds) mislabel every seat's wind.
function mistakeActorSeat(m) {
  if (m && m.actual && m.actual.actor != null) return m.actual.actor;
  if (m && m.expected && m.expected.actor != null) return m.expected.actor;
  return null;
}

// Derive the dealer (oya) seat from a mistake's snapshot. Needed to convert
// an absolute seat number into the correct round-relative wind letter (E/S
// /W/N rotates every round, so seat 0 isn't always East).
function mistakeOya(m) {
  const b = m && m.board_state;
  if (!b || !b.seat_wind) return null;
  const playerSeat = mistakeActorSeat(m);
  if (playerSeat == null) return null;
  const WINDS = ["E", "S", "W", "N"];
  const pw = WINDS.indexOf(b.seat_wind);
  if (pw < 0) return null;
  return ((playerSeat - pw) % 4 + 4) % 4;
}

// Mark one physical copy per choice, preserving red-five identity and the draw gap.
function handChoiceMarkers(m) {
  const markers = new Map();
  if (!m) return markers;
  const actualTile = m.actual?.type === "dahai" ? m.actual.pai
    : m.actual?.type === "reach" ? m.actual_riichi_tile || m.actual.pai : null;
  const expectedTile = m.expected?.type === "dahai" ? m.expected.pai
    : m.expected?.type === "reach" ? m.expected.pai || actualTile : null;
  const add = (tile, cls, label, title) => {
    if (!TILE_FILE[tile]) return;
    if (!markers.has(tile)) markers.set(tile, []);
    markers.get(tile).push(`<span class="hand-choice-tab ${cls}" title="${title}">${label}</span>`);
  };
  const actualQ = (m.top_actions || []).find(a => a.action?.type === m.actual?.type
    && (m.actual?.type === "reach" || a.action.pai === actualTile))?.q_value;
  const bestQ = Math.max(...(m.top_actions || []).map(a => a.q_value).filter(Number.isFinite));
  const loss = Number.isFinite(actualQ) && Number.isFinite(bestQ) ? Math.max(0, bestQ - actualQ)
    : Number.isFinite(m.ev_loss) ? m.ev_loss : null;
  const evLabel = loss == null ? "—" : loss < 0.0001 ? "0.00" : `-${loss.toFixed(2)}`;
  add(actualTile, "hand-choice-you", `YOU<span>${evLabel}</span>`, "Your choice · EV relative to the best action");
  add(expectedTile, "hand-choice-ai", "AI", "AI choice");
  const ranked = (m.top_actions || []).filter(a => Number.isFinite(a.q_value))
    .slice().sort((a, b) => b.q_value - a.q_value);
  const discards = ranked.filter(a => a.action?.type === "dahai" && TILE_FILE[a.action.pai]);
  const seen = new Set();
  const choices = discards.filter(a => {
    if (seen.has(a.action.pai)) return false;
    seen.add(a.action.pai);
    return true;
  });
  choices.slice(1, 3).forEach((a, i) => {
    if (a.action.pai === actualTile) return;
    const rank = i === 0 ? "2nd" : "3rd";
    const delta = a.q_value - ranked[0].q_value;
    const ev = delta >= -0.0001 ? "0.00" : delta.toFixed(2);
    add(a.action.pai, `hand-choice-rank hand-choice-rank-${i + 2}`,
      `${rank}<span>${ev}</span>`, `${rank} best discard · ${ev} EV relative to the best action`);
  });
  return markers;
}

function renderHand(tiles, draw, mistake = null, comparisonKey = null) {
  if (!tiles || !tiles.length) return "";
  const markers = handChoiceMarkers(mistake);
  return tiles.map((t, i) => {
    const extra = draw && i === tiles.length - 1 && t === draw ? "draw" : "";
    // Dora and yakuhai highlights are applied automatically by renderTile.
    const tabs = i === tiles.lastIndexOf(t) ? markers.get(t) : null;
    return renderHandTile(t, extra, tabs, comparisonKey);
  }).join("");
}

// Shared by the normal hand and the grouped hand, preserving choice markers.
function renderHandTile(t, extra, tabs, comparisonKey) {
  if (comparisonKey != null) {
    return `<button type="button" class="hand-choice hand-choice-button ${extra}"`
      + ` data-action="selectHandComparison" data-comparison-key="${comparisonKey}" data-choice-tile="${t}"`
      + ` aria-label="Compare discarding ${t} with AI" aria-pressed="false">${renderTile(t)}`
      + (tabs ? `<span class="hand-choice-tabs">${tabs.join("")}</span>` : "") + `</button>`;
  }
  if (!tabs) return renderTile(t, extra);
  return `<span class="hand-choice ${extra}">${renderTile(t)}`
    + `<span class="hand-choice-tabs">${tabs.join("")}</span></span>`;
}

function renderTenpaiWaitsRow(m) {
  // Shown only when we've stored waits on the mistake — currently 5A (after
  // removing the chosen riichi tile) and 5B (after the silently-discarded
  // would-be riichi tile). Placement directly below the discards block so
  // the student can see their hand's waits against what's been thrown away.

  // For 5A/5B the riichi/dama point scoring now lives inline in the EV table's
  // per-column "Value" row (renderEvComparison), so we don't repeat it here.
  // That table only renders when we have top_actions + discard_stats; when it
  // doesn't (e.g. stats missing), fall back to the standalone EV-bars view so
  // the scoring isn't lost. The bars also fall through to the legacy chip strip
  // if they can't build (open hand, missing draw, Riichi calculator bailed).
  if ((m.category === "5A" || m.category === "5B")
      && typeof renderBadRiichiBars === "function") {
    const tableWillScore = m.top_actions && m.top_actions.length
      && m.discard_stats && m.discard_stats.length;
    if (tableWillScore) return "";
    const bars = renderBadRiichiBars(m);
    if (bars) return bars;
  }

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

function renderDoraSection(b) {
  if (!b) return "";
  let html = "";
  if (b.dora_indicators && b.dora_indicators.length) {
    // CS-02: dora_tiles is the canonical resolved list emitted by
    // extract_board_state — same length/order as dora_indicators.
    const doraList = b.dora_tiles || [];
    html += `<span class="dora-section"><span class="dora-label">Dora</span>`;
    for (let i = 0; i < b.dora_indicators.length; i++) {
      const d = b.dora_indicators[i];
      const actual = doraList[i] || d;
      html += renderTile(actual, "dora-indicator", `Dora ${actual} (from indicator ${d})`);
    }
    html += `</span>`;
  }
  return html;
}

function renderBoardContext(m) {
  const b = m.board_state;
  if (!b) return "";
  setActiveDora(getDoraTiles(b), b);

  let html = "";

  // Build seat -> melds lookup for inline rendering
  const meldsBySeat = {};
  if (b.opponent_melds) {
    for (const om of b.opponent_melds) {
      meldsBySeat[om.seat] = om.melds;
    }
  }

  // All player discards + inline melds (collapsible).
  // Auto-expand for meld/riichi/kan decisions, defensive scenes (riichi or
  // open-threat defense), when there's a live threat, or if the skill area is
  // unknown.
  if (b.all_discards && b.all_discards.length) {
    const hasDiscards = b.all_discards.some(d => d.discards.length > 0 || meldsBySeat[d.seat]);
    if (hasDiscards) {
      const doraTiles = getDoraTiles(b);
      const sa = m.skillArea;
      const expandDiscards = (Array.isArray(m.per_threat) && m.per_threat.length > 0)
                             || sa === "defense" || sa === "open_defense"
                             || sa === "meld" || sa === "riichi" || sa === "kan"
                             || !sa;
      const playerSeat = mistakeActorSeat(m);
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
        if (!d.discards.length && !seatMelds && b.scores?.[d.seat] == null) continue;
        const seatName = seatWindLabel(d.seat);
        const isYou = playerSeat != null && d.seat === playerSeat;
        // Open-threat signal for an opponent (not you): the same trigger the
        // categorizer's Open Defense axis uses (defense.js V8 — 2+ open calls,
        // OR a single high-value call with value-han ≥ 3). A riichi opp takes
        // precedence (its own red row), so the amber open-threat chip only fires
        // on non-riichi seats. A guaranteed ≥2-han floor (one exposed dora, or
        // two yakuhai) upgrades the chip to the solid "strong" fill; a lone
        // high-value call always clears it. A separate "3 dora exposed" chip
        // remains a fallback for melds that don't trip the open-call gate.
        const isRiichiOpp = !isYou && d.riichi_idx != null;
        const openMeldCount = (seatMelds && !isYou)
          ? seatMelds.filter(mm => OPEN_MELD_TYPES.has(mm.type)).length : 0;
        const isOppThreat = !isYou && !isRiichiOpp;
        const doraTilesList = isOppThreat ? meldDoraTiles(seatMelds, doraTiles) : [];
        const meldDora = doraTilesList.length;
        const seatWindLetter = (oya != null) ? WINDS[(d.seat - oya + 4) % 4] : null;
        const yakuList = isOppThreat
          ? [...meldYakuhai(seatMelds, seatWindLetter, b.round_wind), ...meldIttsu(seatMelds),
             ...meldFourCallYaku(seatMelds, openMeldCount)] : [];
        const yakuHan = yakuList.reduce((sum, y) => sum + y.han, 0);
        const guaranteedHan = threatGuaranteedHan(yakuHan, meldDora);
        const valueHan = openValueHan(yakuHan, meldDora);
        const threatBand = isOppThreat
          ? openThreatBand(openMeldCount, guaranteedHan, valueHan) : null;
        const isMeldDanger = threatBand != null;
        const isDoraDanger = meldDora >= 3;
        const isDanger = isMeldDanger || isDoraDanger;
        let rowCls = "discard-row";
        if (isYou) rowCls += " you-row";
        if (isDanger) rowCls += " danger-row";
        if (isRiichiOpp) rowCls += " riichi-row";
        html += `<div class="${rowCls}">`;
        html += `<span class="discard-label"><span class="discard-seat">${seatName}`;
        if (isYou) html += `<span class="you-tag">(you)</span>`;
        html += `</span>`;
        if (b.scores?.[d.seat] != null) {
          html += `<span class="discard-score">${b.scores[d.seat].toLocaleString()}</span>`;
        }
        if (isRiichiOpp) html += `<span class="riichi-tag">RIICHI</span>`;
        if (isOppThreat && openMeldCount > 0) {
          // Every open opponent gets one disclosure, including quiet one-call
          // hands. Warning, band and row shading still use the original gate.
          html += `<span class="danger-tag open-tag ${threatBand || "quiet"} has-detail" tabindex="0">`
            + `${isDanger ? "⚠ " : ""}Open`
            + renderThreatDetail(openMeldCount, m.turn, yakuList, doraTilesList, guaranteedHan,
              b.yaku && b.yaku[d.seat], isDanger)
            + `</span>`;
        } else if (isDoraDanger) {
          html += `<span class="danger-tag" title="${meldDora} dora exposed in melds">⚠ ${meldDora} dora</span>`;
        }
        html += `</span>`;
        html += `<span class="tiles">`;
        const seatSkipCallers = skipCallersBefore.get(d.seat) || [];
        // Soft-safe anchor: for an open threat (non-riichi danger row), the
        // opponent's *last tedashi* is the discard that froze their wait — every
        // tile that passed since would have been ronned if it won. Outline it
        // (sibling of the riichi anchor) so hovering reveals the soft-safe set.
        // No anchor when the row isn't an open threat or has no tedashi at all
        // (an all-tsumogiri pool was never a hand-changing decision to mark).
        let softAnchorIdx = -1;
        if (isDanger && !isRiichiOpp) {
          for (let i = d.discards.length - 1; i >= 0; i--) {
            const raw = d.discards[i];
            const tsg = (typeof raw === "object" && raw !== null) ? raw.tsumogiri : false;
            if (!tsg) { softAnchorIdx = i; break; }
          }
        }
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
          const isTsumogiri = (typeof raw === "object" && raw !== null) ? raw.tsumogiri : false;
          const isRiichi = i === d.riichi_idx;
          const absTurn = absTurnMap.get(`${d.seat}_${i}`);
          const posAttrs = `data-turn="${absTurn}" data-seat="${d.seat}"`;
          // dora-highlight is applied automatically by renderTile.
          let cls = "action-tile-sm no-yakuhai";
          // Called tile (taken by an opponent) → dashed outline; tsumogiri
          // (drawn-and-thrown) → grey shading. Independent, so a tile can be
          // both (a tsumogiri that got called).
          if (calledBy != null) cls += " ghost-tile";
          if (isTsumogiri) cls += " tsumogiri-tile";
          if (isRiichi) {
            const riichiAttrs = `${posAttrs} data-riichi-turn="${absTurn}" data-riichi-seat="${d.seat}"`;
            html += renderTile(tile, cls + " riichi-tile",
              "Riichi declared here — hover to see tiles safe against this riichi",
              riichiAttrs);
          } else if (i === softAnchorIdx) {
            const softAttrs = `${posAttrs} data-soft-turn="${absTurn}" data-soft-seat="${d.seat}"`;
            html += renderTile(tile, cls + " soft-anchor-tile",
              "Last hand-changing discard — their wait froze here; hover to see "
              + "soft-safe tiles (a competent opp would have ronned a winning "
              + "tile that has passed since)",
              softAttrs);
          } else {
            html += renderTile(tile, cls, null, posAttrs);
          }
        }
        html += `</span>`;
        if (seatMelds) {
          const yakuhaiTiles = new Set(["P", "F", "C", b.round_wind, seatWindLetter].filter(Boolean));
          html += `<span class="inline-melds">`;
          for (const meld of seatMelds) {
            html += renderMeld(meld, "action-tile-sm", d.seat, doraTiles, oya, yakuhaiTiles) + " ";
          }
          html += `</span>`;
        }
        html += `</div>`;
      }
      html += `</details>`;
    }
  }

  return html ? `<div class="board-context">${html}</div>` : "";
}
