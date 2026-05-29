// Board context rendering: hand row, melds, discards-by-seat, dora bar,
// scores, tenpai-wait row.

var WIND_DISPLAY = { "E": "East", "S": "South", "W": "West", "N": "North" };
var SEAT_NAMES = ["East", "South", "West", "North"];

// The player's own seat for a mistake. Most carry it on the action the player
// took (`actual.actor`), but a pass/skip decision is `actual = {type:"none"}`
// with no actor — fall back to the expected action, whose actor is still the
// player. Without this fallback, pon/chi/riichi-pass cards lose the "(you)" tag
// and (in non-East rounds) mislabel every seat's wind.
function mistakeActorSeat(m) {
  if (m && m.actual && m.actual.actor != null) return m.actual.actor;
  if (m && m.expected && m.expected.actor != null) return m.expected.actor;
  return null;
}

// Derive the dealer (oya) seat from a mistake's snapshot. Needed to convert
// an absolute seat number into the correct round-relative wind letter (E/S
// /W/N rotates every round, so seat 0 isn't always East).
function mistakeOya(m) {
  const b = m && m.board_state;
  if (!b || !b.seat_wind) return null;
  const playerSeat = mistakeActorSeat(m);
  if (playerSeat == null) return null;
  const WINDS = ["E", "S", "W", "N"];
  const pw = WINDS.indexOf(b.seat_wind);
  if (pw < 0) return null;
  return ((playerSeat - pw) % 4 + 4) % 4;
}

function renderMeld(meld, tileClass = "action-tile-sm", actorSeat, doraTiles, oya = null) {
  const type = meld.type;
  const consumed = meld.consumed || [];
  const pai = meld.pai;
  const target = meld.target;

  function meldTile(t, extra = "") {
    let cls = tileClass;
    if (doraTiles && (t === "5mr" || t === "5pr" || t === "5sr" || doraTiles.has(tileBase(t)))) cls += " dora-highlight";
    if (extra) cls += " " + extra;
    return renderTile(t, cls);
  }
  function calledTile(t) { return `<span class="meld-called">${meldTile(t)}</span>`; }

  // Relative position: 1=right, 2=across, 3=left
  let relPos = null;
  const WINDS = ["E", "S", "W", "N"];
  let windChar = "";
  if (target != null && actorSeat != null) {
    relPos = ((target - actorSeat) % 4 + 4) % 4;
    // Wind badge = the target seat's wind for THIS round, not the absolute
    // seat number. In a non-East round the dealer isn't seat 0, so mapping
    // target directly to WINDS would put the wrong letter on the meld.
    windChar = oya != null
      ? WINDS[((target - oya) % 4 + 4) % 4]
      : WINDS[target % 4];
  }
  const windSup = windChar ? `<sup class="meld-wind">${windChar}</sup>` : "";

  if (type === "ankan") {
    const tile = consumed[0] || pai || "?";
    return `<span class="meld-group">${renderBackTile(tileClass)}${meldTile(tile)}${meldTile(tile)}${renderBackTile(tileClass)}</span>`;
  }

  if (type === "chi") {
    const own = [...consumed].sort((a, b) => (parseInt(a) || 0) - (parseInt(b) || 0));
    return `<span class="meld-group">${calledTile(pai)}${own.map(t => meldTile(t)).join("")}${windSup}</span>`;
  }

  if (type === "pon") {
    const ct = calledTile(pai);
    const ot = consumed.map(t => meldTile(t));
    if (relPos === 3) return `<span class="meld-group">${ct}${ot.join("")}${windSup}</span>`;
    if (relPos === 2) return `<span class="meld-group">${ot[0]}${ct}${ot[1]}${windSup}</span>`;
    return `<span class="meld-group">${ot.join("")}${ct}${windSup}</span>`;
  }

  if (type === "daiminkan") {
    const ct = calledTile(pai);
    const ot = consumed.map(t => meldTile(t));
    if (relPos === 3) return `<span class="meld-group">${ct}${ot.join("")}${windSup}</span>`;
    if (relPos === 2) return `<span class="meld-group">${ot[0]}${ct}${ot.slice(1).join("")}${windSup}</span>`;
    return `<span class="meld-group">${ot.join("")}${ct}${windSup}</span>`;
  }

  if (type === "kakan") {
    // Added kan: pon layout with 4th tile stacked on top of the rotated called tile
    const tile = consumed[0] || pai;
    const ct = `<span class="meld-called meld-kakan">${meldTile(tile)}<span class="meld-kakan-added">${meldTile(pai)}</span></span>`;
    const t1 = meldTile(tile);
    const t2 = meldTile(tile);
    if (relPos === 3) return `<span class="meld-group">${ct}${t1}${t2}${windSup}</span>`;
    if (relPos === 2) return `<span class="meld-group">${t1}${ct}${t2}${windSup}</span>`;
    return `<span class="meld-group">${t1}${t2}${ct}${windSup}</span>`;
  }

  // Fallback
  const all = [...consumed];
  if (pai) all.push(pai);
  return `<span class="meld-group">${all.map(t => meldTile(t)).join("")}</span>`;
}

