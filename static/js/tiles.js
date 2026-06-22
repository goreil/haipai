// Tile rendering primitives + tile-category predicates.
//
// CS-06 home: the tile-category predicates (_isValueTileMjai etc.) live here
// as the canonical JS-side mirror of lib/tiles.py's is_honor_mjai /
// _is_terminal_mjai / _is_value_tile_mjai. Same logic, two languages — kept
// in sync by hand. If you add a predicate on the Python side, mirror it here.

// Suit letter ('m'|'p'|'s') -> display name + representative tile.
// Read by board-yaku-panel.js's pill renderers (sanshoku / ittsuu / honitsu
// chips). Kept here so both that file and any future board-* sibling share
// one definition.
var SUIT_NAME = { m: "man", p: "pin", s: "sou" };
var SUIT_TILE = { m: "1m", p: "1p", s: "1s" };

// mjai notation -> SVG filename
var TILE_FILE = {
  "1m": "Man1", "2m": "Man2", "3m": "Man3", "4m": "Man4", "5m": "Man5",
  "6m": "Man6", "7m": "Man7", "8m": "Man8", "9m": "Man9", "5mr": "Man5-Dora",
  "1p": "Pin1", "2p": "Pin2", "3p": "Pin3", "4p": "Pin4", "5p": "Pin5",
  "6p": "Pin6", "7p": "Pin7", "8p": "Pin8", "9p": "Pin9", "5pr": "Pin5-Dora",
  "1s": "Sou1", "2s": "Sou2", "3s": "Sou3", "4s": "Sou4", "5s": "Sou5",
  "6s": "Sou6", "7s": "Sou7", "8s": "Sou8", "9s": "Sou9", "5sr": "Sou5-Dora",
  "E": "Ton", "S": "Nan", "W": "Shaa", "N": "Pei",
  "P": "Haku", "F": "Hatsu", "C": "Chun",
};

function tileSrc(t) {
  const name = TILE_FILE[t];
  return name ? `/tiles/${name}.svg` : `/tiles/Back.svg`;
}

// Active-dora set helper. Reads the resolved dora list off the canonical
// BoardState (static/js/prep/prep-board-state.js emits dora_tiles alongside
// dora_indicators).
function getDoraTiles(boardState) {
  if (!boardState || !boardState.dora_tiles) return new Set();
  return new Set(boardState.dora_tiles);
}

// Strip the red-five suffix. The only `r`-suffixed mjai tiles in the wild are
// 5mr/5pr/5sr, so this is exactly the red→base mapping for those — and a no-op
// for everything else. Canonical home; categorize.js keeps a private copy
// (identical logic) so it can load standalone in a vm context.
function tileBase(t) {
  if (!t) return t;
  return t.endsWith("r") ? t.slice(0, -1) : t;
}

// Ambient active-dora set. Set once per card/board render via setActiveDora();
// renderTile() then auto-highlights every dora tile it draws, so all tile
// visualizations — current and future — mark dora without threading a doraTiles
// set through each call site. This is the single source of truth for the
// dora-highlight class; no caller should add it by hand.
//
// Red fives are dora intrinsically and highlight regardless of this set.
// Reference glyphs that aren't themselves a held dora tile opt out via their
// class: the dora *indicator* (.dora-indicator — it points at the dora, it
// isn't one), the round/seat wind badges (.wind-tile), and the opponent yaku
// panel's representative tiles (.no-dora).
var _activeDora = new Set();

function setActiveDora(doraTiles) {
  _activeDora = doraTiles instanceof Set ? doraTiles : new Set(doraTiles || []);
}

// True when a tile is an active dora: a red five (always) or a tile whose base
// sits in the current active-dora set.
function tileIsActiveDora(t) {
  if (!t) return false;
  if (t === "5mr" || t === "5pr" || t === "5sr") return true;
  return _activeDora.has(tileBase(t));
}

