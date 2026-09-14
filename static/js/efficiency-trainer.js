// Efficiency Trainer (#efficiency-trainer) — a tile-shooting airplane game.
//
// A 13-tile hand sits across the top of the stage; you fly a plane along the
// bottom carrying exactly one tile of ammo. The plane follows the pointer —
// the stage IS the aim surface, mouse or finger — and firing sends the tile
// straight up to REPLACE whichever hand tile it hits: a draw and a discard in
// one shot. Don't like the tile you're holding? Re-roll it (c). The hand is
// cleared the moment it reaches tenpai.
//
// Aiming is therefore a pointing gesture, not a test of timing: the hand is
// STATIC, so the tile under the tracer is the tile the shot will replace, and
// the only question the game asks is which one that should be. (Both halves
// of that used to be otherwise — a drifting hand and a plane on a held-key
// rail — which made lining up a skill of its own and buried the efficiency
// decision underneath it.)
//
// So the drill is ordinary tile efficiency with the bookkeeping removed: is
// this tile worth using, and which tile does it replace? Both a shot and a
// re-roll cost one fuel, clearing a hand refunds the hand's `par`, and a run
// ends when the tank runs dry short of tenpai — so playing efficiently is
// literally what keeps you in the air. There is deliberately NO clock (same
// call as the Defense Trainer's answer phase): reading the shape is the test,
// not typing speed.
//
// Shanten comes from the real solver the rest of the app uses
// (static/js/prep/shanten.js), so "tenpai" here means exactly what it means on
// a game-detail page — no second implementation to drift out of sync.
//
// Two suits plus the three dragons (21 kinds), not the full 34: with the whole
// wall in play only ~10% of random ammo can advance a 1-shanten hand, which
// turns the last step of every hand into a re-roll grind. At 21 kinds it's
// ~21%, and the decisions that matter (ryanmen vs. kanchan, floaters, a lone
// honour) are all still on the table. Measured, not guessed — the same probe
// picked the `par` numbers below off a greedy-player simulation.
//
// Everything here is client-side; the only server-side part is the
// leaderboard, exactly as in the other two trainers.

// --- Tuning knobs -----------------------------------------------------------

// Starting shanten, the action budget that breaks even on fuel, and the hands
// cleared before the tier starts appearing. `par` is the median action count
// of a greedy-but-not-superhuman player (simulated: 4.3 / 6.3 / 8.7), rounded
// up — so a good player slowly banks fuel and a careless one bleeds it.
var EF_HAND_TIERS = [
  { shanten: 1, par: 5, unlock: 0, weight: 3 },
  { shanten: 2, par: 7, unlock: 3, weight: 3 },
  { shanten: 3, par: 9, unlock: 8, weight: 2 },
];

var EF_BASE_PER_SHANTEN = 5;   // points for clearing, per shanten started from
var EF_SAVE_BONUS = 5;         // points per action saved under par
var EF_FUEL_START = 22;
var EF_FUEL_MAX = 30;
var EF_FUEL_LOW = 6;           // HUD goes red at or below this

var EF_SHOT_SPEED = 4.6;       // stage-heights per second
var EF_CLEAR_SEC = 1.9;        // tenpai flourish before the next hand
// The plane eases toward the pointer instead of snapping to it: ~97% of the
// way in 150ms, which is under the threshold where a cursor feels laggy but
// still enough travel to bank into. A tap-to-fire snaps first (efFireAt), so
// the easing can never put a shot somewhere the player didn't point.
var EF_PLANE_FOLLOW = 25;      // e-folds per second
var EF_TAP_SLOP = 12;          // px of travel still counted as a tap, not a drag
var EF_ROW_TARGET = 0.9;       // hand row width as a fraction of the stage
// A phone stage gives 13 tiles as much width as it can spare — nothing has to
// move through the margins any more, they only exist so a shot can miss.
var EF_ROW_TARGET_NARROW = 0.96;
var EF_TILE_W_MAX = 46;        // px; a wide desktop stage stops growing tiles
var EF_TILE_RATIO = 0.75;      // tile SVG aspect (300x400 viewBox)

var EF_BEST_KEY = "haipai.efficiencyTrainer.best.v1";

// 34-index -> mjai notation. Index order is the app's canonical one (see
// static/js/prep/shanten_calc.js's BASE_TO_MJAI).
var EF_TILES = [
  "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
  "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
  "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
  "E", "S", "W", "N", "P", "F", "C",
];
var EF_SUIT_RANGES = [[0, 9], [9, 18], [18, 27]];
var EF_DRAGONS = [31, 32, 33];

// --- Shanten ----------------------------------------------------------------

// prep/shanten.js indexes 1..37 with padding between suits so its run math
// (i + 1, i + 2) can't cross a suit boundary; we count in flat 0..33.
function efBaseToKd(b) {
  if (b < 9) return b + 1;
  if (b < 18) return b + 2;
  if (b < 27) return b + 3;
  return b + 4;
}

