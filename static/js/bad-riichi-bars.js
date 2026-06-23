// Per-wait EV bars for 5A (Bad Riichi) and 5B (Missed Riichi) mistake cards.
// Replaces the legacy chip strip with stacked Ron + Tsumo bars showing dama,
// riichi premium, and an ippatsu/ura EV tail per wait. Built off the bundled
// Riichi calculator already loaded for detectClosedHandYaku.
//
// Relies on globals from categorize-yaku.js (_mjaiToRiichiTile,
// _windToKazeInt, _formatRiichiHandStr, _SITUATIONAL_YAKU, _YAKU_LABEL)
// and tiles.js (renderTile).

// Approximation for the ippatsu + uradora tail. Derived to match the
// hand-tuned reference values in the design at typical 1-3 han hands; it
// roughly tracks "one extra han worth of value times the chance of getting
// one." Rounded to the nearest 100 so the number reads cleanly.
function _badRiichiBonusEv(riichiTen) {
  if (!riichiTen) return 0;
  return Math.round(riichiTen * 0.13 / 100) * 100;
}

// Compact "5z" / "5z6m"-style dora notation for the Riichi lib. Takes the
// resolved dora tiles (not indicators) from board_state.dora_tiles and emits
// the string that goes after `+d` in the calculator input.
function _formatRiichiDoraStr(mjaiTiles) {
  if (!mjaiTiles || !mjaiTiles.length) return null;
  if (typeof _mjaiToRiichiTile !== "function") return null;
  const groups = { m: [], p: [], s: [], z: [] };
  for (const t of mjaiTiles) {
    const r = _mjaiToRiichiTile(t);
    if (!r || r.length !== 2) continue;
    if (!groups[r[1]]) continue;
    groups[r[1]].push(r[0]);
  }
  let out = "";
  for (const s of "mpsz") {
    if (groups[s].length) out += groups[s].join("") + s;
  }
  return out || null;
}

// Build a hand string for the Riichi lib such that the win tile is parsed as
// the agari (last tile). Required for tsumo, where the win tile is part of
// the 14-tile hand rather than passed as `+<winTile>`.
function _formatRiichiTsumoHandStr(handTiles14, winTile) {
  if (typeof _mjaiToRiichiTile !== "function") return null;
  const winR = _mjaiToRiichiTile(winTile);
  if (!winR || winR.length !== 2) return null;
  const winSuit = winR[1];
  const winNum = winR[0];

  const groups = { m: [], p: [], s: [], z: [] };
  for (const t of handTiles14) {
    const r = _mjaiToRiichiTile(t);
    if (!r || r.length !== 2) continue;
    if (!groups[r[1]]) continue;
    groups[r[1]].push(r[0]);
  }
  const wIdx = groups[winSuit].indexOf(winNum);
  if (wIdx < 0) return null;
  groups[winSuit].splice(wIdx, 1);

  // win-suit group goes last so the agari ends up at the tail of `hai`
  const suitOrder = "mpsz".replace(winSuit, "") + winSuit;
  let out = "";
  for (const s of suitOrder) {
    if (s === winSuit) {
      const tail = groups[s].join("") + winNum;
      out += tail + s;
    } else if (groups[s].length) {
      out += groups[s].join("") + s;
    }
  }
  return out;
}

// Collect a meld's physical tiles (mjai notation) for scoring an OPEN hand.
// chi/pon/daiminkan are `consumed` + the called `pai`; ankan is its 4
// `consumed` tiles; kakan upgrades a pon to a kan, so it's the pon base ×3
// plus the added `pai` (the renderer trusts only consumed[0] for kakan, so we
// don't rely on consumed.length there). Returns null on a shape we can't read.
function _meldTiles(meld) {
  if (!meld) return null;
  const consumed = meld.consumed || [];
  if (meld.type === "ankan") {
    return consumed.length === 4 ? consumed.slice() : null;
  }
  if (meld.type === "kakan") {
    const base = consumed[0] || meld.pai;
    if (!base) return null;
    const tiles = consumed.length >= 3 ? consumed.slice(0, 3) : [base, base, base];
    if (meld.pai) tiles.push(meld.pai);
    return tiles;
  }
  const tiles = consumed.slice();
  if (meld.pai) tiles.push(meld.pai);
  return tiles.length >= 3 ? tiles : null;
}