// extraClass tokens that suppress the automatic dora-highlight (reference glyphs
// + an already-present highlight, so we never double-add).
var _DORA_OPT_OUT = /(^|\s)(no-dora|dora-indicator|wind-tile|dora-highlight)(\s|$)/;

function renderTile(t, extraClass = "", titleOverride = null, extraAttrs = "") {
  let cls = ["tile", extraClass].filter(Boolean).join(" ");
  if (!_DORA_OPT_OUT.test(extraClass) && tileIsActiveDora(t)) {
    cls += " dora-highlight";
  }
  const title = titleOverride || t;
  const attrs = extraAttrs ? " " + extraAttrs : "";
  return `<img class="${cls}" src="${tileSrc(t)}" alt="${t}" title="${title}" data-tile="${tileBase(t)}"${attrs}>`;
}

function renderBackTile(cls = "action-tile-sm") {
  return `<img class="tile ${cls}" src="/tiles/Back.svg" alt="?" title="hidden">`;
}

// Render ukeire tiles compactly: one SVG per tile kind with a ×N count badge.
// Used inline in the EV table, directly below the relevant pick row. Dora
// acceptance tiles highlight automatically via renderTile's active-dora set
// (set by the surrounding card render) — red copies use the "5xr" SVG, which is
// dora intrinsically.
function renderUkeireTiles(tiles) {
  if (!tiles || !tiles.length) return "";
  const TILE_ORDER = {};
  ["1m","2m","3m","4m","5m","6m","7m","8m","9m",
   "1p","2p","3p","4p","5p","6p","7p","8p","9p",
   "1s","2s","3s","4s","5s","6s","7s","8s","9s",
   "E","S","W","N","P","F","C"].forEach((t, i) => { TILE_ORDER[t] = i; });
  const sorted = [...tiles].sort((a, b) =>
    (TILE_ORDER[tileBase(a.tile)] ?? 99) - (TILE_ORDER[tileBase(b.tile)] ?? 99)
  );
  // Split a five acceptance into regular + red chips when a red copy is still
  // live (aka_count, emitted by the shanten kernels). The red chip uses the
  // "5xr" SVG and is always dora-highlighted; the regular chip shows the
  // remaining non-red copies (suppressed when all live copies are red).
  const units = [];
  for (const t of sorted) {
    const aka = t.aka_count || 0;
    if (aka > 0) {
      const plain = t.count - aka;
      if (plain > 0) units.push({ tile: t.tile, count: plain });
      units.push({ tile: t.tile + "r", count: aka, isRed: true });
    } else {
      units.push({ tile: t.tile, count: t.count });
    }
  }
  let html = "";
  for (const u of units) {
    html += `<span class="ukeire-chip" title="${u.tile}: ${u.count} left">`;
    html += renderTile(u.tile, "tile-sm ukeire-tile-img");
    html += `<span class="ukeire-chip-count">×${u.count}</span>`;
    html += `</span>`;
  }
  return html;
}

// --- Tile-category predicates (CS-06) ---
// JS mirrors of lib/tiles.py predicates. Keep in sync with the Python side.

// Honor: winds (E/S/W/N) + dragons (P/F/C).
function _isHonorMjai(tile) {
  if (!tile) return false;
  return "ESWNPFC".includes(tile);
}

// Terminal: 1 or 9 of any number suit.
function _isTerminalMjai(tile) {
  if (!tile) return false;
  return /^[19][mps]$/.test(tile);
}

// Value tile: honors and terminals (yakuhai / terminal-pair candidates).
// Narrower than the Python `_is_value_tile_mjai` which only flags yakuhai —
// the JS-side use site (categorize-explanations builder) wants the
// broader "edge tile" notion.
function _isValueTileMjai(tile) {
  if (!tile) return false;
  if (_isHonorMjai(tile)) return true;
  if (_isTerminalMjai(tile)) return true;
  return false;
}