// Count the dora across a seat's melds for the "N dora" badge. Uses the same
// per-tile rule as renderMeld's dora-highlight (red fives + active dora), over
// every tile in each group: a kan counts all four (the tile is known even for
// an ankan, where renderMeld only draws two face-up). Binary per tile — a tile
// that is both a red five and the active dora counts once, not twice.
function meldDoraCount(melds, doraTiles) {
  if (!melds || !doraTiles) return 0;
  const isDora = t => t === "5mr" || t === "5pr" || t === "5sr" || doraTiles.has(tileBase(t));
  // A kakan upgrades an earlier pon of the same tile to a kan; mjai (and so
  // the stored melds) keeps both events, so skip the superseded pon to avoid
  // counting that group's dora twice.
  const kakanBases = new Set();
  for (const meld of melds) {
    if (meld.type === "kakan") kakanBases.add(tileBase((meld.consumed || [])[0] || meld.pai));
  }
  let count = 0;
  for (const meld of melds) {
    const consumed = meld.consumed || [];
    let tiles;
    if (meld.type === "ankan") {
      // mjai lists all four tiles in consumed.
      tiles = consumed;
    } else if (meld.type === "kakan") {
      // Pon upgraded to a kan: three copies of the base tile + the added pai,
      // matching what renderMeld draws.
      const base = consumed[0] || meld.pai;
      tiles = base ? [base, base, base] : [];
      if (meld.pai) tiles.push(meld.pai);
    } else if (meld.type === "pon" && kakanBases.has(tileBase(meld.pai || consumed[0]))) {
      // Superseded by a kakan of the same tile — count it once, via the kakan.
      continue;
    } else {
      // chi / pon / daiminkan: called tile + tiles from hand.
      tiles = meld.pai ? consumed.concat([meld.pai]) : consumed.slice();
    }
    for (const t of tiles) if (isDora(t)) count++;
  }
  return count;
}

function renderHand(tiles, draw, mistake, doraTiles) {
  if (!tiles || !tiles.length) return "";
  // KD-derived deal-in colouring — tooltip is "<tile> — Type · X.X%" and the
  // underline matches the EV table's green / yellow-red gradient. Skipped
  // when there's no active threat (no per_threat / dealin_rates).
  const useKd = mistake
    && mistake.dealin_rates
    && Object.keys(mistake.dealin_rates).length > 0;
  return tiles.map((t, i) => {
    let extra = "";
    let title = null;
    let extraAttrs = "";
    if (draw && i === tiles.length - 1 && t === draw) extra = "draw";
    if (useKd) {
      const rate = getFieldForTile(mistake.dealin_rates, t);
      const coarse = coarseSafetyLabelForTile(mistake, t);
      const fine = fineLabelForTile(mistake, t);
      if (rate != null && coarse) {
        const isSafe = rate === 0 || coarse === "genbutsu" || fine === "genbutsu";
        const labelText = isSafe ? "Safe" : (fine || dealinLabelText(coarse));
        title = `${t} — ${labelText} · ${rate.toFixed(1)}%`;
        if (isSafe) {
          extra += " hand-tile-safe";
        } else {
          extraAttrs = `style="border-bottom:3px solid ${dealinColor(rate)}"`;
        }
      }
    }
    if (t === "5mr" || t === "5pr" || t === "5sr" || (doraTiles && doraTiles.has(tileBase(t)))) {
      extra += " dora-highlight";
    }
    return renderTile(t, extra, title, extraAttrs);
  }).join("");
}

function renderTenpaiWaitsRow(m) {
  // Shown only when we've stored waits on the mistake — currently 5A (after
  // removing the chosen riichi tile) and 5B (after the silently-discarded
  // would-be riichi tile). Placement directly below the discards block so
  // the student can see their hand's waits against what's been thrown away.

  // For 5A/5B specifically, swap the chip strip for the rich EV-bars view
  // (yaku, han·fu, dama vs riichi for both ron and tsumo, per wait). Falls
  // through to the legacy chip strip if the bars renderer can't build —
  // e.g. open hand, missing draw, or the Riichi calculator bailed.
  if ((m.category === "5A" || m.category === "5B")
      && typeof renderBadRiichiBars === "function") {
    const bars = renderBadRiichiBars(m);
    if (bars) return bars;
  }

  const waits = tenpaiWaitTiles(m);
  if (!waits.length) return "";
  const total = waits.reduce((a, w) => a + (w.count || 0), 0);
  const furitenSet = new Set(m.furiten_tiles || []);
  const chips = waits.map(w => {
    const dead = (w.count || 0) === 0;
    const isFuriten = furitenSet.has(w.tile);
    const clsList = ["ukeire-chip"];
    if (dead) clsList.push("ukeire-chip-dead");
    if (isFuriten) clsList.push("ukeire-chip-furiten");
    return `<span class="${clsList.join(" ")}" title="${w.tile}: ${w.count} left${isFuriten ? " — furiten (already discarded)" : ""}">`
      + renderTile(w.tile, "tile-sm ukeire-tile-img")
      + `<span class="ukeire-chip-count">×${w.count}</span>`
      + `</span>`;
  }).join("");
  const label = waits.length === 1
    ? `Tenpai wait (${total} tile${total === 1 ? "" : "s"}):`
    : `Tenpai waits (${waits.length} types, ${total} tiles):`;
  return `<div class="tenpai-waits-row">
    <span class="tenpai-waits-label">${label}</span>
    <span class="tenpai-waits-tiles">${chips}</span>
  </div>`;
}

// Normalise tenpai_waits so existing code can iterate {tile, count} regardless
// of whether a mistake was written with the old flat-string format.
function tenpaiWaitTiles(m) {
  const waits = m.tenpai_waits;
  if (!Array.isArray(waits) || !waits.length) return [];
  if (typeof waits[0] === "string") return waits.map(t => ({tile: t, count: 0}));
  return waits;
}

// Yaku panel (v1.3) — a right-aside strip of pills on each opened seat's
// discard row, one pill per yaku that survives that seat's melds. `entries`
// is board_state.yaku[seat] from prep: an array of { type, state, ... }.
// Pills are green (locked, ✓) or gold (possible, ◐); each carries a hover
// detail. Yakuhai shows tile chips (locked ✓ / reachable ×N), honitsu shows
// the committable suit as a tile plus a +pip when chinitsu is still alive, and
// chanta shows a +pip when junchan is still alive.
// An opened seat with no surviving yaku gets a muted placeholder.
// Listed here in strip display order (open-hand frequency on amae-koromo);
// the actual ordering is enforced by prep/board.js's _YAKU_DISPLAY_ORDER sort.
const YAKU_META = {
  yakuhai:  { label: "Yakuhai" },
  tanyao:   { label: "Tanyao" },
  honitsu:  { label: "Honitsu" },
  sanshoku: { label: "Sanshoku" },
  toitoi:   { label: "Toitoi" },
  ittsuu:   { label: "Ittsuu" },
  chanta:   { label: "Chanta" },
};
// SUIT_NAME / SUIT_TILE moved to static/js/tiles.js.