// One meld → a Riichi-lib furo group string (e.g. "123m", "0p", "1111z").
// Tiles are sorted by rank (red five ranks as 5) so a chi like 3-4-5r parses
// as a run — the lib's isFuro check runs on the UNSORTED group, so order matters.
function _meldFuroStr(meld) {
  const tiles = _meldTiles(meld);
  if (!tiles || !tiles.length) return null;
  const conv = [];
  for (const t of tiles) {
    const r = _mjaiToRiichiTile(t);
    if (!r || r.length !== 2) return null;
    conv.push(r);
  }
  const suit = conv[0][1];
  const rank = (r) => (r[0] === "0" ? 5 : parseInt(r[0], 10));
  conv.sort((a, b) => rank(a) - rank(b));
  return conv.map(r => r[0]).join("") + suit;
}

// `+`-separated furo suffix for the Riichi-lib `data` string, covering every
// called meld in the hero's hand. "" for a closed hand. Note: the bundled lib
// has no concealed-kan concept, so an ankan is treated as an open furo here —
// it (mildly) suppresses menzen-only yaku, but open hands are the case that
// matters and reach decisions never reach this with melds present.
function _formatRiichiFuroSuffix(m) {
  const melds = (m && m.melds) || [];
  if (!melds.length) return "";
  let out = "";
  for (const meld of melds) {
    const f = _meldFuroStr(meld);
    if (f) out += `+${f}`;
  }
  return out;
}

// Double riichi (daburu rīchi) requires the player's first uninterrupted
// discard with no calls anywhere in the round. mistake.turn is junme; an
// opp meld at this point would mean a call broke the first go-around.
function _isDoubleRiichiContext(m) {
  if (!m || m.turn !== 1) return false;
  if (m.melds && m.melds.length) return false;
  const opp = (m.board_state && m.board_state.opponent_melds) || [];
  for (const o of opp) {
    if (o && o.melds && o.melds.length) return false;
  }
  return true;
}

