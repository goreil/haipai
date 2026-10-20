// Yaku panel — grouped inside each open opponent's hover disclosure,
// one pill per yaku that survives that seat's melds. `entries`
// is board_state.yaku[seat] from prep: an array of { type, state, ... }.
// Pills are green (locked, ✓) or gold (possible, ◐); each carries a hover
// detail. Yakuhai shows tile chips (locked ✓ / reachable ×N), honitsu shows
// the committable suit as a tile plus a +pip when chinitsu is still alive, and
// chanta shows a +pip when junchan is still alive.
// Guaranteed yakus appear in the value breakdown; two-meld commitments appear
// under Likely yakus. Lesser live yakus and dead candidates appear separately
// under Possible and Eliminated, both expanded by default.
// An opened seat with no surviving yaku gets a muted placeholder.
// Listed here in strip display order (open-hand frequency on amae-koromo);
// the actual ordering is enforced by prep/prep-board-yaku.js's _YAKU_DISPLAY_ORDER sort.
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

// Per-state glyph + popover label, shared by every pill renderer. Previously
// duplicated as SANSHOKU_STATE_CHAR / SANSHOKU_STATE_LABEL plus an inline
// ternary in renderYakuPill, and a hard-coded "✗" in renderDeadYakuhaiPill.
const YAKU_STATES = {
  locked:   { char: "✓", label: "✓ locked" },
  close:    { char: "◐", label: "2/3 close" },
  possible: { char: "◐", label: "1/3 possible" },
  dead:     { char: "×", label: "× dead" },
};

function renderYakuhaiTiles(d) {
  let chips = "";
  for (const l of d.locked || []) {
    const note = l.note ? ` (${l.note})` : "";
    chips += `<span class="yp-tile-chip is-locked" title="Yakuhai · ${l.tile}${note}">`
      + renderTile(l.tile, "no-dora")
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
      + renderTile(p.tile, "no-dora")
      + `<span class="yp-tile-count">×${p.count}</span></span>`;
  }
  return chips ? `<span class="yp-tiles">${chips}</span>` : "";
}

