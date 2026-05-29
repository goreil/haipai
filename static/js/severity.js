// EV-loss based severity tiers + game-rating thresholds.
//
// Display-only: drives the per-mistake severity badge (mistake-card,
// game-list) and the per-game star rating (game-list sidebar).
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

// Per-user game-rating thresholds: top-25% / top-50% of the user's own
// ev-per-decision distribution. Defaults (0.14 / 0.19) only kick in for
// new accounts with <3 finished games — picked by sampling the live DB so
// a first-game rating still feels meaningful.
function computeThresholds(games) {
  const evpts = (games || [])
    .map(g => (g.summary || {}).ev_per_decision)
    .filter(v => v != null)
    .sort((a, b) => a - b);
  if (evpts.length < 3) return { p25: 0.14, p50: 0.19 };
  const p25 = evpts[Math.floor(evpts.length * 0.25)];
  const p50 = evpts[Math.floor(evpts.length * 0.50)];
  return { p25, p50 };
}