// One score evaluation. opts: { riichi: bool, tsumo: bool }.
// `hand13` is the 13-tile tenpai hand (does NOT include the win tile).
// Returns { han, fu, ten, yaku: [labels] } or null when the win is invalid
// (e.g. no yaku on dama ron).
function _evalWaitScore(hand13, winTile, m, opts) {
  if (typeof window === "undefined" || !window.Riichi) return null;
  if (typeof _windToKazeInt !== "function" || typeof _formatRiichiHandStr !== "function") return null;

  const bs = m.board_state || {};
  const bakaze = _windToKazeInt(bs.round_wind) || 1;
  const jikaze = _windToKazeInt(bs.seat_wind) || 2;
  // Pass `w` (double riichi, 2 han) instead of `r` (regular riichi, 1 han)
  // when junme 1 with no calls. The Riichi lib's 立直 check excludes itself
  // when ダブル立直 fires, so the two never double-count.
  const riichiFlag = opts.riichi ? (_isDoubleRiichiContext(m) ? "w" : "r") : "";
  const extras = riichiFlag + `${bakaze}${jikaze}`;
  const doraStr = _formatRiichiDoraStr(bs.dora_tiles);
  const doraSuffix = doraStr ? `+d${doraStr}` : "";
  // Called melds feed the calc as extra furo groups so an OPEN hand scores its
  // full shape (and its meld dora/aka). Closed hands contribute "".
  const furoSuffix = _formatRiichiFuroSuffix(m);

  let data;
  if (opts.tsumo) {
    const hand14 = hand13.slice();
    hand14.push(winTile);
    const handStr = _formatRiichiTsumoHandStr(hand14, winTile);
    if (!handStr) return null;
    data = `${handStr}+${extras}${doraSuffix}${furoSuffix}`;
  } else {
    const handStr = _formatRiichiHandStr(hand13);
    const winR = _mjaiToRiichiTile(winTile);
    data = `${handStr}+${winR}+${extras}${doraSuffix}${furoSuffix}`;
  }

  let result;
  try {
    result = new window.Riichi(data).calc();
  } catch (e) {
    return null;
  }
  if (!result || !result.isAgari || !result.han) return null;

  // The Riichi lib doesn't enforce the "must have a real yaku" rule — it
  // happily reports aka/dora-only "wins". Skip those: in real play you can't
  // ron or tsumo on dora alone. Riichi and menzen-tsumo both count as real
  // yaku here.
  let hasRealYaku = false;
  let dora = 0;
  let aka = 0;
  const yaku = [];
  for (const jp in result.yaku) {
    if (jp === "ドラ") {
      const v = String(result.yaku[jp]).match(/^(\d+)/);
      if (v) dora = parseInt(v[1], 10);
      continue;
    }
    if (jp === "赤ドラ") {
      const v = String(result.yaku[jp]).match(/^(\d+)/);
      if (v) aka = parseInt(v[1], 10);
      continue;
    }
    hasRealYaku = true;
    if (_SITUATIONAL_YAKU && _SITUATIONAL_YAKU.has(jp)) continue;
    yaku.push((_YAKU_LABEL && _YAKU_LABEL[jp]) || jp);
  }
  if (!hasRealYaku) return null;
  return { han: result.han, fu: result.fu, ten: result.ten, yaku, dora, aka };
}

// Build the 13-tile tenpai hand for 5A/5B by dropping the actual discard
// from the 14-tile pre-discard snapshot. Returns null if shapes don't line up.
function _badRiichiTenpaiHand(m) {
  const hand = (m.hand || []).slice();
  if (m.melds && m.melds.length) return null;            // riichi requires menzen
  if (hand.length === 13) return hand;
  if (hand.length !== 14) return null;
  const discard = m.actual_riichi_tile || (m.actual && m.actual.pai);
  if (!discard) return null;
  const idx = hand.indexOf(discard);
  if (idx < 0) return null;
  hand.splice(idx, 1);
  return hand;
}

// Split a 5/5/5 wait into regular + red rows when the aka is still available
// (wall[34/35/36] > 0 means the red copy isn't in the player's hand or seen
// elsewhere). Furiten applies to the whole base wait so it propagates to both.
const _AKA_TILE_FOR_BASE = { "5m": "5mr", "5p": "5pr", "5s": "5sr" };
function _expandWaitsForAka(waits, furitenSet) {
  const out = [];
  for (const w of waits) {
    if (!w || !w.tile) continue;
    const fur = furitenSet.has(w.tile);
    const redTile = _AKA_TILE_FOR_BASE[w.tile];
    const aka = w.aka_count || 0;
    if (!redTile || aka <= 0) {
      out.push({ tile: w.tile, count: w.count || 0, furiten: fur });
      continue;
    }
    const reg = (w.count || 0) - aka;
    if (reg > 0) out.push({ tile: w.tile, count: reg, furiten: fur });
    out.push({ tile: redTile, count: aka, furiten: fur });
  }
  return out;
}

