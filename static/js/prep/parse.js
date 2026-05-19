// mjai event walking — twin of lib/parse.py for prep. Pure logic; no UI.
// Provides `flatten_mjai_log` and `walk_kyoku`, the canonical per-kyoku
// event walker that feeds defense / decision-state tracking on the JS side.
//
// See lib/parse.py for the documentation of the return shape — kept
// identical so the Python and JS prep layers can be diffed by a parity
// fixture verbatim.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.haipaiPrepParse = factory();
  }
}(typeof self !== "undefined" ? self : this, function () {

  function flatten_mjai_log(mjai_log) {
    const flat = [];
    for (const item of mjai_log || []) {
      if (Array.isArray(item)) {
        for (const sub of item) {
          if (sub && typeof sub === "object" && !Array.isArray(sub)) flat.push(sub);
        }
      } else if (item && typeof item === "object") {
        flat.push(item);
      }
    }
    return flat;
  }

  function walk_kyoku(events, start_pos, end_pos, player_id, target_tiles_left = 0) {
    const opponents = {};
    // First-seen seat order — Python's dict preserves insertion order; JS
    // objects with numeric-string keys do not, so we track it explicitly so
    // downstream consumers (notably `get_opponent_discards`) emit the same
    // ordering as the Python prep layer.
    const opponent_order = [];
    const player_tsumo_riichi_state = [];
    const reach_accepted_seats = new Set();
    const genbutsu_post_reach_by_seat = {};
    let tiles_left = 70;
    let first_dora_indicator = null;

    if (start_pos >= 0 && start_pos < events.length) {
      const sk = events[start_pos];
      if (sk && sk.type === "start_kyoku") {
        let dm = sk.dora_marker;
        if (Array.isArray(dm) && dm.length) dm = dm[0];
        if (typeof dm === "string") first_dora_indicator = dm;
      }
    }

    function ensureOpp(actor) {
      let o = opponents[actor];
      if (!o) {
        o = {
          discards: [],
          reach_event_idx: null,
          reach_accepted: false,
          open_melds: 0,
        };
        opponents[actor] = o;
        opponent_order.push(actor);
      }
      return o;
    }

    for (let pos = start_pos + 1; pos < end_pos; pos++) {
      const e = events[pos];
      if (!e) continue;
      const etype = e.type;
      const actor = e.actor;

      if (etype === "tsumo") {
        tiles_left -= 1;
        if (actor === player_id) {
          player_tsumo_riichi_state.push(reach_accepted_seats.size > 0);
        }
      } else if (etype === "dahai" && actor !== undefined && actor !== null) {
        const pai = e.pai;
        if (actor !== player_id) ensureOpp(actor).discards.push(pai);
        if (pai !== undefined && pai !== null) {
          for (const seat of reach_accepted_seats) {
            if (!genbutsu_post_reach_by_seat[seat]) genbutsu_post_reach_by_seat[seat] = [];
            genbutsu_post_reach_by_seat[seat].push(pai);
          }
        }
      } else if (etype === "kakan" && actor !== undefined && actor !== null) {
        const pai = e.pai;
        if (actor !== player_id) ensureOpp(actor);
        if (pai !== undefined && pai !== null) {
          for (const seat of reach_accepted_seats) {
            if (!genbutsu_post_reach_by_seat[seat]) genbutsu_post_reach_by_seat[seat] = [];
            genbutsu_post_reach_by_seat[seat].push(pai);
          }
        }
      } else if (etype === "reach" && actor !== undefined && actor !== null && actor !== player_id) {
        const opp = ensureOpp(actor);
        opp.reach_event_idx = opp.discards.length;
      } else if (etype === "reach_accepted" && actor !== undefined && actor !== null && actor !== player_id) {
        const opp = ensureOpp(actor);
        opp.reach_accepted = true;
        reach_accepted_seats.add(actor);
      } else if ((etype === "pon" || etype === "chi" || etype === "daiminkan")
                 && actor !== undefined && actor !== null && actor !== player_id) {
        ensureOpp(actor).open_melds += 1;
      }

      if (tiles_left <= target_tiles_left) break;
    }

    return {
      opponents,
      opponent_order,
      player_tsumo_riichi_state,
      genbutsu_post_reach_by_seat,
      first_dora_indicator,
      tiles_left_at_end: tiles_left,
    };
  }

  const _MELD_TYPES = new Set(["chi", "pon"]);
  const _KAN_TYPES = new Set(["ankan", "kakan", "daiminkan"]);

  // JS mirror of lib/parse.py::skill_area_for_entry — classifies one review
  // entry into the same denominator bucket the Python parser uses, so the
  // client-computed decision_counts agree with what the backfill would have
  // produced.
  function skill_area_for_entry(actual_type, expected_type, detail_types, in_riichi) {
    const types = new Set();
    if (actual_type) types.add(actual_type);
    if (expected_type) types.add(expected_type);
    if (types.has("chi") || types.has("pon")) return "meld";
    if (types.has("reach")) return "riichi";
    if (types.has("ankan") || types.has("kakan") || types.has("daiminkan")) return "kan";
    if (types.has("dahai")) return in_riichi ? "defense" : "attack";
    const d = new Set(detail_types || []);
    if (d.has("chi") || d.has("pon")) return "meld";
    if (d.has("reach")) return "riichi";
    if (d.has("ankan") || d.has("kakan") || d.has("daiminkan")) return "kan";
    return null;
  }

  // Per-skill-area decision counts for one kyoku — denominator for the
  // trends EV/D bars. Mirrors lib/parse.py::_decision_counts_for_kyoku;
  // entries hit attack/defense by player tsumo-state when the action is
  // plain dahai, otherwise by action-type priority.
  function decision_counts_for_kyoku(entries, start_pos, end_pos, events, player_id) {
    const counts = { attack: 0, defense: 0, riichi: 0, meld: 0, kan: 0 };
    const state = walk_kyoku(events, start_pos, end_pos, player_id);
    const junme_state = state.player_tsumo_riichi_state;
    for (const entry of (entries || [])) {
      const junme = entry.junme;
      const actual_type = (entry.actual || {}).type || null;
      const expected_type = (entry.expected || {}).type || null;
      const detail_types = (entry.details || []).map(d => (d.action || {}).type || null);
      const in_riichi = (typeof junme === "number"
        && junme >= 0
        && junme < junme_state.length
        && junme_state[junme]);
      const area = skill_area_for_entry(actual_type, expected_type, detail_types, in_riichi);
      if (area) counts[area] += 1;
    }
    return counts;
  }

  // Roll per-kyoku denominators into a per-game total. Pass mortalData as
  // returned by /api/games/<id> (or a previously prepped game's
  // `mortal_data`). Returns null if the data isn't usable.
  function decision_counts_for_game(mortalData) {
    if (!mortalData) return null;
    const player_id = mortalData.player_id;
    if (player_id === undefined || player_id === null) return null;
    const kyokus = ((mortalData.review || {}).kyokus) || [];
    const events = flatten_mjai_log(mortalData.mjai_log || []);
    const start_positions = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i] && events[i].type === "start_kyoku") start_positions.push(i);
    }
    const totals = { attack: 0, defense: 0, riichi: 0, meld: 0, kan: 0 };
    for (let ki = 0; ki < kyokus.length; ki++) {
      const start = start_positions[ki];
      if (start === undefined) continue;
      const end = (ki + 1 < start_positions.length) ? start_positions[ki + 1] : events.length;
      const c = decision_counts_for_kyoku(
        kyokus[ki].entries || [], start, end, events, player_id,
      );
      for (const k of Object.keys(totals)) totals[k] += c[k] || 0;
    }
    return totals;
  }

  return {
    flatten_mjai_log,
    walk_kyoku,
    skill_area_for_entry,
    decision_counts_for_kyoku,
    decision_counts_for_game,
  };
}));
