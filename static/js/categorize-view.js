// Category presentation: labels, group colors, severity tiers, explanation
// text, and closed-hand yaku detection.

var CATEGORIES = [
  "", "1A",
  "2A",
  "3A", "3B", "3C",
  "4A", "4B", "4C",
  "5A", "5B",
  "6A", "6B",
];

// Loaded from /api/categories on init
var CATEGORY_INFO = {};

var GROUP_COLORS = {
  "Attack": "#4a9eff",
  "Defense": "#ff6b6b",
  "Meld": "#ffa94d",
  "Riichi": "#a855f7",
  "Kan": "#22c55e",
  // Legacy group names (map to new colors)
  "Push": "#4a9eff",
  "Efficiency": "#4a9eff",
  "Value Tiles": "#4a9eff",
  "Strategy": "#ff6b6b",
};

var OUTCOME_EMOJI = { ":D": "\u{1F60E}", ":)": "\u{1F642}", ":|": "\u{1F610}", ":(": "\u{1F61E}" };

function catLabel(code) {
  const info = CATEGORY_INFO[code];
  return info ? `${info.group} / ${info.label}` : code;
}

function catGroup(code) {
  const info = CATEGORY_INFO[code];
  return info ? info.group : code;
}

function catDesc(code) {
  const info = CATEGORY_INFO[code];
  if (!info) return code;
  let desc = info.desc || "";
  if (info.study) desc += ` (${info.study})`;
  return desc;
}