// `counts` is a 34-length count array. Returns -1 for a complete hand, 0 for
// tenpai, n for n-shanten.
function efShanten(counts) {
  const kd = new Array(38).fill(0);
  for (let b = 0; b < 34; b++) kd[efBaseToKd(b)] = counts[b];
  return haipaiShanten.calculateMinimumShanten(kd);
}

function efHandCounts(tiles) {
  const c = new Array(34).fill(0);
  for (const t of tiles) c[t]++;
  return c;
}

// Every tile that completes a tenpai hand. Shown on the clear flourish — the
// payoff for the shape you just built, and the only place the game states out
// loud what all that aiming was for.
function efWaits(tiles) {
  const c = efHandCounts(tiles);
  const out = [];
  for (let t = 0; t < 34; t++) {
    if (c[t] >= 4) continue;
    c[t]++;
    if (efShanten(c) < 0) out.push(t);
    c[t]--;
  }
  return out;
}

// --- Hand generation --------------------------------------------------------

function efRandInt(lo, hi) { return lo + Math.floor(Math.random() * (hi - lo + 1)); }
function efPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// Two of the three suits plus the dragons — see the header for why the wall is
// cut down. Re-rolled per hand, so consecutive hands don't look alike.
function efUniverse() {
  const suits = [0, 1, 2];
  suits.splice(efRandInt(0, 2), 1);
  const u = [];
  for (const s of suits) {
    for (let i = EF_SUIT_RANGES[s][0]; i < EF_SUIT_RANGES[s][1]; i++) u.push(i);
  }
  return u.concat(EF_DRAGONS);
}

// Deal 13 tiles from a fresh 4-of-each wall over `univ`.
function efDeal(univ) {
  const wall = [];
  for (const b of univ) for (let i = 0; i < 4; i++) wall.push(b);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = wall[i]; wall[i] = wall[j]; wall[j] = tmp;
  }
  return wall.slice(0, 13).sort((a, b) => a - b);
}

// Rejection-sample until the deal lands on exactly `target` shanten. Random
// 13-tile deals over 21 kinds hit 1/2/3-shanten roughly 12/38/45% of the time,
// so this converges in a handful of tries; the fallback is the closest deal
// seen rather than a retry loop that could stall the frame.
function efGenerateHand(univ, target) {
  let best = null;
  let bestGap = 99;
  for (let tries = 0; tries < 400; tries++) {
    const tiles = efDeal(univ);
    const s = efShanten(efHandCounts(tiles));
    if (s === target) return { tiles: tiles, shanten: s };
    const gap = Math.abs(s - target);
    if (s >= 1 && gap < bestGap) { best = tiles; bestGap = gap; }
  }
  return { tiles: best || efDeal(univ), shanten: target };
}

// Weighted pick among the unlocked tiers. The easy tier thins out as the run
// goes on, so a long run is necessarily a harder one — the ramp is difficulty,
// not speed, because there is no clock to speed up.
function efPickTier(cleared) {
  const open = EF_HAND_TIERS.filter((t) => cleared >= t.unlock);
  const weight = (t) => (t.shanten === 1 ? Math.max(1, t.weight - Math.floor(cleared / 5)) : t.weight);
  const total = open.reduce((s, t) => s + weight(t), 0);
  let r = Math.random() * total;
  for (const t of open) { r -= weight(t); if (r <= 0) return t; }
  return open[open.length - 1];
}

// Ammo is uniform over the hand's universe, minus any kind the hand already
// holds four of — otherwise a shot at any other slot would make a fifth copy.
// Excluding it up front is simpler than rejecting the shot afterwards, and the
// player never sees a tile they can't legally use.
function efDrawAmmo(exclude) {
  const c = efHandCounts(ef.hand);
  const pool = ef.univ.filter((t) => c[t] < 4 && t !== exclude);
  if (!pool.length) return efPick(ef.univ.filter((t) => c[t] < 4));
  return efPick(pool);
}

// --- Game state -------------------------------------------------------------

// Null when the trainer isn't mounted. The rAF loop self-terminates as soon as
// the stage element leaves the DOM, so routing away needs no teardown.
var ef = null;

