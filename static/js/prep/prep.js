// Per-mistake input prep — twin of lib/categorize/__init__.py. Pure JS
// port; produces the data the frontend categorizer reads at render time:
// `discard_stats` / `best_discard` / `safety_ratings` / `opponent_discards`
// / `dealin_rates` / `wait_breakdowns` / `suji_partners` / `per_threat`, and
// the 5A/5B riichi patches (`tenpai_waits`, `bad_riichi_reason`,
// `furiten_tiles`, `actual_riichi_tile`, `prior_own_discards`).
//
// This is the last "still computed server-side" piece of the
// BACKEND-TO-FRONTEND migration. Categorization itself lives in
// static/js/categorize.js.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const tiles = require("./tiles.js");
    const parse = require("./parse.js");
    const board = require("./board.js");
    const furiten = require("./furiten.js");
    const shantenCalc = require("./shanten_calc.js");
    const defense = require("./defense.js");
    module.exports = factory(tiles, parse, board, furiten, shantenCalc, defense);
  } else {
    root.haipaiPrep = factory(
      root.haipaiPrepTiles,
      root.haipaiPrepParse,
      root.haipaiPrepBoard,
      root.haipaiPrepFuriten,
      root.haipaiPrepShantenCalc,
      root.haipaiPrepDefense
    );
  }
}(typeof self !== "undefined" ? self : this, function (
  tilesMod, parseMod, boardMod, furitenMod, shantenCalcMod, defenseMod
) {

  const { ID_TO_MJAI } = tilesMod;
  const { flatten_mjai_log } = parseMod;
  const { reconstruct_context, subtract_hand_from_wall } = boardMod;
  const {
    tenpai_wait_tiles, is_furiten,
    find_riichi_context, find_discard_history_for_turn,
  } = furitenMod;
  const { calculate: calcShanten } = shantenCalcMod;
  const {
    compute_kd_defense_data,
    get_tile_safety_for_mistake,
    get_opponent_discards,
  } = defenseMod;

  function _warn(msg, ...args) {
    if (typeof console !== "undefined" && console.warn) console.warn(msg, ...args);
  }

  function _clamp_wall(wall) {
    for (let i = 0; i < wall.length; i++) {
      if (wall[i] < 0) {
        const tile_name = ID_TO_MJAI[i] || ("id=" + i);
        _warn(`Negative wall count: wall[${i}] (${tile_name}) = ${wall[i]}, clamping`);
        wall[i] = 0;
      }
    }
    return wall;
  }

  function _wall_for_mistake(mistake, mortalData, kyokuIdx, entry) {
    if (mortalData == null || kyokuIdx == null || entry == null) return null;
    const tiles_left = entry.tiles_left;
    if (tiles_left == null) return null;
    try {
      const ctx = reconstruct_context(mortalData, kyokuIdx, tiles_left);
      const wall = subtract_hand_from_wall(ctx.wall, mistake.hand || []);
      return _clamp_wall(wall);
    } catch (e) {
      _warn("wall reconstruct failed:", e);
      return null;
    }
  }

  function _compute_shanten_stats(mistake, mortalData, kyokuIdx, entry) {
    const hand = mistake.hand || [];
    if (hand.length !== 14) return [];
    const tiles_left = entry ? entry.tiles_left : null;
    if (tiles_left == null) return [];
    try {
      const ctx = reconstruct_context(mortalData, kyokuIdx, tiles_left);
      const wall = _clamp_wall(subtract_hand_from_wall(ctx.wall, hand));
      const response = calcShanten(hand, mistake.melds || [], wall);
      return response.stats || [];
    } catch (e) {
      _warn("discard_stats compute failed:", e);
      return [];
    }
  }

  // 5A: actual=reach, expected=dahai. The player declared riichi the engine
  // disliked. Detect furiten + surface the waits & riichi tile.
  function _compute_bad_riichi_reason(mistake, defenseCtx, mortalData, kyokuIdx, entry) {
    if (!defenseCtx) return {};
    try {
      const { riichi_tile, own_discards } = find_riichi_context(
        defenseCtx.mjai_events, defenseCtx.start_pos,
        defenseCtx.end_pos, defenseCtx.player_id,
      );
      if (!riichi_tile) return {};
      const hand = (mistake.hand || []).slice();
      const idx = hand.indexOf(riichi_tile);
      if (idx < 0) return {};
      hand.splice(idx, 1);
      const fur = is_furiten(hand, mistake.melds || [], own_discards);
      const wall = _wall_for_mistake(mistake, mortalData, kyokuIdx, entry);
      const wait_tiles = tenpai_wait_tiles(hand, mistake.melds || [], wall);

      const patch = { actual_riichi_tile: riichi_tile };
      if (wait_tiles.length) patch.tenpai_waits = wait_tiles;
      if (fur.is_furiten) {
        patch.bad_riichi_reason = "furiten";
        patch.furiten_tiles = fur.furiten_tiles;
      }
      return patch;
    } catch (e) {
      _warn("furiten compute failed:", e);
      return {};
    }
  }

  // 5B: actual=dahai, expected=reach. Player skipped riichi. The tile they
  // actually discarded IS the would-be riichi tile; furiten doesn't apply
  // (they never declared).
  function _compute_missed_riichi_patch(mistake, defenseCtx, mortalData, kyokuIdx, entry) {
    if (!defenseCtx) return {};
    const actual = mistake.actual || {};
    const would_riichi_tile = actual.pai;
    if (!would_riichi_tile) return {};
    try {
      const target_junme = mistake.turn;
      const own_discards = find_discard_history_for_turn(
        defenseCtx.mjai_events, defenseCtx.start_pos,
        defenseCtx.end_pos, defenseCtx.player_id, target_junme,
      );
      const hand = (mistake.hand || []).slice();
      const idx = hand.indexOf(would_riichi_tile);
      if (idx < 0) return {};
      hand.splice(idx, 1);
      const wall = _wall_for_mistake(mistake, mortalData, kyokuIdx, entry);
      const wait_tiles = tenpai_wait_tiles(hand, mistake.melds || [], wall);
      if (!wait_tiles.length) return {};
      return {
        tenpai_waits: wait_tiles,
        prior_own_discards: own_discards,
      };
    } catch (e) {
      _warn("5B waits compute failed:", e);
      return {};
    }
  }

  function _compute_kd_defense_patch(hand, defenseCtx, tiles_left, wall) {
    try {
      const kd = compute_kd_defense_data(
        hand, defenseCtx.mjai_events, defenseCtx.start_pos,
        defenseCtx.end_pos, defenseCtx.player_id, tiles_left, wall,
      );
      if (!kd) return {};
      return {
        dealin_rates: kd.dealin_rates,
        wait_breakdowns: kd.wait_breakdowns,
        suji_partners: kd.suji_partners,
        per_threat: kd.per_threat,
      };
    } catch (e) {
      _warn("KD defense compute failed:", e);
      return {};
    }
  }

  // mistake: {hand, melds, actual, expected, turn, ...}
  // mortalData: full Mortal JSON.
  // kyokuIdx: index into mortalData.review.kyokus.
  // entry: the matching kyoku entry (has tiles_left).
  // defenseCtx: {mjai_events, start_pos, end_pos, player_id} or null.
  //
  // Returns a dict of fields to merge into the mistake's data_json. Never
  // sets `category`, `categorize_data`, or `labels` — categorize.js owns
  // those. Returns an empty dict when nothing useful can be computed.
  function prepMistake(mistake, mortalData, kyokuIdx, entry, defenseCtx) {
    const actual = mistake.actual || {};
    const expected = mistake.expected || {};
    const at = actual.type;
    const et = expected.type;

    // Non-dahai branch (meld/riichi/kan decisions). No discard tradeoff;
    // still want a per-tile shanten table for the EV-table view + 5A/5B
    // furiten / wait data.
    if (!(at === "dahai" && et === "dahai")) {
      const patch = {};
      const stats = _compute_shanten_stats(mistake, mortalData, kyokuIdx, entry);
      if (stats && stats.length) patch.discard_stats = stats;

      if (at === "reach" && et === "dahai") {
        Object.assign(patch,
          _compute_bad_riichi_reason(mistake, defenseCtx, mortalData, kyokuIdx, entry));
      } else if (at === "dahai" && et === "reach") {
        Object.assign(patch,
          _compute_missed_riichi_patch(mistake, defenseCtx, mortalData, kyokuIdx, entry));
      }

      return patch;
    }

    // Dahai vs dahai: full prep.
    const hand = mistake.hand || [];
    const melds = mistake.melds || [];
    const tiles_left = entry.tiles_left;

    const ctx = reconstruct_context(mortalData, kyokuIdx, tiles_left);
    let wall = subtract_hand_from_wall(ctx.wall, hand);
    wall = _clamp_wall(wall);

    const patch = {};

    if (defenseCtx) {
      const safety = get_tile_safety_for_mistake(
        hand, defenseCtx.mjai_events, defenseCtx.start_pos,
        defenseCtx.end_pos, defenseCtx.player_id, tiles_left, wall,
      );
      if (safety) {
        // Already rounded to 1 decimal in compute_kd_defense_data.
        patch.safety_ratings = safety;
        patch.opponent_discards = get_opponent_discards(
          defenseCtx.mjai_events, defenseCtx.start_pos,
          defenseCtx.end_pos, defenseCtx.player_id, tiles_left,
        );
      }
      Object.assign(patch, _compute_kd_defense_patch(hand, defenseCtx, tiles_left, wall));
    }

    let response;
    try {
      response = calcShanten(hand, melds, wall);
    } catch (e) {
      if (e && e.code === "winning") {
        // Hand already winning. Frontend categorizes as P4 from action
        // types alone; the patch built so far is still useful (defense
        // ratings against riichi when passing on win).
        return patch;
      }
      _warn("Shanten error on mistake:", e);
      return patch;
    }

    const discard_stats = response.stats || [];
    if (discard_stats.length) {
      patch.discard_stats = discard_stats;
      patch.best_discard = discard_stats[0].tile;
    }

    return patch;
  }

  // Game-level walker: replicates the iteration pattern of
  // lib.categorize.prepare_game_data. Iterates each kyoku's review entries,
  // matches them to per-round mistakes by junme, and calls prepMistake.
  //
  // game: parsed game with `rounds[*].mistakes[*]` (the same shape returned
  //   by `/api/games/<id>`). Each mistake gets its prep fields merged in
  //   place. Mortal data is required separately (the API endpoint will
  //   ship it under `mortal_data` per BACKEND-TO-FRONTEND step 5).
  // mortalData: full Mortal JSON.
  //
  // Returns the same game object for chaining.
  function prepGame(game, mortalData) {
    if (!mortalData || !game) return game;
    const kyokus = (mortalData.review && mortalData.review.kyokus) || [];
    const events = flatten_mjai_log(mortalData.mjai_log);
    const start_positions = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i] && events[i].type === "start_kyoku") start_positions.push(i);
    }
    const player_id = mortalData.player_id;

    const rounds_by_header = {};
    for (const r of game.rounds || []) {
      rounds_by_header[r.round] = r;
    }

    for (let ki = 0; ki < kyokus.length; ki++) {
      const kyoku = kyokus[ki];
      const start = events[start_positions[ki]];
      if (!start) continue;
      let header = `${start.bakaze}${start.kyoku}`;
      if (start.honba > 0) header += `-${start.honba}`;
      const round = rounds_by_header[header];
      if (!round || !round.mistakes || !round.mistakes.length) continue;

      const start_pos = start_positions[ki];
      const end_pos = (ki + 1 < start_positions.length)
        ? start_positions[ki + 1] : events.length;
      const defenseCtx = {
        mjai_events: events, start_pos, end_pos, player_id,
      };

      let mistake_idx = 0;
      for (const entry of (kyoku.entries || [])) {
        if (entry.is_equal) continue;

        // Walk db_mistakes forward until junme matches (same pattern as
        // Python prepare_game_data — entries and mistakes are both
        // ordered by junme).
        while (mistake_idx < round.mistakes.length
               && round.mistakes[mistake_idx].turn !== entry.junme) {
          mistake_idx += 1;
        }
        if (mistake_idx >= round.mistakes.length) break;

        const m = round.mistakes[mistake_idx];
        mistake_idx += 1;

        try {
          const patch = prepMistake(m, mortalData, ki, entry, defenseCtx);
          if (patch) Object.assign(m, patch);
        } catch (e) {
          _warn("prepMistake failed for mistake turn=" + m.turn + ":", e);
        }
      }
    }

    return game;
  }

  return {
    prepMistake,
    prepGame,
  };
}));
