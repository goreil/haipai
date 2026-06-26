// Mistake explanation text. `generateExplanation(m)` returns the HTML fragment
// shown in the mistake card body.
//
// Two regimes:
//   - Action decisions (call / reach / kan / missed-win) carry no shape and
//     keep their dedicated per-decision prose (the 4A/4B/4C, 5A/5B, 6A/6B,
//     hora branches), dispatched on action type.
//   - Discard-vs-discard is compositional (mistake-dimensions CORE Phase 2):
//     the shape (Obvious / Trade-off / Complex) is derived from the shared
//     win-vector (compare-dimensions.js), and the body is assembled from
//     per-dimension fragments by three shape templates. The old per-category
//     discard prose (P1-P4, D1-D3, OD*, legacy 1A/2A/3A/3B/3C) is gone.
//
// Load order: depends on
//   - compare-dimensions.js (haipaiCompareDimensions — the win-vector + shape)
//   - categorize-yaku.js (detectClosedHandYaku for the 5A dama-wins branch)
//   - prep/defense.js (defenseSituation, defenseDealinForTile,
//     _isDoubleRiichiContext, tenpaiWaitTiles)
//   - mistake-card.js (mortalRaisedShanten, for the 5A branch)
//   - tiles.js (renderTile, formatAction)

// --- Compositional trainer text (mistake-dimensions CORE, Phase 2) ---
//
// The discard-vs-discard card body is no longer per-category prose. It is
// assembled from the shared win-vector (compare-dimensions.js): each winning
// dimension owns a small fragment, and three shape templates (Obvious /
// Trade-off / Complex) stitch the fragments together. A new value detector
// ships exactly one fragment and works in all three templates for free.
//
// Action decisions (call / reach / kan / missed-win) carry no shape and keep
// their dedicated text further down in generateExplanation — only the
// dahai-vs-dahai branch is compositional.

// Group → narration order. Group-internal prio (shanten>ukeire,
// dora_kept>dora_acceptance) breaks ties within a group. In a defense scene
// the safety win headlines the sentence, so Defense leads; otherwise the
// reading order is Speed → Yaku → Dora → Defense.
var _GROUP_NARRATION = { Speed: 1, Yaku: 2, Dora: 3, Defense: 4 };

function _narrationRank(w, skillArea) {
  if ((skillArea === "defense" || skillArea === "open_defense") && w.group === "Defense") return 0;
  return _GROUP_NARRATION[w.group] || 9;
}

// One natural-language clause describing what a winning dimension gains, with
// tiles rendered as glyphs. `seatWindFor(seat)` maps a deal_in entry's seat to
// a wind label (null when unknown).
function _winClause(w, seatWindFor) {
  const tile = (t) => renderTile(t, "tile-sm");
  switch (w.dim) {
    case "shanten": {
      const n = w.magnitude || 1;
      return n <= 1 ? "reaches tenpai a step sooner" : `gets ${n} steps closer to tenpai`;
    }
    case "ukeire":
      return `accepts ${w.magnitude} more tile${w.magnitude === 1 ? "" : "s"}`;
    case "dora_kept":
      return `keeps the ${tile(w.tiles[0])} dora`;
    case "dora_acceptance": {
      const ts = (w.tiles || []).map(tile).join("");
      return ts ? `keeps a wait that still draws ${ts} (dora)` : "keeps a wait that draws more dora";
    }
    case "deal_in": {
      const wind = seatWindFor ? seatWindFor(w.seat) : null;
      const pct = (w.pct != null) ? `${w.pct.toFixed(1)}% less deal-in` : "less deal-in";
      return wind ? `stays safer vs ${wind} (${pct})` : `stays safer (${pct})`;
    }
  }
  return "";
}

// The yaku a winning Yaku-group dimension keeps open, as a short name. New
// yaku detectors add a case here and are folded into the unified "wants to go
// …" clause for free. Returns null for non-yaku dimensions.
function _yakuName(w) {
  switch (w.dim) {
    case "tanyao_kept": return "tanyao";
    case "honitsu_kept": return "honitsu";
    case "ittsu_kept": return "ittsu";
    case "yakuhai_kept": return `yakuhai ${renderTile(w.tiles[0], "tile-sm")}`;
  }
  return null;
}

