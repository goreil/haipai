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

// The three discard shapes (derived from the win-vector topology). "n/a" is the
// action-decision / non-dahai case — it never renders as a shape badge.
var SHAPE_INFO = {
  obvious:     { label: "Obvious",   desc: "Mortal's pick strictly dominates — pure technique, one of the more learnable spots." },
  "trade-off": { label: "Trade-off", desc: "A judgment call: your pick wins on one axis, Mortal's on another that's worth more here." },
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

function shapeLabel(shape) {
  const info = SHAPE_INFO[shape];
  return info ? info.label : "";
}

// The sub-facet that splits a skill area on the card / summary: the action
// label for action decisions, otherwise the shape label. Returns
// { key, label, desc } — `key` is stable for grouping, "" when there's nothing
// to name (rare odd combos / missed agari with no shape).
function mistakeFacet(m) {
  const act = m && m.category && ACTION_INFO[m.category];
  if (act) return { key: m.category, label: act.label, desc: act.desc };
  const info = m && SHAPE_INFO[m.shape];
  if (info && info.label) return { key: m.shape, label: info.label, desc: info.desc };
  return { key: "", label: "", desc: "" };
}

// The badge for a mistake card: "{skill area} / {shape-or-action}" with the
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
