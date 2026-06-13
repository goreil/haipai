// Defense safety labels derived on the client.
//
// Two public functions:
//
//   coarseSafetyLabelForTile(mistake, tile)
//     -> "genbutsu" | "suji" | "no-suji" | null
//
//   fineLabelForTile(mistake, tile)
//     -> "genbutsu"
//        | "honor (0 left)" .. "honor (3 left)"
//        | "suji terminal" | "suji 2-8" | "suji 3-7" | "suji 4-5-6"
//        | "non-suji terminal" | "non-suji 2-8" | "non-suji 3-7" | "non-suji 4-5-6"
//        | null  (no riichi threat)
//
// Derived purely from the defense payload the backend already sends:
//   mistake.per_threat[].genbutsu       — per-threat pass-through mjai tiles
//   mistake.hand / melds                 — hero's visible tiles
//   mistake.board_state.all_discards     — every seat's discard pool
//   mistake.board_state.opponent_melds   — every opponent's open melds
//   mistake.board_state.dora_indicators  — visible dora indicators
//
// Suji derivation mirrors lib/defense_kd.py::_derive_label — edge tiles
// (1-3, 7-9 in a suit) are suji on one flank, 4/5/6 need both flanks
// genbutsu. Worst-across-threats wins.

const _DEFENSE_HONORS = new Set(["E", "S", "W", "N", "P", "F", "C"]);

function _digitGroup(digit) {
  if (digit === 1 || digit === 9) return "terminal";
  if (digit === 2 || digit === 8) return "2-8";
  if (digit === 3 || digit === 7) return "3-7";
  return "4-5-6";
}

function _coarseLabelForThreat(base, genbutsuSet) {
  if (genbutsuSet.has(base)) return "genbutsu";
  if (_DEFENSE_HONORS.has(base)) return "no-suji";
  const digit = parseInt(base[0], 10);
  const suit = base[1];
  const plus3 = `${digit + 3}${suit}`;
  const minus3 = `${digit - 3}${suit}`;
  if (digit >= 1 && digit <= 3) return genbutsuSet.has(plus3) ? "suji" : "no-suji";
  if (digit >= 7 && digit <= 9) return genbutsuSet.has(minus3) ? "suji" : "no-suji";
  return genbutsuSet.has(minus3) && genbutsuSet.has(plus3) ? "suji" : "no-suji";
}

const _COARSE_RANK = { "genbutsu": 0, "suji": 1, "no-suji": 2 };

function coarseSafetyLabelForTile(mistake, tile) {
  if (!mistake || !mistake.per_threat || mistake.per_threat.length === 0) {
    return null;
  }
  const base = tileBase(tile);
  let worst = null;
  for (const th of mistake.per_threat) {
    const gen = new Set((th.genbutsu || []).map(tileBase));
    const label = _coarseLabelForThreat(base, gen);
    if (worst === null || _COARSE_RANK[label] > _COARSE_RANK[worst]) {
      worst = label;
    }
  }
  return worst;
}

function _countVisibleTile(mistake, base) {
  const matches = (t) => tileBase(t) === base;
  let c = 0;
  for (const t of mistake.hand || []) if (matches(t)) c++;
  for (const meld of mistake.melds || []) {
    for (const t of meld.consumed || []) if (matches(t)) c++;
    if (meld.pai && matches(meld.pai)) c++;
  }
  const bs = mistake.board_state || {};
  for (const row of bs.all_discards || []) {
    for (const d of row.discards || []) if (matches(d.tile)) c++;
  }
  for (const opp of bs.opponent_melds || []) {
    for (const meld of opp.melds || []) {
      for (const t of meld.consumed || []) if (matches(t)) c++;
      if (meld.pai && matches(meld.pai)) c++;
    }
  }
  for (const d of bs.dora_indicators || []) if (matches(d)) c++;
  return c;
}

function fineLabelForTile(mistake, tile) {
  const coarse = coarseSafetyLabelForTile(mistake, tile);
  if (coarse == null) return null;
  if (coarse === "genbutsu") return "genbutsu";
  const base = tileBase(tile);
  if (_DEFENSE_HONORS.has(base)) {
    const visible = _countVisibleTile(mistake, base);
    const left = Math.max(0, Math.min(3, 4 - visible));
    return `honor (${left} left)`;
  }
  const prefix = coarse === "suji" ? "suji" : "non-suji";
  return `${prefix} ${_digitGroup(parseInt(base[0], 10))}`;
}

// --- Generic defense-situation helper ---------------------------------------
//
// Single source of truth for "is this mistake in a defense situation?". Used
// by the bad-riichi / bad-meld / missed-meld / bad-kan explanations and the
// dahai-vs-dahai categorizer.
//
// Today the only trigger is a riichi threat (any opponent in riichi with
// dealin data computed). When open-defense detection lands (3+ open calls →
// threatening hand), it should attach into the same `threats` array so all
// the category messages pick it up automatically.

const _DEFENSE_WINDS_ABS = ["E", "S", "W", "N"];
const _DEFENSE_WIND_DISPLAY = { E: "East", S: "South", W: "West", N: "North" };

function _oyaSeat(m) {
  const b = m && m.board_state;
  if (!b || !b.seat_wind) return null;
  const playerSeat = m.actual ? m.actual.actor : null;
  if (playerSeat == null) return null;
  const pw = _DEFENSE_WINDS_ABS.indexOf(b.seat_wind);
  if (pw < 0) return null;
  return ((playerSeat - pw) % 4 + 4) % 4;
}

function _seatWindLabel(m, seat) {
  const oya = _oyaSeat(m);
  if (oya == null || seat == null) return null;
  const w = _DEFENSE_WINDS_ABS[(seat - oya + 4) % 4];
  return _DEFENSE_WIND_DISPLAY[w] || null;
}

// Returns { in_defense, riichi_threat, threats:[{seat, wind, riichi_tile,
//   ippatsu_alive}, ...] }. `riichi_threat` is true iff any threat comes from
// an opponent in riichi. Future open-defense triggers can extend `threats`
// without touching the consumers.
function defenseSituation(m) {
  const out = { in_defense: false, riichi_threat: false, threats: [] };
  if (!m) return out;
  const per = Array.isArray(m.per_threat) ? m.per_threat : [];
  for (const t of per) {
    if (!t || t.seat == null) continue;
    // Honor the threat kind from prep ("riichi" | "open"). Missing tags on
    // older prepped data read as riichi, matching categorize.js's gate.
    const kind = t.kind || "riichi";
    out.threats.push({
      seat: t.seat,
      wind: _seatWindLabel(m, t.seat),
      riichi_tile: t.riichi_tile || null,
      ippatsu_alive: !!t.ippatsu_alive,
      kind,
    });
    if (kind === "riichi") out.riichi_threat = true;
  }
  out.in_defense = out.threats.length > 0;
  return out;
}

// Deal-in % for one tile, with red-five fallback. Mirrors the dealinFor()
// helpers scattered through the codebase — pulled out so the defense-context
// messages and the hand-tile colouring share one lookup.
function defenseDealinForTile(m, tile) {
  if (!tile || !m || !m.dealin_rates) return null;
  const r = m.dealin_rates[tile];
  if (r != null) return r;
  return m.dealin_rates[tileBase(tile)] ?? null;
}
