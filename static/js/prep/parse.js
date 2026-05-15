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

  return { flatten_mjai_log, walk_kyoku };
}));