// The clauses for one side ("you" = the player's pick, "mortal" = Mortal's),
// in narration order. Suppressed dimensions (cross-shanten ukeire) never count.
// When a side both keeps a dora AND its wait draws dora, the acceptance clause
// only names the *extra* dora the kept clause didn't (and is dropped entirely
// when there's no extra), so the sentence never says the same dora twice.
function _sideClauses(wins, side, skillArea, seatWindFor) {
  const mine = wins
    .filter(w => w.winner === side && !w.suppressed)
    .sort((a, b) =>
      _narrationRank(a, skillArea) - _narrationRank(b, skillArea)
      || (a.prio || 9) - (b.prio || 9));
  const keptDora = new Set();
  for (const w of mine) {
    if (w.dim === "dora_kept") for (const t of (w.tiles || [])) keptDora.add(t);
  }
  // All Yaku-group wins (yakuhai, tanyao, …) collapse into ONE clause naming
  // every yaku the pick keeps open — "wants to go tanyao and yakuhai 🀅, …" —
  // rather than a separate fragment each. Emitted once, at the first yaku win's
  // narration slot; the rest are skipped.
  const yakuNames = mine.map(_yakuName).filter(Boolean);
  let yakuEmitted = false;
  const clauses = [];
  for (const w of mine) {
    let c;
    if (_yakuName(w)) {
      if (yakuEmitted) continue;
      yakuEmitted = true;
      c = `wants to go ${_joinClauses(yakuNames)}, which gives the option `
        + `for more points and speeds up the hand`;
    } else if (w.dim === "dora_acceptance" && keptDora.size) {
      // Only the dora the kept clause didn't already name.
      const extra = (w.tiles || []).filter(t => !keptDora.has(t));
      if (!extra.length) continue;  // wait draws only the dora we already kept — say nothing more
      c = `its wait also draws ${extra.map(t => renderTile(t, "tile-sm")).join("")}`;
    } else {
      c = _winClause(w, seatWindFor);
    }
    if (c) clauses.push(c);
  }
  return clauses;
}

// "a and b" / "a, b, and c".
function _joinClauses(clauses) {
  if (!clauses.length) return "";
  if (clauses.length === 1) return clauses[0];
  if (clauses.length === 2) return `${clauses[0]} and ${clauses[1]}`;
  return `${clauses.slice(0, -1).join(", ")}, and ${clauses.slice(-1)[0]}`;
}

// Scene-framing lead line for a defense / open-defense discard. Empty for
// attack (the shape headline carries the whole sentence there).
function _defenseLead(skillArea, defenseCtx) {
  if (skillArea === "open_defense") return "A non-riichi opponent's open hand is threatening.";
  if (skillArea !== "defense") return "";
  const riichiOpps = (defenseCtx.threats || []).filter(t => t.kind === "riichi");
  const winds = riichiOpps.map(t => t.wind).filter(Boolean);
  if (!winds.length) return "An opponent is in riichi.";
  const subject = winds.length === 1
    ? winds[0]
    : winds.slice(0, -1).join(", ") + " + " + winds.slice(-1)[0];
  return `${subject} ${winds.length > 1 ? "are" : "is"} in riichi.`;
}

// The "trust the read" hint for a complex spot — what the visible stats can't
// see. Defense reads weigh the threat; attack reads weigh hand-building.
function _complexHint(skillArea) {
  return (skillArea === "defense" || skillArea === "open_defense")
    ? "a wait-quality, hand-value, or score read on the threat"
    : "hand shape, wait quality, or yaku potential";
}

