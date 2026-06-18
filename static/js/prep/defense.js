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
  // NOTE: flip to "SWEEP1" + re-prep (category_bench.mjs) to regenerate the
  // han-gate sweep cache (scripts/od_han_gate_sweep.mjs); "V8" is shipped.
  const OPEN_TRIGGER_VARIANT = "V8";

  // `dora_set` is the Set of every live dora tile (mjai), one per indicator —
  // including kan-dora. Aka fives always count. A kan of a dora tile therefore
  // scores all four copies, so a daiminkan'd dragon that a new kan-dora marker
  // turns into dora is worth 4, not 0 (report R-151 / #8790, the "dora4" hand).
  function _meld_dora_count(opp, dora_set) {
    let n = 0;
    for (const meld of opp.melds || []) {
      for (const t of meld.tiles || []) {
        if (typeof t !== "string") continue;
        if (t.endsWith("r")) { n++; continue; }   // aka five
        if (dora_set && dora_set.has(t)) n++;
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

  // Guaranteed yakuhai han locked into a seat's visible triplets. Mirrors
  // board-melds.js::meldYakuhai: dragon = 1, round/seat wind = 1, double wind
  // (round AND seat) = 2; deduped by base tile so a kakan-upgraded pon isn't
  // double-counted. Sums to the han every win this hand makes is guaranteed.
  function _yakuhai_han(opp, bakaze, seat_wind) {
    let han = 0;
    const seen = {};
    for (const meld of opp.melds || []) {
      if (meld.type === "chi") continue;
      const t = (meld.tiles || [])[0];
      if (!t || seen[t]) continue;
      if (t === "P" || t === "F" || t === "C") { han += 1; seen[t] = 1; }
      else if (t === bakaze && t === seat_wind) { han += 2; seen[t] = 1; }
      else if (t === bakaze || t === seat_wind) { han += 1; seen[t] = 1; }
    }
    return han;
  }

  // Han an open hand is locked into (board-discards.js::threatGuaranteedHan):
  // yakuhai stand alone; dora only count alongside a yaku, so a dora-only hand
  // adds 1 for the yaku it still needs.
  function _guaranteed_han(yakuhai_han, meld_dora) {
    if (yakuhai_han > 0) return yakuhai_han + meld_dora;
    return meld_dora > 0 ? meld_dora + 1 : 0;
  }

  // Value-based han for the open-defense gate (the V8 model). Every open hand
  // needs a yaku, so the floor is 1: a single yakuhai IS that yaku (1 han, not
  // 2), a round+seat double wind counts twice (2), and each exposed dora (incl.
  // aka) adds 1. So 1=bare/single-yakuhai, 2=double-wind or 1-dora, 3=2-dora,
  // 4=3-dora or double-wind+2, 5=4-dora or double-wind+3.
  function _open_value_han(opp, ctx) {
    return Math.max(1, _yakuhai_han(opp, ctx.bakaze, ctx.seat_wind))
         + _meld_dora_count(opp, ctx.dora_set);
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
        return _meld_dora_count(opp, ctx.dora_set) >= 2;
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
            || _meld_dora_count(opp, ctx.dora_set) >= 2;
      case "V7":   // 2+ calls, any turn. Benchmark: melds≥2 lifts OD1-Defend
                   // share to 65% / 74% EV vs melds≥1's 57% / 66%.
        return melds >= 2;
      case "V8":   // SHIPPED: V7 OR a high-value single call (han>=3 by the
                   // value model: 2+ dora, dora-pon, double-wind+dora). At scale
                   // (366 games) this adds +77 fold spots / 40 games at 66%
                   // OD1 / 76% EV — above the riichi-defense bar. See
                   // [[od-han-gate-sweep]]; han = _open_value_han.
        return melds >= 2 || _open_value_han(opp, ctx) >= 3;
      case "SWEEP1": // ANALYSIS ONLY: emit every 1+ call open threat so the han-
                     // gate sweep (scripts/od_han_gate_sweep.mjs) can filter on
                     // guaranteed_han without re-prepping. NOT for shipping.
        return melds >= 1;
      default:
        return false;
    }
  }

  const _WINDS = ["E", "S", "W", "N"];

  function _extract_threats(events, start_pos, end_pos, player_id, target_tiles_left) {
    const state = walk_kyoku(events, start_pos, end_pos, player_id, target_tiles_left);
    // Full live dora set — every indicator, incl. kan-dora — in both notations:
    //   dora_set     (mjai)   → the open-threat gate's meld-dora value model
    //   dora_tenhou  (tenhou) → the KD wait-value weighting (doraGreed)
    // so a kan of a kan-dora tile counts at full han (R-151 / #8790) and waits
    // that complete on any live dora are weighted up, not just the first dora's.
    const dora_set = new Set();
    const dora_tenhou = [];
    for (const ind_mjai of state.dora_indicators || []) {
      const ind_tenhou = MJAI_TO_TENHOU[ind_mjai];
      if (ind_tenhou == null) continue;
      const d_tenhou = dora_indicator_to_dora_tenhou(ind_tenhou);
      if (d_tenhou == null) continue;
      dora_tenhou.push(normRedFive(d_tenhou));
      const d_mjai = TENHOU_TO_MJAI[d_tenhou];
      if (d_mjai != null) dora_set.add(d_mjai);
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
          dora_tiles: dora_tenhou,
          ippatsu_alive: !!opp.ippatsu_alive,
        });
        continue;
      }

      // Open (non-riichi) threat — only when the active trigger fires.
      const seat_wind = (state.oya != null)
        ? _WINDS[((seat - state.oya) % 4 + 4) % 4] : null;
      const ctx = { dora_set, bakaze: state.bakaze, seat_wind };
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

      // Value metadata for the han-gate sweep — carried through to per_threat.
      const meld_dora = _meld_dora_count(opp, dora_set);
      const yakuhai_han = _yakuhai_han(opp, state.bakaze, seat_wind);
      threats.push({
        kind: "open",
        seat,
        discards_to_riichi: [],   // KD riichi knobs all key off this; empty drops them
        genbutsu,
        dora_tiles: dora_tenhou,
        ippatsu_alive: false,
        open_melds: opp.open_melds || 0,
        meld_dora,
        yakuhai_han,
        guaranteed_han: _guaranteed_han(yakuhai_han, meld_dora),
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
      const combos = calcCombos(
        generateWaits(), threat.genbutsu, threat.discards_to_riichi, unseen,
        threat.dora_tiles
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
      const entry = {
        kind: td.threat.kind || "riichi",
        seat,
        riichi_tile,
        ippatsu_alive: td.threat.ippatsu_alive,
        genbutsu: genbutsu_mjai,
        dealin_rates: rates,
        wait_breakdowns: breakdowns,
        suji_partners: partners_by_tile,
      };
      if (td.threat.kind === "open") {
        entry.open_melds = td.threat.open_melds;
        entry.meld_dora = td.threat.meld_dora;
        entry.yakuhai_han = td.threat.yakuhai_han;
        entry.guaranteed_han = td.threat.guaranteed_han;
      }
      per_threat.push(entry);
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