function generateExplanation(m) {
  const actual = m.actual;
  const expected = m.expected;
  if (!actual || !expected) return "";
  const at = actual.type;
  const et = expected.type;
  const cat = m.category || "";
  const shantenStr = m.shanten != null ? `${m.shanten}-shanten` : null;
  const labels = (m.categorize_data && m.categorize_data.labels) || m.labels || [];
  const hasRiichi = !!m.safety_ratings;

  // --- Helper: find per-discard stats for a tile ---
  function statFor(tile) {
    if (!m.discard_stats) return null;
    const base = tile ? tile.replace(/r$/, "") : null;
    return m.discard_stats.find(s => s.tile === tile || s.tile === base) || null;
  }
  function mortalFor(tile) {
    if (!m.top_actions) return null;
    return m.top_actions.find(a => a.action && a.action.pai === tile) || null;
  }
  function safetyFor(tile) {
    if (!m.safety_ratings) return null;
    return m.safety_ratings[tile] ?? m.safety_ratings[tile.replace(/r$/, "")] ?? null;
  }
  function safetyLabel(rating) {
    if (rating == null) return "unknown";
    if (rating >= 14) return "safe";
    if (rating >= 10) return "fairly safe";
    if (rating >= 7) return "moderate (suji)";
    if (rating >= 4) return "risky";
    return "dangerous";
  }
  function tileCountStr(stat) {
    if (!stat) return "";
    return stat.necessary_count ? `${stat.necessary_count} tiles` : "";
  }
  // Ankan keeps the hand closed; any other meld (chi/pon/kakan/daiminkan) opens it.
  const handAlreadyOpen = !!(m.melds && m.melds.some(ml => ml.type && ml.type !== "ankan"));

  // --- Meld decisions (4A/4B/4C) ---
  if (cat === "4A" || (at !== "dahai" && at !== "reach" && (at === "chi" || at === "pon") && et === "none")) {
    const meldType = at === "chi" ? "chi" : "pon";
    let text = `You called ${meldType}, but Mortal says passing was better.`;
    if (handAlreadyOpen) {
      text += ` Your hand is already open, so there's no menzen penalty left to pay — but this ${meldType} likely narrows your shape or commits you to the wrong direction.`;
    } else {
      text += ` Calling opens your hand, which costs you menzen (closed hand) bonuses like riichi and potentially ippatsu/tsumo.`;
    }
    if (shantenStr) text += ` At ${shantenStr}, the speed gain from calling doesn't outweigh what you lose in hand value.`;
    if (m.top_actions && m.top_actions.length >= 2) {
      const evGap = Math.abs(m.top_actions[0].q_value - (mortalFor(actual.pai)?.q_value || m.top_actions[m.top_actions.length - 1].q_value));
      text += ` The EV difference is about ${evGap.toFixed(2)} — Mortal sees a meaningful cost to this call.`;
    }
    return text;
  }

  if (cat === "4B" || (at === "none" && (et === "chi" || et === "pon"))) {
    const meldType = et === "chi" ? "chi" : "pon";
    let text = `You passed on a ${meldType} opportunity, but Mortal says you should have called.`;
    if (shantenStr) text += ` Your hand is at ${shantenStr}`;
    if (shantenStr) text += ` — calling this ${meldType} would bring you closer to tenpai faster than waiting for a self-draw.`;
    if (handAlreadyOpen) {
      text += ` Your hand is already open, so there's nothing to lose by calling — the menzen bonuses are already off the table.`;
    } else {
      text += ` Sometimes speed matters more than keeping your hand closed, especially when the hand value is already decent or the game situation demands urgency.`;
    }
    return text;
  }

  if (cat === "4C") {
    let text = `You called ${formatAction(actual)}, but ${formatAction(expected)} was the better meld choice.`;
    text += ` Different melds leave you with different tile shapes and waiting patterns. The recommended call gives you a more flexible hand going forward.`;
    return text;
  }

  // --- Riichi decisions (5A/5B) ---
  if (cat === "5A" || (at === "reach" && et === "dahai")) {
    const waits = tenpaiWaitTiles(m);
    const waitTypes = waits.length;
    const waitTotal = waits.reduce((a, w) => a + (w.count || 0), 0);
    const waitCountPhrase = waitTypes
      ? `a ${waitTypes}-type wait with ${waitTotal} live ${waitTotal === 1 ? "tile" : "tiles"}`
      : null;
    // Furiten is the strongest 5A signal — the riichi literally can't ron.
    // Put that up front and skip the generic "you could dama" framing.
    if (m.bad_riichi_reason === "furiten") {
      const furitenTiles = (m.furiten_tiles || [])
        .map(t => renderTile(t, "tile-sm furiten-tile")).join("");
      const waitsHtml = waits
        .map(w => renderTile(w.tile, "tile-sm furiten-wait-tile")).join("");
      let text = `<span class="furiten-alert">Furiten riichi</span>`;
      const waitPrefix = waitTypes
        ? `your ${waitCountPhrase} (${waitsHtml}) includes ${furitenTiles}, which you've already discarded`
        : `your wait includes tiles you've already discarded`;
      text += ` — ${waitPrefix}.`;
      text += ` While in furiten you can only win by tsumo, not ron, so declaring riichi locks you into the weaker half of your own wait.`;
      if (hasRiichi) text += ` And with an opponent already in riichi, you can't even dodge their wait anymore.`;
      if (m.ev_loss) text += ` This cost ${m.ev_loss.toFixed(2)} EV compared to dama.`;
      return text;
    }
    let text = `You declared riichi, but Mortal recommends just discarding ${expected.pai} (dama) instead.`;
    if (waitCountPhrase) text += ` You've got ${waitCountPhrase} — thin waits especially make riichi costly since you lose the flexibility to abandon them.`;
    text += ` Riichi locks your hand — you can't change your wait or defend against opponents.`;
    if (hasRiichi) text += ` With an opponent already in riichi, declaring here is especially risky — you lose all ability to dodge dangerous tiles.`;
    const yakuHints = detectClosedHandYaku(m);
    if (yakuHints.length) {
      text += ` <span class="yaku-hints">Likely yaku already in hand: ${yakuHints.map(y => `<span class="yaku-tag">${y}</span>`).join(" ")}</span>`;
      text += ` — when the hand already has a yaku, dama is often correct (Riichi Book 1): you keep flexibility, can dodge dangerous tiles, and the riichi premium of 1 han + ippatsu chance may not be worth the lock-in.`;
    } else {
      text += ` Mortal still says dama works here — perhaps because of board state, score situation, or remaining tiles. Trust Mortal's read on this one.`;
    }
    if (m.ev_loss) text += ` This cost ${m.ev_loss.toFixed(2)} EV compared to the best play.`;
    return text;
  }

  if (cat === "5B" || (at === "dahai" && et === "reach")) {
    const waits = tenpaiWaitTiles(m);
    const waitTypes = waits.length;
    const waitTotal = waits.reduce((a, w) => a + (w.count || 0), 0);
    let text = `Your hand is tenpai and ready to declare riichi, but you chose to discard ${actual.pai} silently.`;
    if (waitTypes) {
      text += ` You've got a ${waitTypes}-type wait with ${waitTotal} live ${waitTotal === 1 ? "tile" : "tiles"} remaining — declaring riichi would lock it in but add at least 1 han plus the ippatsu/uradora chances.`;
    } else {
      text += ` Riichi adds at least 1 han to your hand value, plus the chance of ippatsu (winning within one round).`;
    }
    text += ` It also intimidates opponents into playing defensively, which can protect your winning tile from being blocked.`;
    if (m.ev_loss) text += ` This cost ${m.ev_loss.toFixed(2)} EV compared to declaring riichi.`;
    return text;
  }

  // --- Kan decisions (6A/6B) ---
  if (cat === "6A") {
    let text = `You declared kan, but Mortal says ${formatAction(expected)} was better.`;
    text += ` Kan gives you an extra draw and reveals a new dora indicator, but it also reveals information to opponents and changes the tile count.`;
    text += ` Here, the risk or timing wasn't worth the potential reward.`;
    return text;
  }

  if (cat === "6B") {
    let text = `You chose ${formatAction(actual)}, but declaring kan was the better play.`;
    text += ` The kan would give you an extra draw from the dead wall plus a new dora indicator, potentially increasing your hand's value. In this position, the reward outweighs the information you reveal.`;
    return text;
  }

  // --- Missed win ---
  if (et === "hora") {
    let text = `You passed on a winning tile — this is almost always a mistake.`;
    text += ` Unless you're strategically going for a higher-scoring wait (damaten to ippatsu, or furiten considerations), you should take the win when it's offered.`;
    return text;
  }

  // --- Discard vs discard ---
  if (at === "dahai" && et === "dahai") {
    const actualStat = statFor(actual.pai);
    const expectedStat = statFor(expected.pai);
    const bestDiscard = m.best_discard;
    const actualSafety = safetyFor(actual.pai);
    const expectedSafety = safetyFor(expected.pai);

    // Shanten increase prefix
    const catData = m.categorize_data || {};
    const shantenIncrease = catData.shanten_increase;
    let shantenWarning = "";
    if (shantenIncrease) {
      shantenWarning = `<strong>Your discard increased shanten</strong> (from ${catData.best_shanten} to ${catData.actual_shanten}) — this moves your hand further from winning. `;
    }

    // Defense trigger description
    const defenseTrigger = catData.defense_trigger;
    function defenseTriggerStr() {
      if (defenseTrigger === "riichi") return "an opponent declared riichi";
      if (defenseTrigger === "open_melds") return "an opponent has 3+ open calls (threatening hand)";
      if (hasRiichi) return "an opponent declared riichi";
      return "an opponent is threatening";
    }

    // Deal-in rate lookup with red-five fallback.
    const dealinFor = (t) => {
      if (!t || !m.dealin_rates) return null;
      const r = m.dealin_rates[t];
      if (r != null) return r;
      return m.dealin_rates[t.replace(/r$/, "")] ?? null;
    };
    const expectedDealin = dealinFor(expected.pai);
    const actualDealin = dealinFor(actual.pai);
    // Fine-grained safety label (e.g. "non-suji 4-5-6", "honor (2 left)").
    const labelFor = (t) => (t ? fineLabelForTile(m, t) : null);
    const expectedLabel = labelFor(expected.pai);
    const actualLabel = labelFor(actual.pai);
    const pctStr = (r) => (r == null ? "" : `${r.toFixed(1)}%`);

    // --- D1: Defend (Mortal's discard has strictly lower deal-in rate) ---
    if (cat === "D1") {
      let text = `<span class="trigger-line">${defenseTriggerStr().charAt(0).toUpperCase() + defenseTriggerStr().slice(1)}. Mortal chose a safer tile than you did.</span>`;
      if (shantenStr) text += `Your hand is at ${shantenStr}. `;
      text += `Mortal recommends ${expected.pai}`;
      if (expectedDealin != null) text += ` (deal-in ${pctStr(expectedDealin)}${expectedLabel ? ", " + expectedLabel : ""})`;
      text += ` — you chose ${actual.pai}`;
      if (actualDealin != null) text += ` (deal-in ${pctStr(actualDealin)}${actualLabel ? ", " + actualLabel : ""})`;
      text += `. When an opponent is threatening, lowering your deal-in probability takes priority over hand progress.`;
      return text;
    }

    // --- D2: Push (Mortal took the riskier tile, basic strategy justifies it) ---
    if (cat === "D2") {
      const reason = catData.push_reason;  // "P1" | "P2" | "P3"
      const bothSafe = catData.both_safe === true;

      // Both-safe variant: no defense tradeoff. Text teaches the specific
      // efficiency lesson AND reinforces the "both safe — efficiency only"
      // read as a defense skill in its own right.
      if (bothSafe) {
        let text = `<span class="trigger-line">An opponent is in riichi, but both your pick and Mortal's are 100% safe.</span>`;
        if (shantenStr) text += `Your hand is at ${shantenStr}. `;
        if (reason === "P1" && expectedStat && actualStat) {
          text += `Your ${actual.pai} raises shanten from ${catData.best_shanten ?? expectedStat.shanten} to ${catData.actual_shanten ?? actualStat.shanten} — a fundamental setback. `;
        } else if (reason === "P2" && expectedStat && actualStat) {
          text += `Mortal's ${expected.pai} keeps ${tileCountStr(expectedStat)} acceptance vs only ${tileCountStr(actualStat)} for your ${actual.pai}. `;
        } else if (reason === "P3") {
          const vp = catData.value_preserve || {};
          if (vp.dora && vp.yakuhai) {
            text += `Your ${actual.pai} is both dora and yakuhai — Mortal's ${expected.pai} preserves both. `;
          } else if (vp.yakuhai) {
            text += `Your ${actual.pai} is a yakuhai — Mortal's ${expected.pai} preserves it (and the option to meld for a yaku). `;
          } else if (vp.dora) {
            text += `Your ${actual.pai} is dora — Mortal's ${expected.pai} preserves the hand value. `;
          } else {
            text += `Mortal's ${expected.pai} preserves hand value (yakuhai or dora) that you discarded. `;
          }
        } else {
          text += `Mortal's pick is more efficient here. `;
        }
        text += `Recognising that both choices are safe — so the decision is pure efficiency — is itself a defense skill.`;
        return text;
      }

      let text = `<span class="trigger-line">${defenseTriggerStr().charAt(0).toUpperCase() + defenseTriggerStr().slice(1)}, but Mortal pushed — `;
      if (reason === "P1") text += `your discard would have raised shanten.</span>`;
      else if (reason === "P2") text += `your discard has worse tile acceptance.</span>`;
      else if (reason === "P3") text += `your discard gave up a yakuhai or dora.</span>`;
      else text += `Mortal accepted the risk for basic-strategy reasons.</span>`;
      if (shantenStr) text += `Your hand is at ${shantenStr}. `;
      text += `Mortal's ${expected.pai}`;
      if (expectedDealin != null) text += ` (deal-in ${pctStr(expectedDealin)}${expectedLabel ? ", " + expectedLabel : ""})`;
      text += ` is riskier than your ${actual.pai}`;
      if (actualDealin != null) text += ` (${pctStr(actualDealin)}${actualLabel ? ", " + actualLabel : ""})`;
      text += `, `;
      if (reason === "P1" && expectedStat && actualStat) {
        text += `but your pick raises shanten from ${catData.best_shanten ?? expectedStat.shanten} to ${catData.actual_shanten ?? actualStat.shanten} — a fundamental setback. `;
      } else if (reason === "P2" && expectedStat && actualStat) {
        text += `but ${expected.pai} keeps ${tileCountStr(expectedStat)} acceptance vs only ${tileCountStr(actualStat)} for ${actual.pai}. `;
      } else if (reason === "P3") {
        const vp = catData.value_preserve || {};
        if (vp.dora && vp.yakuhai) {
          text += `but your ${actual.pai} is both dora and yakuhai — ${expected.pai} preserves both. `;
        } else if (vp.yakuhai) {
          text += `but your ${actual.pai} is a yakuhai — ${expected.pai} preserves the yaku and the option to meld for speed. `;
        } else if (vp.dora) {
          text += `but your ${actual.pai} is dora — ${expected.pai} preserves the hand value. `;
        } else {
          text += `but ${expected.pai} preserves a yakuhai or dora that your ${actual.pai} gave up. `;
        }
      } else {
        text += `but pure tile efficiency favors pushing here. `;
      }
      text += `The lost speed on your discard outweighs the deal-in risk on Mortal's.`;
      return text;
    }

    // --- D3: Complex (Mortal took the riskier tile, not explained by basic strategy) ---
    if (cat === "D3") {
      const bothSafe = catData.both_safe === true;

      if (bothSafe) {
        let text = `<span class="trigger-line">An opponent is in riichi, but both your pick and Mortal's are 100% safe.</span>`;
        if (shantenStr) text += `Your hand is at ${shantenStr}. `;
        text += `Mortal preferred ${expected.pai} over your ${actual.pai}, and basic tile efficiency doesn't explain why — likely a hand-shape, yaku-potential, or wait-quality read. `;
        text += `Noticing that both tiles are safe, so the choice is about hand building rather than survival, is itself a defense skill.`;
        return text;
      }

      let text = `<span class="trigger-line">${defenseTriggerStr().charAt(0).toUpperCase() + defenseTriggerStr().slice(1)}. Mortal chose a more dangerous tile, and basic tile efficiency doesn't explain why.</span>`;
      if (shantenStr) text += `Your hand is at ${shantenStr}. `;
      text += `Mortal's ${expected.pai}`;
      if (expectedDealin != null) text += ` (deal-in ${pctStr(expectedDealin)}${expectedLabel ? ", " + expectedLabel : ""})`;
      text += ` is riskier than your ${actual.pai}`;
      if (actualDealin != null) text += ` (${pctStr(actualDealin)}${actualLabel ? ", " + actualLabel : ""})`;
      text += `. Mortal is weighing hand value, yaku potential, or score-situation factors that the tile-efficiency calculator can't see.`;
      return text;
    }

    // --- P1: Shanten Failure ---
    if (cat === "P1") {
      let text = `<span class="trigger-line">Your discard increased shanten (from ${catData.best_shanten} to ${catData.actual_shanten}).</span>`;
      text += `This is a fundamental mistake — always maintain or reduce shanten to stay on track toward winning.`;
      if (shantenStr) text += ` Your hand is at ${shantenStr}.`;
      if (expectedStat && actualStat) {
        text += ` Discarding ${expected.pai} keeps shanten at ${catData.best_shanten} with ${tileCountStr(expectedStat)} acceptance,`;
        text += ` while your ${actual.pai} raises it to ${catData.actual_shanten}.`;
      }
      return text;
    }

    // --- P2: Tile Efficiency ---
    if (cat === "P2") {
      let trigger = `Your tile has worse acceptance (ukeire) than Mortal's choice`;
      if (bestDiscard && bestDiscard === expected.pai?.replace(/r$/, "")) trigger += ` — both Mortal and calculator agree`;
      trigger += `.`;
      let text = shantenWarning;
      text += `<span class="trigger-line">${trigger}</span>`;
      if (shantenStr) text += `Your hand is at ${shantenStr}. `;
      if (expectedStat && actualStat) {
        text += `Discarding ${expected.pai} gives ${tileCountStr(expectedStat)} acceptance`;
        text += ` vs ${tileCountStr(actualStat)} for your ${actual.pai}.`;
      }
      text += ` Maximize your tile acceptance to reach tenpai as fast as possible.`;
      return text;
    }

    // --- P3: Hand Value (reintroduced 2026-04-20) ---
    if (cat === "P3") {
      const vp = (m.categorize_data || {}).value_preserve || {};
      let text = shantenWarning;
      const trigger = vp.similar_acceptance
        ? `Similar tile acceptance, but Mortal is preserving hand value.`
        : `Mortal is preserving hand value.`;
      text += `<span class="trigger-line">${trigger}</span>`;
      if (shantenStr) text += `Your hand is at ${shantenStr}. `;
      if (expectedStat && actualStat) {
        text += `${expected.pai}: ${tileCountStr(expectedStat)} vs ${actual.pai}: ${tileCountStr(actualStat)}. `;
      }
      if (vp.dora && vp.yakuhai) {
        text += `Your discard ${actual.pai} is <strong>both dora and yakuhai</strong> — it raises hand score and gives you a yaku.`;
        text += ` Yakuhai also gives the option to meld for that one yaku, which can greatly speed up the hand.`;
      } else if (vp.yakuhai) {
        text += `Your discard ${actual.pai} is a yakuhai (value honor) — keeping it means more points if you win.`;
        text += ` It's also possible to meld the hand for that yakuhai, giving the option of greatly speeding up the hand.`;
      } else if (vp.dora) {
        text += `Your discard ${actual.pai} is dora — holding it preserves hand value.`;
      } else {
        // Legacy data without value_preserve: fall back to the label hint.
        if (labels.includes("yakuhai")) {
          text += `A yakuhai (value honor) is involved — keeping it means more points if you win.`;
        } else if (labels.includes("dora")) {
          text += `Dora is involved — holding it preserves hand value.`;
        } else {
          text += `When tile acceptance is close, prioritize the discard that leads to a higher-scoring hand.`;
        }
      }
      return text;
    }

    // --- P4: Complex Decision ---
    if (cat === "P4") {
      let text = shantenWarning;
      text += `<span class="trigger-line">Mortal and calculator genuinely disagree on the best discard — often a score or yaku tradeoff the calculator can't see.</span>`;
      if (shantenStr) text += `Your hand is at ${shantenStr}. `;
      if (bestDiscard && bestDiscard !== expected.pai) {
        const bestEntry = statFor(bestDiscard);
        text += `Calculator recommends ${bestDiscard}`;
        if (bestEntry) text += ` (${tileCountStr(bestEntry)})`;
        text += `, but Mortal prefers ${expected.pai}. `;
        text += `Mortal sees strategic value beyond tile counting — `;
        const factors = [];
        if (labels.includes("yakuhai") || labels.includes("dora")) factors.push("hand value optimization");
        if (m.board_state && m.board_state.scores) factors.push("score situation");
        factors.push("hand shape", "yaku potential");
        text += `${factors.slice(0, 3).join(", ")}.`;
      } else {
        text += `Mortal recommends ${expected.pai} over your ${actual.pai} — a judgment call beyond pure efficiency.`;
      }
      return text;
    }

    // --- Legacy categories (1A/2A/3A/3B/3C) for old data ---

    // 1A: Pure efficiency (legacy)
    if (cat === "1A") {
      let text = shantenWarning;
      text += `This is a pure tile efficiency mistake — both Mortal and the calculator agree on the best discard.`;
      if (shantenStr) text += ` Your hand is at ${shantenStr}.`;
      if (expectedStat && actualStat) {
        text += ` Discarding ${expected.pai} gives you ${tileCountStr(expectedStat)} acceptance`;
        text += ` vs ${tileCountStr(actualStat)} for your ${actual.pai}.`;
      } else if (expectedStat) {
        text += ` Discarding ${expected.pai} gives you ${tileCountStr(expectedStat)} acceptance for maximum hand progress.`;
      }
      text += ` At this point, getting to tenpai as fast as possible is the priority — count your tile acceptance and choose the discard that keeps the most outs.`;
      return text;
    }

    // 2A: Value tile ordering
    if (cat === "2A") {
      let text = shantenWarning;
      text += `Both discards have similar tile efficiency, but Mortal prefers keeping one for strategic value.`;
      if (shantenStr) text += ` Your hand is at ${shantenStr}.`;

      const actualIsValue = _isValueTileMjai(actual.pai);
      const expectedIsValue = _isValueTileMjai(expected.pai);

      if (labels.includes("yakuhai")) {
        text += ` One of the tiles involved is a yakuhai (value honor)`;
        const bs = m.board_state;
        if (bs) {
          const winds = [];
          if (bs.round_wind) winds.push(`round wind: ${bs.round_wind}`);
          if (bs.seat_wind) winds.push(`seat wind: ${bs.seat_wind}`);
          if (winds.length) text += ` (${winds.join(", ")})`;
        }
        text += ` — keeping it means the hand is worth more points if you win with it.`;
      } else if (labels.includes("dora")) {
        text += ` One tile is dora or adjacent to dora — holding it preserves hand value.`;
      } else if (actualIsValue && !expectedIsValue) {
        text += ` You discarded the value tile (${actual.pai}), but Mortal wanted to keep it for hand value potential.`;
      } else if (!actualIsValue && expectedIsValue) {
        text += ` Mortal recommends discarding the less valuable ${expected.pai} to preserve your hand's scoring potential.`;
      }

      if (expectedStat && actualStat) {
        text += ` The calculator sees these as similar (${tileCountStr(expectedStat)} vs ${tileCountStr(actualStat)}), but Mortal weighs the hand value difference.`;
      }
      text += ` When tile acceptance is close, prioritize keeping tiles that add han (yaku value) to your hand.`;
      return text;
    }

    // 3B: Defense
    if (cat === "3B") {
      const threateningOpp = catData.threatening_opponent;
      let text = "";
      if (hasRiichi && threateningOpp) {
        text = `An opponent is in riichi and another has 3+ open calls — multiple threats demand a defensive approach.`;
      } else if (hasRiichi) {
        text = `An opponent is in riichi, and this is a defense-oriented decision.`;
      } else if (threateningOpp) {
        text = `An opponent has 3+ open calls, signaling a fast, threatening hand. Mortal chooses a safer discard.`;
      } else {
        text = `This is a defense-oriented decision.`;
      }
      if (shantenStr) text += ` Your hand is at ${shantenStr}.`;
      text += ` Mortal recommends ${expected.pai}`;
      if (expectedSafety != null) text += ` (safety: ${expectedSafety.toFixed ? expectedSafety.toFixed(0) : expectedSafety}, ${safetyLabel(expectedSafety)})`;
      text += ` over your ${actual.pai}`;
      if (actualSafety != null) text += ` (safety: ${actualSafety.toFixed ? actualSafety.toFixed(0) : actualSafety}, ${safetyLabel(actualSafety)})`;
      text += `.`;

      if (bestDiscard && bestDiscard !== expected.pai) {
        text += ` The calculator, which doesn't consider defense, would prefer ${bestDiscard} for pure efficiency.`;
        text += ` But Mortal overrides this because surviving is more important than hand progress when someone is threatening to win.`;
      } else {
        text += ` When an opponent declares riichi, tile safety becomes critical — prioritize tiles already in their discard pool (100% safe), then suji-safe tiles, before considering efficiency.`;
      }
      return text;
    }

    // 3A: Complex/strategic decision
    if (cat === "3A") {
      let text = shantenWarning;
      text += `This is a complex strategic decision where Mortal and the calculator disagree.`;
      if (shantenStr) text += ` Your hand is at ${shantenStr}.`;

      if (bestDiscard && bestDiscard !== expected.pai) {
        text += ` The calculator recommends ${bestDiscard} for maximum tile efficiency`;
        const bestEntry = statFor(bestDiscard);
        if (bestEntry) text += ` (${tileCountStr(bestEntry)})`;
        text += `, but Mortal prefers ${expected.pai}.`;
        text += ` This means Mortal is considering factors beyond pure tile counting — things like`;
        const factors = [];
        if (hasRiichi) factors.push("opponent riichi pressure");
        if (labels.includes("yakuhai") || labels.includes("dora")) factors.push("hand value optimization");
        if (m.board_state && m.board_state.scores) factors.push("score situation");
        factors.push("hand shape flexibility", "yaku potential");
        text += ` ${factors.slice(0, 3).join(", ")}.`;
      } else if (bestDiscard && bestDiscard === expected.pai) {
        text += ` Both Mortal and the calculator agree on ${expected.pai}, but you chose ${actual.pai}.`;
        if (expectedStat && actualStat) {
          text += ` The efficiency difference: ${tileCountStr(expectedStat)} vs ${tileCountStr(actualStat)}.`;
        }
      } else {
        text += ` Mortal recommends ${expected.pai} over your ${actual.pai} — this likely involves judgment about hand direction, yaku potential, or game state factors that go beyond simple tile counting.`;
      }
      text += ` You chose ${actual.pai} instead. These strategic decisions are the hardest to learn — they require reading the game state holistically.`;
      return text;
    }

    // Uncategorized discard vs discard
    let text = `Mortal recommends discarding ${expected.pai} instead of your ${actual.pai}.`;
    if (shantenStr) text += ` Your hand is at ${shantenStr}.`;
    if (expectedStat && actualStat) {
      text += ` Calculator: ${tileCountStr(expectedStat)} acceptance for ${expected.pai} vs ${tileCountStr(actualStat)} for ${actual.pai}.`;
    }
    if (m.top_actions && m.top_actions.length >= 2) {
      text += ` Mortal's EV: ${m.top_actions[0].q_value.toFixed(2)} for the best play vs ${(mortalFor(actual.pai)?.q_value || m.top_actions[m.top_actions.length - 1].q_value).toFixed(2)} for yours.`;
    }
    return text;
  }

  // Fallback
  return `Mortal recommends ${formatAction(expected)} instead of your ${formatAction(actual)}. The EV difference of ${m.ev_loss.toFixed(2)} suggests this was a meaningful mistake.`;
}