// Assemble the discard-vs-discard body from shape + win-vector. Returns null
// when the comparator isn't available (callers fall through to legacy text).
function explainDiscardShape(m, defenseCtx) {
  const cmp = (typeof haipaiCompareDimensions !== "undefined") ? haipaiCompareDimensions : null;
  if (!cmp) return null;
  const wins = cmp.compareDimensions(m);
  const shape = cmp.deriveShape(wins, m);
  const skillArea = cmp.skillAreaFor(m);
  if (shape !== "obvious" && shape !== "trade-off" && shape !== "complex") return null;

  const threats = (defenseCtx && defenseCtx.threats) || [];
  const seatWindMap = {};
  for (const t of threats) seatWindMap[t.seat] = t.wind;
  const soleWind = threats.length === 1 ? threats[0].wind : null;
  const seatWindFor = (seat) => (seat != null ? seatWindMap[seat] : soleWind) || null;

  const aT = renderTile(m.actual.pai, "tile-sm");
  const eT = renderTile(m.expected.pai, "tile-sm");
  const youText = _joinClauses(_sideClauses(wins, "you", skillArea, seatWindFor));
  const mortalText = _joinClauses(_sideClauses(wins, "mortal", skillArea, seatWindFor));
  const lead = _defenseLead(skillArea, defenseCtx);
  const leadHtml = lead ? `<span class="trigger-line">${lead}</span>` : "";

  if (shape === "obvious") {
    // Mortal strictly dominates — your column won nothing.
    let head = mortalText
      ? `Mortal's ${eT} is simply better — it ${mortalText}.`
      : `Mortal's ${eT} is simply better here.`;
    return `${leadHtml}<span class="trigger-line">${head}</span>`
      + ` Your ${aT} gives that up for nothing — a pure-technique spot, so it's one of the easier ones to fix.`;
  }

  if (shape === "trade-off") {
    // Both columns won something — value vs speed vs safety.
    return `${leadHtml}<span class="trigger-line">A judgment call.</span>`
      + ` Your ${aT} ${youText} — but Mortal's ${eT} ${mortalText}, and here that's worth more.`;
  }

  // complex — Mortal's column won nothing visible.
  if (youText) {
    return `${leadHtml}<span class="trigger-line">Mortal prefers ${eT}, but the visible stats don't explain it.</span>`
      + ` Your ${aT} ${youText}, yet Mortal still picks ${eT} — likely ${_complexHint(skillArea)}. Trust the read.`;
  }
  return `${leadHtml}<span class="trigger-line">Mortal prefers ${eT} over your ${aT}, but shanten, ukeire and value don't explain it.</span>`
    + ` The edge is ${_complexHint(skillArea)} — trust the read.`;
}

