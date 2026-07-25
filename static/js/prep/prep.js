// Per-mistake input prep — sole owner of the per-mistake derived data the
// frontend categorizer reads at render time: `discard_stats` /
// `best_discard` / `dealin_rates` / `wait_breakdowns` / `suji_partners` /
// `per_threat`, and the 5A/5B riichi patches (`tenpai_waits`,
// `bad_riichi_reason`, `furiten_tiles`, `actual_riichi_tile`,
// `prior_own_discards`). Categorization itself lives in
// static/js/categorize.js.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const tiles = require("./tiles.js");
    const parse = require("./parse.js");
    const boardState = require("./prep-board-state.js");
    const boardYaku = require("./prep-board-yaku.js");
    const furiten = require("./furiten.js");
    const shantenCalc = require("./shanten_calc.js");
    const defense = require("./defense.js");
    module.exports = factory(tiles, parse, boardState, boardYaku, furiten, shantenCalc, defense);
  } else {
    root.haipaiPrep = factory(
      root.haipaiPrepTiles,
      root.haipaiPrepParse,
      root.haipaiPrepBoardState,
      root.haipaiPrepBoardYaku,
      root.haipaiPrepFuriten,
      root.haipaiPrepShantenCalc,
      root.haipaiPrepDefense
    );
  }
}(typeof self !== "undefined" ? self : this, function (
  tilesMod, parseMod, boardStateMod, boardYakuMod, furitenMod, shantenCalcMod, defenseMod
) {

  const { ID_TO_MJAI } = tilesMod;
  const { flatten_mjai_log } = parseMod;
  const { reconstruct_context, subtract_hand_from_wall, extract_board_state }
    = boardStateMod;
  const { compute_yaku_panel } = boardYakuMod;
  const {
    tenpai_wait_tiles, is_furiten,
    find_riichi_context, find_discard_history_for_turn, find_riichi_declared_at_turn,
  } = furitenMod;
  const { calculate: jsCalcShanten } = shantenCalcMod;

  // Resolve the shanten/ukeire kernel at call time. The WASM kernel is opt-in
  // and loads asynchronously (see static/js/prep/wasm-bootstrap.js): the global
  // flag flips only once the adapter is fully ready, so early calls and the
  // default (no opt-in) both stay on the JS kernel. Same {shanten, stats}
  // contract either way.
  function calcShanten(hand, melds, wall) {
    const g = (typeof self !== "undefined") ? self
            : (typeof window !== "undefined") ? window : null;
    if (g && g.haipaiPrepUseWasm && g.haipaiPrepShantenCalcWasm) {
      return g.haipaiPrepShantenCalcWasm.calculate(hand, melds, wall);
    }
    return jsCalcShanten(hand, melds, wall);
  }
  const {
    compute_kd_defense_data,
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
      const ctx = reconstruct_context(mortalData, kyokuIdx, tiles_left, entry);
      const wall = subtract_hand_from_wall(ctx.wall, mistake.hand || []);
      return _clamp_wall(wall);
    } catch (e) {
      _warn("wall reconstruct failed:", e);
      return null;
    }
  }

  // Apply the same KD defense compute we use for dahai-vs-dahai to non-dahai
  // mistakes (5A/5B/4A/4B/6A/6B). Same fields land on the mistake so the
  // frontend's defense-situation helper / hand-tile colouring work uniformly.
  function _maybe_apply_defense_patch(patch, mistake, defenseCtx, mortalData,
                                      kyokuIdx, entry) {
    if (!defenseCtx) return;
    const tiles_left = entry ? entry.tiles_left : null;
    if (tiles_left == null) return;
    const wall = _wall_for_mistake(mistake, mortalData, kyokuIdx, entry);
    if (!wall) return;
    Object.assign(patch,
      _compute_kd_defense_patch(mistake.hand || [], defenseCtx, tiles_left, wall));
  }

  function _compute_shanten_stats(mistake, mortalData, kyokuIdx, entry) {
    const hand = mistake.hand || [];
    if (hand.length !== 14) return [];
    const tiles_left = entry ? entry.tiles_left : null;
    if (tiles_left == null) return [];
    try {
      const ctx = reconstruct_context(mortalData, kyokuIdx, tiles_left, entry);
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
  function _compute_board_state(mortalData, kyokuIdx, entry) {
    if (mortalData == null || kyokuIdx == null || entry == null) return null;
    const tiles_left = entry.tiles_left;
    if (tiles_left == null) return null;
    try {
      return extract_board_state(mortalData, kyokuIdx, tiles_left, entry);
    } catch (e) {
      _warn("board_state extract failed:", e);
      return null;
    }
  }

  // Attach the per-opponent yaku panel (yakuhai/tanyao/toitoi/chanta/honitsu) to board_state.
  // Opponent-only by design — the panel reads opponents' threats; we don't
  // second-guess the student's own yaku, so the player's own melds are left
  // out (board_state.opponent_melds already excludes the player). Needs the
  // unseen-copy wall (player's hand subtracted) for the "still reachable"
  // counts, and oya to map each seat to its seat wind. No-op when board_state
  // or the wall is missing.
  function _attach_yaku_panel(board_state, mistake, mortalData, kyokuIdx, entry) {
    if (!board_state) return;
    const wall = _wall_for_mistake(mistake, mortalData, kyokuIdx, entry);
    if (!wall) return;
    const player_id = mortalData.player_id;
    const WINDS = ["E", "S", "W", "N"];
    const pw = WINDS.indexOf(board_state.seat_wind);
    if (pw < 0) return;
    const oya = ((player_id - pw) % 4 + 4) % 4;

    const meldsBySeat = {};
    for (const om of board_state.opponent_melds || []) meldsBySeat[om.seat] = om.melds;

    try {
      const yaku = compute_yaku_panel(meldsBySeat, wall, oya, board_state.round_wind,
                                      mistake.hand || []);
      if (yaku && Object.keys(yaku).length) board_state.yaku = yaku;
    } catch (e) {
      _warn("yaku panel compute failed:", e);
    }
  }

  function prepMistake(mistake, mortalData, kyokuIdx, entry, defenseCtx) {
    const actual = mistake.actual || {};
    const expected = mistake.expected || {};
    const at = actual.type;
    const et = expected.type;

    const board_state = _compute_board_state(mortalData, kyokuIdx, entry);
    _attach_yaku_panel(board_state, mistake, mortalData, kyokuIdx, entry);

    // Non-dahai branch (meld/riichi/kan decisions). No discard tradeoff;
    // still want a per-tile shanten table for the EV-table view + 5A/5B
    // furiten / wait data. Defense data (dealin_rates / per_threat) is
    // populated here too so 5A/4A/4B/6A cards can detect a riichi opponent
    // through the same channel dahai-vs-dahai uses.
    if (!(at === "dahai" && et === "dahai")) {
      const patch = {};
      if (board_state) patch.board_state = board_state;
      const stats = _compute_shanten_stats(mistake, mortalData, kyokuIdx, entry);
      if (stats && stats.length) patch.discard_stats = stats;

      _maybe_apply_defense_patch(patch, mistake, defenseCtx, mortalData,
                                 kyokuIdx, entry);

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

    const ctx = reconstruct_context(mortalData, kyokuIdx, tiles_left, entry);
    let wall = subtract_hand_from_wall(ctx.wall, hand);
    wall = _clamp_wall(wall);

    const patch = {};
    if (board_state) patch.board_state = board_state;

    if (defenseCtx) {
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

    // Ground truth for the riichi pill + Value scoring on tenpai columns
    // (see find_riichi_declared_at_turn): only meaningful when the actual
    // discard itself reached tenpai and the hand is closed (riichi requires
    // both). `mistake.turn` mirrors Mortal's 1-indexed junme; the detector
    // wants a 0-indexed own-tsumo count.
    if (defenseCtx && melds.length === 0 && actual.pai) {
      const actualStat = discard_stats.find(s => s.tile === actual.pai);
      if (actualStat && actualStat.shanten === 0
          && find_riichi_declared_at_turn(defenseCtx.mjai_events, defenseCtx.start_pos,
                                          defenseCtx.end_pos, defenseCtx.player_id, mistake.turn - 1)) {
        patch.riichi_decision = true;
      }
    }

    return patch;
  }

  // Per-kyoku body shared by prepGame (sync) and prepGameAsync (chunked).
  function _prepKyoku(game, mortalData, ki, kyokus, events, start_positions,
                     player_id, rounds_by_header, all_last_sig) {
    const kyoku = kyokus[ki];
    const start = events[start_positions[ki]];
    if (!start) return;
    let header = `${start.bakaze}${start.kyoku}`;
    if (start.honba > 0) header += `-${start.honba}`;
    const round = rounds_by_header[header];
    if (!round || !round.mistakes || !round.mistakes.length) return;

    // All-last covers every kyoku sharing the (bakaze, kyoku) of the game's
    // final played round — so S4, S4-1, S4-2 all light up when the game
    // ended at S4-2. The same rule catches tonpuusen E4 and any extended
    // west/north sudden-death round.
    const is_all_last = !!(all_last_sig
      && start.bakaze === all_last_sig.bakaze
      && start.kyoku === all_last_sig.kyoku);

    const start_pos = start_positions[ki];
    const end_pos = (ki + 1 < start_positions.length)
      ? start_positions[ki + 1] : events.length;
    const defenseCtx = {
      mjai_events: events, start_pos, end_pos, player_id,
    };

    let mistake_idx = 0;
    for (const entry of (kyoku.entries || [])) {
      if (entry.is_equal) continue;

      // Walk db_mistakes forward until junme matches — entries and
      // mistakes are both ordered by junme.
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
        if (is_all_last) m.is_all_last = true;
      } catch (e) {
        _warn("prepMistake failed for mistake turn=" + m.turn + ":", e);
      }
    }
  }

  // Ordinal of a (bakaze, kyoku) so rounds compare in play order:
  // E1<E2<E3<E4<S1<…<S4<W1<… Used to tell a real all-last from a tobi.
  function _roundOrd(bakaze, kyoku) {
    const wind = { E: 0, S: 1, W: 2, N: 3 }[bakaze];
    if (wind === undefined || !kyoku) return null;
    return wind * 4 + (kyoku - 1);
  }

  // True when `start` is at or past the game's natural last round: S4 for a
  // hanchan (incl. west-round sudden death), E4 for a tonpuusen. A game that
  // stops short of this ended early via tobi, so it isn't really all-last.
  function _reachedAllLast(start, game_length) {
    const ord = _roundOrd(start.bakaze, start.kyoku);
    if (ord === null) return false;
    const isEastOnly = /tonpu/i.test(game_length || "");
    const naturalLast = isEastOnly ? _roundOrd("E", 4) : _roundOrd("S", 4);
    return ord >= naturalLast;
  }

  function _prepGameSetup(game, mortalData) {
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
    // Bakaze+kyoku of the final played kyoku. Shared by every kyoku in
    // _prepKyoku so the all-last flag covers honba repeats too. Only set it
    // when the game actually reached its natural last round — a tobi
    // (bankruptcy) ends the game early (e.g. East-1 of a hanchan), and that
    // round was never strategically "all last": nobody knew it was the final
    // hand, so framing decisions by placement there is misleading.
    let all_last_sig = null;
    if (kyokus.length) {
      const lastStart = events[start_positions[kyokus.length - 1]];
      if (lastStart && _reachedAllLast(lastStart, mortalData.game_length)) {
        all_last_sig = { bakaze: lastStart.bakaze, kyoku: lastStart.kyoku };
      }
    }
    return { kyokus, events, start_positions, player_id, rounds_by_header, all_last_sig };
  }

  // Game-level walker. Iterates each kyoku's review entries, matches them
  // to per-round mistakes by junme, and calls prepMistake.
  //
  // game: parsed game with `rounds[*].mistakes[*]` (the same shape returned
  //   by `/api/games/<id>`). Each mistake gets its prep fields merged in
  //   place. Mortal data is shipped under `mortal_data` on the same
  //   endpoint and passed in here.
  // mortalData: full Mortal JSON.
  //
  // Returns the same game object for chaining.
  function prepGame(game, mortalData) {
    if (!mortalData || !game) return game;
    const ctx = _prepGameSetup(game, mortalData);
    for (let ki = 0; ki < ctx.kyokus.length; ki++) {
      _prepKyoku(game, mortalData, ki, ctx.kyokus, ctx.events,
                 ctx.start_positions, ctx.player_id, ctx.rounds_by_header,
                 ctx.all_last_sig);
    }
    return game;
  }

  // Same as prepGame but yields to the event loop between kyokus and
  // reports progress. Use this from the browser so the main thread stays
  // responsive while prep runs (browser-side prep takes ~700 ms on a
  // 9-kyoku/42-mistake game). `onProgress(done, total)` is called after
  // each kyoku (including ki=total when complete).
  async function prepGameAsync(game, mortalData, onProgress) {
    if (!mortalData || !game) {
      if (onProgress) onProgress(0, 0);
      return game;
    }
    const ctx = _prepGameSetup(game, mortalData);
    const total = ctx.kyokus.length;
    if (onProgress) onProgress(0, total);
    for (let ki = 0; ki < total; ki++) {
      _prepKyoku(game, mortalData, ki, ctx.kyokus, ctx.events,
                 ctx.start_positions, ctx.player_id, ctx.rounds_by_header,
                 ctx.all_last_sig);
      if (onProgress) onProgress(ki + 1, total);
      if (ki + 1 < total) await new Promise((r) => setTimeout(r, 0));
    }
    return game;
  }

  // Prep a single mistake without needing the rest of its round. Used by the
  // admin reports view, which gets one mistake at a time keyed by
  // (game, round_idx, mistake_idx). Mistakes within a kyoku appear in
  // mortal_data review order with is_equal entries skipped — see lib/parse.py
  // — so `mistake_idx` indexes the non-is_equal entries directly. Mutates
  // `mistake` in place and returns it.
  function prepReport(mistake, mortalData, roundIdx, mistakeIdx) {
    if (!mortalData) return mistake;
    const kyokus = (mortalData.review && mortalData.review.kyokus) || [];
    const kyoku = kyokus[roundIdx];
    if (!kyoku) return mistake;

    let entry = null;
    let nonEqIdx = 0;
    for (const e of kyoku.entries || []) {
      if (e.is_equal) continue;
      if (nonEqIdx === mistakeIdx) { entry = e; break; }
      nonEqIdx += 1;
    }
    if (!entry) return mistake;

    const events = flatten_mjai_log(mortalData.mjai_log || []);
    const start_positions = [];
    for (let i = 0; i < events.length; i++) {
      if (events[i] && events[i].type === "start_kyoku") start_positions.push(i);
    }
    if (roundIdx >= start_positions.length) return mistake;
    const start_pos = start_positions[roundIdx];
    const end_pos = (roundIdx + 1 < start_positions.length)
      ? start_positions[roundIdx + 1] : events.length;
    const defenseCtx = {
      mjai_events: events,
      start_pos,
      end_pos,
      player_id: mortalData.player_id,
    };

    try {
      const patch = prepMistake(mistake, mortalData, roundIdx, entry, defenseCtx);
      if (patch) Object.assign(mistake, patch);
      const lastStart = events[start_positions[kyokus.length - 1]];
      const thisStart = events[start_pos];
      if (lastStart && thisStart
          && lastStart.bakaze === thisStart.bakaze
          && lastStart.kyoku === thisStart.kyoku) {
        mistake.is_all_last = true;
      }
    } catch (e) {
      _warn("prepReport failed for mistake turn=" + mistake.turn + ":", e);
    }
    return mistake;
  }

  return {
    prepMistake,
    prepGame,
    prepGameAsync,
    prepReport,
  };
}));