function renderYakuhaiTiles(d) {
  let chips = "";
  for (const l of d.locked || []) {
    const note = l.note ? ` (${l.note})` : "";
    chips += `<span class="yp-tile-chip is-locked" title="Yakuhai · ${l.tile}${note}">`
      + renderTile(l.tile, "")
      + `<span class="yp-tile-count">✓</span></span>`;
  }
  for (const p of d.possible || []) {
    if (p.count < 3) continue;   // a pon needs 3 copies; below that is dead
    const note = p.note ? ` (${p.note})` : "";
    // A copy in your own hand still counts toward their triplet — discarding it
    // feeds the pon/ron — so flag it: the chip you're being warned not to throw.
    const inHand = p.inHand > 0;
    const title = inHand
      ? `${p.tile}${note}: ${p.count} live — ${p.inHand} in your hand (don't feed the pon)`
      : `${p.tile}${note}: ${p.count} left`;
    chips += `<span class="yp-tile-chip${inHand ? " yp-tile-chip-inhand" : ""}" title="${title}">`
      + renderTile(p.tile, "")
      + `<span class="yp-tile-count">×${p.count}</span></span>`;
  }
  return chips ? `<span class="yp-tiles">${chips}</span>` : "";
}

function renderHonitsuTiles(d) {
  // One tile per still-committable suit; a +pip when the no-honor chinitsu
  // finish is also reachable.
  const tiles = (d.suits || [])
    .map(s => renderTile(SUIT_TILE[s], "yp-suit-tile", SUIT_NAME[s]))
    .join("");
  const upgrade = d.chinitsuReachable
    ? `<span class="yp-upgrade" title="Chinitsu still reachable — no honor melded.">+</span>`
    : "";
  return tiles || upgrade ? `<span class="yp-tiles">${tiles}${upgrade}</span>` : "";
}

function renderChantaTiles(d) {
  // No suit/tile chips for chanta; just the green +pip (matching honitsu's
  // chinitsu marker) when the terminals-only junchan finish is still reachable.
  return d.junchanReachable
    ? `<span class="yp-tiles"><span class="yp-upgrade" title="Junchan still reachable — no honor melded.">+</span></span>`
    : "";
}

function yakuDetail(d) {
  if (d.type === "yakuhai") {
    let html = `<b>Yakuhai</b> · <span class="muted">${d.state}</span><br>`;
    html += d.state === "locked"
      ? `<span class="muted">Locked via</span> ` + (d.locked || [])
          .map(l => l.tile + (l.note ? ` (${l.note})` : "")).join(", ") + "."
      : `<span class="muted">No yakuhai meld yet.</span>`;
    const live = (d.possible || []).filter(p => p.count >= 3);
    if (live.length) {
      html += `<br><span class="muted">${d.state === "locked" ? "Other still-reachable:" : "Reachable tiles:"}</span> `;
      html += live.map(p => `${p.tile}×${p.count}`).join(" · ");
    }
    return html;
  }
  if (d.type === "chanta") {
    const title = d.junchanReachable ? "Chanta / Junchan" : "Chanta";
    return `<b>${title}</b> · <span class="muted">possible</span><br>`
      + `<span class="muted">Every meld holds a terminal or honor. Dies if a meld has none (a 2–8 run or triplet).</span><br>`
      + `Junchan upgrade: <b style="color:${d.junchanReachable ? "#9fd9a2" : "var(--text-dim)"}">`
      + `${d.junchanReachable ? "still reachable" : "dead (honor already melded)"}</b>.`;
  }
  if (d.type === "honitsu") {
    const suits = (d.suits || []).map(s => SUIT_NAME[s]).join(" / ");
    const title = d.chinitsuReachable ? "Honitsu / Chinitsu" : "Honitsu";
    return `<b>${title}</b> · <span class="muted">${d.state}</span><br>`
      + `Committable suit${(d.suits || []).length > 1 ? "s" : ""}: <b>${suits || "—"}</b>.<br>`
      + `Chinitsu upgrade: <b style="color:${d.chinitsuReachable ? "#9fd9a2" : "var(--text-dim)"}">`
      + `${d.chinitsuReachable ? "still reachable" : "dead (honor already melded)"}</b>.`;
  }
  if (d.type === "tanyao") {
    return `<b>Tanyao</b> · <span class="muted">possible</span><br>`
      + `<span class="muted">All melds are simples (2–8). Dies if a terminal or honor enters a meld.</span>`;
  }
  if (d.type === "toitoi") {
    return `<b>Toitoi</b> · <span class="muted">possible</span><br>`
      + `<span class="muted">Every meld is a triplet. Dies on any chi.</span>`;
  }
  return `<b>${(YAKU_META[d.type] || {}).label || d.type}</b>`;
}

// Sanshoku-doujun pill (v1.5). Variant B in the strip: the run number plus the
// run's start tile in each suit (opaque + green outline = melded, dim = pending,
// dim + red outline = the suit that killed the candidate). Hover lifts Variant
// D — the full three-tile sequence per suit with copies-remaining under each
// pending tile, plus a bottleneck/foot callout. States: possible (1/3, gold),
// close (2/3, orange), locked (3/3, green ✓), dead (strike + ×).
// A pending tile you hold the last copy of (0 unseen, in your hand) is a
// deal-in: amber outline + "deal-in" status, and the foot warns you not to
// discard it. The suit only dies when a tile is gone everywhere, or when two of
// its tiles are last-copies you hold (a call can pull just one).
const SANSHOKU_STATE_CHAR = { locked: "✓", close: "◐", possible: "◐", dead: "×" };
const SANSHOKU_STATE_LABEL = {
  locked: "✓ locked", close: "2/3 close", possible: "1/3 possible", dead: "× dead",
};