// Detect easy-to-spot closed-hand yaku from a riichi mistake's hand tiles.
// Returns a list of yaku name strings (may be empty). Used by 5A explanation
// to indicate when dama can win without the riichi yaku.
function detectClosedHandYaku(m) {
  const hand = m.hand || [];
  if (!hand.length) return [];
  const yaku = [];
  const bases = hand.map(tileBase);

  // Tanyao: no terminals, no honors
  const hasTerminalOrHonor = bases.some(t =>
    "ESWNPFC".includes(t) || /^[19][mps]$/.test(t)
  );
  if (!hasTerminalOrHonor) yaku.push("tanyao");

  // Suit purity (honitsu / chinitsu): only one of m/p/s present
  const suits = new Set();
  let hasHonor = false;
  for (const t of bases) {
    if ("ESWNPFC".includes(t)) hasHonor = true;
    else if (t.endsWith("m")) suits.add("m");
    else if (t.endsWith("p")) suits.add("p");
    else if (t.endsWith("s")) suits.add("s");
  }
  if (suits.size === 1 && !hasHonor) yaku.push("chinitsu");
  else if (suits.size === 1 && hasHonor) yaku.push("honitsu");

  // Yakuhai pair-or-better: 2+ of dragons or wind matching round/seat
  const bs = m.board_state || {};
  const counts = {};
  for (const t of bases) counts[t] = (counts[t] || 0) + 1;
  for (const dragon of ["P", "F", "C"]) {
    if ((counts[dragon] || 0) >= 2) {
      yaku.push(`yakuhai (${dragon === "P" ? "haku" : dragon === "F" ? "hatsu" : "chun"})`);
    }
  }
  for (const wind of ["E", "S", "W", "N"]) {
    if ((counts[wind] || 0) >= 2 && (wind === bs.round_wind || wind === bs.seat_wind)) {
      const which = (wind === bs.round_wind && wind === bs.seat_wind) ? "double wind"
                    : wind === bs.round_wind ? "round wind" : "seat wind";
      yaku.push(`yakuhai (${which})`);
    }
  }
  return yaku;
}

