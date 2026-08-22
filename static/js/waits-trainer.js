// Waits Trainer (#waits-trainer) — a falling-hands minigame.
//
// Pin-suit-only tenpai hands fall from the top of the stage; the player taps
// tiles from a nine-tile arsenal to "shoot" the target hand. Every wait must
// be hit (a two-sided wait needs both tiles) before the hand dissolves. A
// wrong shot costs the combo and hitstuns the arsenal; a hand that reaches
// the bottom costs a life and clears the stage.
//
// The mahjong logic (wait detection + random tenpai-hand generation, incl.
// the curated multi-sided shapes) is a JS port of djuretic/riichi-mahjong-
// trainer (MIT, Elm) — added as the reference-only `riichi-mahjong-trainer/`
// submodule, same arrangement as killer_mortal_gui: read it, don't import it.
// Upstream sources: src/Group.elm `winningTiles` / `isWinningHand` (the
// add-a-tile-and-decompose wait search), `randomCompleteGroups` /
// `randomTenpaiGroups` (hand generation), and `randomTatsumaki` /
// `randomRyanmentenWithNobetan` (the 5-sided shapes). Restricted to one suit
// here, so no honor/kokushi/chiitoi branches are needed.
//
// Everything below is client-side and stateless — no API, no DB. The best
// score is kept in localStorage.

// --- Tuning knobs -----------------------------------------------------------

// Hand sizes, their point value, and the combo needed before they spawn.
// "Bigger hands only after a combo" (the 4-tile hand is the baseline spawn).
var WT_HAND_TIERS = [
  { size: 4,  points: 1, unlockCombo: 0,  weight: 3 },
  { size: 7,  points: 2, unlockCombo: 5,  weight: 2 },
  { size: 10, points: 4, unlockCombo: 10, weight: 1 },
];

var WT_LIVES = 3;
// Two hands are always on the stage: clear the bottom one and the next is
// already there, with a replacement spawning the same frame — so a fast
// player is never left waiting on the spawn timer. The timer only adds
// hands *beyond* the minimum, as the difficulty ramp.
var WT_MIN_HANDS = 2;
var WT_MAX_HANDS = 4;        // concurrent hands on the stage
var WT_HAND_GAP = 10;        // px of clear air kept between stacked hands
var WT_STUN_SEC = 0.9;       // hitstun after a wrong shot
var WT_SHOT_COOLDOWN = 0.1;  // min gap between shots (anti-mash)
var WT_CLEAR_SEC = 1.2;      // grace pause after a life is lost
var WT_BEST_KEY = "haipai.waitsTrainer.best";
var WT_TILE_RATIO = 0.75;    // tile SVG aspect (300x400 viewBox)

// Difficulty ramp, driven by hands cleared this run. Falls are slow — the
// pressure comes from reading hands quickly enough to keep the queue moving,
// not from the drop rate.
function wtFallSeconds(cleared) { return Math.max(7, 18 - cleared * 0.3); }
function wtSpawnSeconds(cleared) { return Math.max(2.2, 5.5 - cleared * 0.09); }
// How many waits a hand may have. Two-sided only at the start, the curated
// 5-sided shapes only once the player is deep into a run.
function wtMaxWaits(cleared) { return cleared < 8 ? 2 : (cleared < 20 ? 3 : 5); }
function wtCuratedChance(cleared) { return cleared < 12 ? 0 : Math.min(0.3, (cleared - 12) * 0.02); }

// Index 0..8 -> mjai tile. One suit keeps the arsenal to nine buttons.
var WT_TILES = ["1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p"];

// --- Wait solver (port of Group.elm `winningTiles` / `isWinningHand`) --------