function renderHonitsuTiles(d) {
  // One tile per still-committable suit; a +pip when the no-honor chinitsu
  // finish is also reachable.
  const tiles = (d.suits || [])
    .map(s => renderTile(SUIT_TILE[s], "yp-suit-tile no-dora", SUIT_NAME[s]))
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
      : `<span class="muted">${d.additional ? "Additional yakuhai still reachable." : "No yakuhai meld yet."}</span>`;
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
      + (d.state === "locked" ? `Four honor melds leave only the pair concealed.<br>` : ``)
      + `Committable suit${(d.suits || []).length > 1 ? "s" : ""}: <b>${suits || "—"}</b>.<br>`
      + `Chinitsu upgrade: <b style="color:${d.chinitsuReachable ? "#9fd9a2" : "var(--text-dim)"}">`
      + `${d.chinitsuReachable ? "still reachable" : "dead (honor already melded)"}</b>.`;
  }
  if (d.type === "tanyao") {
    return `<b>Tanyao</b> · <span class="muted">possible</span><br>`
      + `<span class="muted">All melds are simples (2–8). Dies if a terminal or honor enters a meld.</span>`;
  }
  if (d.type === "toitoi") {
    return `<b>Toitoi</b> · <span class="muted">${d.state}</span><br>`
      + (d.state === "locked" ? `Four triplet melds leave only the pair concealed.`
        : `<span class="muted">Every meld is a triplet. Dies on any chi.</span>`);
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

function renderSanshokuTiles(d) {
  // Variant B suit-tile row — the run's start tile in each suit.
  const chips = d.rows.map(row => {
    const cls = row.melded ? "yp-ss-tile done"
              : row.dead ? "yp-ss-tile dead"
              : "yp-ss-tile";
    return renderTile(row.tiles[0].tile, cls + " no-dora", SUIT_NAME[row.suit]);
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

// Shared popover for sanshoku & ittsuu. Both yakus render a candidate detail
// with the same 3-row structure (one row per suit for sanshoku, one row per
// fixed run 123/456/789 for ittsuu), with the same dealin / low / done / dead
// row colouring, the same per-tile count, and the same head/foot frame; only
// the title, row label, suit class, and foot text differ.
function renderRunCandidateDetail(d, opts) {
  const { title, rowLabel, rowSuit, foot } = opts;
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
      tilesHtml += `<span class="${tileCls}">${renderTile(t.tile, "no-dora")}`
        + `<span class="ssd-count">${count}</span></span>`;
    }
    // A suit killed by two last-copies in hand has no single exhausted tile.
    const status = row.melded ? "✓ melded"
                 : row.dead ? (row.deadTile ? `× ${row.deadTile} out` : "× both in hand")
                 : dealInAlive ? "deal-in" : `${row.live} live`;
    rowsHtml += `<div class="ssd-suit ${rowSuit(row)}"><span class="ssd-dot"></span>${rowLabel(row)}</div>`
      + `<div class="${rowCls}"><div class="ssd-tiles">${tilesHtml}</div>`
      + `<div class="ssd-status">${status}</div></div>`;
  }
  return `<span class="yp-detail ss-detail">`
    + `<div class="ss-detail-head"><span class="ssd-title">${title}</span>`
    + `<span class="ssd-state ${d.state}">${YAKU_STATES[d.state].label}</span></div>`
    + `<div class="ss-detail-rows">${rowsHtml}</div>`
    + (foot ? `<div class="ss-detail-foot">${foot}</div>` : "")
    + `</span>`;
}

function renderSanshokuDetail(d) {
  return renderRunCandidateDetail(d, {
    title: `Sanshoku · ${d.seq}`,
    rowLabel: row => row.suit,
    rowSuit: row => row.suit,
    foot: sanshokuFoot(d),
  });
}

function renderSanshokuPill(d) {
  return `<span class="yp ss ${d.state}" title="Sanshoku ${d.seq}">`
    + `<span class="yp-state">${YAKU_STATES[d.state].char}</span>`
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
    return renderTile(row.tiles[0].tile, cls + " no-dora", `${row.start}–${row.start + 2}`);
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
  return renderRunCandidateDetail(d, {
    title: `Ittsuu · ${SUIT_NAME[d.suit]}`,
    // All rows share the candidate's suit; the row label distinguishes which
    // of the three fixed runs (123 / 456 / 789) we're inspecting.
    rowLabel: row => `${row.start}–${row.start + 2}`,
    rowSuit: () => d.suit,
    foot: ittsuuFoot(d),
  });
}

function renderIttsuuPill(d) {
  return `<span class="yp ss it ${d.state}" title="Ittsuu · ${SUIT_NAME[d.suit]}">`
    + `<span class="yp-state">${YAKU_STATES[d.state].char}</span>`
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
  const stateChar = YAKU_STATES[d.state] ? YAKU_STATES[d.state].char : "◐";
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
// shows the unseen count under each chip. Lives behind the strip's
// "more" toggle. Dead sanshoku/ittsuu candidates are also routed behind
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
      + renderTile(h.tile, "no-dora")
      + `<span class="yp-tile-count">${h.unseen}</span></span>`;
    rows += `<b>${h.tile}${noteSuffix}</b> <span class="muted">${reason}</span><br>`;
  }
  const detail = `<b>Yakuhai</b> <span class="muted">dead</span><br>${rows}`;
  return `<span class="yp dead" title="Yakuhai dead">`
    + `<span class="yp-state">${YAKU_STATES.dead.char}</span>`
    + `<span class="yp-name">Yakuhai</span>`
    + `<span class="yp-tiles">${chips}</span>`
    + `<span class="yp-detail">${detail}</span></span>`;
}

// Returns { pills, count } — `pills` is the HTML chunks (one compressed
// yakuhai pill + one pill per dead sanshoku/ittsuu); `count` is the
// per-yaku tally (kept for callers, though the "more" toggle now counts
// pills, not eliminated yakus).
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

// Dead entries are collected separately from the live candidates.
function isDeadRouted(d) {
  return (d.type === "yakuhai" && d.state === "dead")
    || ((d.type === "sanshoku" || d.type === "ittsuu") && d.state === "dead");
}

// Whether a live entry belongs under Likely rather than Possible: a guaranteed
// (already-melded) yakuhai, and yakus that two melds are committed to —
// sanshoku/ittsuu with 2+ suits/runs melded, and whole-hand yakus (tanyao,
// toitoi, chanta, honitsu) backed by 2+ melds. Everything else — possible
// yakuhai, one-meld sanshoku/ittsuu, single-meld whole-hand yakus — is demoted.
function stripKeep(d) {
  if (d.type === "yakuhai") return d.state === "locked";
  if (d.type === "sanshoku" || d.type === "ittsuu") return d.progress >= 2;
  return (d.support || 0) >= 2;
}

// These are individual open-hand values, not a total or a threat-band input.
// Upgrades remain alternatives rather than being added to their base yaku.
function openYakuHan(d) {
  if (d.type === "yakuhai") {
    const honors = d.state === "locked" ? d.locked || [] : (d.possible || []).filter(p => p.count >= 3);
    const values = honors.map(h => h.note === "round + seat" ? 2 : 1);
    if (d.state === "locked") return String(values.reduce((sum, han) => sum + han, 0));
    return values.includes(2) ? (values.includes(1) ? "1–2" : "2") : "1";
  }
  if (d.type === "honitsu") return d.chinitsuReachable ? "2 / 5" : "2";
  if (d.type === "chanta") return d.junchanReachable ? "1 / 2" : "1";
  return d.type === "toitoi" ? "2" : "1";
}

function renderYakuValueRow(d) {
  const upgrade = d.type === "honitsu" && d.chinitsuReachable ? "Honitsu / Chinitsu"
    : d.type === "chanta" && d.junchanReachable ? "Chanta / Junchan" : "";
  return `<span class="td-yaku-row">${renderYakuPill(d)}`
    + `<span class="td-han"${upgrade ? ` title="${upgrade}"` : ""}>${openYakuHan(d)} han</span></span>`;
}

function renderYakuStrip(entries, guaranteedYaku = []) {
  if (!entries) return "";
  const keep = [];
  const demoted = [];
  const guaranteedNames = new Set(guaranteedYaku.map(y => y.name));
  for (const d of entries) {
    if (isDeadRouted(d)) continue;
    // Guaranteed rows already show melded yakuhai, Ittsu and four-call
    // shapes. Keep any additional reachable honors in the Possible group.
    if (d.type === "yakuhai" && d.state === "locked" && guaranteedYaku.some(y => y.tile && "ESWNPFC".includes(y.tile))) {
      if ((d.possible || []).some(p => p.count >= 3)) {
        demoted.push({ ...d, state: "possible", locked: [], additional: true });
      }
      continue;
    }
    const name = d.type === "ittsuu" ? "Ittsu" : (YAKU_META[d.type] || {}).label;
    if (d.state === "locked" && guaranteedNames.has(name)) continue;
    (stripKeep(d) ? keep : demoted).push(d);
  }
  const { pills: deadPills } = collectDeadPills(entries);
  const likely = keep.length
    ? `<span class="td-section-label">Likely yakus</span>${keep.map(renderYakuValueRow).join("")}` : "";
  const possible = demoted.length
    ? `<details class="td-yaku-more" open><summary>Possible · ${demoted.length}</summary>`
      + demoted.map(renderYakuValueRow).join("") + `</details>` : "";
  const dead = deadPills.length
    ? `<details class="td-yaku-more" open><summary>Eliminated · ${deadPills.length}</summary>`
      + deadPills.join("") + `</details>` : "";
  const empty = !keep.length && !demoted.length && !guaranteedYaku.length
    ? `<span class="td-empty">No yaku reachable</span>` : "";
  return `<span class="threat-yakus">${likely}${possible}${dead}${empty}</span>`;
}