// Per-card evaluation. For each wait, computes dama and riichi scores under
// both ron and tsumo. yaku is the union of natural-shape yaku across modes
// (with situational ones stripped) — what the design labels "yaku already
// present on dama".
function _buildBadRiichiWaitEval(m) {
  const hand13 = _badRiichiTenpaiHand(m);
  if (!hand13) return null;
  const rawWaits = (typeof tenpaiWaitTiles === "function") ? tenpaiWaitTiles(m) : [];
  if (!rawWaits.length) return null;

  const furitenSet = new Set(m.furiten_tiles || []);
  const waits = _expandWaitsForAka(rawWaits, furitenSet);
  const out = [];
  for (const w of waits) {
    const ronDama = _evalWaitScore(hand13, w.tile, m, { riichi: false, tsumo: false });
    const ronRiichi = _evalWaitScore(hand13, w.tile, m, { riichi: true,  tsumo: false });
    const tsumoDama = _evalWaitScore(hand13, w.tile, m, { riichi: false, tsumo: true });
    const tsumoRiichi = _evalWaitScore(hand13, w.tile, m, { riichi: true,  tsumo: true });

    // Natural-shape yaku (dama wins) for this wait. Falls back to riichi's
    // yaku minus the riichi token when dama is impossible.
    let yaku = (ronDama && ronDama.yaku) || (tsumoDama && tsumoDama.yaku) || [];
    yaku = yaku.filter(y => y && y !== "立直");

    // Dora/aka counts are identical across all 4 modes for a given wait —
    // the lib counts them from the completed hand, which is the same shape
    // for ron/tsumo/dama/riichi. Pick from whichever eval is non-null. (A
    // wait tile that is itself dora is reflected here because each eval uses
    // its own agari.)
    const anyEval = ronRiichi || tsumoRiichi || ronDama || tsumoDama;
    const dora = anyEval ? (anyEval.dora || 0) : 0;
    const aka = anyEval ? (anyEval.aka || 0) : 0;

    out.push({
      tile: w.tile,
      count: w.count || 0,
      furiten: w.furiten,
      yaku,
      dora,
      aka,
      ronDama, ronRiichi, tsumoDama, tsumoRiichi,
    });
  }
  return out.length ? _groupWaitsByScore(out) : null;
}

// Group waits whose score profile is identical so a single row covers them.
// Same yaku list + same (han, fu, ten) across all 4 modes + same dora/aka +
// same furiten state ⇒ identical bars; the only differentiator is the tile.
function _scoreSig(s) { return s ? `${s.han},${s.fu},${s.ten}` : "x"; }
function _waitSig(w) {
  return [
    _scoreSig(w.ronDama), _scoreSig(w.ronRiichi),
    _scoreSig(w.tsumoDama), _scoreSig(w.tsumoRiichi),
    (w.yaku || []).slice().sort().join("|"),
    w.dora || 0, w.aka || 0,
    w.furiten ? "f" : "",
  ].join("/");
}
function _groupWaitsByScore(waits) {
  const groups = new Map();
  const order = [];
  for (const w of waits) {
    const sig = _waitSig(w);
    let g = groups.get(sig);
    if (!g) {
      // Reuse first wait's fields for scores/yaku; tiles holds every member.
      g = Object.assign({}, w, { tiles: [] });
      groups.set(sig, g);
      order.push(sig);
    }
    g.tiles.push({ tile: w.tile, count: w.count, furiten: w.furiten });
  }
  return order.map(sig => groups.get(sig));
}

function _fmtPts(n) {
  if (n == null) return "";
  return n.toLocaleString();
}