function renderSanshokuTiles(d) {
  // Variant B suit-tile row — the run's start tile in each suit.
  const chips = d.rows.map(row => {
    const cls = row.melded ? "yp-ss-tile done"
              : row.dead ? "yp-ss-tile dead"
              : "yp-ss-tile";
    return renderTile(row.tiles[0].tile, cls, SUIT_NAME[row.suit]);
  }).join("");
  return `<span class="yp-tiles">${chips}</span>`;
}

function sanshokuFoot(d) {
  if (d.state === "locked") {
    return `Sanshoku <b>${d.seq}</b> complete across all three suits.`;
  }
  if (d.state === "dead") {
    const r = d.rows.find(row => row.dead);
    if (!r) return "";
    if (r.deadTile) {
      return `All four <b>${r.deadTile}</b> already visible — `
        + `sequence in ${SUIT_NAME[r.suit]} impossible.`;
    }
    // Killed by two last-copies in your hand — a call pulls only one.
    const [a, b] = r.tiles.filter(t => t.dealIn).map(t => t.tile);
    return `${SUIT_NAME[r.suit]} needs both <b>${a}</b> and <b>${b}</b> from your `
      + `hand — a call takes one tile, so the run can't complete.`;
  }
  // A last-copy you hold completes the yaku if you discard it — the strongest
  // signal in the popover, so it leads over the draw-count bottleneck.
  if (d.dealInTiles && d.dealInTiles.length) {
    const lead = d.state === "close" ? "One sequence away. " : "";
    const tiles = d.dealInTiles.map(t => `<b>${t}</b>`).join(" / ");
    const multi = d.dealInTiles.length > 1;
    return `${lead}You hold the last ${tiles} — discarding `
      + `${multi ? "either" : "it"} feeds sanshoku ${d.seq}.`;
  }
  if (d.bottleneck) {
    const lead = d.state === "close" ? "One sequence away. " : "";
    return `${lead}<b>${d.bottleneck.tile}</b> bottleneck — `
      + `only ${d.bottleneck.count} cop${d.bottleneck.count === 1 ? "y" : "ies"} remain.`;
  }
  return "";   // mid/high counts get no foot text — keep the popover terse
}

function renderSanshokuDetail(d) {
  let rowsHtml = "";
  for (const row of d.rows) {
    // A last-copy you hold (0 unseen, 1+ in hand) on a still-live suit — the
    // tile you're warned not to feed. Distinct from a dead suit.
    const dealInAlive = !row.melded && !row.dead && row.tiles.some(t => t.dealIn);
    const rowLow = !row.melded && !row.dead && !dealInAlive
      && row.tiles.some(t => t.count !== null && t.count <= 2);
    const rowCls = row.melded ? "ssd-row done"
                 : row.dead ? "ssd-row dead"
                 : dealInAlive ? "ssd-row possible dealin"
                 : rowLow ? "ssd-row possible low"
                 : "ssd-row possible";
    let tilesHtml = "";
    for (const t of row.tiles) {
      const tileCls = t.zero ? "ssd-tile zero"
                    : t.dealIn ? "ssd-tile dealin"
                    : (!row.melded && t.count !== null && t.count <= 2) ? "ssd-tile low"
                    : "ssd-tile";
      // Deal-in tiles can't be drawn — show the copies you hold instead.
      const count = row.melded ? "·"
                  : t.dealIn ? String(t.inHand)
                  : String(t.count);
      tilesHtml += `<span class="${tileCls}">${renderTile(t.tile, "")}`
        + `<span class="ssd-count">${count}</span></span>`;
    }
    // A suit killed by two last-copies in hand has no single exhausted tile.
    const status = row.melded ? "✓ melded"
                 : row.dead ? (row.deadTile ? `× ${row.deadTile} out` : "× both in hand")
                 : dealInAlive ? "deal-in" : `${row.live} live`;
    rowsHtml += `<div class="ssd-suit ${row.suit}"><span class="ssd-dot"></span>${row.suit}</div>`
      + `<div class="${rowCls}"><div class="ssd-tiles">${tilesHtml}</div>`
      + `<div class="ssd-status">${status}</div></div>`;
  }
  const foot = sanshokuFoot(d);
  return `<span class="yp-detail ss-detail">`
    + `<div class="ss-detail-head"><span class="ssd-title">Sanshoku · ${d.seq}</span>`
    + `<span class="ssd-state ${d.state}">${SANSHOKU_STATE_LABEL[d.state]}</span></div>`
    + `<div class="ss-detail-rows">${rowsHtml}</div>`
    + (foot ? `<div class="ss-detail-foot">${foot}</div>` : "")
    + `</span>`;
}

function renderSanshokuPill(d) {
  return `<span class="yp ss ${d.state}" title="Sanshoku ${d.seq}">`
    + `<span class="yp-state">${SANSHOKU_STATE_CHAR[d.state]}</span>`
    + `<span class="yp-name">Sanshoku</span>`
    + `<span class="yp-seq">${d.seq}</span>`
    + renderSanshokuTiles(d)
    + renderSanshokuDetail(d)
    + `</span>`;
}

// Ittsuu pill (一気通貫). Visual twin of the sanshoku pill: same `.yp.ss`
// CSS hooks (so the close/dead/popover styling carries over), same hover
// detail layout. The differences are pivoted — one yaku per suit instead
// of per run, and rows are the three fixed runs (123/456/789) within
// that suit rather than three suits sharing a run. The strip-tile row
// shows the start tile of each run (1X, 4X, 7X).
function renderIttsuuTiles(d) {
  const chips = d.rows.map(row => {
    const cls = row.melded ? "yp-ss-tile done"
              : row.dead ? "yp-ss-tile dead"
              : "yp-ss-tile";
    return renderTile(row.tiles[0].tile, cls, `${row.start}–${row.start + 2}`);
  }).join("");
  return `<span class="yp-tiles">${chips}</span>`;
}

