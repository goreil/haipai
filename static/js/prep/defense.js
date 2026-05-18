// Defense glue — twin of lib/defense.py + the adapter half of
// lib/defense_kd.py:compute_kd_defense_data. The algorithmic core
// (generateWaits, calcCombos, dealinProbability, dealinToSafety) lives in
// prep/defense_kd.js; this module handles threat extraction from the
// canonical kyoku walker, mjai↔tenhou translation, and aggregation across
// multiple riichi opponents.
//
// Public surface:
//   - compute_kd_defense_data(hand_mjai, events, start_pos, end_pos,
//                             player_id, tiles_left, wall)
//       → {safety_ratings, dealin_rates, wait_breakdowns, suji_partners,
//          per_threat} or null when no opponent is in riichi.
//   - get_opponent_discards(events, start_pos, end_pos, player_id,
//                           target_tiles_left)
//       → [{seat, discards, riichi_idx}, …] or null.
//   - get_tile_safety_for_mistake(...) — same args as compute_kd, returns
//     just safety_ratings.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const tiles = require("./tiles.js");
    const parse = require("./parse.js");
    const defenseKd = require("./defense_kd.js");
    module.exports = factory(tiles, parse, defenseKd);
  } else {
    root.haipaiPrepDefense = factory(
      root.haipaiPrepTiles, root.haipaiPrepParse, root.haipaiDefenseKD
    );
  }
}(typeof self !== "undefined" ? self : this, function (tilesMod, parseMod, kd) {

  const {
    MJAI_TO_ID,
    MJAI_TO_TENHOU,
    TENHOU_TO_MJAI,
    dora_indicator_to_dora_tenhou,
  } = tilesMod;
  const { walk_kyoku } = parseMod;
  const {
    WAIT_TYPE,
    normRedFive,
    generateWaits,
    calcCombos,
    dealinProbability,
    dealinToSafety,
  } = kd;

  const WAIT_NAMES = {
    [WAIT_TYPE.ryanmen]: "ryanmen",
    [WAIT_TYPE.kanchan]: "kanchan",
    [WAIT_TYPE.penchan]: "penchan",
    [WAIT_TYPE.tanki]: "tanki",
    [WAIT_TYPE.shanpon]: "shanpon",
  };

  function _unseen_from_wall(wall) {
    // wall has 34 base slots (already aggregates aka into base) + 3 aka
    // slots. KD normalises aka → base, so the base slot is exactly what
    // we want; the trailing 3 entries are ignored.
    const unseen = {};
    for (const mjai of Object.keys(MJAI_TO_ID)) {
      if (mjai.endsWith("r")) continue;
      const tid = MJAI_TO_ID[mjai];
      const tenhou = MJAI_TO_TENHOU[mjai];
      if (tenhou == null || tid >= wall.length) continue;
      unseen[tenhou] = Math.max(0, wall[tid] || 0);
    }
    return unseen;
  }

  function _extract_threats(events, start_pos, end_pos, player_id, target_tiles_left) {
    const state = walk_kyoku(events, start_pos, end_pos, player_id, target_tiles_left);
    let first_dora_indicator = null;
    if (state.first_dora_indicator != null) {
      first_dora_indicator = MJAI_TO_TENHOU[state.first_dora_indicator];
      if (first_dora_indicator === undefined) first_dora_indicator = null;
    }

    const threats = [];
    const order = state.opponent_order || Object.keys(state.opponents).map(Number);
    for (const seat of order) {
      const opp = state.opponents[seat];
      if (!opp || opp.reach_event_idx == null) continue;

      const discards_tenhou = [];
      for (const p of opp.discards) {
        const t = MJAI_TO_TENHOU[p];
        if (t != null) discards_tenhou.push(t);
      }

      const riichi_idx = opp.reach_event_idx;
      const cutoff = (riichi_idx >= opp.discards.length)
        ? discards_tenhou.length
        : riichi_idx + 1;
      const discards_to_riichi = discards_tenhou.slice(0, cutoff);

      const genbutsu = new Set();
      for (const t of discards_tenhou) genbutsu.add(normRedFive(t));
      const postReach = state.genbutsu_post_reach_by_seat[seat] || [];
      for (const pai of postReach) {
        const t = MJAI_TO_TENHOU[pai];
        if (t != null) genbutsu.add(normRedFive(t));
      }

      threats.push({
        seat,
        discards_to_riichi,
        genbutsu,
        dora_indicator: first_dora_indicator,
      });
    }
    return threats;
  }

  function _suji_partners(tenhou_tile, genbutsu) {
    const t = normRedFive(tenhou_tile);
    if (t > 40) return [];
    const digit = t % 10;
    const partners = [];
    if (digit >= 1 && digit <= 3) {
      if (genbutsu.has(t + 3)) partners.push(t + 3);
    } else if (digit >= 7 && digit <= 9) {
      if (genbutsu.has(t - 3)) partners.push(t - 3);
    } else {
      if (genbutsu.has(t - 3)) partners.push(t - 3);
      if (genbutsu.has(t + 3)) partners.push(t + 3);
    }
    return partners;
  }

  function _build_wait_breakdown(tenhou_tile, combos) {
    const t = normRedFive(tenhou_tile);
    if (!combos[t] || combos.all <= 0) return [];
    const total = combos.all;
    const out = [];
    for (const wait of combos[t].types) {
      const rate_pct = wait.combos / total * 100;
      out.push({
        type: WAIT_NAMES[wait.type],
        tiles: wait.tiles.map(x => TENHOU_TO_MJAI[normRedFive(x)]),
        waits_on: wait.waitsOn.map(x => TENHOU_TO_MJAI[normRedFive(x)]),
        rate: Math.round(rate_pct * 100) / 100,
        left: (wait.numUnseen || []).slice(),
      });
    }
    out.sort((a, b) => b.rate - a.rate);
    return out;
  }

  function compute_kd_defense_data(hand_mjai, events, start_pos, end_pos,
                                   player_id, tiles_left, wall) {
    const threats = _extract_threats(events, start_pos, end_pos, player_id, tiles_left);
    if (!threats.length) return null;

    const unseen = _unseen_from_wall(wall);

    const hand_norm = {};
    for (const t of hand_mjai) {
      const tenhou = MJAI_TO_TENHOU[t];
      if (tenhou != null) hand_norm[t] = normRedFive(tenhou);
    }

    const threat_data = [];
    for (const threat of threats) {
      const dora = (threat.dora_indicator != null)
        ? dora_indicator_to_dora_tenhou(threat.dora_indicator)
        : null;
      const combos = calcCombos(
        generateWaits(), threat.genbutsu, threat.discards_to_riichi, unseen, dora
      );
      threat_data.push({ threat, combos });
    }

    const dealin_rates = {};
    const safety_ratings = {};
    const wait_breakdowns = {};
    const suji_partners = {};

    for (const mjai_tile of Object.keys(hand_norm)) {
      const th = hand_norm[mjai_tile];
      let prob_not = 1.0;
      let most_dangerous = null;
      let most_dangerous_p = -1.0;
      for (const td of threat_data) {
        const p = dealinProbability(th, td.combos);
        prob_not *= (1.0 - p);
        if (p > most_dangerous_p) {
          most_dangerous_p = p;
          most_dangerous = td;
        }
      }
      const combined = 1.0 - prob_not;
      dealin_rates[mjai_tile] = Math.round(combined * 10000) / 100;
      safety_ratings[mjai_tile] = Math.round(dealinToSafety(combined) * 10) / 10;
      wait_breakdowns[mjai_tile] = _build_wait_breakdown(th, most_dangerous.combos);
      const partners = _suji_partners(th, most_dangerous.threat.genbutsu);
      if (partners.length) {
        suji_partners[mjai_tile] = partners
          .map(p => TENHOU_TO_MJAI[p])
          .filter(x => x !== undefined);
      }
    }

    const per_threat = [];
    for (const td of threat_data) {
      const seat = td.threat.seat;
      const dtr = td.threat.discards_to_riichi;
      let riichi_tile = null;
      if (dtr.length) {
        const norm = normRedFive(dtr[dtr.length - 1]);
        riichi_tile = TENHOU_TO_MJAI[norm] || null;
      }
      const genbutsu_mjai = [...td.threat.genbutsu]
        .map(t => TENHOU_TO_MJAI[t])
        .filter(x => x !== undefined)
        .sort();
      const rates = {};
      const breakdowns = {};
      const partners_by_tile = {};
      for (const mjai_tile of Object.keys(hand_norm)) {
        const th = hand_norm[mjai_tile];
        rates[mjai_tile] = Math.round(dealinProbability(th, td.combos) * 10000) / 100;
        breakdowns[mjai_tile] = _build_wait_breakdown(th, td.combos);
        const partners = _suji_partners(th, td.threat.genbutsu);
        if (partners.length) {
          partners_by_tile[mjai_tile] = partners
            .map(p => TENHOU_TO_MJAI[p])
            .filter(x => x !== undefined);
        }
      }
      per_threat.push({
        seat,
        riichi_tile,
        genbutsu: genbutsu_mjai,
        dealin_rates: rates,
        wait_breakdowns: breakdowns,
        suji_partners: partners_by_tile,
      });
    }

    return {
      safety_ratings,
      dealin_rates,
      wait_breakdowns,
      suji_partners,
      per_threat,
    };
  }

  function get_tile_safety_for_mistake(hand_mjai, events, start_pos, end_pos,
                                       player_id, tiles_left, wall) {
    const data = compute_kd_defense_data(hand_mjai, events, start_pos, end_pos,
                                         player_id, tiles_left, wall);
    return data ? data.safety_ratings : null;
  }

  function get_opponent_discards(events, start_pos, end_pos, player_id,
                                 target_tiles_left) {
    const state = walk_kyoku(events, start_pos, end_pos, player_id, target_tiles_left);
    const order = state.opponent_order || Object.keys(state.opponents).map(Number);
    const riichi_opps = [];
    for (const seat of order) {
      const opp = state.opponents[seat];
      if (!opp || opp.reach_event_idx == null) continue;
      riichi_opps.push({
        seat,
        discards: opp.discards,
        riichi_idx: opp.reach_event_idx,
      });
    }
    return riichi_opps.length ? riichi_opps : null;
  }

  return {
    compute_kd_defense_data,
    get_tile_safety_for_mistake,
    get_opponent_discards,
  };
}));