function _renderBarBlock(modeLabel, dama, riichi, bonus, scaleMax, isDaburi) {
  // No-yaku case: dama is impossible (e.g. ron with no yaku). Show riichi
  // value as the full bar — no comparison framing.
  const hasDama = dama && dama.ten > 0;
  const hasRiichi = riichi && riichi.ten > 0;
  if (!hasRiichi) return "";

  const pct = v => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const riichiW = pct(riichi.ten);
  const damaW = hasDama ? pct(dama.ten) : 0;
  const bonusW = bonus > 0 ? pct(bonus) : 0;

  const riichiTag = isDaburi ? "Double Riichi" : "Riichi";
  let breakdown = `<span class="bd-mode">${modeLabel}</span>`;
  if (hasDama) {
    breakdown += `<span class="bd-item dama">
        <span class="bd-tag">Dama</span>
        <span class="bd-hanfu">${dama.han} han · ${dama.fu} fu</span>
        <span class="bd-points">${_fmtPts(dama.ten)}</span>
      </span>
      <span class="bd-sep">+</span>
      <span class="bd-item riichi">
        <span class="bd-tag">${riichiTag}</span>
        <span class="bd-hanfu">${riichi.han} han · ${riichi.fu} fu</span>
        <span class="bd-points">+${_fmtPts(riichi.ten - dama.ten)}</span>
      </span>`;
  } else {
    breakdown += `<span class="bd-item riichi">
        <span class="bd-tag">${riichiTag}</span>
        <span class="bd-hanfu">${riichi.han} han · ${riichi.fu} fu</span>
        <span class="bd-points">${_fmtPts(riichi.ten)}</span>
      </span>`;
  }
  if (bonus > 0) {
    breakdown += `<span class="bd-sep">+</span>
      <span class="bd-item bonus">
        <span class="bd-tag">ura EV</span>
        <span class="bd-points">~${_fmtPts(bonus)}</span>
      </span>`;
  }

  // Bar segments: dama (0 → damaW), riichi extension (damaW → riichiW),
  // bonus tail (riichiW → riichiW+bonusW). When there's no dama, the entire
  // pre-bonus length is the riichi segment.
  let bar = "";
  if (hasDama) {
    bar += `<div class="bar-seg dama"   style="left:0; width:${damaW.toFixed(1)}%;"></div>`;
    bar += `<div class="bar-seg riichi" style="left:${damaW.toFixed(1)}%; width:${(riichiW - damaW).toFixed(1)}%;"></div>`;
  } else {
    bar += `<div class="bar-seg riichi" style="left:0; width:${riichiW.toFixed(1)}%;"></div>`;
  }
  if (bonusW > 0) {
    bar += `<div class="bar-bonus" style="left:${riichiW.toFixed(1)}%; width:${bonusW.toFixed(1)}%;"></div>`;
  }

  return `<div class="bar-block">
    <div class="bar-breakdown">${breakdown}</div>
    <div class="bar-track compact">${bar}</div>
  </div>`;
}