// EV-loss driven tier — display-only; backend severity string is ignored.
function sevTier(evLoss) {
  const ev = evLoss == null ? 0 : evLoss;
  if (ev > 1.0) return "severe";
  if (ev >= 0.5) return "mistake";
  if (ev >= 0.2) return "light";
  return "unsure";
}

var TIER_LABEL = {
  severe: "Severe",
  mistake: "Mistake",
  light: "Light",
  unsure: "Unsure",
};

var TIER_CLASS = {
  severe: "sev-major",
  mistake: "sev-medium",
  light: "sev-light",
  unsure: "sev-minor",
};

var TIER_TOOLTIP = {
  severe: "Severe — Mortal EV gap >1.0",
  mistake: "Mistake — Mortal EV gap 0.5–1.0",
  light: "Light — Mortal EV gap 0.2–0.5",
  unsure: "Unsure — Mortal EV gap <0.2 (AI not confident)",
};

function sevClass(m) {
  const ev = typeof m === "object" && m !== null ? m.ev_loss : null;
  return TIER_CLASS[sevTier(ev)] || "";
}

function sevLabel(m) {
  const ev = typeof m === "object" && m !== null ? m.ev_loss : null;
  return TIER_LABEL[sevTier(ev)] || "";
}

function sevTooltip(m) {
  const ev = typeof m === "object" && m !== null ? m.ev_loss : null;
  return TIER_TOOLTIP[sevTier(ev)] || "";
}