// Can `c` (9 counts, 1p..9p) be split into runs and triplets with nothing
// left over? Greedy on the lowest remaining tile, backtracking over the two
// ways to consume it.
function wtCanFormSets(c) {
  let i = 0;
  while (i < 9 && c[i] === 0) i++;
  if (i === 9) return true;
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = wtCanFormSets(c);
    c[i] += 3;
    if (ok) return true;
  }
  if (i <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = wtCanFormSets(c);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

// A 3n+2 hand wins when some pair can be set aside and the rest forms sets.
function wtIsWinningHand(c) {
  for (let p = 0; p < 9; p++) {
    if (c[p] < 2) continue;
    c[p] -= 2;
    const ok = wtCanFormSets(c);
    c[p] += 2;
    if (ok) return true;
  }
  return false;
}

// Every tile that completes this 3n+1 hand. A tile already held four times
// can't be the winning tile (upstream's `hasMoreThan4Tiles` guard).
function wtWaits(counts) {
  const c = counts.slice();
  const out = [];
  for (let t = 0; t < 9; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (wtIsWinningHand(c)) out.push(t);
    c[t]--;
  }
  return out;
}

// --- Hand generation (port of Group.elm `randomTenpaiGroups` + friends) ------

function wtRandInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }

function wtAddGroup(c, tripletWeight) {
  if (Math.random() * 100 < tripletWeight) {
    c[wtRandInt(0, 8)] += 3;
  } else {
    const n = wtRandInt(0, 6);
    c[n]++; c[n + 1]++; c[n + 2]++;
  }
}

function wtOver4(c) { return c.some((x) => x > 4); }

// Pair + `nGroups` runs/triplets, retried until no tile appears five times.
function wtCompleteHand(nGroups, tripletWeight) {
  for (let tries = 0; tries < 200; tries++) {
    const c = new Array(9).fill(0);
    c[wtRandInt(0, 8)] += 2;
    for (let i = 0; i < nGroups; i++) wtAddGroup(c, tripletWeight);
    if (!wtOver4(c)) return c;
  }
  return null;
}

function wtRemoveRandomTile(c) {
  const total = c.reduce((a, b) => a + b, 0);
  let k = wtRandInt(0, total - 1);
  for (let i = 0; i < 9; i++) {
    if (k < c[i]) { const d = c.slice(); d[i]--; return d; }
    k -= c[i];
  }
  return c.slice();
}

// Tatsumaki — 6667888p, waits 56789p (Group.elm `randomTatsumaki`).
function wtTatsumaki() {
  const c = new Array(9).fill(0);
  const b = wtRandInt(1, 4);
  c[b] += 3; c[b + 1] += 1; c[b + 2] += 3;
  return c;
}

// Ryanmenten with nobetan — 3334567m, waits 24578 (Group.elm
// `randomRyanmentenWithNobetan`): a 5-tile run plus a pair on either end.
function wtRyanmentenNobetan() {
  const c = new Array(9).fill(0);
  const b = wtRandInt(1, 4);
  for (let i = 0; i < 5; i++) c[b + i] += 1;
  c[Math.random() < 0.5 ? b : b + 4] += 2;
  return c;
}

// A curated multi-sided shape at the requested size. The 10-tile version is
// the 7-tile shape plus one more group (upstream stacks a second suit there;
// single-suit means we retry until the extra group fits under four copies).
function wtCuratedHand(size) {
  const base = Math.random() < 0.5 ? wtTatsumaki() : wtRyanmentenNobetan();
  if (size === 7) return base;
  if (size !== 10) return null;
  for (let tries = 0; tries < 40; tries++) {
    const c = base.slice();
    wtAddGroup(c, 33);
    if (!wtOver4(c)) return c;
  }
  return null;
}

// A tenpai hand of `size` tiles (4/7/10) with at most `maxWaits` waits.
// Returns {counts, waits}.
function wtGenerateHand(size, maxWaits, curatedChance) {
  const nGroups = (size - 1) / 3;
  for (let pass = 0; pass < 2; pass++) {
    // Second pass drops the maxWaits cap so generation can never fail.
    const cap = pass === 0 ? maxWaits : 9;
    for (let tries = 0; tries < 80; tries++) {
      let c = null;
      if (size >= 7 && Math.random() < curatedChance) c = wtCuratedHand(size);
      if (!c) {
        const full = wtCompleteHand(nGroups, 33);
        if (!full) continue;
        c = wtRemoveRandomTile(full);
      }
      const waits = wtWaits(c);
      if (!waits.length || waits.length > cap) continue;
      return { counts: c, waits };
    }
  }
  // Unreachable in practice; a fixed tenpai shape beats returning null.
  return { counts: [2, 1, 1, 0, 0, 0, 0, 0, 0], waits: wtWaits([2, 1, 1, 0, 0, 0, 0, 0, 0]) };
}

