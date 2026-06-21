// Yaku-panel computation — shape yakus (tanyao/toitoi/chanta/honitsu with
// chinitsu/junchan upgrades), sanshoku-doujun candidates, ittsuu candidates,
// and yakuhai liveness — for the per-opponent strip rendered in board.js.
// Pure helpers over a seat's melds + the unseen-copy wall produced by
// prep-board-state.js's `reconstruct_context` / `subtract_hand_from_wall`.
// No UI; no event walking. See prep-board-state.js for the BoardState
// orchestrator that feeds this module.

(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    const tiles = require("./tiles.js");
    module.exports = factory(tiles);
  } else {
    root.haipaiPrepBoardYaku = factory(root.haipaiPrepTiles);
  }
}(typeof self !== "undefined" ? self : this, function (tiles) {

  const { mjai_to_tile_id, is_honor_mjai, base_mjai } = tiles;

  // ── Yaku panel (v1: yakuhai only) ─────────────────────────────────
  // Per opened seat, decide whether a yakuhai is already locked in (a meld of
  // a dragon, the round wind, or that seat's own seat wind) or still reachable
  // (a yakuhai tile with >=3 unseen copies — a pon needs 3 total, so anything
  // below is dead). Mirrors the v1.1 spec in the Yaku-Panel design handoff.

  const _YAKU_DRAGONS = ["P", "F", "C"];
  const _WIND_LETTERS = ["E", "S", "W", "N"];
  // A yakuhai triplet needs 3 copies still live (not dead in discards/melds/
  // dora indicators), at least 2 of them unseen so the opponent can conceal a
  // pair. A copy in YOUR hand counts toward the 3 — discarding it feeds their
  // pon/ron — but can't be one of the concealed pair, hence the separate gates.
  const _YAKUHAI_TRIPLET_MIN = 3;
  const _YAKUHAI_HOLD_MIN = 2;

  // Yaku-strip display order — open-hand frequency on amae-koromo
  // (https://amae-koromo.sapk.ch/statistics/fan-stats). Most-likely first so
  // the eye lands on the threats opponents actually finish with. Sorting
  // happens after all candidates are pushed; see extract_board_state below.
  const _YAKU_DISPLAY_ORDER = {
    yakuhai:  0,
    tanyao:   1,
    honitsu:  2,
    sanshoku: 3,
    toitoi:   4,
    ittsuu:   5,
    chanta:   6,
  };

  function _seat_wind(seat, oya) {
    return _WIND_LETTERS[((seat - oya) % 4 + 4) % 4];
  }

  // The honor tiles already exposed in a seat's melds. chi sequences are never
  // honors, so this only ever picks up pon/kan groups. mjai stores the group's
  // tile on `pai` and/or `consumed[0]`; both are checked.
  function _meld_honor_tiles(melds) {
    const out = new Set();
    for (const meld of melds || []) {
      const cand = [meld.pai, (meld.consumed || [])[0]];
      for (const t of cand) if (t && is_honor_mjai(t)) out.add(t);
    }
    return out;
  }

  // Every tile in a meld (consumed + the called/added tile). Duplicates are
  // fine — callers only inspect tile kinds (suit / terminal / honor), never
  // counts. Covers chi/pon/daiminkan (consumed + pai), kakan (the 3 ponned +
  // added pai) and ankan (4 in consumed, no pai).
  function _meld_tiles(meld) {
    const out = (meld.consumed || []).slice();
    if (meld.pai) out.push(meld.pai);
    return out;
  }

  // Numbered tile -> its suit letter ('m'|'p'|'s'); honor -> null.
  function _tile_suit_mjai(t) {
    if (is_honor_mjai(t)) return null;
    return base_mjai(t)[1];
  }
  // 1/9 of any suit, or any honor — i.e. anything that kills tanyao.
  function _is_terminal_or_honor_mjai(t) {
    if (is_honor_mjai(t)) return true;
    const r = base_mjai(t)[0];
    return r === "1" || r === "9";
  }

  // Shape yakus a seat's melds keep alive, per the v1.3 Yaku-Panel handoff.
  // Each survives only while the melds don't contradict it (no likelihood
  // ranking yet — binary alive/dead). All three stay 'possible' from an
  // opponent's view: locking them needs the concealed shape we can't see.
  //   tanyao  — alive while no meld holds a terminal or honor.
  //   toitoi  — alive while no meld is a chi (every group a triplet/kan).
  //   chanta  — alive while every meld holds a terminal or honor. The badge
  //             folds in junchan: `junchanReachable` is true when no honor has
  //             been melded (the terminals-only finish is still open).
  //   honitsu — alive while numbered melds stay within one suit. The badge
  //             folds in chinitsu: `chinitsuReachable` is true when no honor
  //             has been melded (the no-honor finish is still open). With only
  //             honor melds, every suit is still committable (suits = all 3).
  function _shape_yakus(melds) {
    let hasChi = false;
    let termOrHonor = false;
    let honorMelded = false;
    let everyMeldTermOrHonor = melds.length > 0;
    // Whole-hand yakus are backed by every meld (any contradicting meld kills
    // them), so `support` — used by the strip to keep only 2-meld-committed
    // yakus out of the "more" toggle — is just the seat's meld count.
    const support = melds.length;
    const suits = new Set();
    for (const meld of melds) {
      if (meld.type === "chi") hasChi = true;
      let meldTermOrHonor = false;
      for (const t of _meld_tiles(meld)) {
        if (is_honor_mjai(t)) { honorMelded = true; termOrHonor = true; meldTermOrHonor = true; continue; }
        suits.add(_tile_suit_mjai(t));
        if (_is_terminal_or_honor_mjai(t)) { termOrHonor = true; meldTermOrHonor = true; }
      }
      if (!meldTermOrHonor) everyMeldTermOrHonor = false;
    }
    const out = [];
    if (!termOrHonor) out.push({ type: "tanyao", state: "possible", support });
    if (!hasChi) out.push({ type: "toitoi", state: "possible", support });
    if (everyMeldTermOrHonor) {
      out.push({
        type: "chanta", state: "possible", support,
        junchanReachable: !honorMelded,
      });
    }
    if (suits.size <= 1) {
      out.push({
        type: "honitsu", state: "possible", support,
        suits: suits.size === 1 ? [...suits] : ["m", "p", "s"],
        chinitsuReachable: !honorMelded && suits.size === 1,
      });
    }
    return out;
  }

  const _SUITS = ["m", "p", "s"];

  // The run a chi meld forms: { suit, start } with start the lowest number
  // (1..7). Non-chi melds (pon/kan, honor groups) return null. mjai keeps a
  // chi's three tiles across consumed + pai; red fives fold to their base.
  function _chi_run(meld) {
    if (meld.type !== "chi") return null;
    const tiles = _meld_tiles(meld).map(base_mjai);
    if (tiles.length !== 3) return null;
    const suit = _tile_suit_mjai(tiles[0]);
    if (!suit) return null;
    const nums = tiles.map(t => Number(t[0])).sort((a, b) => a - b);
    return { suit, start: nums[0] };
  }

  // Copies of an mjai tile still unseen — the wall already has discards, melds,
  // dora indicators, and the player's hand subtracted, so this is exactly how
  // many copies an opponent could still draw. Red fives share their base count.
  function _unseen(wall, mjai) {
    return wall[mjai_to_tile_id(base_mjai(mjai))] || 0;
  }

  // Sanshoku-doujun candidates a seat's melds keep alive (v1.5 Yaku-Panel
  // handoff). A candidate is a run (start 1..7) that at least one melded chi
  // already covers in some suit; the yaku completes when the same run appears
  // in all three suits. Key rules:
  //   • Each melded chi run seeds a candidate; progress = how many of m/p/s
  //     that run is already melded in (1..3).
  //   • Viability needs the still-missing suits to fit in the seat's remaining
  //     concealed sets (4 - meldCount). This is what yields the handoff's
  //     progression: 2 melds → up to 2 candidates, 3 melds → 1, 4 → done.
  //   • A pending suit's tile is reachable if the opponent can still draw it
  //     (>=1 unseen) OR you hold the last copies — discarding one feeds their
  //     chi/ron. So, like yakuhai, a copy in YOUR hand counts as live (a
  //     "deal-in"). A pending suit only dies when (a) one of its tiles is gone
  //     everywhere — 0 unseen AND 0 in your hand — or (b) two of its tiles are
  //     last-copies in your hand: a call takes just one tile from outside, so
  //     the opponent can never collect both. Two last-copies in *different*
  //     suits is fine — they're fed on separate turns.
  //   • A dead candidate is surfaced (strike-through) only at >=2 melds; with a
  //     single meld the hand can still abandon this run for a different
  //     sanshoku formed entirely in the concealed sets ("sanshoku any" stays
  //     alive), so we just drop the dead candidate rather than flag it. Only
  //     the concrete chi candidate (progress 1) is ever shown at one meld; the
  //     dormant "any" possibility carries no number to render.
  // Returns candidates in run order, each:
  //   { type:'sanshoku', state:'possible'|'close'|'locked'|'dead', seq:'234',
  //     progress, bottleneck:{tile,count}|null,
  //     dealInTiles:[tile] (last-copies you hold on still-live suits),
  //     rows:[{ suit, melded, live, dead, deadTile,
  //             tiles:[{tile,count,inHand,zero,dealIn}] }] }
  // handCounts maps base mjai tile -> copies in the player's hand.
  function _sanshoku_candidates(melds, wall, handCounts) {
    const meldCount = melds.length;
    const concealedSlots = 4 - meldCount;
    const byStart = new Map();   // run start -> Set of melded suits
    for (const meld of melds) {
      const run = _chi_run(meld);
      if (!run) continue;
      if (!byStart.has(run.start)) byStart.set(run.start, new Set());
      byStart.get(run.start).add(run.suit);
    }

    const out = [];
    for (const start of [...byStart.keys()].sort((a, b) => a - b)) {
      const meldedSuits = byStart.get(start);
      const progress = meldedSuits.size;
      // Can't fit the missing suits in the concealed sets that remain.
      if (3 - progress > concealedSlots) continue;

      const rows = [];
      let dead = false;
      const dealInTiles = [];          // last-copies you hold on live suits
      let minDraw = Infinity, minDrawTile = null;
      for (const suit of _SUITS) {
        const melded = meldedSuits.has(suit);
        const tiles = [];
        let exhaustedTile = null;      // a tile gone everywhere (kills the suit)
        const suitDealIn = [];         // last-copies you hold in this suit
        let live = 0;
        for (let k = 0; k < 3; k++) {
          const tile = `${start + k}${suit}`;
          let count = null, inHand = 0, zero = false, dealIn = false;
          if (!melded) {
            count = _unseen(wall, tile);
            inHand = handCounts[base_mjai(tile)] || 0;
            live += count;
            if (count === 0 && inHand === 0) { zero = true; exhaustedTile = tile; }
            else if (count === 0) { dealIn = true; suitDealIn.push(tile); }
            else if (count < minDraw) { minDraw = count; minDrawTile = tile; }
          }
          tiles.push({ tile, count, inHand, zero, dealIn });
        }
        // Suit dies if a tile is gone everywhere, or if two of its tiles are
        // last-copies in hand (a single call can't pull both).
        const suitDead = !melded && (exhaustedTile !== null || suitDealIn.length >= 2);
        if (suitDead) dead = true;
        else for (const t of suitDealIn) dealInTiles.push(t);
        rows.push({ suit, melded, tiles, live: melded ? null : live,
                    dead: suitDead, deadTile: exhaustedTile });
      }

      let state;
      if (progress === 3) state = "locked";
      else if (dead) state = "dead";
      else state = progress === 2 ? "close" : "possible";

      // 1-meld policy: a lone run that goes dead isn't truly dead — the hand
      // can switch to a concealed-only sanshoku — so don't surface it.
      if (state === "dead" && meldCount < 2) continue;

      const bottleneck = (state === "possible" || state === "close")
        && minDrawTile !== null && minDraw <= 2
        ? { tile: minDrawTile, count: minDraw } : null;

      out.push({
        type: "sanshoku", state, seq: `${start}${start + 1}${start + 2}`,
        progress, rows, bottleneck, dealInTiles,
      });
    }
    return out;
  }

  // Ittsuu (一気通貫) candidates a seat's melds keep alive. Mirrors the
  // sanshoku candidate logic, but pivoted: the variation axis is the suit
  // (one yaku per m/p/s), and progress is across the three fixed runs
  // 123 / 456 / 789. A candidate is seeded by any melded chi whose run is
  // one of those three; chi melds with other starts (e.g. 234, 567) don't
  // contribute to ittsuu and aren't surfaced. Same close/dead/deal-in
  // semantics, same 1-meld policy (don't surface a lone-meld dead — the hand
  // can pivot to a concealed-only ittsuu in another suit). `rows` are per
  // run, not per suit.
  const _ITTSUU_STARTS = [1, 4, 7];

  function _ittsuu_candidates(melds, wall, handCounts) {
    const meldCount = melds.length;
    const concealedSlots = 4 - meldCount;
    const bySuit = new Map();   // suit -> Set of melded run indices (0/1/2)
    for (const meld of melds) {
      const run = _chi_run(meld);
      if (!run) continue;
      const idx = _ITTSUU_STARTS.indexOf(run.start);
      if (idx < 0) continue;   // chi run is not one of 123/456/789
      if (!bySuit.has(run.suit)) bySuit.set(run.suit, new Set());
      bySuit.get(run.suit).add(idx);
    }

    const out = [];
    for (const suit of _SUITS) {
      if (!bySuit.has(suit)) continue;
      const meldedRuns = bySuit.get(suit);
      const progress = meldedRuns.size;
      if (3 - progress > concealedSlots) continue;

      const rows = [];
      let dead = false;
      const dealInTiles = [];
      let minDraw = Infinity, minDrawTile = null;
      for (let r = 0; r < 3; r++) {
        const start = _ITTSUU_STARTS[r];
        const melded = meldedRuns.has(r);
        const tiles = [];
        let exhaustedTile = null;
        const runDealIn = [];
        let live = 0;
        for (let k = 0; k < 3; k++) {
          const tile = `${start + k}${suit}`;
          let count = null, inHand = 0, zero = false, dealIn = false;
          if (!melded) {
            count = _unseen(wall, tile);
            inHand = handCounts[base_mjai(tile)] || 0;
            live += count;
            if (count === 0 && inHand === 0) { zero = true; exhaustedTile = tile; }
            else if (count === 0) { dealIn = true; runDealIn.push(tile); }
            else if (count < minDraw) { minDraw = count; minDrawTile = tile; }
          }
          tiles.push({ tile, count, inHand, zero, dealIn });
        }
        // Run dies if a tile is gone everywhere, or two of its tiles are
        // last-copies you hold (a call pulls only one).
        const runDead = !melded && (exhaustedTile !== null || runDealIn.length >= 2);
        if (runDead) dead = true;
        else for (const t of runDealIn) dealInTiles.push(t);
        rows.push({ run: r, start, melded, tiles, live: melded ? null : live,
                    dead: runDead, deadTile: exhaustedTile });
      }

      let state;
      if (progress === 3) state = "locked";
      else if (dead) state = "dead";
      else state = progress === 2 ? "close" : "possible";

      // 1-meld policy: a lone ittsuu run going dead could pivot to a
      // different suit concealed — don't surface as dead.
      if (state === "dead" && meldCount < 2) continue;

      const bottleneck = (state === "possible" || state === "close")
        && minDrawTile !== null && minDraw <= 2
        ? { tile: minDrawTile, count: minDraw } : null;

      out.push({
        type: "ittsuu", state, suit,
        progress, rows, bottleneck, dealInTiles,
      });
    }
    return out;
  }

  // meldsBySeat: { seat -> [melds] } for every seat that has opened.
  // wall: 37-entry unseen-copy counts (player's hand already subtracted).
  // oya: dealer seat (for per-seat wind). round_wind: bakaze mjai letter.
  // hand: the player's concealed tiles — copies of a yakuhai you hold are still
  //   "live" for an opponent (you might discard them), so they're added back to
  //   the wall's unseen count for the triplet gate.
  // Returns { seat -> [yaku, ...] } for opened seats only — one entry per yaku
  // that survives the seat's melds, in display order (yakuhai, tanyao, toitoi,
  // chanta, honitsu, then one entry per live sanshoku candidate). Dead yakus
  // are omitted (sanshoku's dead state is the exception — see
  // _sanshoku_candidates); an opened seat with none surviving gets an empty
  // array (the render shows a muted placeholder). Shapes:
  //   yakuhai: { type, state:'locked'|'possible'|'dead',
  //             locked:[{tile,note}], possible:[{tile,count,inHand,note}],
  //             dead:[{tile,unseen,inHand,note}] }
  //     `dead` carries the seat's yakuhai candidates killed by tile count —
  //     not exposed in a meld and below the live gate (unseen < 2 or
  //     unseen+inHand < 3). Surfaced via the collapsible "N dead" toggle on
  //     the strip (see board.js). The yakuhai entry may have state='dead'
  //     when all candidates are dead; it skips live rendering then but its
  //     `dead[]` is still picked up by the dead-row collector.
  //   tanyao / toitoi: { type, state:'possible', support }
  //   chanta:  { type, state:'possible', support, junchanReachable }
  //   honitsu: { type, state:'possible', support, suits:['m'|'p'|'s'], chinitsuReachable }
  //     `support` = backing meld count; the strip keeps only 2-meld-committed
  //     whole-hand yakus out of the "more" toggle.
  //   sanshoku: { type, state, seq, progress, rows, bottleneck, dealInTiles } (see above)
  //   ittsuu:   { type, state, suit, progress, rows, bottleneck, dealInTiles } (see above)
  function compute_yaku_panel(meldsBySeat, wall, oya, round_wind, hand) {
    const out = {};
    const handHonors = {};
    const handCounts = {};   // base mjai tile -> copies in hand (red fives folded)
    for (const t of hand || []) {
      handCounts[base_mjai(t)] = (handCounts[base_mjai(t)] || 0) + 1;
      if (is_honor_mjai(t)) handHonors[t] = (handHonors[t] || 0) + 1;
    }
    for (const key of Object.keys(meldsBySeat || {})) {
      const seat = Number(key);
      const melds = meldsBySeat[key];
      if (!melds || !melds.length) continue;

      const seat_wind = _seat_wind(seat, oya);
      // Candidate yakuhai tiles for this seat, deduped, in display order:
      // the three dragons, then round wind, then seat wind.
      const cands = [];
      const seen = new Set();
      for (const t of [..._YAKU_DRAGONS, round_wind, seat_wind]) {
        if (t && !seen.has(t)) { seen.add(t); cands.push(t); }
      }

      const exposed = _meld_honor_tiles(melds);
      const note_for = (t) => {
        const isRound = t === round_wind;
        const isSeat = t === seat_wind;
        if (isRound && isSeat) return "round + seat";
        if (isSeat) return "seat";
        return null;   // dragon, or round wind (applies to everyone — no note)
      };

      const locked = [];
      const possible = [];
      const dead = [];
      for (const t of cands) {
        const note = note_for(t);
        if (exposed.has(t)) {
          locked.push({ tile: t, note });
          continue;
        }
        const unseen = wall[mjai_to_tile_id(t)] || 0;
        const inHand = handHonors[t] || 0;
        const live = unseen + inHand;
        if (unseen >= _YAKUHAI_HOLD_MIN && live >= _YAKUHAI_TRIPLET_MIN) {
          possible.push({ tile: t, count: live, inHand, note });
        } else {
          // Below the triplet/hold threshold — a pon of this honor is no
          // longer mathematically possible. Surfaced in the dead-row toggle.
          dead.push({ tile: t, unseen, inHand, note });
        }
      }

      const entries = [];
      if (locked.length || possible.length || dead.length) {
        entries.push({
          type: "yakuhai",
          state: locked.length ? "locked" : (possible.length ? "possible" : "dead"),
          locked, possible, dead,
        });
      }
      // tanyao / toitoi / chanta / honitsu — pushed in detection order, then
      // re-sorted with the rest below into the strip's display order.
      for (const y of _shape_yakus(melds)) entries.push(y);
      // Sanshoku-doujun candidates derived from the seat's melded chi runs.
      for (const s of _sanshoku_candidates(melds, wall, handCounts)) entries.push(s);
      // Ittsuu candidates — one per suit with a melded 123/456/789 chi.
      for (const s of _ittsuu_candidates(melds, wall, handCounts)) entries.push(s);
      // Strip display order matches open-hand frequency on amae-koromo
      // (https://amae-koromo.sapk.ch/statistics/fan-stats): yakuhai > tanyao >
      // honitsu > sanshoku > toitoi > ittsuu > chanta. Stable so multiple
      // sanshoku/ittsuu candidates keep their detection-order grouping.
      entries.sort((a, b) =>
        (_YAKU_DISPLAY_ORDER[a.type] ?? 99) - (_YAKU_DISPLAY_ORDER[b.type] ?? 99));
      out[seat] = entries;
    }
    return out;
  }

  return {
    compute_yaku_panel,
  };
}));
