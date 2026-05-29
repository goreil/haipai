// Category presentation metadata: labels, group colors, outcome emoji, and
// the small `cat*` helpers that turn a category code into UI strings.
//
// Severity-tier logic (sevTier / sevClass / sevLabel / sevTooltip) lives in
// static/js/severity.js — load that file separately. This module is
// load-order canonical: every other categorize-* module (yaku, explanations)
// reads CATEGORY_INFO from here, so it must load before them.

var CATEGORIES = [
  "", "1A",
  "2A",
  "3A", "3B", "3C",
  "4A", "4B", "4C",
  "5A", "5B",
  "6A", "6B",
];

// Loaded from /api/categories on init (see main.js).
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