function wtCountsToTiles(counts) {
  const out = [];
  for (let i = 0; i < 9; i++) for (let n = 0; n < counts[i]; n++) out.push(i);
  return out;
}

// --- Game state -------------------------------------------------------------

// Null when the trainer isn't mounted. The rAF loop self-terminates as soon
// as the stage element is gone (i.e. the user routed to another view), so
// there's nothing to tear down on navigation.
var wt = null;

function wtBestScore() {
  const v = parseInt(localStorage.getItem(WT_BEST_KEY) || "0", 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function wtSaveBest(score) {
  if (score > wtBestScore()) {
    try { localStorage.setItem(WT_BEST_KEY, String(score)); } catch (e) { /* private mode */ }
  }
}

// --- View -------------------------------------------------------------------

function showWaitsTrainer() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  // Don't inherit the last-viewed game's dora set — renderTile() would paint
  // random arsenal tiles orange.
  setActiveDora([]);

  document.getElementById("content").innerHTML = wtShellHtml();
  wtSyncTileSize();
  wtNewGame();
  wt.phase = "intro";
  wtRenderOverlay();
  wtRenderHud();
  wt.raf = requestAnimationFrame(wtLoop);
}

function wtShellHtml() {
  let ammo = "";
  for (let i = 0; i < 9; i++) {
    ammo += `<button type="button" class="wt-ammo" data-action="wtShoot" data-tile-idx="${i}" aria-label="Shoot ${WT_TILES[i]}">
      ${renderTile(WT_TILES[i], "wt-ammo-tile")}
      <span class="wt-ammo-key">${i + 1}</span>
    </button>`;
  }
  return `<div class="wt-wrap">
    <div class="wt-hud">
      <div class="wt-lives" id="wt-lives"></div>
      <div class="wt-score-box">
        <div class="wt-score" id="wt-score">0</div>
        <div class="wt-sub">best <span id="wt-best">0</span></div>
      </div>
      <div class="wt-combo" id="wt-combo"></div>
    </div>
    <div class="wt-stage" id="wt-stage">
      <div class="wt-hands" id="wt-hands"></div>
      <div class="wt-fx" id="wt-fx"></div>
      <div class="wt-overlay" id="wt-overlay"></div>
    </div>
    <div class="wt-arsenal" id="wt-arsenal">${ammo}</div>
  </div>`;
}

function wtNewGame() {
  const stage = document.getElementById("wt-stage");
  if (stage) {
    // Drop anything left mid-animation from the previous run (dissolving
    // hands, the life-lost tint, an in-flight shake).
    document.getElementById("wt-hands").innerHTML = "";
    document.getElementById("wt-fx").innerHTML = "";
    stage.classList.remove("wt-cleared", "wt-shake");
    document.getElementById("wt-arsenal").classList.remove("wt-stunned");
  }
  wt = {
    phase: "playing",       // intro | playing | cleared | paused | over
    hands: [],
    nextId: 1,
    targetId: null,
    score: 0,
    combo: 0,
    bestCombo: 0,
    cleared: 0,
    lives: WT_LIVES,
    spawnTimer: 0.6,
    clearTimer: 0,
    stunUntil: 0,
    cooldownUntil: 0,
    now: 0,
    lastTs: 0,
    stageW: 0,
    stageH: 0,
    raf: 0,
  };
}

// --- Hands ------------------------------------------------------------------

// Weighted pick among the tiers the current combo has unlocked.
function wtPickTier(combo) {
  const open = WT_HAND_TIERS.filter((t) => combo >= t.unlockCombo);
  const total = open.reduce((s, t) => s + t.weight, 0);
  let r = Math.random() * total;
  for (const t of open) { r -= t.weight; if (r <= 0) return t; }
  return open[0];
}

// Falling-hand tiles are drawn at the same width as the arsenal tiles below,
// so a tile you're reading looks exactly like the tile you're about to fire.
// The only cap is that a 10-tile hand still has to fit the stage — on a narrow
// phone that's the binding constraint, everywhere else the arsenal is. Writes
// `--wt-tile-h` on .wt-wrap; the stylesheet's value is only the pre-mount
// fallback.
function wtSyncTileSize() {
  const wrap = document.querySelector(".wt-wrap");
  const stage = document.getElementById("wt-stage");
  const ammo = document.querySelector(".wt-ammo-tile");
  if (!wrap || !stage || !ammo) return;
  // Measure the arsenal tile's WIDTH, not its height: the img is `width:100%;
  // height:auto`, so its width comes from the grid column and is correct even
  // before the SVG has loaded, while its height is 0 until then.
  const ammoW = ammo.getBoundingClientRect().width;
  // 10 tiles + 9 gaps + the hand's own padding/border must fit the stage.
  const perTile = (stage.clientWidth - 22 - 9) / 10;
  const h = Math.max(18, Math.min(ammoW, perTile) / WT_TILE_RATIO);
  wrap.style.setProperty("--wt-tile-h", h.toFixed(1) + "px");
}

// Re-measure every hand's box. Needed after the tile size changes (mount,
// resize, orientation flip) since the fall math works off the measured height.
function wtRemeasureHands() {
  for (const h of wt.hands) { h.w = h.el.offsetWidth; h.h = h.el.offsetHeight; }
}

// Keep the stack from overlapping: walk the hands top-down and push any hand
// that sits too close to the one above it further down. This is what makes
// "clear the bottom hand, a new one appears at the top" readable — the
// survivor slides clear of the newcomer instead of being drawn over it.
// A push never goes past 0.92 of the drop, so a crowded stage can't shove a
// hand straight through the floor.
function wtSpaceHands() {
  const sorted = [...wt.hands].sort((a, b) => a.prog - b.prog);
  let minY = 0;
  for (const h of sorted) {
    const travel = Math.max(1, wt.stageH - h.h);
    if (h.prog * travel < minY) h.prog = Math.min(0.92, minY / travel);
    minY = h.prog * travel + h.h + WT_HAND_GAP;
  }
}

function wtSpawnHand() {
  const tier = wtPickTier(wt.combo);
  const gen = wtGenerateHand(tier.size, wtMaxWaits(wt.cleared), wtCuratedChance(wt.cleared));
  const h = {
    id: wt.nextId++,
    tiles: wtCountsToTiles(gen.counts),
    waits: gen.waits,
    hit: new Set(),
    points: tier.points,
    prog: 0,
    rate: 1 / wtFallSeconds(wt.cleared),
    xFrac: Math.random(),
    dead: false,
    el: null,
    w: 0,
    h: 0,
  };

  const el = document.createElement("div");
  el.className = "wt-hand" + (h.waits.length >= 4 ? " wt-hand-multi" : "");
  el.dataset.action = "wtTarget";
  el.dataset.handId = String(h.id);
  el.innerHTML = `
    <div class="wt-hand-tiles">${h.tiles.map((t) => renderTile(WT_TILES[t], "wt-tile")).join("")}</div>
    <div class="wt-hand-foot">
      <span class="wt-hand-pts">+${h.points}</span>
      <span class="wt-slots">${h.waits.map(() => `<span class="wt-slot">?</span>`).join("")}</span>
    </div>`;
  document.getElementById("wt-hands").appendChild(el);
  h.el = el;
  h.w = el.offsetWidth;
  h.h = el.offsetHeight;
  wt.hands.push(h);
  wtSpaceHands();
}

// The hand shots go to: the player's tapped pick while it lives, otherwise
// the one closest to the bottom.
function wtTargetHand() {
  const live = wt.hands.filter((h) => !h.dead);
  if (!live.length) return null;
  if (wt.targetId != null) {
    const picked = live.find((h) => h.id === wt.targetId);
    if (picked) return picked;
    wt.targetId = null;
  }
  return live.reduce((a, b) => (b.prog > a.prog ? b : a));
}

function wtTarget(el) {
  if (!wt || wt.phase !== "playing") return;
  const id = parseInt(el.dataset.handId, 10);
  wt.targetId = wt.targetId === id ? null : id;
}

function wtRemoveHand(h) {
  h.dead = true;
  if (wt.targetId === h.id) wt.targetId = null;
  h.el.classList.add("wt-dissolve");
  const el = h.el;
  setTimeout(() => el.remove(), 320);
  wt.hands = wt.hands.filter((x) => x !== h);
}

// --- Shooting ---------------------------------------------------------------

function wtShoot(idx) {
  if (!wt) return;
  if (wt.phase === "intro" || wt.phase === "paused") { wtStart(); return; }
  if (wt.phase !== "playing") return;
  if (wt.now < wt.stunUntil || wt.now < wt.cooldownUntil) return;
  const h = wtTargetHand();
  if (!h) return;

  wt.cooldownUntil = wt.now + WT_SHOT_COOLDOWN;
  const correct = h.waits.includes(idx) && !h.hit.has(idx);
  wtFireShot(idx, h, correct);

  if (correct) {
    h.hit.add(idx);
    wtRenderSlots(h);
    h.el.classList.remove("wt-flash-ok");
    void h.el.offsetWidth;
    h.el.classList.add("wt-flash-ok");
    if (h.hit.size === h.waits.length) wtClearHand(h);
  } else {
    wt.combo = 0;
    wt.stunUntil = wt.now + WT_STUN_SEC;
    const stage = document.getElementById("wt-stage");
    stage.classList.remove("wt-shake");
    void stage.offsetWidth;
    stage.classList.add("wt-shake");
    document.getElementById("wt-arsenal").classList.add("wt-stunned");
    wtRenderHud();
  }
}

function wtClearHand(h) {
  wt.score += h.points;
  wt.combo += 1;
  wt.bestCombo = Math.max(wt.bestCombo, wt.combo);
  wt.cleared += 1;
  wtFloat(`+${h.points}`, h, "ok");
  // Announce a newly unlocked hand size the moment the combo reaches it.
  const unlocked = WT_HAND_TIERS.find((t) => t.unlockCombo === wt.combo);
  if (unlocked) wtBanner(`${unlocked.size}-tile hands unlocked`);
  wtRemoveHand(h);
  wtRenderHud();
}

function wtRenderSlots(h) {
  const slots = h.el.querySelectorAll(".wt-slot");
  let i = 0;
  for (const w of h.waits) {
    const el = slots[i++];
    if (!el) continue;
    if (h.hit.has(w)) {
      el.classList.add("filled");
      el.innerHTML = renderTile(WT_TILES[w], "wt-slot-tile");
    }
  }
}

// Cosmetic projectile: the outcome is already decided, this just sells it.
function wtFireShot(idx, hand, ok) {
  const stage = document.getElementById("wt-stage");
  const btn = document.querySelector(`.wt-ammo[data-tile-idx="${idx}"]`);
  if (!stage || !btn) return;
  const sr = stage.getBoundingClientRect();
  const br = btn.getBoundingClientRect();
  const hr = hand.el.getBoundingClientRect();
  const p = document.createElement("div");
  p.className = "wt-shot" + (ok ? " ok" : " bad");
  p.innerHTML = renderTile(WT_TILES[idx], "wt-shot-tile");
  document.getElementById("wt-fx").appendChild(p);
  const from = `translate(${br.left + br.width / 2 - sr.left}px, ${sr.height + 10}px) translate(-50%, -50%)`;
  const to = `translate(${hr.left + hr.width / 2 - sr.left}px, ${hr.top + hr.height / 2 - sr.top}px) translate(-50%, -50%) scale(${ok ? 1.15 : 0.7})`;
  const anim = p.animate(
    [{ transform: from, opacity: 1 }, { transform: to, opacity: ok ? 0.9 : 0 }],
    { duration: 150, easing: "cubic-bezier(.2,.7,.4,1)" }
  );
  anim.onfinish = () => p.remove();
  setTimeout(() => p.remove(), 400);
}

function wtFloat(text, hand, kind) {
  const stage = document.getElementById("wt-stage");
  if (!stage) return;
  const sr = stage.getBoundingClientRect();
  const hr = hand.el.getBoundingClientRect();
  const el = document.createElement("div");
  el.className = `wt-float wt-float-${kind}`;
  el.textContent = text;
  el.style.left = `${hr.left + hr.width / 2 - sr.left}px`;
  el.style.top = `${hr.top + hr.height / 2 - sr.top}px`;
  document.getElementById("wt-fx").appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function wtBanner(text) {
  const fx = document.getElementById("wt-fx");
  if (!fx) return;
  const el = document.createElement("div");
  el.className = "wt-banner";
  el.textContent = text;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// --- Loop -------------------------------------------------------------------

function wtLoop(ts) {
  const stage = document.getElementById("wt-stage");
  if (!stage || !wt) { wt = null; return; }   // routed away — stop the loop
  wt.raf = requestAnimationFrame(wtLoop);
  // Read the stage box once per frame, before anything spawns or positions.
  wt.stageW = stage.clientWidth;
  wt.stageH = stage.clientHeight;

  const dt = wt.lastTs ? Math.min(0.05, (ts - wt.lastTs) / 1000) : 0;
  wt.lastTs = ts;
  wt.now += dt;

  if (wt.now >= wt.stunUntil) {
    document.getElementById("wt-arsenal").classList.remove("wt-stunned");
  }

  if (wt.phase === "cleared") {
    wt.clearTimer -= dt;
    if (wt.clearTimer <= 0) {
      wt.phase = "playing";
      stage.classList.remove("wt-cleared");
      wt.spawnTimer = 0.4;
    }
  }
  if (wt.phase !== "playing") { wtPositionHands(); return; }

  // Refill to the minimum with no delay — dissolving the bottom hand puts a
  // fresh one on the stage the same frame. The timer only stacks hands on
  // top of that floor.
  while (wt.hands.length < WT_MIN_HANDS) wtSpawnHand();
  wt.spawnTimer -= dt;
  if (wt.spawnTimer <= 0 && wt.hands.length < WT_MAX_HANDS) {
    wtSpawnHand();
    wt.spawnTimer = wtSpawnSeconds(wt.cleared);
  }

  for (const h of wt.hands) h.prog += h.rate * dt;
  wtPositionHands();

  const landed = wt.hands.find((h) => h.prog >= 1);
  if (landed) wtLoseLife();
}

function wtPositionHands() {
  const target = wt.phase === "playing" ? wtTargetHand() : null;
  for (const h of wt.hands) {
    if (!h.w) { h.w = h.el.offsetWidth; h.h = h.el.offsetHeight; }
    const x = Math.max(2, Math.min(h.xFrac * (wt.stageW - h.w), wt.stageW - h.w - 2));
    const y = Math.max(0, Math.min(1, h.prog)) * Math.max(0, wt.stageH - h.h);
    h.el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    h.el.classList.toggle("wt-targeted", target === h);
  }
}

function wtLoseLife() {
  wt.lives -= 1;
  wt.combo = 0;
  wt.targetId = null;
  // The whole stage is wiped, not just the hand that landed.
  for (const h of wt.hands.slice()) wtRemoveHand(h);
  wtRenderHud();
  if (wt.lives <= 0) {
    wt.phase = "over";
    wtSaveBest(wt.score);
    wtRenderHud();
    wtRenderOverlay();
    return;
  }
  wt.phase = "cleared";
  wt.clearTimer = WT_CLEAR_SEC;
  document.getElementById("wt-stage").classList.add("wt-cleared");
}

// --- HUD / overlay ----------------------------------------------------------

function wtRenderHud() {
  const lives = document.getElementById("wt-lives");
  if (!lives) return;
  let hearts = "";
  for (let i = 0; i < WT_LIVES; i++) {
    hearts += `<span class="wt-heart${i < wt.lives ? "" : " lost"}">&#9829;</span>`;
  }
  lives.innerHTML = hearts;
  document.getElementById("wt-score").textContent = wt.score;
  document.getElementById("wt-best").textContent = Math.max(wtBestScore(), wt.score);
  const combo = document.getElementById("wt-combo");
  combo.className = "wt-combo" + (wt.combo >= 5 ? " hot" : "");
  combo.innerHTML = `<span class="wt-combo-n">${wt.combo}</span><span class="wt-combo-l">combo</span>`;
}

function wtRenderOverlay() {
  const ov = document.getElementById("wt-overlay");
  if (!ov) return;
  if (wt.phase === "playing" || wt.phase === "cleared") {
    ov.className = "wt-overlay";
    ov.innerHTML = "";
    return;
  }
  ov.className = "wt-overlay show";
  if (wt.phase === "over") {
    ov.innerHTML = `<div class="wt-panel">
      <h3>Game over</h3>
      <div class="wt-result">
        <div><span class="wt-result-n">${wt.score}</span><span>score</span></div>
        <div><span class="wt-result-n">${wt.bestCombo}</span><span>best combo</span></div>
        <div><span class="wt-result-n">${wt.cleared}</span><span>hands</span></div>
      </div>
      <p class="wt-hint">Personal best: ${wtBestScore()}</p>
      <button class="btn btn-primary" data-action="wtStart" type="button">Play again</button>
    </div>`;
    return;
  }
  if (wt.phase === "paused") {
    ov.innerHTML = `<div class="wt-panel">
      <h3>Paused</h3>
      <button class="btn btn-primary" data-action="wtStart" type="button">Resume</button>
    </div>`;
    return;
  }
  ov.innerHTML = `<div class="wt-panel">
    <h3>Waits Trainer</h3>
    <p class="wt-hint">Tenpai hands fall from the top. Shoot the tile they're waiting on — a two-sided wait needs <b>both</b> tiles before the hand dissolves.</p>
    <ul class="wt-rules">
      <li>Tap a falling hand to aim at it; otherwise you shoot the lowest one.</li>
      <li>A wrong tile breaks your combo and stuns you for a moment.</li>
      <li>4-tile hands = 1 point. 7-tile at combo 5, 10-tile at combo 10, worth 2 and 4.</li>
      <li>A hand reaching the floor costs a life and wipes the stage. You have 3.</li>
    </ul>
    <button class="btn btn-primary" data-action="wtStart" type="button">Start</button>
  </div>`;
}

function wtStart() {
  if (!wt) return;
  if (wt.phase === "paused") {
    wt.phase = "playing";
    wtRenderOverlay();
    return;
  }
  const keep = wt.raf;
  wtNewGame();
  wt.raf = keep;
  // Re-sync in case the arsenal only reached its final layout after mount.
  wtSyncTileSize();
  wtRenderHud();
  wtRenderOverlay();
}

function wtPause() {
  if (!wt || wt.phase !== "playing") return;
  wt.phase = "paused";
  wtRenderOverlay();
}

// --- Global listeners (registered once at load; no-ops off the trainer) ------

document.addEventListener("visibilitychange", () => {
  if (document.hidden) wtPause();
});

// Resize / orientation flip: the arsenal (and so the hand tiles) re-lays out,
// which changes every hand's measured box.
window.addEventListener("resize", () => {
  if (!wt || !document.getElementById("wt-stage")) return;
  wtSyncTileSize();
  wtRemeasureHands();
});

document.addEventListener("keydown", (e) => {
  if (!wt || !document.getElementById("wt-stage")) return;
  if (e.target.closest("input, textarea, select")) return;
  if (e.key >= "1" && e.key <= "9") {
    wtShoot(parseInt(e.key, 10) - 1);
    e.preventDefault();
  } else if (e.key === " " || e.key === "Enter") {
    if (wt.phase === "intro" || wt.phase === "over" || wt.phase === "paused") {
      wtStart();
      e.preventDefault();
    }
  } else if (e.key === "Escape") {
    wtPause();
  }
});