function _renderWaitRow(w, scaleMax, isDaburi) {
  const ronBonus = w.ronRiichi ? _badRiichiBonusEv(w.ronRiichi.ten) : 0;
  const tsumoBonus = w.tsumoRiichi ? _badRiichiBonusEv(w.tsumoRiichi.ten) : 0;

  // Yaku/dora chips. The "no yaku — riichi only" hint shows whenever no real
  // yaku is present, even when dora is — dora alone doesn't complete a hand,
  // so the dama-impossible framing still applies.
  const tagParts = [];
  const hasYaku = w.yaku && w.yaku.length;
  if (hasYaku) {
    for (const y of w.yaku) tagParts.push(`<span class="yaku-tag">${y}</span>`);
  }
  if (w.dora) tagParts.push(`<span class="yaku-tag dora-tag">dora ${w.dora}</span>`);
  if (w.aka) tagParts.push(`<span class="yaku-tag dora-tag">aka ${w.aka}</span>`);
  if (!hasYaku) tagParts.push(`<span class="yaku-none">no yaku — riichi only</span>`);
  const yakuTags = tagParts.join(" ");

  // Verdict line: short summary of the riichi premium (or, when there's no
  // dama, just "Riichi N pts").
  const verdictParts = [];
  if (w.ronRiichi && w.ronDama) {
    verdictParts.push(`Ron +${_fmtPts(w.ronRiichi.ten - w.ronDama.ten)}`);
  } else if (w.ronRiichi) {
    verdictParts.push(`Ron ${_fmtPts(w.ronRiichi.ten)}`);
  }
  if (w.tsumoRiichi && w.tsumoDama) {
    verdictParts.push(`Tsumo +${_fmtPts(w.tsumoRiichi.ten - w.tsumoDama.ten)}`);
  } else if (w.tsumoRiichi) {
    verdictParts.push(`Tsumo ${_fmtPts(w.tsumoRiichi.ten)}`);
  }
  const verdictTxt = verdictParts.length ? verdictParts.join(" · ") + " vs dama" : "";
  const verdict = verdictTxt
    ? `<span class="bar-verdict bad">${verdictTxt}</span>` : "";

  // Tile column: one (tile + ×count) entry per group member, stacked
  // vertically. Single-tile groups still get the same layout — one entry.
  const tiles = w.tiles && w.tiles.length ? w.tiles : [{ tile: w.tile, count: w.count, furiten: w.furiten }];
  const tileEntries = tiles.map(t => {
    const tileHtml = (typeof renderTile === "function")
      ? renderTile(t.tile, "tile-big-wait")
      : t.tile;
    const countCls = t.furiten ? "live-count live-count-furiten" : "live-count";
    const countTip = t.furiten ? `${t.tile} — furiten (already discarded)` : `${t.tile} ×${t.count}`;
    return `<div class="bar-tile-entry">
      ${tileHtml}
      <span class="${countCls}" title="${countTip}">×${t.count}</span>
    </div>`;
  }).join("");

  return `<div class="bar-row">
    <div class="bar-tile-col">
      ${tileEntries}
    </div>
    <div class="bar-body">
      <div class="bar-meta">
        <span class="yaku-list">${yakuTags}</span>
        ${verdict}
      </div>
      <div class="bar-stack">
        ${_renderBarBlock("Ron",   w.ronDama,   w.ronRiichi,   ronBonus,   scaleMax, isDaburi)}
        ${_renderBarBlock("Tsumo", w.tsumoDama, w.tsumoRiichi, tsumoBonus, scaleMax, isDaburi)}
      </div>
    </div>
  </div>`;
}

// Public entry. Returns HTML for the EV-bars section on 5A/5B mistake cards,
// or null when we don't have enough data and the legacy chip strip should be
// used instead.
function renderBadRiichiBars(m) {
  if (!m) return null;
  if (m.category !== "5A" && m.category !== "5B") return null;
  if (typeof window === "undefined" || !window.Riichi) return null;

  const evals = _buildBadRiichiWaitEval(m);
  if (!evals) return null;

  // Shared visual scale across the card so "bad riichi" reads at a glance.
  // Defaults to 6,000 (matching the design); grows for bigger hands so the
  // bars never clip past 100%. Bonus is included so the tail has room.
  let scaleMax = 6000;
  for (const w of evals) {
    const candidates = [w.ronRiichi, w.tsumoRiichi];
    for (const c of candidates) {
      if (c && c.ten) {
        const bonus = _badRiichiBonusEv(c.ten);
        if (c.ten + bonus > scaleMax) scaleMax = c.ten + bonus;
      }
    }
  }
  scaleMax = Math.ceil(scaleMax / 1000) * 1000;

  // totalLive sums each group's tile counts; types counts every tile across
  // all groups so the header still reads "N types" the way users expect.
  let totalLive = 0;
  let types = 0;
  for (const g of evals) {
    const ts = g.tiles && g.tiles.length ? g.tiles : [g];
    types += ts.length;
    for (const t of ts) totalLive += t.count || 0;
  }
  const heading = `${types} type${types === 1 ? "" : "s"} · ${totalLive} live tile${totalLive === 1 ? "" : "s"}`;
  const isMissedRiichi = m.category === "5B";
  const headerLabel = isMissedRiichi ? "Tenpai waits — riichi would gain" : "Tenpai waits";
  const isDaburi = _isDoubleRiichiContext(m);

  const rows = evals.map(w => _renderWaitRow(w, scaleMax, isDaburi)).join("");

  return `<div class="bad-riichi-waits-section">
    <div class="waits-section-head">
      <span class="h-label">${headerLabel}</span>
      <span class="h-count">${heading}</span>
      <span class="h-legend">
        <span class="legend-dot dama"></span>Dama
        <span class="sep">·</span>
        <span class="legend-dot riichi"></span>+ Riichi
        <span class="sep">·</span>
        <span class="legend-dot bonus"></span>ippatsu / ura EV
      </span>
    </div>
    <div class="wait-bars with-tsumo">${rows}</div>
  </div>`;
}

