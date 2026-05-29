// Closed-hand yaku detection for the 5A (Bad Riichi) explanation card and
// per-wait bars. Walks every tenpai wait, asks the bundled riichi calculator
// what yaku the completed hand earns on ron, and returns the union of
// natural-shape yaku as English/romaji labels.
//
// Also exposes the mjai → riichi-package tile/wind converters
// (_mjaiToRiichiTile, _windToKazeInt, _formatRiichiHandStr) and the
// situational-yaku filter set — both consumed by bad-riichi-bars.js too.
//
// Load order: depends on the riichi-bundle vendor script (window.Riichi).
// categorize-metadata.js may also load first; this file does not depend on
// CATEGORY_INFO directly but follows the metadata → yaku → explanations
// convention for clarity.

// Convert our mjai tile notation to the riichi-package's notation
// (1m–9m, 0m for red 5m, 1z–7z for honors E/S/W/N/P/F/C).
function _mjaiToRiichiTile(t) {
  switch (t) {
    case "E": return "1z";
    case "S": return "2z";
    case "W": return "3z";
    case "N": return "4z";
    case "P": return "5z";  // haku
    case "F": return "6z";  // hatsu
    case "C": return "7z";  // chun
    case "5mr": return "0m";
    case "5pr": return "0p";
    case "5sr": return "0s";
    default:   return t;     // 1m..9s already match
  }
}

function _windToKazeInt(w) {
  return { E: 1, S: 2, W: 3, N: 4 }[w] || 0;
}

// Compact "234m1p55z"-style notation from an array of mjai tiles.
function _formatRiichiHandStr(mjaiTiles) {
  const groups = { m: [], p: [], s: [], z: [] };
  for (const t of mjaiTiles) {
    const r = _mjaiToRiichiTile(t);
    if (r.length !== 2) continue;
    const suit = r[1];
    if (groups[suit]) groups[suit].push(r[0]);
  }
  let out = "";
  for (const suit of ["m", "p", "s", "z"]) {
    if (groups[suit].length) out += groups[suit].join("") + suit;
  }
  return out;
}

// Situational/board yaku we don't want to surface here: the user is asking
// "would dama win?" — the answer should describe the natural hand shape, not
// the yaku you'd only earn by declaring riichi or by drawing the haitei.
var _SITUATIONAL_YAKU = new Set([
  "立直", "ダブル立直", "一発", "門前清自摸和",
  "嶺上開花", "搶槓", "海底摸月", "河底撈魚",
  "天和", "地和", "人和",
  "ドラ", "赤ドラ",
]);

var _YAKU_LABEL = {
  // 1 han
  "平和": "pinfu",
  "断么九": "tanyao",
  "一盃口": "iipeikou",
  "役牌白": "yakuhai (haku)",
  "役牌発": "yakuhai (hatsu)",
  "役牌中": "yakuhai (chun)",
  "場風東": "yakuhai (round east)",
  "場風南": "yakuhai (round south)",
  "場風西": "yakuhai (round west)",
  "場風北": "yakuhai (round north)",
  "自風東": "yakuhai (seat east)",
  "自風南": "yakuhai (seat south)",
  "自風西": "yakuhai (seat west)",
  "自風北": "yakuhai (seat north)",
  // 2 han
  "二盃口": "ryanpeikou",
  "一気通貫": "ittsu",
  "三色同順": "sanshoku",
  "三色同刻": "sanshoku doukou",
  "対々和": "toitoi",
  "三暗刻": "sanankou",
  "三槓子": "sankantsu",
  "混老頭": "honroutou",
  "小三元": "shousangen",
  "七対子": "chiitoitsu",
  "混全帯么九": "chanta",
  // 3 han
  "純全帯么九": "junchan",
  "混一色": "honitsu",
  // 6 han
  "清一色": "chinitsu",
  // Yakuman
  "国士無双": "kokushi musou",
  "国士無双十三面待ち": "kokushi (13-sided)",
  "四暗刻": "suuankou",
  "四暗刻単騎待ち": "suuankou tanki",
  "大三元": "daisangen",
  "小四喜": "shousuushii",
  "大四喜": "daisuushii",
  "字一色": "tsuuiisou",
  "緑一色": "ryuuiisou",
  "清老頭": "chinroutou",
  "四槓子": "suukantsu",
  "九蓮宝燈": "chuuren poutou",
  "純正九蓮宝燈": "pure chuuren poutou",
  "大七星": "daichisei",
};

// Detect closed-hand yaku that would resolve a dama win for a 5A (Bad Riichi)
// mistake. Walks every tenpai wait, asks the bundled riichi calculator what
// yaku the completed hand earns on ron, and returns the union of natural-shape
// yaku as English/romaji labels. Situational yaku (riichi, ippatsu, tsumo,
// haitei…) are stripped so the list only reflects "the hand is already worth
// something without declaring."
function detectClosedHandYaku(m) {
  if (typeof window === "undefined" || !window.Riichi) return [];
  let hand = (m.hand || []).slice();
  // For 5A the pre-discard hand is 14 tiles; drop the riichi tile.
  if (hand.length === 14) {
    const riichiTile = m.actual_riichi_tile || (m.actual && m.actual.pai);
    if (!riichiTile) return [];
    const idx = hand.indexOf(riichiTile);
    if (idx < 0) return [];
    hand.splice(idx, 1);
  }
  if (hand.length !== 13) return [];
  const waits = tenpaiWaitTiles(m);
  if (!waits.length) return [];

  const bs = m.board_state || {};
  const bakaze = _windToKazeInt(bs.round_wind) || 1;
  const jikaze = _windToKazeInt(bs.seat_wind) || 2;
  const kazeSuffix = `${bakaze}${jikaze}`;

  const handStr = _formatRiichiHandStr(hand);
  const seen = new Set();
  for (const w of waits) {
    if (!w || !w.tile) continue;
    const winTile = _mjaiToRiichiTile(w.tile);
    // `+<winTile>` flags ron in the parser, so menzen-tsumo doesn't trigger.
    const data = `${handStr}+${winTile}+${kazeSuffix}`;
    let result;
    try {
      result = new window.Riichi(data).calc();
    } catch (e) {
      continue;
    }
    if (!result || !result.isAgari) continue;
    for (const jp in result.yaku) {
      if (_SITUATIONAL_YAKU.has(jp)) continue;
      seen.add(_YAKU_LABEL[jp] || jp);
    }
  }
  return Array.from(seen);
}
