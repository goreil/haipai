// Mistake presentation metadata: the skill-area + shape registry plus the
// small helpers that turn a categorize result into UI strings.
//
// As of mistake-dimensions CORE Phase 3 the legacy category-code layer
// (CATEGORY_INFO / P1-P4 / D1-D3 / OD*) is gone. A mistake is now
// `{ skillArea, shape, wins, category? }`:
//   - skillArea — attack / defense / open_defense / meld / riichi / kan, from
//     the scene classifier (prep/parse.js::skill_area_for_entry).
//   - shape — obvious / trade-off / complex (dahai only; "n/a" otherwise),
//     derived from the win-vector topology (compare-dimensions.js).
//   - category — survives ONLY for action decisions (4A-4C meld, 5A/5B riichi,
//     6A/6B kan); those carry no shape, so their action code names the call.
//
// Severity-tier logic (sevTier / sevClass / sevLabel / sevTooltip) lives in
// static/js/severity.js — load that file separately. This module is
// load-order canonical: every other categorize-* module reads from here, so it
// must load before them.

// Skill area → display label + outline/badge color. Colors carried over from
// the retired GROUP_COLORS so the card outlines look identical.
var SKILL_AREA_INFO = {
  attack:       { label: "Attack",       color: "#4a9eff" },
  defense:      { label: "Defense",      color: "#ff6b6b" },
  // Open Defense owns amber-gold; Meld owns pink — the two warm zones stay
  // distinct (see style-theme.css --c-open-defense).
  open_defense: { label: "Open Defense", color: "#f5b342" },
  meld:         { label: "Meld",         color: "#ee5fa7" },
  riichi:       { label: "Riichi",       color: "#a855f7" },
  kan:          { label: "Kan",          color: "#22c55e" },
};

// Stored shapes stay unchanged; discard badges describe their visible evidence.
var SHAPE_INFO = {
  obvious:     { label: "Visible improvements", desc: "The badge names Mortal's visible advantages: Efficiency, Value, Safety, or a combination." },
  "trade-off": { label: "Main trade-off", desc: "The badge names one recommended direction supported by the displayed comparison." },
  complex:     { label: "Complex",   desc: "The visible stats (shanten, ukeire, value) don't explain Mortal's pick — a read on shape, wait, or score." },
  "n/a":       { label: "",          desc: "" },
};

// Action-decision labels — meld / riichi / kan carry no shape, so the action
// category names the call instead. These codes still flow on `m.category`.
var ACTION_INFO = {
  "4A": { label: "Bad Call",     desc: "Called chi/pon when you shouldn't have" },
  "4B": { label: "Missed Call",  desc: "Didn't call chi/pon when you should have" },
  "4C": { label: "Wrong Choice", desc: "Called the wrong combination" },
  "5A": { label: "Bad Riichi",   desc: "Declared riichi when you shouldn't have" },
  "5B": { label: "Missed Riichi",desc: "Didn't declare riichi when you should have" },
  "6A": { label: "Bad Kan",      desc: "Declared kan when you shouldn't have" },
  "6B": { label: "Missed Kan",   desc: "Didn't declare kan when you should have" },
};

var OUTCOME_EMOJI = { ":D": "\u{1F60E}", ":)": "\u{1F642}", ":|": "\u{1F610}", ":(": "\u{1F61E}" };

function skillAreaLabel(sa) {
  const info = SKILL_AREA_INFO[sa];
  return info ? info.label : (sa || "");
}

function skillAreaColor(sa) {
  const info = SKILL_AREA_INFO[sa];
  return info ? info.color : "#888";
}

