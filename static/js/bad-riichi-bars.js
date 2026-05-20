// Per-wait EV bars for 5A (Bad Riichi) and 5B (Missed Riichi) mistake cards.
// Replaces the legacy chip strip with stacked Ron + Tsumo bars showing dama,
// riichi premium, and an ippatsu/ura EV tail per wait. Built off the bundled
// Riichi calculator already loaded for detectClosedHandYaku.
//
// Relies on globals from categorize-view.js (_mjaiToRiichiTile,
// _windToKazeInt, _SITUATIONAL_YAKU, _YAKU_LABEL) and tiles.js (renderTile).

// Approximation for the ippatsu + uradora tail. Derived to match the
// hand-tuned reference values in the design at typical 1-3 han hands; it
// roughly tracks "one extra han worth of value times the chance of getting
// one." Rounded to the nearest 100 so the number reads cleanly.
function _badRiichiBonusEv(riichiTen) {
  if (!riichiTen) return 0;
  return Math.round(riichiTen * 0.13 / 100) * 100;
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
  const extras = (opts.riichi ? "r" : "") + `${bakaze}${jikaze}`;

  let data;
  if (opts.tsumo) {
    const hand14 = hand13.slice();
    hand14.push(winTile);
    const handStr = _formatRiichiTsumoHandStr(hand14, winTile);
    if (!handStr) return null;
    data = `${handStr}+${extras}`;
  } else {
    const handStr = _formatRiichiHandStr(hand13);
    const winR = _mjaiToRiichiTile(winTile);
    data = `${handStr}+${winR}+${extras}`;
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
  const yaku = [];
  for (const jp in result.yaku) {
    if (jp === "ドラ" || jp === "赤ドラ") continue;
    hasRealYaku = true;
    if (_SITUATIONAL_YAKU && _SITUATIONAL_YAKU.has(jp)) continue;
    yaku.push((_YAKU_LABEL && _YAKU_LABEL[jp]) || jp);
  }
  if (!hasRealYaku) return null;
  return { han: result.han, fu: result.fu, ten: result.ten, yaku };
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

// Per-card evaluation. For each wait, computes dama and riichi scores under
// both ron and tsumo. yaku is the union of natural-shape yaku across modes
// (with situational ones stripped) — what the design labels "yaku already
// present on dama".
function _buildBadRiichiWaitEval(m) {
  const hand13 = _badRiichiTenpaiHand(m);
  if (!hand13) return null;
  const waits = (typeof tenpaiWaitTiles === "function") ? tenpaiWaitTiles(m) : [];
  if (!waits.length) return null;

  const furitenSet = new Set(m.furiten_tiles || []);
  const out = [];
  for (const w of waits) {
    if (!w || !w.tile) continue;
    const ronDama = _evalWaitScore(hand13, w.tile, m, { riichi: false, tsumo: false });
    const ronRiichi = _evalWaitScore(hand13, w.tile, m, { riichi: true,  tsumo: false });
    const tsumoDama = _evalWaitScore(hand13, w.tile, m, { riichi: false, tsumo: true });
    const tsumoRiichi = _evalWaitScore(hand13, w.tile, m, { riichi: true,  tsumo: true });

    // Natural-shape yaku (dama wins) for this wait. Falls back to riichi's
    // yaku minus the riichi token when dama is impossible.
    let yaku = (ronDama && ronDama.yaku) || (tsumoDama && tsumoDama.yaku) || [];
    yaku = yaku.filter(y => y && y !== "立直");

    out.push({
      tile: w.tile,
      count: w.count || 0,
      furiten: furitenSet.has(w.tile),
      yaku,
      ronDama, ronRiichi, tsumoDama, tsumoRiichi,
    });
  }
  return out.length ? out : null;
}

function _fmtPts(n) {
  if (n == null) return "";
  return n.toLocaleString();
}

function _renderBarBlock(modeLabel, dama, riichi, bonus, scaleMax) {
  // No-yaku case: dama is impossible (e.g. ron with no yaku). Show riichi
  // value as the full bar — no comparison framing.
  const hasDama = dama && dama.ten > 0;
  const hasRiichi = riichi && riichi.ten > 0;
  if (!hasRiichi) return "";

  const pct = v => Math.max(0, Math.min(100, (v / scaleMax) * 100));
  const riichiW = pct(riichi.ten);
  const damaW = hasDama ? pct(dama.ten) : 0;
  const bonusW = bonus > 0 ? pct(bonus) : 0;

  let breakdown = `<span class="bd-mode">${modeLabel}</span>`;
  if (hasDama) {
    breakdown += `<span class="bd-item dama">
        <span class="bd-tag">Dama</span>
        <span class="bd-hanfu">${dama.han} han · ${dama.fu} fu</span>
        <span class="bd-points">${_fmtPts(dama.ten)}</span>
      </span>
      <span class="bd-sep">+</span>
      <span class="bd-item riichi">
        <span class="bd-tag">Riichi</span>
        <span class="bd-hanfu">${riichi.han} han · ${riichi.fu} fu</span>
        <span class="bd-points">+${_fmtPts(riichi.ten - dama.ten)}</span>
      </span>`;
  } else {
    breakdown += `<span class="bd-item riichi">
        <span class="bd-tag">Riichi</span>
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

function _renderWaitRow(w, scaleMax) {
  const ronBonus = w.ronRiichi ? _badRiichiBonusEv(w.ronRiichi.ten) : 0;
  const tsumoBonus = w.tsumoRiichi ? _badRiichiBonusEv(w.tsumoRiichi.ten) : 0;

  const yakuTags = w.yaku && w.yaku.length
    ? w.yaku.map(y => `<span class="yaku-tag">${y}</span>`).join(" ")
    : `<span class="yaku-none">no yaku — riichi only</span>`;

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

  const tileHtml = (typeof renderTile === "function")
    ? renderTile(w.tile, "tile-big-wait")
    : w.tile;
  const countCls = w.furiten ? "live-count live-count-furiten" : "live-count";
  const countTip = w.furiten ? `${w.tile} — furiten (already discarded)` : `${w.tile} ×${w.count}`;

  return `<div class="bar-row">
    <div class="bar-tile-col">
      ${tileHtml}
      <span class="${countCls}" title="${countTip}">×${w.count}</span>
    </div>
    <div class="bar-body">
      <div class="bar-meta">
        <span class="yaku-list">${yakuTags}</span>
        ${verdict}
      </div>
      <div class="bar-stack">
        ${_renderBarBlock("Ron",   w.ronDama,   w.ronRiichi,   ronBonus,   scaleMax)}
        ${_renderBarBlock("Tsumo", w.tsumoDama, w.tsumoRiichi, tsumoBonus, scaleMax)}
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

  const totalLive = evals.reduce((a, w) => a + (w.count || 0), 0);
  const types = evals.length;
  const heading = `${types} type${types === 1 ? "" : "s"} · ${totalLive} live tile${totalLive === 1 ? "" : "s"}`;
  const isMissedRiichi = m.category === "5B";
  const headerLabel = isMissedRiichi ? "Tenpai waits — riichi would gain" : "Tenpai waits";

  const rows = evals.map(w => _renderWaitRow(w, scaleMax)).join("");

  return `<div class="bad-riichi-waits-section">
    <div class="waits-section-head">
      <span class="h-label">${headerLabel}</span>
      <span class="h-count">${heading}</span>
      <span class="scope-pill both"><span class="dot"></span>Ron + Tsumo</span>
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
