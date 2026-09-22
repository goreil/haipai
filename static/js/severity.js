// EV-loss based severity tiers.
//
// Display-only: drives the per-mistake severity badge (mistake-card,
// game-list). Fixed game rankings live in game-render.js.
// The backend `sev` string ("?"/"??"/"???"/"!") is independent and surfaces
// via the server-side `by_severity` aggregates in db/games.py; nothing in
// this module reads it.

// Map a mistake's EV loss to a UI tier name.
// Thresholds were calibrated against the DB-wide ev_loss distribution:
// 0.2 ≈ the noise floor where Mortal stops disagreeing strongly; 0.5 = a
// real misplay; 1.0+ = a turn-defining miss. Re-tune at the bottom of this
// file if the distribution shifts after a categorizer rules change.
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

// Cumulative severity ordering, most → least severe. The filter slider exposes a
// single threshold (state.sevLevel): a tier is shown when its rank <= the level.
var SEV_ORDER = ["severe", "mistake", "light", "unsure"];
function sevRank(tier) {
  var i = SEV_ORDER.indexOf(tier);
  return i < 0 ? 0 : i;
}

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
