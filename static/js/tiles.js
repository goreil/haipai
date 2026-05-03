// Tile rendering primitives + tile-category predicates.
//
// CS-06 home: the tile-category predicates (_isValueTileMjai etc.) live here
// as the canonical JS-side mirror of lib/tiles.py's is_honor_mjai /
// _is_terminal_mjai / _is_value_tile_mjai. Same logic, two languages — kept
// in sync by hand. If you add a predicate on the Python side, mirror it here.

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
// BoardState (extract_board_state in lib/categorize.py emits dora_tiles
// alongside dora_indicators using lib/tiles.py::dora_indicator_to_dora_mjai).
// CS-02: frontend no longer mirrors the indicator->dora rule.
function getDoraTiles(boardState) {
  if (!boardState || !boardState.dora_tiles) return new Set();
  return new Set(boardState.dora_tiles);
}

// Normalize tile for comparison (red five -> base tile)
function tileBase(t) {
  if (t === "5mr") return "5m";
  if (t === "5pr") return "5p";
  if (t === "5sr") return "5s";
  return t;
}

function renderTile(t, extraClass = "", titleOverride = null, extraAttrs = "") {
  const cls = ["tile", extraClass].filter(Boolean).join(" ");
  const title = titleOverride || t;
  const attrs = extraAttrs ? " " + extraAttrs : "";
  return `<img class="${cls}" src="${tileSrc(t)}" alt="${t}" title="${title}" data-tile="${tileBase(t)}"${attrs}>`;
}

function renderBackTile(cls = "action-tile-sm") {
  return `<img class="tile ${cls}" src="/tiles/Back.svg" alt="?" title="hidden">`;
}

// Render ukeire tiles compactly: one SVG per tile kind with a ×N count badge.
// Used inline in the EV table, directly below the relevant pick row.
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
  let html = "";
  for (const t of sorted) {
    html += `<span class="ukeire-chip" title="${t.tile}: ${t.count} left">`;
    html += renderTile(t.tile, "tile-sm ukeire-tile-img");
    html += `<span class="ukeire-chip-count">×${t.count}</span>`;
    html += `</span>`;
  }
  return html;
}

function normalizeRed(tile) {
  // 5mr -> 5m, 5pr -> 5p, 5sr -> 5s
  if (tile && tile.endsWith("r")) return tile.slice(0, -1);
  return tile;
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
// the JS-side use site (categorize-view explanation builder) wants the
// broader "edge tile" notion.
function _isValueTileMjai(tile) {
  if (!tile) return false;
  if (_isHonorMjai(tile)) return true;
  if (_isTerminalMjai(tile)) return true;
  return false;
}