function ittsuuFoot(d) {
  if (d.state === "locked") {
    return `Ittsuu in <b>${SUIT_NAME[d.suit]}</b> complete (123 / 456 / 789).`;
  }
  if (d.state === "dead") {
    const r = d.rows.find(row => row.dead);
    if (!r) return "";
    const seq = `${r.start}${r.start + 1}${r.start + 2}${d.suit}`;
    if (r.deadTile) {
      return `All four <b>${r.deadTile}</b> already visible — `
        + `<b>${seq}</b> impossible.`;
    }
    const [a, b] = r.tiles.filter(t => t.dealIn).map(t => t.tile);
    return `<b>${seq}</b> needs both <b>${a}</b> and <b>${b}</b> from your `
      + `hand — a call takes one tile, so the run can't complete.`;
  }
  if (d.dealInTiles && d.dealInTiles.length) {
    const lead = d.state === "close" ? "One run away. " : "";
    const tiles = d.dealInTiles.map(t => `<b>${t}</b>`).join(" / ");
    const multi = d.dealInTiles.length > 1;
    return `${lead}You hold the last ${tiles} — discarding `
      + `${multi ? "any" : "it"} feeds ittsuu in ${SUIT_NAME[d.suit]}.`;
  }
  if (d.bottleneck) {
    const lead = d.state === "close" ? "One run away. " : "";
    return `${lead}<b>${d.bottleneck.tile}</b> bottleneck — `
      + `only ${d.bottleneck.count} cop${d.bottleneck.count === 1 ? "y" : "ies"} remain.`;
  }
  return "";
}

function renderIttsuuDetail(d) {
  let rowsHtml = "";
  for (const row of d.rows) {
    const dealInAlive = !row.melded && !row.dead && row.tiles.some(t => t.dealIn);
    const rowLow = !row.melded && !row.dead && !dealInAlive
      && row.tiles.some(t => t.count !== null && t.count <= 2);
    const rowCls = row.melded ? "ssd-row done"
                 : row.dead ? "ssd-row dead"
                 : dealInAlive ? "ssd-row possible dealin"
                 : rowLow ? "ssd-row possible low"
                 : "ssd-row possible";
    let tilesHtml = "";
    for (const t of row.tiles) {
      const tileCls = t.zero ? "ssd-tile zero"
                    : t.dealIn ? "ssd-tile dealin"
                    : (!row.melded && t.count !== null && t.count <= 2) ? "ssd-tile low"
                    : "ssd-tile";
      const count = row.melded ? "·"
                  : t.dealIn ? String(t.inHand)
                  : String(t.count);
      tilesHtml += `<span class="${tileCls}">${renderTile(t.tile, "")}`
        + `<span class="ssd-count">${count}</span></span>`;
    }
    const status = row.melded ? "✓ melded"
                 : row.dead ? (row.deadTile ? `× ${row.deadTile} out` : "× both in hand")
                 : dealInAlive ? "deal-in" : `${row.live} live`;
    // All rows share the candidate's suit; the row label distinguishes which
    // of the three fixed runs (123 / 456 / 789) we're inspecting.
    const runLabel = `${row.start}–${row.start + 2}`;
    rowsHtml += `<div class="ssd-suit ${d.suit}"><span class="ssd-dot"></span>${runLabel}</div>`
      + `<div class="${rowCls}"><div class="ssd-tiles">${tilesHtml}</div>`
      + `<div class="ssd-status">${status}</div></div>`;
  }
  const foot = ittsuuFoot(d);
  return `<span class="yp-detail ss-detail">`
    + `<div class="ss-detail-head"><span class="ssd-title">Ittsuu · ${SUIT_NAME[d.suit]}</span>`
    + `<span class="ssd-state ${d.state}">${SANSHOKU_STATE_LABEL[d.state]}</span></div>`
    + `<div class="ss-detail-rows">${rowsHtml}</div>`
    + (foot ? `<div class="ss-detail-foot">${foot}</div>` : "")
    + `</span>`;
}

function renderIttsuuPill(d) {
  return `<span class="yp ss it ${d.state}" title="Ittsuu · ${SUIT_NAME[d.suit]}">`
    + `<span class="yp-state">${SANSHOKU_STATE_CHAR[d.state]}</span>`
    + `<span class="yp-name">Ittsuu</span>`
    + `<span class="yp-seq">${d.suit}</span>`
    + renderIttsuuTiles(d)
    + renderIttsuuDetail(d)
    + `</span>`;
}

function renderYakuPill(d) {
  if (d.type === "sanshoku") return renderSanshokuPill(d);
  if (d.type === "ittsuu") return renderIttsuuPill(d);
  const meta = YAKU_META[d.type] || { label: d.type };
  const stateChar = d.state === "locked" ? "✓" : "◐";
  let tiles = "";
  if (d.type === "yakuhai") tiles = renderYakuhaiTiles(d);
  else if (d.type === "honitsu") tiles = renderHonitsuTiles(d);
  else if (d.type === "chanta") tiles = renderChantaTiles(d);
  return `<span class="yp ${d.state}" title="${meta.label}">`
    + `<span class="yp-state">${stateChar}</span>`
    + `<span class="yp-name">${meta.label}</span>`
    + tiles
    + `<span class="yp-detail">${yakuDetail(d)}</span></span>`;
}