function generateExplanation(m) {
  const actual = m.actual;
  const expected = m.expected;
  if (!actual || !expected) return "";
  // Arm the ambient active-dora set: this runs before the mistake card render,
  // so renderTile() calls in the explanation (e.g. the dora-acceptance tiles)
  // highlight against this mistake's dora rather than a stale neighbour's.
  setActiveDora(getDoraTiles(m.board_state));
  const at = actual.type;
  const et = expected.type;
  const cat = m.category || "";
  const shantenStr = m.shanten != null ? `${m.shanten}-shanten` : null;
  // Defense-situation read: the action-decision branches (4A/4B/5A/6A) use it
  // for their riichi-context lines, and explainDiscardShape uses its threat
  // list for the deal_in wind labels + the scene lead.
  const defenseCtx = (typeof defenseSituation === "function")
    ? defenseSituation(m) : { in_defense: false, threats: [] };

  // Pretty-format the riichi threat list as "West" or "South + West", and
  // build a deal-in suffix for the player's discard. Returns an HTML
  // fragment ready to drop into a trigger line, or null when no riichi opp
  // is present. `discardTile` is the tile whose deal-in rate to annotate
  // (e.g. the riichi tile for 5A); pass null to skip the suffix.
  function defenseTriggerHtml(discardTile) {
    const riichiOpps = defenseCtx.threats.filter(t => t.kind === "riichi");
    if (!riichiOpps.length) return null;
    const winds = riichiOpps.map(t => t.wind).filter(Boolean);
    const subject = winds.length === 0
      ? "An opponent"
      : (winds.length === 1
          ? winds[0]
          : winds.slice(0, -1).join(", ") + " + " + winds.slice(-1)[0]);
    const verb = winds.length > 1 ? "are" : "is";
    let html = `${subject} ${verb} in riichi`;
    if (discardTile) {
      const r = (typeof defenseDealinForTile === "function")
        ? defenseDealinForTile(m, discardTile) : null;
      if (r != null) {
        html += ` — your <span class="defense-tile">${discardTile}</span> has a `
              + `<span class="defense-dealin">${r.toFixed(1)}% deal-in rate</span>`;
      }
    }
    return html;
  }

  // 1-indexed standing of the mistake's player at the time of the mistake.
  // Ties round to the better placement (player tied for 1st is 1st). Null
  // when scores aren't available — older mistakes from before board_state
  // prep can hit this.
  function playerStanding(m) {
    const bs = m && m.board_state;
    const scores = bs && bs.scores;
    if (!scores || !scores.length) return null;
    const actor = m.actual && m.actual.actor;
    if (actor == null) return null;
    const my = scores[actor];
    if (my == null) return null;
    let standing = 1;
    for (let i = 0; i < scores.length; i++) {
      if (i === actor) continue;
      if (scores[i] > my) standing += 1;
    }
    return standing;
  }

  // Context line for 5A in all last — placement is the framing the student
  // needs, not raw EV. The "doesn't affect your standing" claim is the
  // teaching point: in all last the riichi premium rarely changes the
  // points table even when it lands.
  function allLastRiichiInfo(m) {
    if (!m || !m.is_all_last) return "";
    const place = playerStanding(m);
    if (!place) return "";
    const ord = ["1st", "2nd", "3rd", "4th"][place - 1] || `${place}th`;
    return `<div class="all-last-context-line">It's all last and you are in ${ord} place — the riichi bonus probably doesn't affect your standing.</div>`;
  }

  // Per-category defense info appended to the lead line of a card.
  function defenseInfoFor(category, opts = {}) {
    if (!defenseCtx.in_defense) return "";
    const opener = defenseTriggerHtml(opts.discardTile);
    if (!opener) return "";
    let body;
    if (category === "5A") {
      body = `${opener}. Declaring riichi locks your hand — you can no longer fold or swap to safer tiles if the opponent's wait closes in on you.`;
    } else if (category === "4A") {
      body = `${opener}. Opening your hand with a call cuts off your ability to defend — you commit to pushing while options to fold disappear.`;
    } else if (category === "4B") {
      const ippatsu = defenseCtx.threats.some(t => t.kind === "riichi" && t.ippatsu_alive);
      body = ippatsu
        ? `${opener}, and ippatsu is still alive. Calling here would have broken their ippatsu — denying the bonus is itself a defense play, on top of the speed.`
        : `${opener}.`;
      if (!ippatsu) return "";  // outside ippatsu window we don't surface the riichi link for 4B
    } else if (category === "6A") {
      body = `${opener}. Kan reduces your ability to defend (you commit a tile shape) AND reveals a new dora indicator — that new dora can buff their hand value as much as yours.`;
    } else {
      return "";
    }
    return `<div class="defense-context-line">${body}</div>`;
  }

  // --- Helper: find per-discard stats for a tile ---
  function statFor(tile) {
    if (!m.discard_stats) return null;
    const base = tile ? tile.replace(/r$/, "") : null;
    return m.discard_stats.find(s => s.tile === tile || s.tile === base) || null;
  }
  function mortalFor(tile) {
    if (!m.top_actions) return null;
    return m.top_actions.find(a => a.action && a.action.pai === tile) || null;
  }
  function tileCountStr(stat) {
    if (!stat) return "";
    return stat.necessary_count ? `${stat.necessary_count} tiles` : "";
  }
  // Ankan keeps the hand closed; any other meld (chi/pon/kakan/daiminkan) opens it.
  const handAlreadyOpen = !!(m.melds && m.melds.some(ml => ml.type && ml.type !== "ankan"));

  // --- Meld decisions (4A/4B/4C) ---
  if (cat === "4A" || (at !== "dahai" && at !== "reach" && (at === "chi" || at === "pon") && et === "none")) {
    const meldType = at === "chi" ? "chi" : "pon";
    let text = defenseInfoFor("4A");
    text += `You called ${meldType}, but Mortal says passing was better.`;
    if (handAlreadyOpen) {
      text += ` Your hand is already open, so there's no menzen penalty left to pay — but this ${meldType} likely narrows your shape or commits you to the wrong direction.`;
    } else {
      text += ` Calling opens your hand, which costs you menzen (closed hand) bonuses like riichi and potentially ippatsu/tsumo.`;
    }
    if (shantenStr) text += ` At ${shantenStr}, the speed gain from calling doesn't outweigh what you lose in hand value.`;
    if (m.top_actions && m.top_actions.length >= 2) {
      const evGap = Math.abs(m.top_actions[0].q_value - (mortalFor(actual.pai)?.q_value || m.top_actions[m.top_actions.length - 1].q_value));
      text += ` The EV difference is about ${evGap.toFixed(2)} — Mortal sees a meaningful cost to this call.`;
    }
    return text;
  }

  if (cat === "4B" || (at === "none" && (et === "chi" || et === "pon"))) {
    const meldType = et === "chi" ? "chi" : "pon";
    let text = defenseInfoFor("4B");
    text += `You passed on a ${meldType} opportunity, but Mortal says you should have called.`;
    if (shantenStr) text += ` Your hand is at ${shantenStr}`;
    if (shantenStr) text += ` — calling this ${meldType} would bring you closer to tenpai faster than waiting for a self-draw.`;
    if (handAlreadyOpen) {
      text += ` Your hand is already open, so there's nothing to lose by calling — the menzen bonuses are already off the table.`;
    } else {
      text += ` Sometimes speed matters more than keeping your hand closed, especially when the hand value is already decent or the game situation demands urgency.`;
    }
    return text;
  }

  if (cat === "4C") {
    let text = `You called ${formatAction(actual)}, but ${formatAction(expected)} was the better meld choice.`;
    text += ` Different melds leave you with different tile shapes and waiting patterns. The recommended call gives you a more flexible hand going forward.`;
    return text;
  }

  // --- Riichi decisions (5A/5B) ---
  if (cat === "5A" || (at === "reach" && et === "dahai")) {
    const waits = tenpaiWaitTiles(m);
    const waitTypes = waits.length;
    const waitTotal = waits.reduce((a, w) => a + (w.count || 0), 0);
    const waitCountPhrase = waitTypes
      ? `a ${waitTypes}-type wait with ${waitTotal} live ${waitTotal === 1 ? "tile" : "tiles"}`
      : null;
    // Riichi tile = the tile you actually discarded when declaring. We've
    // stored it on the mistake during prep; fall back to actual.pai for
    // older mistakes that pre-date that field.
    const riichiTile = m.actual_riichi_tile || actual.pai;
    const allLastInfo = allLastRiichiInfo(m);
    const defenseInfo = defenseInfoFor("5A", { discardTile: riichiTile });
    // Furiten is the strongest 5A signal — the riichi literally can't ron.
    // Put that up front and skip the generic "you could dama" framing.
    if (m.bad_riichi_reason === "furiten") {
      const furitenTiles = (m.furiten_tiles || [])
        .map(t => renderTile(t, "tile-sm furiten-tile")).join("");
      const waitsHtml = waits
        .map(w => renderTile(w.tile, "tile-sm furiten-wait-tile")).join("");
      let text = allLastInfo + defenseInfo;
      text += `<span class="furiten-alert">Furiten riichi</span>`;
      const waitPrefix = waitTypes
        ? `your ${waitCountPhrase} (${waitsHtml}) includes ${furitenTiles}, which you've already discarded`
        : `your wait includes tiles you've already discarded`;
      text += ` — ${waitPrefix}.`;
      text += ` While in furiten you can only win by tsumo, not ron, so declaring riichi locks you into the weaker half of your own wait.`;
      if (m.ev_loss) text += ` This cost ${m.ev_loss.toFixed(2)} EV compared to dama.`;
      return text;
    }
    // Mortal-raised-shanten on a riichi call: Mortal would rather break the
    // tenpai shape than declare. That's a strategic call (better wait,
    // bigger hand, or a defensive read), not a tile-efficiency one. The two
    // branches below are mutually exclusive — when Mortal raised shanten we
    // skip the dama framing entirely, because "Mortal picks dama" and
    // "Mortal breaks tenpai" can't both be true.
    const raisedSh = (typeof mortalRaisedShanten === "function")
      ? mortalRaisedShanten(m) : null;
    let text = allLastInfo + defenseInfo;
    if (raisedSh) {
      text += `You declared riichi, but Mortal recommends discarding ${raisedSh.mortalTile} instead — breaking tenpai rather than locking in your shape.`;
      if (waitCountPhrase) text += ` You've got ${waitCountPhrase} — thin waits especially make riichi costly since you lose the flexibility to abandon them.`;
      text += ` Riichi locks your hand — you can't change your wait or defend against opponents.`;
      text += ` <span class="raised-shanten-hint">Mortal even breaks tenpai (${raisedSh.userSh}→${raisedSh.mortalSh}-shanten) by picking ${raisedSh.mortalTile} — it wants a better wait, more hand value, or room to defend, and would rather give up tenpai than ride your shape into riichi.</span>`;
    } else {
      const isDaburi = typeof _isDoubleRiichiContext === "function" && _isDoubleRiichiContext(m);
      const riichiHanStr = isDaburi ? "2 han (double riichi)" : "1 han";
      text += `You declared riichi, but Mortal recommends just discarding ${expected.pai} (dama) instead.`;
      if (waitCountPhrase) text += ` You've got ${waitCountPhrase} — thin waits especially make riichi costly since you lose the flexibility to abandon them.`;
      text += ` Riichi locks your hand — you can't change your wait or defend against opponents.`;
      const yakuHints = detectClosedHandYaku(m);
      if (yakuHints.length) {
        text += ` <span class="yaku-hints">Dama would win with: ${yakuHints.map(y => `<span class="yaku-tag">${y}</span>`).join(" ")}</span>`;
        text += ` — with dama you keep flexibility, can dodge dangerous tiles, and the riichi premium of ${riichiHanStr} + ippatsu chance may not be worth the lock-in.`;
      } else {
        text += ` Mortal still says dama works here — perhaps because of board state, score situation, or remaining tiles. Trust Mortal's read on this one.`;
      }
    }
    if (m.ev_loss) text += ` This cost ${m.ev_loss.toFixed(2)} EV compared to the best play.`;
    return text;
  }

  if (cat === "5B" || (at === "dahai" && et === "reach")) {
    const waits = tenpaiWaitTiles(m);
    const waitTypes = waits.length;
    const waitTotal = waits.reduce((a, w) => a + (w.count || 0), 0);
    const isDaburi = typeof _isDoubleRiichiContext === "function" && _isDoubleRiichiContext(m);
    const minHanStr = isDaburi ? "2 han (double riichi)" : "1 han";
    let text = `Your hand is tenpai and ready to declare riichi, but you chose to discard ${actual.pai} silently.`;
    if (waitTypes) {
      text += ` You've got a ${waitTypes}-type wait with ${waitTotal} live ${waitTotal === 1 ? "tile" : "tiles"} remaining — declaring riichi would lock it in but add at least ${minHanStr} plus the ippatsu/uradora chances.`;
    } else {
      text += ` Riichi adds at least ${minHanStr} to your hand value, plus the chance of ippatsu (winning within one round).`;
    }
    text += ` It also intimidates opponents into playing defensively, which can protect your winning tile from being blocked.`;
    if (m.ev_loss) text += ` This cost ${m.ev_loss.toFixed(2)} EV compared to declaring riichi.`;
    return text;
  }

  // --- Kan decisions (6A/6B) ---
  if (cat === "6A") {
    let text = defenseInfoFor("6A");
    text += `You declared kan, but Mortal says ${formatAction(expected)} was better.`;
    text += ` Kan gives you an extra draw and reveals a new dora indicator, but it also reveals information to opponents and changes the tile count.`;
    text += ` Here, the risk or timing wasn't worth the potential reward.`;
    return text;
  }

  if (cat === "6B") {
    let text = `You chose ${formatAction(actual)}, but declaring kan was the better play.`;
    text += ` The kan would give you an extra draw from the dead wall plus a new dora indicator, potentially increasing your hand's value. In this position, the reward outweighs the information you reveal.`;
    return text;
  }

  // --- Missed win ---
  if (et === "hora") {
    let text = `You passed on a winning tile — this is almost always a mistake.`;
    text += ` Unless you're strategically going for a higher-scoring wait (damaten to ippatsu, or furiten considerations), you should take the win when it's offered.`;
    return text;
  }

  // --- Discard vs discard ---
  // Compositional: the shape (Obvious / Trade-off / Complex) is derived from
  // the shared win-vector (compare-dimensions.js) and the body is assembled
  // from per-dimension fragments via explainDiscardShape. The old per-category
  // prose (P1-P4, D1-D3, OD*, and legacy 1A/2A/3A/3B/3C) is gone — every
  // discard mistake routes through the three shape templates now.
  if (at === "dahai" && et === "dahai") {
    const shapeText = explainDiscardShape(m, defenseCtx);
    if (shapeText) return shapeText;

    // Fallback only when the comparator isn't loaded (e.g. an unprepped
    // mistake with no win-vector): an honest minimal description off raw stats.
    const actualStat = statFor(actual.pai);
    const expectedStat = statFor(expected.pai);
    let text = `Mortal recommends discarding ${expected.pai} instead of your ${actual.pai}.`;
    if (shantenStr) text += ` Your hand is at ${shantenStr}.`;
    if (expectedStat && actualStat) {
      text += ` Tile acceptance: ${tileCountStr(expectedStat)} for ${expected.pai} vs ${tileCountStr(actualStat)} for ${actual.pai}.`;
    }
    return text;
  }

  // Fallback
  return `Mortal recommends ${formatAction(expected)} instead of your ${formatAction(actual)}. The EV difference of ${m.ev_loss.toFixed(2)} suggests this was a meaningful mistake.`;
}
