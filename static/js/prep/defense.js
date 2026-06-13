// Defense glue — twin of lib/defense.py + the adapter half of
// lib/defense_kd.py:compute_kd_defense_data. The algorithmic core
// (generateWaits, calcCombos, dealinProbability) lives in
// prep/defense_kd.js; this module handles threat extraction from the
// canonical kyoku walker, mjai↔tenhou translation, and aggregation across
// multiple riichi opponents.
//
// Public surface:
//   - compute_kd_defense_data(hand_mjai, events, start_pos, end_pos,
//                             player_id, tiles_left, wall)
//       → {dealin_rates, wait_breakdowns, suji_partners, per_threat} or
//         null when no opponent is in riichi.

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

  // ── Open-threat trigger (EXPERIMENT — benchmark each variant) ──────
  // A non-riichi opponent becomes an "open" defense threat when the active
  // variant's rule fires. Edit OPEN_TRIGGER_VARIANT, then run
  // scripts/category_bench.mjs (prep cache re-keys automatically).
  // turn = player's junme (1-based draw count at decision time).
  const OPEN_TRIGGER_VARIANT = "V7";

  function _meld_dora_count(opp, dora_mjai) {
    let n = 0;
    for (const meld of opp.melds || []) {
      for (const t of meld.tiles || []) {
        if (typeof t !== "string") continue;
        if (t.endsWith("r")) { n++; continue; }   // aka five
        if (dora_mjai != null && t === dora_mjai) n++;
      }
    }
    return n;
  }

  function _has_yakuhai_meld(opp, bakaze, seat_wind) {
    for (const meld of opp.melds || []) {
      if (meld.type === "chi") continue;
      const t = (meld.tiles || [])[0];
      if (!t) continue;
      if (t === "P" || t === "F" || t === "C") return true;
      if (t === bakaze || t === seat_wind) return true;
    }
    return false;
  }

  function _is_open_threat(opp, turn, ctx) {
    const melds = opp.open_melds || 0;
    if (melds < 1) return false;
    switch (OPEN_TRIGGER_VARIANT) {
      case "V1":   // backlog 3-2-1: 3 melds always, 2 from turn 7, 1 from turn 13
        return melds >= 3
            || (turn >= 7 && melds >= 2)
            || (turn >= 13 && melds >= 1);
      case "V2":   // 3-2-1 with the last band starting at turn 11
        return melds >= 3
            || (turn >= 7 && melds >= 2)
            || (turn >= 11 && melds >= 1);
      case "V3":   // visible dora: opp's melds show 2+ dora (incl. aka)
        return _meld_dora_count(opp, ctx.dora_mjai) >= 2;
      case "V4":   // yakuhai pon/kan + at least one more call
        return melds >= 2 && _has_yakuhai_meld(opp, ctx.bakaze, ctx.seat_wind);
      case "V5":   // 3-2-1 (last band turn 11) OR yakuhai+2
        return melds >= 3
            || (turn >= 7 && melds >= 2)
            || (turn >= 11 && melds >= 1)
            || (melds >= 2 && _has_yakuhai_meld(opp, ctx.bakaze, ctx.seat_wind));
      case "V6":   // V5 OR 2+ visible meld dora
        return melds >= 3
            || (turn >= 7 && melds >= 2)
            || (turn >= 11 && melds >= 1)
            || (melds >= 2 && _has_yakuhai_meld(opp, ctx.bakaze, ctx.seat_wind))
            || _meld_dora_count(opp, ctx.dora_mjai) >= 2;
      case "V7":   // SHIPPED: 2+ calls, any turn. Benchmark: melds≥2 lifts
                   // OD1-Defend share to 65% / 74% EV vs melds≥1's 57% / 66%.
        return melds >= 2;
      default:
        return false;
    }
  }

  const _WINDS = ["E", "S", "W", "N"];

  function _extract_threats(events, start_pos, end_pos, player_id, target_tiles_left) {
    const state = walk_kyoku(events, start_pos, end_pos, player_id, target_tiles_left);
    let first_dora_indicator = null;
    if (state.first_dora_indicator != null) {
      first_dora_indicator = MJAI_TO_TENHOU[state.first_dora_indicator];
      if (first_dora_indicator === undefined) first_dora_indicator = null;
    }
    let dora_mjai = null;
    if (first_dora_indicator != null) {
      dora_mjai = TENHOU_TO_MJAI[dora_indicator_to_dora_tenhou(first_dora_indicator)] || null;
    }
    const turn = (state.player_tsumo_riichi_state || []).length;

    const threats = [];
    const order = state.opponent_order || Object.keys(state.opponents).map(Number);
    for (const seat of order) {
      const opp = state.opponents[seat];
      if (!opp) continue;

      const discards_tenhou = [];
      for (const p of opp.discards) {
        const t = MJAI_TO_TENHOU[p];
        if (t != null) discards_tenhou.push(t);
      }

      if (opp.reach_event_idx != null) {
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
          kind: "riichi",
          seat,
          discards_to_riichi,
          genbutsu,
          dora_indicator: first_dora_indicator,
          ippatsu_alive: !!opp.ippatsu_alive,
        });
        continue;
      }

      // Open (non-riichi) threat — only when the active trigger fires.
      const seat_wind = (state.oya != null)
        ? _WINDS[((seat - state.oya) % 4 + 4) % 4] : null;
      const ctx = { dora_mjai, bakaze: state.bakaze, seat_wind };
      if (!_is_open_threat(opp, turn, ctx)) continue;

      // Genbutsu: own discards ∪ every tile that hit the table after the
      // opp's last own dahai (they passed on it — temp-furiten window).
      const genbutsu = new Set();
      for (const t of discards_tenhou) genbutsu.add(normRedFive(t));
      const flow = state.tile_flow || [];
      for (let i = opp.flow_pos_at_last_dahai || 0; i < flow.length; i++) {
        const t = MJAI_TO_TENHOU[flow[i]];
        if (t != null) genbutsu.add(normRedFive(t));
      }

      threats.push({
        kind: "open",
        seat,
        discards_to_riichi: [],   // KD riichi knobs all key off this; empty drops them
        genbutsu,
        dora_indicator: first_dora_indicator,
        ippatsu_alive: false,
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
        kind: td.threat.kind || "riichi",
        seat,
        riichi_tile,
        ippatsu_alive: td.threat.ippatsu_alive,
        genbutsu: genbutsu_mjai,
        dealin_rates: rates,
        wait_breakdowns: breakdowns,
        suji_partners: partners_by_tile,
      });
    }

    return {
      dealin_rates,
      wait_breakdowns,
      suji_partners,
      per_threat,
    };
  }

  return {
    compute_kd_defense_data,
  };
}));