// Dead-yakuhai pill — one compressed pill per yakuhai entry, with one
// tile chip per dead honor (pon no longer possible: unseen<2 or live<3
// and not melded). Mirrors the live yakuhai pill which packs multiple
// honors into one "Yakuhai" pill with ✓ / ×N chips; the dead variant
// shows the unseen count under each chip. Lives behind the strip's "N
// dead" toggle. Dead sanshoku/ittsuu candidates are also routed behind
// the same toggle by collectDeadPills (via their normal pill renderer,
// so the v1.5 `.ss.dead` strike-through styling carries over inside the
// expanded row).
function renderDeadYakuhaiPill(d) {
  const dead = d.dead || [];
  if (!dead.length) return "";
  let chips = "";
  let rows = "";
  for (const h of dead) {
    const noteSuffix = h.note ? ` (${h.note})` : "";
    let reason;
    if (h.unseen === 0 && h.inHand === 0) {
      reason = `All 4 copies visible. No pon possible.`;
    } else if (h.unseen === 0) {
      reason = `${4 - h.inHand} visible, ${h.inHand} in your hand. Opponent can't form a triplet.`;
    } else {
      const live = h.unseen + h.inHand;
      reason = `Only ${live} cop${live === 1 ? "y" : "ies"} left`
        + (h.inHand ? ` (${h.inHand} in your hand)` : "")
        + ` — not enough for a pon.`;
    }
    chips += `<span class="yp-tile-chip" title="${h.tile}${noteSuffix}: ${reason}">`
      + renderTile(h.tile, "")
      + `<span class="yp-tile-count">${h.unseen}</span></span>`;
    rows += `<b>${h.tile}${noteSuffix}</b> <span class="muted">${reason}</span><br>`;
  }
  const detail = `<b>Yakuhai</b> <span class="muted">dead</span><br>${rows}`;
  return `<span class="yp dead" title="Yakuhai dead">`
    + `<span class="yp-state">✗</span>`
    + `<span class="yp-name">Yakuhai</span>`
    + `<span class="yp-tiles">${chips}</span>`
    + `<span class="yp-detail">${detail}</span></span>`;
}

// Returns { pills, count } — `pills` is the HTML chunks (one compressed
// yakuhai pill + one pill per dead sanshoku/ittsuu), `count` is the
// per-yaku tally shown in the toggle ("3 dead" = three impossible yakus,
// not three pills).
function collectDeadPills(entries) {
  const pills = [];
  let count = 0;
  for (const d of entries) {
    if (d.type === "yakuhai" && Array.isArray(d.dead) && d.dead.length) {
      pills.push(renderDeadYakuhaiPill(d));
      count += d.dead.length;
    } else if ((d.type === "sanshoku" || d.type === "ittsuu") && d.state === "dead") {
      // Dead sanshoku/ittsuu candidates ride the same "N dead" toggle as
      // dead yakuhai — the pill's own `.ss.dead` styling (strike + ×) is
      // preserved by the normal renderer; only the live/dead bucket changes.
      pills.push(renderYakuPill(d));
      count += 1;
    }
  }
  return { pills, count };
}

function renderYakuStrip(entries) {
  if (!entries) return "";
  if (!entries.length) {
    return `<span class="yaku-strip">`
      + `<span class="yp yp-empty"><span class="yp-name">No yaku reachable</span></span></span>`;
  }
  // Entries routed behind the dead-toggle are skipped from the live row:
  //   - yakuhai with state='dead' (all candidates eliminated)
  //   - sanshoku / ittsuu with state='dead' (suit/run impossible)
  // collectDeadPills below picks them up.
  const liveHtml = entries
    .filter(d => !(d.type === "yakuhai" && d.state === "dead"))
    .filter(d => !((d.type === "sanshoku" || d.type === "ittsuu") && d.state === "dead"))
    .map(renderYakuPill).join("");
  const { pills: deadPills, count: deadCount } = collectDeadPills(entries);
  if (!deadPills.length) {
    return `<span class="yaku-strip">${liveHtml}</span>`;
  }
  // If every live yaku was filtered out (only dead yakuhai for this seat),
  // anchor the strip with the muted placeholder so the row isn't a bare toggle.
  const emptyHtml = liveHtml
    ? ""
    : `<span class="yp yp-empty"><span class="yp-name">No yaku reachable</span></span>`;
  const toggle = `<button type="button" class="yp-dead-toggle" aria-expanded="false"`
    + ` title="Yakus eliminated by tile count">`
    + `<span class="toggle-arrow">▸</span>`
    + `<span class="toggle-label">${deadCount} dead</span>`
    + `</button>`
    + `<span class="yp-dead-sep"></span>`;
  return `<span class="yaku-strip" data-expanded="false">`
    + `${emptyHtml}${liveHtml}${toggle}${deadPills.join("")}</span>`;
}

// Delegated click handler for the dead-yaku toggle. Strips are re-rendered on
// every mistake change, so listening on document avoids re-binding per render.
if (typeof document !== "undefined") {
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".yp-dead-toggle");
    if (!btn) return;
    const strip = btn.closest(".yaku-strip");
    if (!strip) return;
    const expanded = strip.dataset.expanded === "true";
    strip.dataset.expanded = expanded ? "false" : "true";
    btn.setAttribute("aria-expanded", String(!expanded));
  });
}