// --- EV-table per-column scoring (5A/5B) -------------------------------------
// The riichi/dama point scoring, relocated into the 2-column EV table. Each
// pick's column shows the value of ITS OWN call — the riichi column scores a
// declared riichi, the dama column scores a silent dama — computed from that
// column's own discard tile and tenpai waits. A column that breaks tenpai
// (shanten > 0) has no winning hand to score and is skipped, so only the
// tenpai side(s) get a calc.

// Score one discard's waits under a single mode. `discardTile` is dropped from
// the 14-tile hand to form the tenpai hand; `waitEntries` are that hand's
// winning tiles (the column's ukeire — for a tenpai hand, ukeire == the wait),
// each `{ tile, count, aka_count }`. `riichi` toggles the declared-riichi han
// (plus the ippatsu/ura EV tail) vs. a silent dama win. Returns grouped rows
// `[{ tiles, ron, tsumo, bonus, yaku, dora, aka }]` or null when nothing scores.
function evalDiscardScores(m, discardTile, waitEntries, riichi) {
  if (typeof window === "undefined" || !window.Riichi) return null;
  // Open hands are scored too (silent value via _formatRiichiFuroSuffix); they
  // just can't declare riichi, so force the dama branch when melds are present.
  const meldCount = (m.melds || []).length;
  const useRiichi = riichi && meldCount === 0;
  // Each called meld occupies one set (3 tiles) of the 13-tile structure, so the
  // concealed portion is 13 − 3·melds at tenpai (14 − 3·melds pre-discard).
  const tenpaiLen = 13 - 3 * meldCount;
  const preLen = 14 - 3 * meldCount;
  const hand = (m.hand || []).slice();
  let hand13;
  if (hand.length === tenpaiLen) {
    hand13 = hand;
  } else if (hand.length === preLen) {
    const idx = hand.indexOf(discardTile);
    if (idx < 0) return null;
    hand13 = hand.slice();
    hand13.splice(idx, 1);
  } else {
    return null;
  }
  if (!Array.isArray(waitEntries) || !waitEntries.length) return null;

  const furitenSet = new Set(m.furiten_tiles || []);
  const waits = _expandWaitsForAka(
    waitEntries.map(w => ({ tile: w.tile, count: w.count, aka_count: w.aka_count })),
    furitenSet,
  );
  const rows = [];
  for (const w of waits) {
    const ron = _evalWaitScore(hand13, w.tile, m, { riichi: useRiichi, tsumo: false });
    const tsumo = _evalWaitScore(hand13, w.tile, m, { riichi: useRiichi, tsumo: true });
    if (!ron && !tsumo) continue;                    // no legal win on this wait
    const anyEval = ron || tsumo;
    let yaku = (ron && ron.yaku) || (tsumo && tsumo.yaku) || [];
    yaku = yaku.filter(y => y && y !== "立直" && y !== "ダブル立直");
    const bonus = useRiichi ? _badRiichiBonusEv((ron && ron.ten) || (tsumo && tsumo.ten)) : 0;
    rows.push({
      tile: w.tile, count: w.count, furiten: w.furiten,
      ron, tsumo, bonus,
      yaku, dora: anyEval.dora || 0, aka: anyEval.aka || 0,
    });
  }
  return rows.length ? _groupScoreRows(rows) : null;
}

