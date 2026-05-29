// Skill-area metadata for the Trends page.
//
// The Trends page rolls every mistake category up into one of five "skill
// areas" (attack, defense, meld, riichi, kan) — each with its own
// decision-count denominator so per-area EV/D bars are comparable. The
// metadata (display order, color, situational copy, study reference) lives
// here so every chunk of trends.js (currently one file, splits in Phase 3.3)
// reads from a single canonical place.
//
// Load order: depends on `CATEGORY_INFO` (categorize-view.js → main.js
// async-loads /api/categories on boot) — but only at call time, since
// trendSkillAreaFor reads it inside the function body.

var TREND_SKILL_AREAS = [
  { label: "Attack",  key: "attack",  catGroup: "Attack",  color: "#4a9eff",
    situation: "no opponent is in riichi and your hand can still move forward",
    intro: "Turns where no opponent is in riichi and your hand can still move forward. Tile efficiency, hand value, and deeper strategic reads live here.",
    study: "Riichi Book Ch 3-6" },
  { label: "Defense", key: "defense", catGroup: "Defense", color: "#ff6b6b",
    situation: "an opponent is in riichi",
    intro: "Turns where an opponent is in riichi. The metric is how much value you give up by pushing a dangerous tile or misreading the danger pool.",
    study: "Riichi Book Ch 8" },
  { label: "Meld",    key: "meld",    catGroup: "Meld",    color: "#ffa94d",
    situation: "a chi or pon was available",
    intro: "Turns where a chi or pon was available. Calling trades hand value and defensive options for speed — getting this wrong leaks EV in either direction.",
    study: "Riichi Book Ch 9" },
  { label: "Riichi",  key: "riichi",  catGroup: "Riichi",  color: "#a855f7",
    situation: "you could declare riichi",
    intro: "Turns where you could declare riichi, or chose to. Locks your hand in exchange for the han bonus, ippatsu odds, and ura-dora — at the cost of flexibility.",
    study: "Riichi Book Ch 7" },
  { label: "Kan",     key: "kan",     catGroup: "Kan",     color: "#22c55e",
    situation: "an ankan or shouminkan was available",
    intro: "Turns where an ankan or shouminkan was available. Declaring exposes a new dora and raises opponents' hand ceilings — rarely worth the tempo.",
    study: "Riichi Book Ch 9.3" },
];

// Minimum decisions in denominator before a skill area is eligible for
// weakness ranking. Guards low-volume areas (especially kan) against
// one-off spikes.
var TREND_MIN_DECISIONS = 20;

// Skill-area key (attack/defense/meld/riichi/kan) for a mistake category code.
function trendSkillAreaFor(cat) {
  const info = CATEGORY_INFO[cat];
  if (!info) return null;
  const sa = TREND_SKILL_AREAS.find(a => a.catGroup === info.group);
  return sa ? sa.key : null;
}

function trendSkillAreaInfo(key) {
  return TREND_SKILL_AREAS.find(a => a.key === key);
}