function renderBoardContext(m) {
  const b = m.board_state;
  if (!b) return "";

  // BoardState owns the wall position — `b.tiles_left` is emitted by
  // static/js/prep/board.js for every mistake. Read it from here rather
  // than counting [data-tile] DOM nodes.

  let html = `<div class="board-context">`;

  // Wind + Dora bar
  html += `<div class="board-info-bar">`;
  if (b.round_wind) {
    html += `<span class="wind-badge round-wind" title="Round wind">${renderTile(b.round_wind, "tile-sm wind-tile")}<span class="wind-label">Round</span></span>`;
  }
  if (b.seat_wind) {
    html += `<span class="wind-badge seat-wind" title="Seat wind">${renderTile(b.seat_wind, "tile-sm wind-tile")}<span class="wind-label">Seat</span></span>`;
  }
  if (b.dora_indicators && b.dora_indicators.length) {
    // CS-02: dora_tiles is the canonical resolved list emitted by
    // extract_board_state — same length/order as dora_indicators.
    const doraList = b.dora_tiles || [];
    html += `<span class="dora-section"><span class="dora-label">Dora</span>`;
    for (let i = 0; i < b.dora_indicators.length; i++) {
      const d = b.dora_indicators[i];
      const actual = doraList[i] || d;
      html += renderTile(actual, "tile-sm dora-indicator", `Dora ${actual} (from indicator ${d})`);
    }
    html += `</span>`;
  }
  html += `</div>`;

  // Build seat -> melds lookup for inline rendering
  const meldsBySeat = {};
  if (b.opponent_melds) {
    for (const om of b.opponent_melds) {
      meldsBySeat[om.seat] = om.melds;
    }
  }

  // All player discards + inline melds (collapsible).
  // Auto-expand for meld/riichi/kan mistakes, any Defense category, when
  // there's a riichi threat, or if the category is unset.
  if (b.all_discards && b.all_discards.length) {
    const hasDiscards = b.all_discards.some(d => d.discards.length > 0 || meldsBySeat[d.seat]);
    if (hasDiscards) {
      const doraTiles = getDoraTiles(b);
      const cat = m.category || "";
      const expandDiscards = !cat
                             || (Array.isArray(m.per_threat) && m.per_threat.length > 0)
                             || /^[3-6]/.test(cat) || /^D/.test(cat);
      const playerSeat = mistakeActorSeat(m);
      // Each seat's wind label rotates from the dealer (oya). We derive oya
      // from the player's absolute actor id + their stored seat wind — the
      // backend doesn't serialize oya directly.
      const WINDS = ["E", "S", "W", "N"];
      let oya = null;
      if (playerSeat != null && b.seat_wind) {
        const pw = WINDS.indexOf(b.seat_wind);
        if (pw >= 0) oya = ((playerSeat - pw) % 4 + 4) % 4;
      }
      function seatWindLabel(seat) {
        if (oya == null) return SEAT_NAMES[seat] || `P${seat}`;
        return WIND_DISPLAY[WINDS[(seat - oya + 4) % 4]];
      }
      // Sort rows so wind order is East, South, West, North regardless of
      // which absolute seat the dealer occupies.
      const sortedDiscards = oya != null
        ? [...b.all_discards].sort((a, c) =>
            ((a.seat - oya + 4) % 4) - ((c.seat - oya + 4) % 4))
        : b.all_discards;

      // Reconstruct absolute turn order from per-player discard lists. Pon
      // and daiminkan can skip the seat(s) between the discarder and the
      // caller; chi only ever comes from the player on the left, so it
      // doesn't skip anyone. Either way, the caller is encoded on the
      // called tile as `called_by` and becomes the next discarder. Without
      // this reconstruction, tiles at the same per-player index across
      // rows are not actually from the same turn — e.g. North's tile 5
      // lands after East's tile 5, since East discards first each cycle.
      const discardBySeat = new Map();
      for (const dd of sortedDiscards) discardBySeat.set(dd.seat, dd);
      const turnSeq = []; // ordered [{seat, idx}]
      {
        const ptr = new Map();
        for (const dd of sortedDiscards) ptr.set(dd.seat, 0);
        const startSeat = oya != null ? oya : (sortedDiscards[0] ? sortedDiscards[0].seat : 0);
        let cur = startSeat;
        let safety = 0;
        while (safety++ < 400) {
          const dd = discardBySeat.get(cur);
          const p = ptr.get(cur) ?? 0;
          if (dd && p < dd.discards.length) {
            turnSeq.push({ seat: cur, idx: p });
            ptr.set(cur, p + 1);
            const raw = dd.discards[p];
            const calledBy = (typeof raw === "object" && raw !== null) ? raw.called_by : undefined;
            cur = (calledBy != null) ? calledBy : (cur + 1) % 4;
          } else {
            // current seat has no (more) discards — advance to next seat
            // that still has tiles left, or stop if none remain.
            let found = null;
            for (let step = 1; step <= 4; step++) {
              const cand = (cur + step) % 4;
              const cd = discardBySeat.get(cand);
              const cp = ptr.get(cand) ?? 0;
              if (cd && cp < cd.discards.length) { found = cand; break; }
            }
            if (found == null) break;
            cur = found;
          }
        }
      }
      // Absolute turn per (seat, idx), so we can stamp data-turn on tiles
      // and reason about pre/post-riichi ordering on hover.
      const absTurnMap = new Map();
      for (let t = 0; t < turnSeq.length; t++) {
        const e = turnSeq[t];
        absTurnMap.set(`${e.seat}_${e.idx}`, t);
      }
      // For each seat's discards, the list of caller-seats that pon/kan'd
      // past this seat before their i-th discard. Empty = no skips. A seat
      // is "skipped" only when the natural E→S→W→N rotation would have
      // handed them the turn but a call jumped past them; normal turns
      // where another seat legitimately discards next are NOT skips. The
      // caller is the seat that took the called tile — i.e. the seat
      // whose discard immediately follows the skipped slot.
      const skipCallersBefore = new Map();
      for (const dd of sortedDiscards) {
        skipCallersBefore.set(dd.seat, Array.from({length: dd.discards.length}, () => []));
      }
      {
        const pending = { 0: [], 1: [], 2: [], 3: [] };
        let prevSeat = null;
        for (const e of turnSeq) {
          if (prevSeat != null) {
            let natural = (prevSeat + 1) % 4;
            while (natural !== e.seat) {
              pending[natural].push(e.seat);
              natural = (natural + 1) % 4;
            }
          }
          const row = skipCallersBefore.get(e.seat);
          if (row) row[e.idx] = pending[e.seat].slice();
          pending[e.seat] = [];
          prevSeat = e.seat;
        }
      }

      html += `<details class="all-discards"${expandDiscards ? " open" : ""}>`;

      html += `<summary>Discards</summary>`;
      for (const d of sortedDiscards) {
        const seatMelds = meldsBySeat[d.seat];
        if (!d.discards.length && !seatMelds) continue;
        const seatName = seatWindLabel(d.seat);
        const isYou = playerSeat != null && d.seat === playerSeat;
        // Two threat signals for an opponent (not you), each rendered as its
        // own orange badge and both painting the row orange:
        //  - 3+ open calls: defense code uses the same 3-meld threshold to
        //    trigger the defense gate.
        //  - 3+ dora exposed in melds: a big hand even without three calls.
        const openMeldCount = seatMelds ? seatMelds.filter(mm => mm.type !== "ankan").length : 0;
        const isMeldDanger = !isYou && openMeldCount >= 3;
        const meldDora = !isYou ? meldDoraCount(seatMelds, doraTiles) : 0;
        const isDoraDanger = meldDora >= 3;
        const isDanger = isMeldDanger || isDoraDanger;
        const isRiichiOpp = !isYou && d.riichi_idx != null;
        let rowCls = "discard-row";
        if (isYou) rowCls += " you-row";
        if (isDanger) rowCls += " danger-row";
        if (isRiichiOpp) rowCls += " riichi-row";
        html += `<div class="${rowCls}">`;
        html += `<span class="discard-label">${seatName}`;
        if (isYou) html += `<span class="you-tag">(you)</span>`;
        if (isRiichiOpp) html += `<span class="riichi-tag">RIICHI</span>`;
        if (isMeldDanger) html += `<span class="danger-tag" title="${openMeldCount} open calls">⚠ ${openMeldCount} melds</span>`;
        if (isDoraDanger) html += `<span class="danger-tag" title="${meldDora} dora exposed in melds">⚠ ${meldDora} dora</span>`;
        html += `</span>`;
        html += `<span class="tiles">`;
        const seatSkipCallers = skipCallersBefore.get(d.seat) || [];
        for (let i = 0; i < d.discards.length; i++) {
          // Insert invisible placeholder tiles only for real pon/kan skips
          // that precede this discard. Each carries a tooltip naming the
          // caller so hovering explains the gap.
          const callers = seatSkipCallers[i] || [];
          for (const callerSeat of callers) {
            const callerWind = seatWindLabel(callerSeat);
            const title = `Skipped — ${callerWind} called pon / kan`;
            html += `<img class="tile action-tile-sm skip-placeholder" src="/tiles/Blank.svg" alt="" title="${title}" aria-hidden="true">`;
          }
          const raw = d.discards[i];
          const tile = typeof raw === "string" ? raw : raw.tile;
          const calledBy = (typeof raw === "object" && raw !== null) ? raw.called_by : undefined;
          const isRiichi = i === d.riichi_idx;
          const absTurn = absTurnMap.get(`${d.seat}_${i}`);
          const posAttrs = `data-turn="${absTurn}" data-seat="${d.seat}"`;
          const isDora = tile === "5mr" || tile === "5pr" || tile === "5sr"
            || doraTiles.has(tileBase(tile));
          let cls = `action-tile-sm${isDora ? " dora-highlight" : ""}`;
          if (calledBy != null) cls += " ghost-tile";
          if (isRiichi) {
            const riichiAttrs = `${posAttrs} data-riichi-turn="${absTurn}" data-riichi-seat="${d.seat}"`;
            html += renderTile(tile, cls + " riichi-tile",
              "Riichi declared here — hover to see tiles safe against this riichi",
              riichiAttrs);
          } else {
            html += renderTile(tile, cls, null, posAttrs);
          }
        }
        html += `</span>`;
        if (seatMelds) {
          html += `<span class="inline-melds">`;
          for (const meld of seatMelds) {
            html += renderMeld(meld, "action-tile-sm", d.seat, doraTiles, oya) + " ";
          }
          html += `</span>`;
        }
        // Yaku panel (right-aside) for any OPPONENT that has opened. Never the
        // player's own row — prep omits the player from board_state.yaku, and
        // this guard keeps that intent explicit at the render site.
        if (b.yaku && b.yaku[d.seat] && d.seat !== playerSeat) {
          html += renderYakuStrip(b.yaku[d.seat]);
        }
        html += `</div>`;
      }
      html += `</details>`;
    }
  }

  // Scores inline in info bar — use seat winds relative to oya like the
  // discard rows above.
  if (b.scores && b.scores.length) {
    const WINDS = ["E", "S", "W", "N"];
    const playerSeat = mistakeActorSeat(m);
    let oya = null;
    if (playerSeat != null && b.seat_wind) {
      const pw = WINDS.indexOf(b.seat_wind);
      if (pw >= 0) oya = ((playerSeat - pw) % 4 + 4) % 4;
    }
    html += `<div class="scores-bar">`;
    for (let i = 0; i < b.scores.length; i++) {
      const name = oya != null
        ? WIND_DISPLAY[WINDS[(i - oya + 4) % 4]]
        : (SEAT_NAMES[i] || `P${i}`);
      const youTag = playerSeat === i ? '<span class="you-tag">(you)</span>' : '';
      html += `<span class="score-item"><span class="score-seat">${name}${youTag}</span> ${b.scores[i].toLocaleString()}</span>`;
    }
    html += `</div>`;
  }

  html += `</div>`;
  return html;
}