// Group score rows whose value profile is identical (same ron/tsumo/bonus +
// yaku/dora/aka + furiten) so a single entry covers every wait that shares it.
function _scoreRowSig(r) {
  return [
    _scoreSig(r.ron), _scoreSig(r.tsumo), r.bonus || 0,
    (r.yaku || []).slice().sort().join("|"), r.dora || 0, r.aka || 0,
    r.furiten ? "f" : "",
  ].join("/");
}
function _groupScoreRows(rows) {
  const groups = new Map();
  const order = [];
  for (const r of rows) {
    const sig = _scoreRowSig(r);
    let g = groups.get(sig);
    if (!g) { g = Object.assign({}, r, { tiles: [] }); groups.set(sig, g); order.push(sig); }
    g.tiles.push({ tile: r.tile, count: r.count, furiten: r.furiten });
  }
  return order.map(s => groups.get(s));
}

// Render a column's score cell for the EV table. `riichi` controls the chrome
// (riichi vs dama). Ron and Tsumo points are shown per score-group; the riichi
// mode appends the ippatsu/ura EV tail. A dama group with no ron yaku notes
// that only menzen-tsumo wins.
function renderRiichiScoreCell(groups, riichi) {
  if (!groups || !groups.length) return "";
  const cls = riichi ? "rsc rsc-riichi" : "rsc rsc-dama";
  const line = (label, s) => s
    ? `<span class="rsc-line"><span class="rsc-mode">${label}</span>`
      + `<span class="rsc-pts">${s.ten.toLocaleString()}</span>`
      + `<span class="rsc-hanfu">(${s.han} han · ${s.fu} fu)</span></span>`
    : "";
  const blocks = groups.map(g => {
    // Wait tiles with their live count (×N) — how many of each winning tile is
    // still drawable. Furiten waits are flagged on their count so a dealt-away
    // wait reads as dead rather than a live out.
    const tileEntries = (g.tiles || []).map(t => {
      const tileHtml = renderTile(t.tile, "tile-sm ukeire-tile-img");
      const countCls = t.furiten ? "rsc-count rsc-count-furiten" : "rsc-count";
      const countTip = t.furiten ? `${t.tile} — furiten (already discarded)` : `${t.tile} ×${t.count}`;
      return `<span class="rsc-tile-entry">${tileHtml}<span class="${countCls}" title="${countTip}">×${t.count}</span></span>`;
    }).join("");

    // Yaku / dora pills present on this wait (riichi token already stripped
    // upstream). On a riichi column the declared riichi is always shown as its
    // own pill — even alongside natural yaku — so the +1 han is explicit.
    const tagParts = [];
    if (riichi) tagParts.push(`<span class="yaku-tag riichi-yaku">riichi</span>`);
    const hasYaku = g.yaku && g.yaku.length;
    if (hasYaku) for (const y of g.yaku) tagParts.push(`<span class="yaku-tag">${y}</span>`);
    if (g.dora) tagParts.push(`<span class="yaku-tag dora-tag">dora ${g.dora}</span>`);
    if (g.aka) tagParts.push(`<span class="yaku-tag dora-tag">aka ${g.aka}</span>`);
    const yakuTags = `<span class="rsc-yaku">${tagParts.join(" ")}</span>`;

    let body = "";
    if (g.ron) body += line("Ron", g.ron);
    else if (!riichi) body += `<span class="rsc-line rsc-noyaku" title="No yaku — a dama hand can't ron, only menzen-tsumo wins"><span class="rsc-mode">Ron</span><span class="rsc-pts">no yaku</span></span>`;
    body += line("Tsumo", g.tsumo);
    const bonus = (riichi && g.bonus > 0)
      ? `<span class="rsc-line rsc-bonus" title="Average ippatsu + uradora value on top of the riichi win"><span class="rsc-mode">+ ura</span><span class="rsc-pts">~${g.bonus.toLocaleString()}</span></span>`
      : "";
    return `<div class="rsc-group">${yakuTags}<span class="rsc-tiles">${tileEntries}</span>`
      + `<span class="rsc-vals">${body}${bonus}</span></div>`;
  }).join("");
  return `<div class="${cls}">${blocks}</div>`;
}