// Presentation only: never remove a win or change the categorizer's shape.
// Shared with summary directions so the headline and its round filter agree.
function discardHeadline(wins) {
  const you = {}, better = {};
  let youCount = 0, betterCount = 0;
  let riskWinner = null, mixedRisk = false, maxRiskGap = 0, betterSpare = false;
  for (const win of wins || []) {
    if (win.suppressed || (win.winner !== "you" && win.winner !== "mortal")) continue;
    if (win.winner === "you") {
      you[win.group] = true;
      youCount++;
    } else {
      better[win.group] = true;
      betterCount++;
      if (win.dim === "safe_spare_kept") betterSpare = true;
    }
    if (win.dim === "deal_in") {
      if (riskWinner && riskWinner !== win.winner) mixedRisk = true;
      riskWinner = win.winner;
      maxRiskGap = Math.max(maxRiskGap, Number.isFinite(win.pct) ? win.pct : Infinity);
    }
  }
  if (!betterCount) return null;
  const headline = (label, desc, axis = "other") => ({ key: label, label, desc, axis });
  if (!youCount) {
    const improvements = [];
    if (better.Speed) improvements.push("Efficiency");
    if (better.Yaku || better.Dora) improvements.push("Value");
    if (better.Defense) improvements.push("Safety");
    if (!improvements.length) return null;
    const label = improvements.join(" + ");
    return headline(label, `Mortal's choice has these displayed advantages: ${label}.`);
  }
  const youValue = you.Yaku || you.Dora;
  const betterValue = better.Yaku || better.Dora;
  const speedValue = (youValue && better.Speed) || (you.Speed && betterValue);
  if (mixedRisk) {
    return headline("Safety trade-off",
      "Mortal's choice is safer against one opponent but riskier against another.", "push_fold");
  }
  // A tiny risk difference only loses headline precedence when another
  // visible trade-off can explain the recommendation. The risk stays visible.
  if (riskWinner && !(speedValue && maxRiskGap + 1e-9 < 0.5)) {
    const opposingProgress = riskWinner === "mortal" ? you.Speed || youValue : better.Speed || betterValue;
    if (opposingProgress) {
      return riskWinner === "mortal"
        ? headline("Should fold", "Mortal's choice gives up efficiency or value for lower deal-in risk.", "push_fold")
        : headline("Should push", "Mortal's choice accepts more deal-in risk for efficiency or value.", "push_fold");
    }
    return headline("Safety trade-off", "The displayed comparison trades one safety advantage for another.", "push_fold");
  }
  if (speedValue) {
    return better.Speed
      ? headline("Prioritize speed", "Mortal's choice favors efficiency over a visible value advantage.", "speed_value")
      : headline("Prioritize value", "Mortal's choice favors value over a visible efficiency advantage.", "speed_value");
  }
  if (betterSpare) {
    return headline("Prioritize safety", "Mortal's choice preserves a safer spare tile before a threat appears.");
  }
  if (better.Speed) return headline("Prioritize speed", "Mortal's choice preserves a visible efficiency advantage.");
  if (betterValue) return headline("Prioritize value", "Mortal's choice preserves a visible value advantage.");
  return null;
}

// Facet keys distinguish different headlines within the same stored shape,
// so aggregated labels cannot depend on which mistake happened to come first.
function mistakeFacet(m) {
  const act = m && m.category && ACTION_INFO[m.category];
  if (act) return { key: m.category, label: act.label, desc: act.desc };
  if (m && (m.shape === "obvious" || m.shape === "trade-off")) {
    const headline = discardHeadline(m.wins);
    return headline || { key: "", label: "", desc: "" };
  }
  const info = m && SHAPE_INFO[m.shape];
  if (info && info.label) return { key: m.shape, label: info.label, desc: info.desc };
  return { key: "", label: "", desc: "" };
}

// The existing single badge: "{skill area} / {headline-or-action}".
// skill-area color + a tooltip. Returns null when there's nothing to show
// (no skill area and no facet).
function mistakeBadge(m) {
  if (!m) return null;
  const saLabel = skillAreaLabel(m.skillArea);
  const facet = mistakeFacet(m);
  const color = skillAreaColor(m.skillArea);
  let label;
  if (saLabel && facet.label) label = `${saLabel} / ${facet.label}`;
  else label = saLabel || facet.label;
  if (!label) return null;
  return { label, color, desc: facet.desc };
}

if (typeof module === "object" && module.exports) {
  module.exports = {
    SKILL_AREA_INFO, SHAPE_INFO, ACTION_INFO,
    skillAreaLabel, skillAreaColor, discardHeadline, mistakeFacet, mistakeBadge,
  };
}
