// Notation and display labels shared by the Value tab's wait scorer.

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

if (typeof module === "object" && module.exports) {
  module.exports = { _mjaiToRiichiTile, _windToKazeInt, _formatRiichiHandStr, _SITUATIONAL_YAKU, _YAKU_LABEL };
}