// --- Action formatting ---

function formatAction(action) {
  if (!action) return "?";
  switch (action.type) {
    case "dahai": return action.pai;
    case "chi": return `chi ${(action.consumed || []).join("")}+${action.pai || "?"}`;
    case "pon": return `pon ${(action.consumed || []).join("")}+${action.pai || "?"}`;
    case "reach": return "riichi";
    case "hora": return "win";
    case "none": return "pass";
    case "ankan": return `ankan ${(action.consumed || ["?"])[0]}`;
    default: return action.type;
  }
}

function renderAction(action, cls = "") {
  if (!action) return `<span class="action-text ${cls}">?</span>`;
  switch (action.type) {
    case "dahai":
      return renderTile(action.pai, `action-tile ${cls}`);
    case "chi":
    case "pon":
    case "ankan":
    case "daiminkan":
    case "kakan":
      return `<span class="action-meld ${cls}">${renderMeld(action, "action-tile-sm", action.actor)}</span>`;
    case "reach":
      return `<span class="action-pill action-riichi ${cls}">RIICHI</span>`;
    case "hora":
      return `<span class="action-pill action-win ${cls}">WIN</span>`;
    case "none":
      return `<span class="action-pill action-pass ${cls}">PASS</span>`;
    default: return `<span class="action-text ${cls}">${action.type}</span>`;
  }
}
