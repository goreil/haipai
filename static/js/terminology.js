// Display-only terminology: calculation keys, data attributes and stored game
// data always retain their original names. Observe rendered content so async
// analysis, expanded hands and trainer updates use the same preference.
(function (root) {
  "use strict";
  const storageKey = "haipai_terminology";
  const names = {
    "double riichi": "double ready", "daburu riichi": "double ready",
    "menzen tsumo": "fully concealed self-draw", "menzenchin tsumohou": "fully concealed self-draw",
    "sanshoku doukou": "triple triplets", "sanshoku doujun": "mixed triple sequence",
    "suuankou tanki": "four concealed triplets (single wait)",
    "pure chuuren poutou": "pure nine gates", "chuuren poutou": "nine gates",
    "kokushi musou": "thirteen orphans",
    ukeire: "acceptance", shanten: "away", tenpai: "ready", noten: "not ready",
    yakus: "scoring patterns", yaku: "scoring pattern", yakuman: "maximum limit hand",
    riichi: "ready", dama: "silent ready", damaten: "silent ready",
    pinfu: "no-points", tanyao: "all simples", iipeikou: "pure double sequence",
    iipeiko: "pure double sequence", ryanpeikou: "twice pure double sequence",
    yakuhai: "value honors", haku: "white dragon", hatsu: "green dragon", chun: "red dragon",
    ittsuu: "pure straight", ittsu: "pure straight", sanshoku: "mixed triple sequence",
    toitoi: "all triplets", sanankou: "three concealed triplets", sankantsu: "three quads",
    honroutou: "all terminals and honors", shousangen: "little three dragons",
    chiitoitsu: "seven pairs", chiitoi: "seven pairs", chanta: "mixed outside",
    junchan: "pure outside", honitsu: "half flush", chinitsu: "full flush",
    kokushi: "thirteen orphans", suuankou: "four concealed triplets",
    daisangen: "big three dragons", shousuushii: "little four winds", daisuushii: "big four winds",
    tsuuiisou: "all honors", ryuuiisou: "all green", chinroutou: "all terminals",
    suukantsu: "four quads", daichisei: "seven honor pairs",
    ippatsu: "one shot", rinshan: "after a quad", "rinshan kaihou": "after a quad",
    chankan: "robbing a quad", haitei: "last tile draw", houtei: "last tile discard",
    tenhou: "heavenly hand", chiihou: "earthly hand", renhou: "hand of man",
    furiten: "discard win restriction", genbutsu: "known safe", suji: "safe sequence lines",
    ryanmen: "two-sided wait", kanchan: "closed wait", penchan: "edge wait",
    tanki: "single wait", shanpon: "pair wait", shabo: "pair wait",
    ankan: "concealed quad", kakan: "added quad", daiminkan: "open quad",
    tsumo: "self-draw", ron: "discard win", pon: "triplet call", chi: "sequence call", kan: "quad",
    dora: "bonus", uradora: "hidden bonus", "ura dora": "hidden bonus",
    "aka dora": "red bonus",
  };
  const pattern = new RegExp("\\b(?:" + Object.keys(names).sort((a, b) => b.length - a.length).join("|") + ")\\b", "gi");
  function translate(text) {
    return text.replace(pattern, match => {
      const replacement = names[match.toLowerCase()];
      if (match === match.toUpperCase()) return replacement.toUpperCase();
      if (match[0] === match[0].toUpperCase()) return replacement[0].toUpperCase() + replacement.slice(1);
      return replacement;
    });
  }

  let language = "japanese";
  try { if (root.localStorage.getItem(storageKey) === "english") language = "english"; } catch (_) { /* private mode */ }
  const originals = new WeakMap();
  const excluded = 'script, style, textarea, input, select, code, pre, [contenteditable], '
    + '[data-terminology="ignore"], .account-section, .account-msg, .admin-card, .df-lb-name, .wt-lb-name, .ef-lb-name';
  const attributes = ["title", "aria-label", "alt"];

  function update(node, key, value, write) {
    let records = originals.get(node);
    if (!records) { records = {}; originals.set(node, records); }
    let record = records[key];
    // A renderer may reuse a node with new source text; don't restore stale text.
    if (!record || value !== record.output) record = { source: value };
    record.output = language === "english" ? translate(record.source) : record.source;
    records[key] = record;
    if (value !== record.output) write(record.output);
  }

  function render(node) {
    const element = node.nodeType === 1 ? node : node.parentElement;
    if (!element || element.closest(excluded)) return;
    if (node.nodeType === 3) {
      update(node, "text", node.nodeValue, value => { node.nodeValue = value; });
      return;
    }
    if (node.nodeType !== 1) return;
    for (const attr of attributes) {
      if (node.hasAttribute(attr)) update(node, attr, node.getAttribute(attr), value => node.setAttribute(attr, value));
    }
    for (const child of node.childNodes) render(child);
  }

  let observer;
  function refresh() {
    const content = root.document.getElementById("content");
    if (!content) return;
    if (observer) observer.disconnect();
    render(content);
    if (observer) observe(content);
  }
  function observe(content) {
    observer.observe(content, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: attributes });
  }
  function setLanguage(value) {
    language = value === "english" ? "english" : "japanese";
    let saved = true;
    try { root.localStorage.setItem(storageKey, language); } catch (_) { saved = false; }
    refresh();
    return saved;
  }
  root.HaipaiTerminology = { translate, setLanguage, get language() { return language; } };
  if (!root.document) return; // Also usable in Node tests.
  function init() {
    const content = root.document.getElementById("content");
    if (!content) return;
    observer = new MutationObserver(records => {
      observer.disconnect(); // Our own display updates must not trigger another pass.
      for (const record of records) {
        if (record.type === "childList") {
          for (const node of record.addedNodes) render(node);
        } else render(record.target);
      }
      observe(content);
    });
    refresh();
  }
  if (root.document.readyState === "loading") root.document.addEventListener("DOMContentLoaded", init);
  else init();
  root.addEventListener("storage", event => {
    if (event.key !== storageKey && event.key !== null) return;
    language = event.newValue === "english" ? "english" : "japanese";
    refresh();
    const select = root.document.getElementById("terminology-select");
    if (select) select.value = language;
  });
})(typeof window === "undefined" ? globalThis : window);
