// Wall reconstruction + canonical BoardState extraction — twin of
// lib/board.py for the JS prep pipeline. Pure event walk over mjai_log;
// no UI. See lib/board.py for the full doc; the return shape of
// `extract_board_state` is identical so a parity fixture can diff
// Python and JS prep outputs directly.
//
// Yaku-panel helpers (shape yakus, sanshoku, ittsuu, yakuhai) live in
// prep-board-yaku.js and are loaded as a sibling module.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const tiles = require("./tiles.js");
    const parse = require("./parse.js");
    module.exports = factory(tiles, parse);
  } else {
    root.haipaiPrepBoardState = factory(root.haipaiPrepTiles, root.haipaiPrepParse);
  }
}(typeof self !== "undefined" ? self : this, function (tiles, parse) {

  const { mjai_to_tile_id, tile_id_to_base, dora_indicator_to_dora_mjai } = tiles;
  const { flatten_mjai_log } = parse;

  function decrement_wall(wall, mjai_tile) {
    const tid = mjai_to_tile_id(mjai_tile);
    const base = tile_id_to_base(tid);
    wall[base] -= 1;
    if (tid !== base) wall[tid] -= 1;
  }

  function _findStartPositions(events) {
    const out = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i] && events[i].type === "start_kyoku") out.push(i);
    }
    return out;
  }

  // Locate the exact decision event for a Mortal review entry so the walks
  // stop there instead of at the next draw. tiles_left alone can't identify
  // the decision: calls don't consume wall tiles, so several decisions share
  // one tiles_left and the legacy stop-at-next-tsumo rule counted events that
  // happen AFTER the decision (the player's own discard, later calls) into
  // the visible wall — reports #170/#207/#208. A decision happens immediately
  // after its trigger event:
  //   - post-call discard (at_self_chi_pon): the player's own chi/pon
  //   - chankan decision (at_opponent_kakan): that opponent's kakan
  //   - own-draw decision (last_actor == player): the player's tsumo
  //   - call/ron decision on a discard (last_actor != player): that dahai
  // Returns a predicate over (event, tiles_left AFTER the event), or null
  // when the entry is missing — callers then keep the legacy behavior. The
  // tiles_left === target guard keeps lookalike events in other turns from
  // matching; if the trigger somehow never fires the walks still stop at the
  // legacy next-tsumo boundary.
  function _decision_trigger(entry, player_id) {
    if (!entry || entry.tiles_left == null || entry.last_actor == null) return null;
    const target = entry.tiles_left;
    const last_actor = entry.last_actor;
    const tile = entry.tile;
    if (entry.at_self_chi_pon) {
      return (e, tiles_left) => tiles_left === target
        && (e.type === "chi" || e.type === "pon") && e.actor === player_id
        && (tile == null || e.pai === tile);
    }
    if (entry.at_opponent_kakan) {
      return (e, tiles_left) => tiles_left === target
        && e.type === "kakan" && e.actor === last_actor
        && (tile == null || e.pai === tile);
    }
    if (last_actor === player_id) {
      return (e, tiles_left) => tiles_left === target
        && e.type === "tsumo" && e.actor === player_id;
    }
    return (e, tiles_left) => tiles_left === target
      && e.type === "dahai" && e.actor === last_actor
      && (tile == null || e.pai === tile);
  }

  function reconstruct_context(mortal_data, kyoku_idx, tiles_left_target, entry) {
    const player_id = mortal_data.player_id;
    const events = flatten_mjai_log(mortal_data.mjai_log);
    const start_positions = _findStartPositions(events);
    const start_pos = start_positions[kyoku_idx];
    const start = events[start_pos];

    const bakaze = start.bakaze;
    const round_wind_id = mjai_to_tile_id(bakaze);
    const oya = start.oya;
    const seat_idx = ((player_id - oya) % 4 + 4) % 4;
    const seat_wind_id = 27 + seat_idx;

    const wall = new Array(37).fill(4);
    for (let i = 34; i < 37; i++) wall[i] = 1;

    const dora_indicators = [start.dora_marker];
    const visible = [start.dora_marker];

    let tiles_left = 70;
    const next_start = (kyoku_idx + 1 < start_positions.length)
      ? start_positions[kyoku_idx + 1]
      : events.length;

    const trigger = _decision_trigger(entry, player_id);

    let pos = start_pos + 1;
    while (pos < next_start) {
      const e = events[pos];
      const etype = e && e.type;

      // Draw after the decision window: with a trigger this is only a safety
      // net (the trigger fires first); without one it is the legacy stop.
      if (etype === "tsumo" && tiles_left <= tiles_left_target) break;

      if (etype === "tsumo") {
        tiles_left -= 1;
        if (trigger ? trigger(e, tiles_left)
                    : (e.actor === player_id && tiles_left <= tiles_left_target)) break;
      } else if (etype === "dahai") {
        visible.push(e.pai);
      } else if (etype === "chi" || etype === "pon") {
        for (const t of e.consumed || []) visible.push(t);
      } else if (etype === "ankan") {
        for (const t of e.consumed || []) visible.push(t);
      } else if (etype === "kakan") {
        visible.push(e.pai);
      } else if (etype === "daiminkan") {
        for (const t of e.consumed || []) visible.push(t);
      } else if (etype === "dora") {
        visible.push(e.dora_marker);
        dora_indicators.push(e.dora_marker);
      }

      // Stop after processing the decision's trigger event — it (and nothing
      // later) is visible at decision time.
      if (trigger && etype !== "tsumo" && trigger(e, tiles_left)) break;

      pos += 1;
    }

    for (const t of visible) decrement_wall(wall, t);
    const dora_ids = dora_indicators.map(mjai_to_tile_id);

    return { wall, round_wind_id, seat_wind_id, dora_ids, tiles_left };
  }

  function extract_board_state(mortal_data, kyoku_idx, tiles_left_target, entry) {
    const player_id = mortal_data.player_id;
    const events = flatten_mjai_log(mortal_data.mjai_log);
    const start_positions = _findStartPositions(events);
    const start_pos = start_positions[kyoku_idx];
    const start = events[start_pos];

    const bakaze = start.bakaze;
    const oya = start.oya;
    const seat_idx = ((player_id - oya) % 4 + 4) % 4;
    const wind_names = ["E", "S", "W", "N"];
    const seat_wind = wind_names[seat_idx];
    const round_wind = bakaze;
    const scores = start.scores || [];

    const dora_indicators = [start.dora_marker];

    const discards = {};
    const melds = {};
    for (let i = 0; i < 4; i++) {
      discards[i] = { tiles: [], riichi_idx: null };
      melds[i] = [];
    }

    let tiles_left = 70;
    const next_start = (kyoku_idx + 1 < start_positions.length)
      ? start_positions[kyoku_idx + 1]
      : events.length;

    const trigger = _decision_trigger(entry, player_id);

    for (let pos = start_pos + 1; pos < next_start; pos++) {
      const e = events[pos];
      const etype = e && e.type;
      const actor = e && e.actor;

      // Safety net when a trigger never fires: don't walk past the decision
      // window into the next draw.
      if (trigger && etype === "tsumo" && tiles_left <= tiles_left_target) break;

      if (etype === "tsumo") {
        tiles_left -= 1;
      } else if (etype === "dahai" && actor !== undefined && actor !== null) {
        // `tsumogiri` (drawn-and-immediately-discarded) rides along on each
        // discard so the discard-pool renderer can grey-shade it apart from a
        // tedashi (discard from hand). mjai marks every dahai with this flag.
        discards[actor].tiles.push({ tile: e.pai, tsumogiri: !!e.tsumogiri });
      } else if (etype === "reach" && actor !== undefined && actor !== null) {
        const d = discards[actor];
        d.riichi_idx = d.tiles.length;
      } else if ((etype === "chi" || etype === "pon" || etype === "daiminkan")
                 && actor !== undefined && actor !== null) {
        melds[actor].push({
          type: etype,
          consumed: e.consumed || [],
          pai: e.pai,
          target: e.target,
        });
        const target = e.target;
        if (target !== undefined && target !== null && discards[target].tiles.length) {
          discards[target].tiles[discards[target].tiles.length - 1].called_by = actor;
        }
      } else if (etype === "ankan" && actor !== undefined && actor !== null) {
        melds[actor].push({ type: "ankan", consumed: e.consumed || [] });
      } else if (etype === "kakan" && actor !== undefined && actor !== null) {
        melds[actor].push({
          type: "kakan",
          consumed: e.consumed || [],
          pai: e.pai,
          target: e.target,
        });
      } else if (etype === "dora") {
        dora_indicators.push(e.dora_marker);
      }

      // With a trigger: stop right after the decision's trigger event, so a
      // post-call/call-decision board includes the discard being reacted to
      // (and the call itself) but nothing that happens after the decision.
      if (trigger ? trigger(e, tiles_left) : (tiles_left <= tiles_left_target)) break;
    }

    const all_discards = [];
    for (let seat = 0; seat < 4; seat++) {
      const d = discards[seat];
      all_discards.push({
        seat,
        discards: d.tiles,
        riichi_idx: d.riichi_idx,
      });
    }

    const opponent_melds = [];
    for (let seat = 0; seat < 4; seat++) {
      if (seat !== player_id && melds[seat].length) {
        opponent_melds.push({ seat, melds: melds[seat] });
      }
    }

    return {
      dora_indicators,
      dora_tiles: dora_indicators.map(dora_indicator_to_dora_mjai),
      seat_wind,
      round_wind,
      scores,
      all_discards,
      opponent_melds,
      tiles_left,
    };
  }

  function subtract_hand_from_wall(wall, hand_tiles) {
    const w = wall.slice();
    for (const t of hand_tiles) decrement_wall(w, t);
    return w;
  }

  return {
    decrement_wall,
    reconstruct_context,
    extract_board_state,
    subtract_hand_from_wall,
  };
}));
