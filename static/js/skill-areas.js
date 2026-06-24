// Skill-area metadata for the Trends page.
//
// The Trends page rolls every mistake category up into one of five "skill
// areas" (attack, defense, meld, riichi, kan) — each with its own
// decision-count denominator so per-area EV/D bars are comparable. The
// metadata (display order, color, situational copy, study reference) lives
// here so every chunk of the Trends page (trends-charts.js,
// trends-analysis.js, trends-view.js) reads from a single canonical place.
//
// As of mistake-dimensions CORE Phase 3 the category-code registry is gone.
// trendSkillAreaFor now maps a facet key to a skill area without CATEGORY_INFO:
// live data keys are action codes (4*/5*/6*); historical snapshot by_category
// rollups still carry the retired P/D/OD codes, so the legacy-prefix map below
// keeps those snapshots classifiable until EXTRAS-C rebuilds trends.

var TREND_SKILL_AREAS = [
  { label: "Attack",  key: "attack",  color: "#4a9eff",
    situation: "no opponent is in riichi and your hand can still move forward",
    intro: "Turns where no opponent is in riichi and your hand can still move forward. Tile efficiency, hand value, and deeper strategic reads live here.",
    study: "Riichi Book Ch 3-6" },
  { label: "Defense", key: "defense", color: "#ff6b6b",
    situation: "an opponent is in riichi",
    intro: "Turns where an opponent is in riichi. The metric is how much value you give up by pushing a dangerous tile or misreading the danger pool.",
    study: "Riichi Book Ch 8" },
  { label: "Open Defense", short: "Open D", key: "open_defense", color: "#f5b342",
    situation: "a non-riichi opponent's open hand is threatening",
    intro: "Turns where no one has declared riichi but an opponent's open hand has tripped the open-threat trigger (2+ open calls). The metric mirrors Defense — deal-in rate against that silent-tenpai pressure.",
    study: "Riichi Book Ch 8.2-8.4" },
  { label: "Meld",    key: "meld",    color: "#ee5fa7",
    situation: "a chi or pon was available",
    intro: "Turns where a chi or pon was available. Calling trades hand value and defensive options for speed — getting this wrong leaks EV in either direction.",
    study: "Riichi Book Ch 9" },
  { label: "Riichi",  key: "riichi",  color: "#a855f7",
    situation: "you could declare riichi",
    intro: "Turns where you could declare riichi, or chose to. Locks your hand in exchange for the han bonus, ippatsu odds, and ura-dora — at the cost of flexibility.",
    study: "Riichi Book Ch 7" },
  { label: "Kan",     key: "kan",     color: "#22c55e",
    situation: "an ankan or shouminkan was available",
    intro: "Turns where an ankan or shouminkan was available. Declaring exposes a new dora and raises opponents' hand ceilings — rarely worth the tempo.",
    study: "Riichi Book Ch 9.3" },
];

// Minimum decisions in denominator before a skill area is eligible for
// weakness ranking. Guards low-volume areas (especially kan) against
// one-off spikes.
var TREND_MIN_DECISIONS = 20;

// Skill-area key for a facet key. Accepts a skill-area key directly (live
// {skillArea} pass-through), an action code (4*/5*/6* → meld/riichi/kan), or a
// retired dahai code (P*/3* → attack, D* → defense, OD* → open_defense) so
// historical snapshot rollups still classify.
function trendSkillAreaFor(cat) {
  if (!cat) return null;
  if (SKILL_AREA_INFO && SKILL_AREA_INFO[cat]) return cat;  // already a skill-area key
  if (cat.startsWith("OD")) return "open_defense";
  if (cat.startsWith("D")) return "defense";
  if (cat[0] === "P" || cat[0] === "1" || cat[0] === "2" || cat[0] === "3") return "attack";
  if (cat[0] === "4") return "meld";
  if (cat[0] === "5") return "riichi";
  if (cat[0] === "6") return "kan";
  return null;
}

function trendSkillAreaInfo(key) {
  return TREND_SKILL_AREAS.find(a => a.key === key);
}
