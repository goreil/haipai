// Meld rendering + dora-count helper, plus the action-formatting wrappers
// that share the meld glyph (chi/pon/ankan/daiminkan/kakan). Loaded before
// board-yaku-panel.js / board-discards.js because both downstream files
// reference renderMeld (yaku-panel via dead pills' renderTile reuse only,
// discards inline-melds + the EV/mistake-card action rows).

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

// --- Action formatting ---
// The played/expected action chips on every mistake card. `renderAction`
// delegates to renderMeld for chi/pon/kan so the strip-tile glyph is byte-
// identical to the inline melds in the discards block.

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