function efBestScore() {
  const v = parseInt(localStorage.getItem(EF_BEST_KEY) || "0", 10);
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function efSaveBest(score) {
  if (score > efBestScore()) {
    try { localStorage.setItem(EF_BEST_KEY, String(score)); } catch (e) { /* private mode */ }
  }
}

// --- Sound ------------------------------------------------------------------

// Engine, mute preference and speaker button are shared with the other
// minigames (static/js/minigame-audio.js); only this trainer's cues live here.

function efSfxFire() {
  mgTone({ freq: 1400, to: 520, dur: 0.09, type: "square", gain: 0.1 });
  mgNoise({ freq: 3000, to: 800, dur: 0.07, gain: 0.06 });
}

function efSfxReroll() {
  mgTone({ freq: 660, to: 990, dur: 0.07, type: "sine", gain: 0.12 });
}

// The impact tells you what the shot did before you've finished reading the
// hand: up a fifth for progress, a flat click for a sideways swap, a sour
// drop for a hand you just made worse.
function efSfxImpact(delta) {
  if (delta < 0) {
    mgTone({ freq: 587, dur: 0.1, type: "triangle", gain: 0.2 });
    mgTone({ freq: 880, dur: 0.13, delay: 0.06, type: "triangle", gain: 0.18 });
  } else if (delta === 0) {
    mgTone({ freq: 392, dur: 0.07, type: "triangle", gain: 0.13 });
  } else {
    mgTone({ freq: 233, to: 110, dur: 0.26, type: "sawtooth", gain: 0.15 });
  }
  mgNoise({ freq: 1600, to: 400, dur: 0.09, gain: 0.08 });
}

function efSfxMiss() {
  mgNoise({ freq: 600, to: 2200, dur: 0.22, filter: "bandpass", gain: 0.1 });
}

// One note per point band, so a big efficient clear is audibly bigger.
function efSfxClear(points) {
  const notes = [523.25, 659.25, 783.99, 1046.5, 1318.5];
  const n = Math.max(2, Math.min(5, 2 + Math.floor(points / 12)));
  for (let i = 0; i < n; i++) {
    mgTone({ freq: notes[i], dur: 0.15, delay: i * 0.06, type: "triangle", gain: 0.18 });
  }
}

function efSfxLowFuel() {
  mgTone({ freq: 330, to: 247, dur: 0.18, type: "square", gain: 0.1 });
}

function efSfxOver() {
  [392, 349.23, 293.66, 196].forEach((f, i) =>
    mgTone({ freq: f, dur: 0.45, delay: i * 0.17, type: "triangle", gain: 0.18 }));
}

function efSfxStart() {
  [392, 587.33].forEach((f, i) =>
    mgTone({ freq: f, dur: 0.14, delay: i * 0.08, type: "triangle", gain: 0.18 }));
}

// --- Leaderboard ------------------------------------------------------------

// Last payload from /api/efficiency/leaderboard: {top, you, players}. Module
// level (not on `ef`) so it survives a restart and a slow fetch can land after
// the player has already hit Play.
var efBoard = null;

function efBoardArrived(payload) {
  if (payload) efBoard = payload;
  if (ef) efRenderOverlay();
}

// A guest's run waiting for an account, submitted on the next visit with a
// session. Held so the intro panel can say what it saved.
var efSavedPending = null;

async function efLoadLeaderboard() {
  efSavedPending = mgFlushPendingRun("efficiency", (r) =>
    efReportRun(r.score, r.best_streak, r.hands_cleared));
  if (efSavedPending) return;
  try {
    const res = await fetch("/api/efficiency/leaderboard");
    if (!res.ok) return;
    efBoardArrived(await res.json());
  } catch (e) {
    // Offline / server down — the panels render without a board.
  }
}

// Guests have no board to land on, so their run goes to localStorage
// (minigame-shell.js) and the game-over panel offers a sign-up.
async function efReportRun(score, bestStreak, cleared) {
  const run = { score: score, best_streak: bestStreak, hands_cleared: cleared };
  if (mgGuest) {
    mgStashRun("efficiency", run);
    return;
  }
  try {
    const res = await apiPost("/api/efficiency/scores", run);
    if (!res.ok) return;
    const body = await res.json();
    efBoardArrived(body.leaderboard);
  } catch (e) {
    // The local result stays on screen; the run just isn't on the board.
  }
}

function efBoardRowHtml(r, extraClass) {
  return `<tr class="${[r.is_you ? "ef-lb-you" : "", extraClass || ""].filter(Boolean).join(" ")}">
    <td class="ef-lb-rank">${r.rank}</td>
    <td class="ef-lb-name">${escapeHtml(r.username)}</td>
    <td class="ef-lb-hands">${r.hands_cleared}</td>
    <td class="ef-lb-score">${r.score}</td>
  </tr>`;
}

function efBoardHtml() {
  if (!efBoard || !efBoard.top || !efBoard.top.length) return "";
  let rows = efBoard.top.map((r) => efBoardRowHtml(r)).join("");
  const you = efBoard.you;
  if (you && !efBoard.top.some((r) => r.is_you)) {
    rows += efBoardRowHtml(you, "ef-lb-outside");
  }
  const n = efBoard.players;
  return `<div class="ef-lb">
    <div class="ef-lb-head">Leaderboard <span>${n} player${n === 1 ? "" : "s"}</span></div>
    <table>
      <thead><tr><th></th><th>player</th><th>hands</th><th>score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// --- View -------------------------------------------------------------------

function showEfficiencyTrainer() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  // Don't inherit the last-viewed game's dora set — renderTile() would paint
  // random hand tiles orange.
  setActiveDora([]);

  document.getElementById("content").innerHTML = efShellHtml();
  efNewGame();
  ef.phase = "intro";
  efSyncLayout();
  efRenderHud();
  efRenderOverlay();
  efLoadLeaderboard();
  mgRenderMuteButtons();
  ef.raf = requestAnimationFrame(efLoop);
}

// The plane. An inline SVG rather than an emoji: the ✈ glyph points in a
// different direction (and renders at a different size) depending on the
// platform font, and this one has to line up with the tracer.
function efPlaneSvg() {
  return `<svg class="ef-plane-glyph" viewBox="0 0 40 34" aria-hidden="true">
    <path d="M20 0.5 L23.4 9 L23.4 13.5 L38.5 23.5 L38.5 28 L23.4 23.6
             L23.4 28.4 L26.6 32.5 L13.4 32.5 L16.6 28.4 L16.6 23.6
             L1.5 28 L1.5 23.5 L16.6 13.5 L16.6 9 Z"/>
  </svg>`;
}

function efShellHtml() {
  return `<div class="ef-wrap">
    <div class="ef-hud">
      <div class="ef-fuel" id="ef-fuel">
        <div class="ef-fuel-l">fuel</div>
        <div class="ef-fuel-bar"><div class="ef-fuel-fill" id="ef-fuel-fill"></div></div>
        <div class="ef-fuel-n" id="ef-fuel-n">0</div>
      </div>
      <div class="ef-score-box">
        <div class="ef-score" id="ef-score">0</div>
        <div class="ef-sub">best <span id="ef-best">0</span></div>
      </div>
      <div class="ef-hud-right">
        <div class="ef-par" id="ef-par"></div>
        <button type="button" class="ef-mute" data-mg-mute data-action="mgToggleMute"></button>
      </div>
    </div>
    <div class="ef-stage" id="ef-stage">
      <div class="ef-hand" id="ef-hand"></div>
      <div class="ef-tracer" id="ef-tracer"></div>
      <div class="ef-plane" id="ef-plane">
        ${efPlaneSvg()}
        <div class="ef-ammo" id="ef-ammo"></div>
      </div>
      <div class="ef-fx" id="ef-fx"></div>
      <div class="ef-overlay" id="ef-overlay"></div>
    </div>
    <div class="ef-controls">
      <button type="button" class="ef-btn ef-btn-fire" data-action="efFire">Fire <span class="ef-key">x</span></button>
      <button type="button" class="ef-btn ef-btn-reroll" data-action="efReroll">Re-roll <span class="ef-key">c</span></button>
    </div>
  </div>`;
}

function efNewGame() {
  const stage = document.getElementById("ef-stage");
  if (stage) {
    document.getElementById("ef-fx").innerHTML = "";
    stage.classList.remove("ef-dry");
  }
  ef = {
    phase: "playing",     // intro | playing | clear | over
    univ: [],
    hand: [],             // 13 sorted 34-indices
    shanten: 0,
    startShanten: 0,
    par: 0,
    actions: 0,           // shots + re-rolls spent on the current hand
    ammo: null,
    fuel: EF_FUEL_START,
    score: 0,
    cleared: 0,
    streak: 0,            // consecutive hands cleared at or under par
    bestStreak: 0,
    stuck: null,          // the hand that ran the tank dry (see efGameOver)
    shot: null,           // {tile, x, y} while in flight
    clearTimer: 0,
    planeX: 0.5,          // fraction of the plane's travel range
    aimX: 0.5,            // where the pointer last pointed; the plane eases to it
    planeV: 0,            // stage-widths/sec, measured — drives the banking only
    tileW: 24,
    rowW: 0,
    stageW: 0,
    stageH: 0,
    lowWarned: false,
    now: 0,
    lastTs: 0,
    raf: 0,
  };
  efNextHand();
}

// --- Hands ------------------------------------------------------------------

function efNextHand() {
  const tier = efPickTier(ef.cleared);
  ef.univ = efUniverse();
  const gen = efGenerateHand(ef.univ, tier.shanten);
  ef.hand = gen.tiles;
  ef.shanten = efShanten(efHandCounts(ef.hand));
  ef.startShanten = ef.shanten;
  ef.par = tier.par;
  ef.actions = 0;
  ef.shot = null;
  ef.ammo = efDrawAmmo(null);
  efRenderHand();
  efSyncLayout();
  efRenderAmmo();
  efRenderHud();
}

function efRenderHand() {
  const row = document.getElementById("ef-hand");
  if (!row) return;
  row.innerHTML = ef.hand
    .map((t, i) => `<span class="ef-slot" data-slot="${i}">${renderTile(EF_TILES[t], "ef-tile")}</span>`)
    .join("");
}

function efRenderAmmo() {
  const el = document.getElementById("ef-ammo");
  if (!el) return;
  el.innerHTML = ef.ammo == null ? "" : renderTile(EF_TILES[ef.ammo], "ef-ammo-tile");
  // An empty rack reads as an empty rack (dashed, hollow) rather than as a
  // blank tile: it's the state you're in mid-flight and through the tenpai
  // flourish, so it has to be obviously "nothing loaded".
  el.classList.toggle("empty", ef.ammo == null);
}

// Tiles are sized so the row spans most of the stage — the hand doesn't move,
// so the leftover margin is only the air a deliberate miss flies through.
// Writes `--ef-tile-w` on .ef-wrap; the stylesheet's value is only the
// pre-mount fallback.
function efSyncLayout() {
  const wrap = document.querySelector(".ef-wrap");
  const stage = document.getElementById("ef-stage");
  const row = document.getElementById("ef-hand");
  if (!wrap || !stage || !row) return;
  const stageW = stage.clientWidth;
  if (!stageW) return;
  // The loop re-measures every frame, but the aim rail is also read from
  // pointer events — which can arrive before the first frame of a new run,
  // since efNewGame() zeroes the measurements. Measuring here too means the
  // stage is never un-measured while it is on screen.
  ef.stageW = stageW;
  ef.stageH = stage.clientHeight;
  const narrow = stageW < 420;
  const gap = narrow ? 1 : 3;
  const target = narrow ? EF_ROW_TARGET_NARROW : EF_ROW_TARGET;
  const w = Math.max(12, Math.min(EF_TILE_W_MAX, (stageW * target - 12 * gap) / 13));
  wrap.style.setProperty("--ef-tile-w", w.toFixed(1) + "px");
  wrap.style.setProperty("--ef-tile-gap", gap + "px");
  ef.tileW = w;
  ef.gap = gap;
  ef.rowW = 13 * w + 12 * gap;
}

// Left edge of the hand row, in stage pixels. The row is centred and stays
// there for the whole run.
function efRowX() {
  return Math.max(0, ef.stageW - ef.rowW) / 2;
}

// Which slot sits under stage-x `x`, or -1 for a miss. The gap between two
// tiles is split between its neighbours, so only the margins outside the row
// are genuinely empty air.
function efSlotAt(x) {
  const rel = x - efRowX();
  if (rel < 0 || rel > ef.rowW) return -1;
  const pitch = ef.tileW + ef.gap;
  const i = Math.floor(rel / pitch);
  return Math.max(0, Math.min(12, i));
}

// The plane's rail is the whole stage, less half a tile at each end so the
// glyph stays on screen. It covers the row plus both margins, so every tile is
// reachable and firing into empty air is still possible (and still costs fuel).
function efRail() {
  const half = ef.tileW * 0.9;
  const lo = half;
  return { lo: lo, hi: Math.max(lo, ef.stageW - half) };
}

function efPlanePx() {
  const r = efRail();
  return r.lo + ef.planeX * (r.hi - r.lo);
}

// Stage pixels -> the 0..1 rail fraction the plane is stored in, so a resize
// rescales the aim instead of throwing it against a wall.
function efPxToPlaneX(px) {
  const r = efRail();
  if (r.hi <= r.lo) return 0.5;
  return Math.max(0, Math.min(1, (px - r.lo) / (r.hi - r.lo)));
}

// Pointer x (client coords) -> rail fraction. Null off the stage.
function efAimFromEvent(e) {
  const stage = document.getElementById("ef-stage");
  if (!stage) return null;
  const box = stage.getBoundingClientRect();
  if (!box.width) return null;
  return efPxToPlaneX(e.clientX - box.left);
}

// --- Firing -----------------------------------------------------------------

function efFire() {
  if (!ef) return;
  if (ef.phase === "intro" || ef.phase === "over") { efStart(); return; }
  if (ef.phase !== "playing" || ef.shot || ef.ammo == null) return;

  ef.actions++;
  ef.fuel--;
  ef.shot = { tile: ef.ammo, x: efPlanePx(), y: efNoseY() };
  ef.ammo = null;
  efRenderAmmo();
  efSfxFire();
  efRenderHud();
}

// Tap/click on the stage: put the plane exactly where the player pointed and
// shoot from there. The snap is what makes a tap unambiguous — no easing tail
// between the tile you touched and the tile the shot replaces.
function efFireAt(aim) {
  if (!ef || ef.phase !== "playing") return;
  ef.aimX = aim;
  ef.planeX = aim;
  ef.planeV = 0;
  efFire();
}

function efReroll() {
  if (!ef) return;
  if (ef.phase === "intro" || ef.phase === "over") { efStart(); return; }
  if (ef.phase !== "playing" || ef.shot || ef.ammo == null) return;

  ef.actions++;
  ef.fuel--;
  ef.ammo = efDrawAmmo(ef.ammo);
  efRenderAmmo();
  document.getElementById("ef-ammo").classList.remove("ef-swap");
  void document.getElementById("ef-ammo").offsetWidth;
  document.getElementById("ef-ammo").classList.add("ef-swap");
  efSfxReroll();
  efRenderHud();
  efCheckDry();
}

// The shot reached the row. The row is static, so this lands in the slot the
// tracer was highlighting when the shot went out — the impact confirms the
// choice, it never re-rolls the dice on it.
function efImpact() {
  const shot = ef.shot;
  ef.shot = null;
  const slot = efSlotAt(shot.x);

  if (slot < 0) {
    efFloat("miss", shot.x, "bad");
    efSfxMiss();
  } else {
    const before = ef.shanten;
    ef.hand.splice(slot, 1);
    ef.hand.push(shot.tile);
    ef.hand.sort((a, b) => a - b);
    ef.shanten = efShanten(efHandCounts(ef.hand));
    efRenderHand();
    efFlashSlot(ef.hand.indexOf(shot.tile), ef.shanten - before);
    efSfxImpact(ef.shanten - before);
    if (ef.shanten <= 0) { efClearHand(); return; }
  }

  ef.ammo = efDrawAmmo(null);
  efRenderAmmo();
  efRenderHud();
  efCheckDry();
}

function efFlashSlot(idx, delta) {
  const el = document.querySelector(`.ef-slot[data-slot="${idx}"]`);
  if (!el) return;
  el.classList.add(delta < 0 ? "ef-better" : (delta === 0 ? "ef-same" : "ef-worse"));
}

function efClearHand() {
  const saved = Math.max(0, ef.par - ef.actions);
  const points = EF_BASE_PER_SHANTEN * ef.startShanten + EF_SAVE_BONUS * saved;
  ef.score += points;
  ef.cleared++;
  // A hand brought in at or under par extends the streak — the board's
  // second column, and the one stat that says "efficiently", not "at all".
  if (ef.actions <= ef.par) {
    ef.streak++;
    ef.bestStreak = Math.max(ef.bestStreak, ef.streak);
  } else {
    ef.streak = 0;
  }
  ef.fuel = Math.min(EF_FUEL_MAX, ef.fuel + ef.par);
  ef.lowWarned = false;
  ef.phase = "clear";
  ef.clearTimer = EF_CLEAR_SEC;
  ef.ammo = null;
  efRenderAmmo();
  efSfxClear(points);
  efShowTenpai(points, saved);
  efRenderHud();
}

// The clear flourish: what the hand is now waiting on, and what it paid.
function efShowTenpai(points, saved) {
  const fx = document.getElementById("ef-fx");
  if (!fx) return;
  const waits = efWaits(ef.hand).map((t) => renderTile(EF_TILES[t], "ef-wait-tile")).join("");
  const el = document.createElement("div");
  el.className = "ef-tenpai";
  el.innerHTML = `<div class="ef-tenpai-l">Tenpai</div>
    <div class="ef-tenpai-waits">${waits}</div>
    <div class="ef-tenpai-pts">+${points}<span>${
      saved > 0 ? ` &middot; ${saved} under par` : (ef.actions === ef.par ? " &middot; on par" : "")
    }</span></div>`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), EF_CLEAR_SEC * 1000 - 150);
}

// Out of fuel short of tenpai. Nothing to spend means nothing left to try, so
// the run ends here rather than stalling on a hand that can't be finished.
function efCheckDry() {
  if (ef.fuel > 0) {
    if (ef.fuel <= EF_FUEL_LOW && !ef.lowWarned) { ef.lowWarned = true; efSfxLowFuel(); }
    return;
  }
  efGameOver();
}

function efGameOver() {
  // Snapshot the hand before the overlay covers the stage, so the panel can
  // show the shape the tank ran out on — the same "here's what got you" beat
  // as the Waits Trainer's killer hand.
  ef.stuck = { tiles: ef.hand.slice(), shanten: ef.shanten };
  ef.phase = "over";
  ef.shot = null;
  document.getElementById("ef-stage").classList.add("ef-dry");
  efSaveBest(ef.score);
  efSfxOver();
  efRenderHud();
  efRenderOverlay();
  efReportRun(ef.score, ef.bestStreak, ef.cleared);
}

function efFloat(text, x, kind) {
  const fx = document.getElementById("ef-fx");
  if (!fx) return;
  const el = document.createElement("div");
  el.className = `ef-float ef-float-${kind}`;
  el.textContent = text;
  el.style.left = `${x}px`;
  el.style.top = `${Math.max(30, ef.stageH * 0.42)}px`;
  fx.appendChild(el);
  setTimeout(() => el.remove(), 800);
}

// --- Loop -------------------------------------------------------------------

function efLoop(ts) {
  const stage = document.getElementById("ef-stage");
  if (!stage || !ef) { ef = null; return; }   // routed away — stop the loop
  ef.raf = requestAnimationFrame(efLoop);
  ef.stageW = stage.clientWidth;
  ef.stageH = stage.clientHeight;
  if (!ef.rowW) efSyncLayout();

  const dt = ef.lastTs ? Math.min(0.05, (ts - ef.lastTs) / 1000) : 0;
  ef.lastTs = ts;
  ef.now += dt;

  if (ef.phase === "clear") {
    ef.clearTimer -= dt;
    if (ef.clearTimer <= 0) { ef.phase = "playing"; efNextHand(); }
  }

  // Plane: ease toward wherever the pointer last pointed. Velocity is measured
  // from the move rather than integrated into it — it exists only so the glyph
  // can bank, which is what keeps a cursor-follower reading as flight. It keeps
  // flying through the tenpai flourish, so the next hand starts under the
  // pointer instead of wherever the last shot left it.
  if (efLive() && dt > 0) {
    const prev = ef.planeX;
    ef.planeX += (ef.aimX - ef.planeX) * (1 - Math.exp(-EF_PLANE_FOLLOW * dt));
    ef.planeV = (ef.planeX - prev) / dt;
  } else {
    ef.planeV = 0;
  }

  if (ef.shot) {
    ef.shot.y -= EF_SHOT_SPEED * ef.stageH * dt;
    if (ef.shot.y <= efRowBottom()) efImpact();
  }

  efPaint();
}

function efRowBottom() {
  return 10 + ef.tileW / EF_TILE_RATIO;
}

// Where a shot leaves the plane: the nose, measured rather than assumed, since
// the plane's height is the glyph plus whatever the current tile size makes
// the ammo frame.
function efNoseY() {
  const plane = document.getElementById("ef-plane");
  return ef.stageH - 8 - (plane ? plane.offsetHeight : 70);
}

function efPaint() {
  const row = document.getElementById("ef-hand");
  const plane = document.getElementById("ef-plane");
  const tracer = document.getElementById("ef-tracer");
  const fx = document.getElementById("ef-fx");
  if (!row || !plane || !tracer) return;

  row.style.transform = `translate3d(${efRowX().toFixed(1)}px, 0, 0)`;

  const px = efPlanePx();
  plane.style.transform = `translate3d(${px.toFixed(1)}px, 0, 0) translateX(-50%)`;
  plane.classList.toggle("ef-banking-l", ef.planeV < -0.35);
  plane.classList.toggle("ef-banking-r", ef.planeV > 0.35);

  // Aim line + the slot it currently covers. Shown only while you actually
  // have a tile loaded — an empty plane has nothing to aim.
  const aiming = ef.phase === "playing" && ef.ammo != null;
  tracer.style.opacity = aiming ? "" : "0";
  tracer.style.transform = `translate3d(${px.toFixed(1)}px, 0, 0)`;
  tracer.style.bottom = `${(ef.stageH - efNoseY()).toFixed(0)}px`;
  const slot = aiming ? efSlotAt(px) : -1;
  for (const el of row.children) el.classList.toggle("ef-aimed", +el.dataset.slot === slot);

  // The in-flight tile is drawn by the loop rather than a CSS transition so
  // impact happens at a position, not at the end of an animation.
  let shotEl = fx.querySelector(".ef-shot");
  if (ef.shot) {
    if (!shotEl) {
      shotEl = document.createElement("div");
      shotEl.className = "ef-shot";
      shotEl.innerHTML = renderTile(EF_TILES[ef.shot.tile], "ef-shot-tile");
      fx.appendChild(shotEl);
    }
    shotEl.style.transform =
      `translate3d(${ef.shot.x.toFixed(1)}px, ${ef.shot.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  } else if (shotEl) {
    shotEl.remove();
  }
}

// --- HUD / overlay ----------------------------------------------------------

function efRenderHud() {
  const fill = document.getElementById("ef-fuel-fill");
  if (!fill) return;
  const frac = Math.max(0, Math.min(1, ef.fuel / EF_FUEL_MAX));
  fill.style.width = (frac * 100).toFixed(1) + "%";
  const low = ef.fuel <= EF_FUEL_LOW;
  document.getElementById("ef-fuel").classList.toggle("low", low);
  document.getElementById("ef-fuel-n").textContent = Math.max(0, ef.fuel);
  document.getElementById("ef-score").textContent = ef.score;
  document.getElementById("ef-best").textContent = Math.max(efBestScore(), ef.score);

  // "how far from tenpai" as pips, plus the action budget. The starting
  // shanten is public anyway (it sets par), so hiding the current one would
  // only make the player guess at whether a shot landed — the skill is which
  // tile to use where, not how far out you are.
  const pips = [];
  for (let i = 0; i < Math.max(ef.startShanten, ef.shanten); i++) {
    pips.push(`<span class="ef-pip${i < ef.shanten ? "" : " done"}"></span>`);
  }
  const over = ef.actions > ef.par;
  document.getElementById("ef-par").innerHTML =
    `<span class="ef-pips">${pips.join("")}</span>
     <span class="ef-par-n${over ? " over" : ""}">${ef.actions}<span>/${ef.par}</span></span>`;
}

// The hand the run ended on, with what it still needed.
function efStuckHtml() {
  const s = ef.stuck;
  if (!s) return "";
  const tiles = s.tiles.map((t) => renderTile(EF_TILES[t], "ef-stuck-tile")).join("");
  return `<div class="ef-stuck">
    <div class="ef-stuck-l">Still ${s.shanten} away from tenpai</div>
    <div class="ef-stuck-tiles">${tiles}</div>
  </div>`;
}

function efRenderOverlay() {
  const ov = document.getElementById("ef-overlay");
  if (!ov) return;
  if (ef.phase === "playing" || ef.phase === "clear") {
    ov.className = "ef-overlay";
    ov.innerHTML = "";
    return;
  }
  ov.className = "ef-overlay show";
  if (ef.phase === "over") {
    ov.innerHTML = `<div class="ef-panel">
      <h3>Out of fuel</h3>
      ${efStuckHtml()}
      <div class="ef-result">
        <div><span class="ef-result-n">${ef.score}</span><span>score</span></div>
        <div><span class="ef-result-n">${ef.cleared}</span><span>hands</span></div>
        <div><span class="ef-result-n">${ef.bestStreak}</span><span>best streak</span></div>
      </div>
      <button class="btn btn-primary" data-action="efStart" type="button">Play again</button>
      ${mgGuest && ef.score > 0 ? mgSignupCtaHtml("run") : ""}
      ${efBoardHtml()}
    </div>`;
    return;
  }
  const board = efBoardHtml();
  const best = efBestScore();
  ov.innerHTML = `<div class="ef-panel">
    <h3>Efficiency Trainer</h3>
    <p class="ef-hint">The plane follows your mouse (or your finger). Line it up
      under a tile and shoot: the hit <b>replaces</b> that tile — get the hand to
      <b>tenpai</b>.</p>
    <ul class="ef-keys">
      <li><span class="ef-gesture">move</span> aim</li>
      <li><span class="ef-gesture">tap the stage</span> fire there</li>
      <li><span class="ef-key">x</span> fire</li>
      <li><span class="ef-key">c</span> re-roll your tile</li>
    </ul>
    <p class="ef-hint">Firing and re-rolling each burn a fuel. Reaching tenpai
      refills the tank by that hand's <b>par</b> — so the fewer shots you use,
      the longer you fly.</p>
    ${!board && best ? `<p class="ef-hint">Personal best: ${best}</p>` : ""}
    ${efSavedPending ? `<p class="ef-hint">Saved your guest run: ${efSavedPending.score} points.</p>` : ""}
    <button class="btn btn-primary" data-action="efStart" type="button">Play</button>
    ${board}
    ${mgGuest ? mgGuestNoteHtml() : ""}
  </div>`;
}

function efStart() {
  if (!ef) return;
  const keep = ef.raf;
  efNewGame();
  ef.raf = keep;
  efSyncLayout();
  efSfxStart();
  efRenderHud();
  efRenderOverlay();
}

// --- Global listeners (registered once at load; no-ops off the trainer) ------

function efMounted() {
  return ef && document.getElementById("ef-stage");
}

// In the air: a hand is up and the stage is steerable. (`clear` is the tenpai
// flourish between hands — the plane still flies, it just has nothing loaded.)
function efLive() {
  return ef && (ef.phase === "playing" || ef.phase === "clear");
}

window.addEventListener("resize", () => {
  if (!efMounted()) return;
  efSyncLayout();
});

document.addEventListener("keydown", (e) => {
  if (!efMounted()) return;
  if (e.target.closest("input, textarea, select")) return;
  const k = e.key.toLowerCase();
  if (k === "x") { efFire(); e.preventDefault(); }
  else if (k === "c") { efReroll(); e.preventDefault(); }
  else if (k === "m") { mgToggleMute(); }
  else if (e.key === " " || e.key === "Enter") {
    if (ef.phase === "intro" || ef.phase === "over") { efStart(); e.preventDefault(); }
  }
});

// Aiming. The stage is the control surface, so the listeners are delegated
// here rather than expressed in the click-only action registry (actions.js):
// a hover and a drag aren't clicks, and the tap that fires has to know where
// it started. Registered once at load; no-ops off the trainer.
//
// A mouse aims by hovering (no button held) and fires by clicking; a finger
// has no hover, so a touch aims by dragging and fires by tapping. Both fall
// out of the same three handlers, and the Fire button stays for anyone who
// would rather keep their thumb off the stage.
var efTap = null;   // {x, y} where the current press went down, or null

// The aim, or null if this pointer isn't steering (off the stage, or the run
// isn't in the air).
function efStagePointer(e) {
  if (!efMounted() || !efLive() || !e.target.closest("#ef-stage")) return null;
  return efAimFromEvent(e);
}

document.addEventListener("pointerdown", (e) => {
  const aim = efStagePointer(e);
  if (aim == null) return;
  ef.aimX = aim;
  efTap = { x: e.clientX, y: e.clientY };
});

document.addEventListener("pointermove", (e) => {
  const aim = efStagePointer(e);
  if (aim == null) return;
  ef.aimX = aim;
  // Past the slop the press is a drag-to-aim, not a tap — so releasing it
  // must not fire. (Aiming continues either way.)
  if (efTap && Math.hypot(e.clientX - efTap.x, e.clientY - efTap.y) > EF_TAP_SLOP) {
    efTap = null;
  }
});

document.addEventListener("pointerup", (e) => {
  const tap = efTap;
  efTap = null;
  if (!tap) return;
  const aim = efStagePointer(e);
  if (aim == null) return;
  if (Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > EF_TAP_SLOP) return;
  efFireAt(aim);
});

// A pointer that leaves the window never reports `pointerup`, which would
// otherwise leave a stale press armed to fire on the next release.
document.addEventListener("pointercancel", () => { efTap = null; });
window.addEventListener("blur", () => { efTap = null; });
