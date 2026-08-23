// Defense Trainer (#defense-trainer) — a Simon-says memory game for genbutsu.
//
// One puzzle is a real kyoku, cut at the moment an opponent declared riichi
// (mined by `scripts/mine_defense_puzzles.py` into the static, anonymized
// pack `static/data/defense-puzzles.json` — see that script for what a board
// carries and why). The board's layout never changes; every tile on it sits
// face down, and the SAFE ones are turned up one at a time, Simon-style, each
// flipping back before the next:
//
//   step 1: the riichi player's first discard, on its own
//   step k: the first k tiles of one long sequence — the riichi player's own
//           pond left to right (all of it is genbutsu against them), and then,
//           once that runs out, every tile discarded since the declaration in
//           the order it hit the table
//
// So a board opens on a single safe tile and grows by one every round, which
// is what makes the ramp: the sequence is only ever one tile longer than the
// one the player just reproduced.
//
// The player then taps every safe tile out of the 34-tile arsenal. Order
// doesn't matter (it's a set, not a sequence); getting them all clears the
// step and the next tile joins the sequence. A wrong tap or a timeout costs
// one of 3 lives, shows the answer, and moves to a fresh board.
//
// A tile that never turns up was never shown, so it is never asked about —
// the other seats' pre-riichi discards stay face down for the whole board.
// They still take up their slot, which is the point: a pond's length is
// public at a real table, its contents are only what you watched.
//
// Everything is client-side apart from the leaderboard (`routes/defense.py`).
// The rAF loop self-terminates when its stage leaves the DOM, so routing away
// needs no teardown. Sound comes from the shared engine in minigame-audio.js.

// --- Tuning knobs -----------------------------------------------------------

var DF_LIVES = 3;
var DF_BEST_KEY = "haipai.defenseTrainer.best";
var DF_PACK_URL = "/static/data/defense-puzzles.json";

// Playback pace. Each safe tile gets one flash; longer sequences step faster
// so a 24-tile board still plays in a few seconds rather than dragging.
function dfFlashSeconds(n) { return Math.max(0.16, 0.42 - n * 0.009); }
// Beat between the riichi player's own pond and the tiles that followed it —
// the two halves of the sequence mean different things, so they don't blur.
var DF_GROUP_GAP = 0.45;
// Beat after the last flash, before the board goes face-down.
var DF_TAIL_GAP = 0.35;
// Answer clock: generous, but it does run out. Scales with the set size.
function dfAnswerSeconds(n) { return Math.min(45, 6 + 2.2 * n); }
// How long the answer stays on screen after a life is lost.
var DF_REVIEW_SEC = 3.6;
// Beat between clearing a step and the next playback.
var DF_NEXT_SEC = 0.7;

// The arsenal, in the canonical order. Row-major over 9 columns puts the
// three suits on their own rows and the seven honors on a short fourth.
var DF_TILES = [
  "1m", "2m", "3m", "4m", "5m", "6m", "7m", "8m", "9m",
  "1p", "2p", "3p", "4p", "5p", "6p", "7p", "8p", "9p",
  "1s", "2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s",
  "E", "S", "W", "N", "P", "F", "C",
];
var DF_TILE_IDX = {};
DF_TILES.forEach((t, i) => { DF_TILE_IDX[t] = i; });

var DF_SEAT_NAMES = ["You", "Shimocha", "Toimen", "Kamicha"];
var DF_KYOKU_NAMES = { E: "East", S: "South", W: "West", N: "North" };

// --- State ------------------------------------------------------------------

var df = null;        // the run; null when the trainer isn't mounted
var dfPack = null;    // the puzzle pack, fetched once per page load
var dfPackError = false;
var dfBoard = null;   // last /api/defense/leaderboard payload

// --- Sound ------------------------------------------------------------------

// Each tile has its own note, so a sequence is an actual melody and the same
// board sounds the same every time — the Simon-says half of the feedback.
// A pentatonic scale over the 34 tiles keeps any run of them consonant.
function dfTileFreq(tile) {
  const i = DF_TILE_IDX[tileBase(tile)] || 0;
  const PENT = [0, 2, 4, 7, 9];
  const semis = PENT[i % 5] + 12 * Math.floor(i / 5);
  return 261.63 * Math.pow(2, semis / 24);   // half-steps, so 34 tiles ≈ 2 octaves
}

function dfSfxFlash(tile) {
  mgTone({ freq: dfTileFreq(tile), dur: 0.16, type: "triangle", gain: 0.2 });
}

function dfSfxPick(tile, found, total) {
  dfSfxFlash(tile);
  mgTone({ freq: 1500 + 900 * (found / Math.max(1, total)), dur: 0.05, type: "sine", gain: 0.07 });
}

function dfSfxStepClear(points) {
  const notes = [523.25, 659.25, 783.99, 1046.5];
  const n = Math.max(2, Math.min(4, Math.round(points / 4)));
  for (let i = 0; i < n; i++) {
    mgTone({ freq: notes[i], dur: 0.13, delay: i * 0.055, type: "triangle", gain: 0.17 });
  }
}

function dfSfxWrong() {
  mgTone({ freq: 196, to: 70, dur: 0.3, type: "sawtooth", gain: 0.17 });
  mgNoise({ freq: 900, to: 180, dur: 0.22, gain: 0.12 });
}

function dfSfxLife() {
  mgNoise({ freq: 2400, to: 200, dur: 0.5, gain: 0.16 });
  [440, 349.23, 261.63].forEach((f, i) =>
    mgTone({ freq: f, dur: 0.26, delay: i * 0.11, type: "square", gain: 0.12 }));
}

function dfSfxOver() {
  [440, 392, 329.63, 220].forEach((f, i) =>
    mgTone({ freq: f, dur: 0.45, delay: i * 0.17, type: "triangle", gain: 0.18 }));
}

function dfSfxStart() {
  [523.25, 783.99].forEach((f, i) =>
    mgTone({ freq: f, dur: 0.14, delay: i * 0.08, type: "triangle", gain: 0.18 }));
}

// A new board arrives — a soft riichi-stick clack, not a melodic cue, so it
// never gets mistaken for part of the sequence about to play.
function dfSfxNewBoard() {
  mgNoise({ freq: 3000, to: 900, dur: 0.09, filter: "bandpass", gain: 0.14 });
}

// --- Puzzle pack ------------------------------------------------------------

async function dfLoadPack() {
  if (dfPack || dfPackError) return dfPack;
  try {
    const res = await fetch(DF_PACK_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const pack = await res.json();
    if (!pack || !Array.isArray(pack.puzzles) || !pack.puzzles.length) {
      throw new Error("empty pack");
    }
    dfPack = pack;
  } catch (e) {
    dfPackError = true;
  }
  if (df) dfRenderOverlay();
  return dfPack;
}

// Walk the whole pack before repeating: a run is short enough that drawing
// independently would show the same board twice well before it should.
function dfShuffledDeck(n) {
  const d = Array.from({ length: n }, (_, i) => i);
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
}

// --- Board model ------------------------------------------------------------

// The board as of `step` tiles into the flow, plus the flash sequence and the
// safe set that go with it.
//
// `seq` is the Simon-says order: the riichi player's own pond first (every
// tile of it is genbutsu against them, whenever it was discarded), then each
// tile discarded since the declaration, in table order. `group` splits the
// two so the playback can pause between them.
function dfBuildBoard(puzzle, step) {
  const ponds = puzzle.ponds.map((p) => p.slice());
  const riichiSeat = puzzle.seat;
  const riichiIdx = puzzle.turn - 1;   // the declaration is their last discard
  // Length taken up front: the flow loop below pushes into these same pond
  // arrays, and the declarer discarding again would otherwise move the seam.
  const ownLen = ponds[riichiSeat].length;
  // The declarer's pond is on the table from the start (face down); the flow
  // tiles only reach it as the sequence gets to them.
  const seq = ponds[riichiSeat].slice(0, step).map((tile, idx) =>
    ({ seat: riichiSeat, idx: idx, tile: tile, group: 0 }));
  for (let i = 0; i < step - ownLen; i++) {
    const [seat, tile] = puzzle.flow[i];
    seq.push({ seat: seat, idx: ponds[seat].length, tile: tile, group: 1 });
    ponds[seat].push(tile);
  }
  const safe = new Set(seq.map((s) => tileBase(s.tile)));
  return {
    ponds: ponds,
    seq: seq,
    safe: safe,
    riichiIdx: riichiIdx,
    ownCount: Math.min(step, ownLen),   // where the sequence's two halves meet
  };
}

// Every tile a board can eventually ask for: the declarer's whole pond, then
// everything discarded since.
function dfTotalSteps(puzzle) {
  return puzzle.ponds[puzzle.seat].length + puzzle.flow.length;
}

// --- View -------------------------------------------------------------------

function showDefenseTrainer() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  setActiveDora([]);   // the board arms its own dora per puzzle

  document.getElementById("content").innerHTML = dfShellHtml();
  dfNewGame();
  df.phase = "intro";
  dfRenderHud();
  dfRenderOverlay();
  mgRenderMuteButtons();
  dfLoadPack();
  dfLoadLeaderboard();
  df.raf = requestAnimationFrame(dfLoop);
}

function dfShellHtml() {
  let ammo = "";
  DF_TILES.forEach((t, i) => {
    ammo += `<button type="button" class="df-ammo" data-action="dfPick" data-tile-idx="${i}"
      aria-label="${t}">${renderTile(t, "df-ammo-tile no-dora")}</button>`;
  });
  return `<div class="df-wrap">
    <div class="df-hud">
      <div class="df-lives" id="df-lives"></div>
      <div class="df-score-box">
        <div class="df-score" id="df-score">0</div>
        <div class="df-sub">best <span id="df-best">0</span></div>
      </div>
      <div class="df-hud-right">
        <div class="df-streak" id="df-streak"></div>
        <button type="button" class="df-mute" data-mg-mute data-action="mgToggleMute"></button>
      </div>
    </div>
    <div class="df-stage" id="df-stage">
      <div class="df-board" id="df-board"></div>
      <div class="df-overlay" id="df-overlay"></div>
    </div>
    <div class="df-prompt" id="df-prompt"></div>
    <div class="df-bar"><i id="df-bar-fill"></i></div>
    <div class="df-arsenal" id="df-arsenal">${ammo}</div>
  </div>`;
}

function dfNewGame() {
  df = {
    phase: "intro",      // intro | play | answer | review | over | paused
    pendingOver: false,  // last life lost; game over once the review is read
    puzzle: null,
    board: null,
    step: 1,             // sequence entries revealed so far (1-based)
    found: new Set(),
    wrong: null,         // the base tile a wrong tap picked, for the review
    deck: [],
    deckPos: 0,
    playIdx: 0,          // sequence entries flashed so far
    playTimer: 0,
    timer: 0,
    timerTotal: 0,
    score: 0,
    streak: 0,
    bestStreak: 0,
    steps: 0,            // steps cleared this run — the score's denominator
    lives: DF_LIVES,
    now: 0,
    lastTs: 0,
    raf: df ? df.raf : 0,
  };
}

// --- Board rendering --------------------------------------------------------

function dfRoundName(p) {
  const wind = DF_KYOKU_NAMES[p.bakaze] || p.bakaze;
  return `${wind} ${p.kyoku}${p.honba ? ` · ${p.honba} honba` : ""}`;
}

// One pond slot. Face down it is a plain back — the layout (and so each pond's
// length) stays put, but nothing about the tile leaks, since the back carries
// no alt/title/data-tile. The declaration keeps its rotated, red-edged look
// either way: which discard called riichi is public, what it was is not.
function dfSlotInner(seat, idx, tile, faceUp) {
  const isRiichi = seat === df.puzzle.seat && idx === df.board.riichiIdx;
  const cls = "df-tile" + (isRiichi ? " df-riichi-tile" : "");
  return faceUp ? renderTile(tile, cls) : renderBackTile(cls + " df-back");
}

// `revealSafe` turns up every tile in the sequence at once — the review beat
// after a step ends. Everything else stays face down, always.
function dfRenderBoard(revealSafe) {
  const el = document.getElementById("df-board");
  if (!el || !df.board) return;
  const p = df.puzzle;
  const dora = (p.dora || []).map((t) => renderTile(t, "df-tile dora-indicator")).join("");

  let seats = "";
  for (let seat = 0; seat < 4; seat++) {
    const isRiichi = seat === p.seat;
    const pond = df.board.ponds[seat];
    let tiles = "";
    pond.forEach((tile, idx) => {
      const faceUp = revealSafe
        && df.board.seq.some((e) => e.seat === seat && e.idx === idx);
      tiles += `<span class="df-slot" data-seat="${seat}" data-idx="${idx}">`
        + dfSlotInner(seat, idx, tile, faceUp)
        + `</span>`;
    });
    seats += `<div class="df-seat${isRiichi ? " is-riichi" : ""}${seat === 0 ? " is-you" : ""}">
      <div class="df-seat-label">
        <span class="df-wind">${p.winds[seat]}</span>
        <span class="df-who">${seat === 0 ? "You" : DF_SEAT_NAMES[seat]}</span>
        ${isRiichi ? `<span class="df-riichi-badge">RIICHI</span>` : ""}
      </div>
      <div class="df-pond">${tiles}</div>
    </div>`;
  }

  el.innerHTML = `<div class="df-round">
      <span>${dfRoundName(p)}</span>
      <span class="df-dora">dora ${dora}</span>
    </div>
    <div class="df-seats">${seats}</div>`;
}

function dfSlot(entry) {
  return document.querySelector(
    `.df-slot[data-seat="${entry.seat}"][data-idx="${entry.idx}"]`);
}

// --- Run flow ---------------------------------------------------------------

function dfNextPuzzle() {
  const puzzles = dfPack ? dfPack.puzzles : null;
  if (!puzzles || !puzzles.length) return false;
  if (df.deckPos >= df.deck.length) {
    df.deck = dfShuffledDeck(puzzles.length);
    df.deckPos = 0;
  }
  df.puzzle = puzzles[df.deck[df.deckPos++]];
  df.step = 1;
  // The pack stores the indicators; renderTile highlights the dora themselves.
  setActiveDora((df.puzzle.dora || []).map(dfDoraFromIndicator));
  dfSfxNewBoard();
  dfBeginStep();
  return true;
}

// Indicator -> the tile it makes dora. Wraps within its suit, and within the
// wind (E S W N) and dragon (P F C) cycles.
function dfDoraFromIndicator(ind) {
  const t = tileBase(ind);
  const WINDS = ["E", "S", "W", "N"];
  const DRAGONS = ["P", "F", "C"];
  if (WINDS.includes(t)) return WINDS[(WINDS.indexOf(t) + 1) % 4];
  if (DRAGONS.includes(t)) return DRAGONS[(DRAGONS.indexOf(t) + 1) % 3];
  const n = parseInt(t[0], 10);
  return `${n === 9 ? 1 : n + 1}${t[1]}`;
}

// Build the board for the current step and start the Simon playback.
function dfBeginStep() {
  df.board = dfBuildBoard(df.puzzle, df.step);
  df.found = new Set();
  df.wrong = null;
  df.playIdx = 0;
  df.playTimer = 0.5;             // a beat to take the board in before it starts
  df.phase = "play";
  dfRenderBoard(false);
  dfRenderArsenal();
  dfRenderHud();
  dfRenderPrompt();
  dfRenderOverlay();   // clears the intro / resume panel off the board
}

function dfFlashNext() {
  const seq = df.board.seq;
  const entry = seq[df.playIdx];
  const slot = dfSlot(entry);
  const flash = dfFlashSeconds(seq.length);
  if (slot) {
    slot.innerHTML = dfSlotInner(entry.seat, entry.idx, entry.tile, true);
    slot.classList.add("df-lit", entry.group === 0 ? "df-lit-own" : "df-lit-flow");
    // Face down again before the next one turns up: seeing the whole sequence
    // at once would be a reading exercise, not a memory one.
    setTimeout(() => {
      slot.classList.remove("df-lit", "df-lit-own", "df-lit-flow");
      slot.innerHTML = dfSlotInner(entry.seat, entry.idx, entry.tile, false);
    }, flash * 1000 * 0.8);
  }
  dfSfxFlash(entry.tile);
  df.playIdx++;
  // Pause across the seam between "the declarer's own pond" and "what has
  // passed since" — two different reasons a tile is safe.
  const next = seq[df.playIdx];
  const seam = next && next.group !== entry.group;
  df.playTimer = flash + (seam ? DF_GROUP_GAP : 0) + (next ? 0 : DF_TAIL_GAP);
}

function dfBeginAnswer() {
  df.phase = "answer";
  df.timerTotal = dfAnswerSeconds(df.board.safe.size);
  df.timer = df.timerTotal;
  dfRenderBoard(false);   // clears any flash left mid-flip
  dfRenderPrompt();
}

function dfPick(el) {
  if (!df || df.phase !== "answer") return;
  const idx = parseInt(el.dataset ? el.dataset.tileIdx : el, 10);
  const tile = DF_TILES[idx];
  if (!tile || df.found.has(tile)) return;

  if (!df.board.safe.has(tile)) {
    df.wrong = tile;
    dfSfxWrong();
    dfFail("Not safe");
    return;
  }
  df.found.add(tile);
  dfSfxPick(tile, df.found.size, df.board.safe.size);
  dfMarkAmmo(idx, "found");
  dfRenderPrompt();
  if (df.found.size >= df.board.safe.size) dfClearStep();
}

function dfClearStep() {
  const points = df.board.safe.size;
  df.score += points;
  df.steps += 1;
  df.streak += 1;
  df.bestStreak = Math.max(df.bestStreak, df.streak);
  dfSfxStepClear(points);
  dfFloat(`+${points}`, "good");
  dfRenderHud();
  df.phase = "review";
  df.timer = DF_NEXT_SEC;
  df.reviewOutcome = "clear";
  dfRenderBoard(true);
  dfRenderPrompt();
}

function dfFail(reason) {
  df.lives -= 1;
  df.streak = 0;
  df.failReason = reason;
  dfSfxLife();
  dfRenderHud();
  // Show the answer face-up with every safe tile marked — the board is only
  // worth playing if a miss teaches what the miss was.
  df.phase = "review";
  df.reviewOutcome = "fail";
  df.timer = DF_REVIEW_SEC;
  dfRenderBoard(true);
  dfMarkReview();
  dfRenderPrompt();
  // Even the last life gets its review beat: the game-over panel covers the
  // board, so showing it now would swallow the answer the player just missed.
  if (df.lives <= 0) df.pendingOver = true;
}

// Paint the answer onto both the board and the arsenal: safe tiles the player
// found, safe tiles they missed, and the tile that ended the step.
function dfMarkReview() {
  for (const entry of df.board.seq) {
    const slot = dfSlot(entry);
    if (!slot) continue;
    slot.classList.add(df.found.has(tileBase(entry.tile)) ? "df-was-found" : "df-was-missed");
  }
  DF_TILES.forEach((t, i) => {
    if (df.board.safe.has(t)) {
      dfMarkAmmo(i, df.found.has(t) ? "found" : "missed");
    } else if (t === df.wrong) {
      dfMarkAmmo(i, "wrong");
    }
  });
}

function dfGameOver() {
  df.phase = "over";
  df.timer = 0;
  dfSfxOver();
  dfSaveBest(df.score);
  dfRenderHud();
  dfRenderOverlay();
  dfReportRun(df.score, df.bestStreak, df.steps);
}

// The review beat is over: either the flow has one more tile for this board,
// or it's spent (or was failed) and a fresh board comes up.
function dfAdvance() {
  if (df.pendingOver) { dfGameOver(); return; }
  if (df.reviewOutcome === "clear" && df.step < dfTotalSteps(df.puzzle)) {
    df.step += 1;
    dfBeginStep();
  } else if (!dfNextPuzzle()) {
    // The pack is checked before Play, so this only fires if it vanished
    // mid-run. Ending the run beats spinning on an empty deck every frame.
    dfGameOver();
  }
}

// --- Arsenal / HUD / prompt -------------------------------------------------

function dfRenderArsenal() {
  for (const b of document.querySelectorAll(".df-ammo")) {
    b.className = "df-ammo";
  }
}

function dfMarkAmmo(idx, cls) {
  const b = document.querySelector(`.df-ammo[data-tile-idx="${idx}"]`);
  if (b) b.classList.add(`df-ammo-${cls}`);
}

function dfRenderHud() {
  const lives = document.getElementById("df-lives");
  if (!lives || !df) return;
  let hearts = "";
  for (let i = 0; i < DF_LIVES; i++) {
    hearts += `<span class="df-heart${i < df.lives ? "" : " lost"}">&#9829;</span>`;
  }
  lives.innerHTML = hearts;
  document.getElementById("df-score").textContent = df.score;
  document.getElementById("df-best").textContent = Math.max(dfBestScore(), df.score);
  const streak = document.getElementById("df-streak");
  streak.className = "df-streak" + (df.streak >= 5 ? " hot" : "");
  streak.innerHTML = `<span class="df-streak-n">${df.streak}</span><span class="df-streak-l">streak</span>`;
}

// One line under the board saying what the player is meant to be doing, plus
// the found/total counter — without it "am I done?" is unanswerable.
function dfRenderPrompt() {
  const el = document.getElementById("df-prompt");
  if (!el || !df) return;
  if (df.phase === "play") {
    el.className = "df-prompt df-prompt-watch";
    el.textContent = df.playIdx <= df.board.ownCount
      ? "Watch — the riichi player's own discards"
      : "Watch — tiles that have passed since the riichi";
  } else if (df.phase === "answer") {
    el.className = "df-prompt df-prompt-answer";
    el.innerHTML = `Tap every safe tile
      <span class="df-count">${df.found.size} / ${df.board.safe.size}</span>`;
  } else if (df.phase === "review" && df.reviewOutcome === "fail") {
    el.className = "df-prompt df-prompt-fail";
    el.textContent = `${df.failReason} — green was safe, amber you missed`;
  } else if (df.phase === "review") {
    el.className = "df-prompt df-prompt-clear";
    el.textContent = df.step < dfTotalSteps(df.puzzle)
      ? "Clear — one more tile joins the sequence"
      : "Board complete — new board";
  } else {
    el.className = "df-prompt";
    el.textContent = "";
  }
}

function dfFloat(text, kind) {
  const stage = document.getElementById("df-stage");
  if (!stage) return;
  const el = document.createElement("div");
  el.className = `df-float df-float-${kind}`;
  el.textContent = text;
  stage.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

// --- Loop -------------------------------------------------------------------

function dfLoop(ts) {
  const stage = document.getElementById("df-stage");
  if (!stage || !df) { df = null; return; }   // routed away — stop the loop
  df.raf = requestAnimationFrame(dfLoop);
  const dt = df.lastTs ? Math.min(0.05, (ts - df.lastTs) / 1000) : 0;
  df.lastTs = ts;
  df.now += dt;

  if (df.phase === "play") {
    df.playTimer -= dt;
    if (df.playTimer <= 0) {
      if (df.playIdx < df.board.seq.length) {
        dfFlashNext();
        dfRenderPrompt();
      } else {
        df.playTimer = DF_TAIL_GAP;
        dfBeginAnswer();
      }
    }
    dfRenderBar(1 - df.playIdx / Math.max(1, df.board.seq.length), "watch");
  } else if (df.phase === "answer") {
    df.timer -= dt;
    dfRenderBar(df.timer / df.timerTotal, df.timer < 5 ? "urgent" : "answer");
    if (df.timer <= 0) dfFail("Out of time");
  } else if (df.phase === "review") {
    df.timer -= dt;
    dfRenderBar(0, "idle");
    if (df.timer <= 0) dfAdvance();
  } else {
    dfRenderBar(0, "idle");
  }
}

function dfRenderBar(frac, kind) {
  const bar = document.getElementById("df-bar-fill");
  if (!bar) return;
  bar.style.width = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  bar.className = `df-bar-${kind}`;
}

// --- Best score / leaderboard -----------------------------------------------

function dfBestScore() {
  try { return parseInt(localStorage.getItem(DF_BEST_KEY), 10) || 0; } catch (e) { return 0; }
}

function dfSaveBest(score) {
  try {
    if (score > dfBestScore()) localStorage.setItem(DF_BEST_KEY, String(score));
  } catch (e) { /* private mode */ }
}

function dfBoardArrived(payload) {
  if (payload) dfBoard = payload;
  if (df) dfRenderOverlay();
}

async function dfLoadLeaderboard() {
  try {
    const res = await fetch("/api/defense/leaderboard");
    if (!res.ok) return;
    dfBoardArrived(await res.json());
  } catch (e) {
    // Offline / server down — the panels simply render without a board.
  }
}

async function dfReportRun(score, bestStreak, steps) {
  try {
    const res = await apiPost("/api/defense/scores", {
      score: score, best_streak: bestStreak, steps_cleared: steps,
    });
    if (!res.ok) return;
    dfBoardArrived((await res.json()).leaderboard);
  } catch (e) {
    // The local result stays on screen; the run just isn't on the board.
  }
}

function dfBoardRowHtml(r, extraClass) {
  return `<tr class="${[r.is_you ? "df-lb-you" : "", extraClass || ""].filter(Boolean).join(" ")}">
    <td class="df-lb-rank">${r.rank}</td>
    <td class="df-lb-name">${escapeHtml(r.username)}</td>
    <td class="df-lb-streak">${r.best_streak}</td>
    <td class="df-lb-score">${r.score}</td>
  </tr>`;
}

function dfBoardHtml() {
  if (!dfBoard || !dfBoard.top || !dfBoard.top.length) return "";
  let rows = dfBoard.top.map((r) => dfBoardRowHtml(r)).join("");
  const you = dfBoard.you;
  if (you && !dfBoard.top.some((r) => r.is_you)) {
    rows += dfBoardRowHtml(you, "df-lb-outside");
  }
  const n = dfBoard.players;
  return `<div class="df-lb">
    <div class="df-lb-head">Leaderboard <span>${n} player${n === 1 ? "" : "s"}</span></div>
    <table>
      <thead><tr><th></th><th>player</th><th>streak</th><th>score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

// --- Overlay ----------------------------------------------------------------

function dfRenderOverlay() {
  const ov = document.getElementById("df-overlay");
  if (!ov || !df) return;
  if (df.phase === "play" || df.phase === "answer" || df.phase === "review") {
    ov.className = "df-overlay";
    ov.innerHTML = "";
    return;
  }
  ov.className = "df-overlay show";
  if (df.phase === "over") {
    ov.innerHTML = `<div class="df-panel">
      <h3>Game over</h3>
      <div class="df-result">
        <div><span class="df-result-n">${df.score}</span><span>score</span></div>
        <div><span class="df-result-n">${df.bestStreak}</span><span>best streak</span></div>
        <div><span class="df-result-n">${df.steps}</span><span>steps</span></div>
      </div>
      <button class="btn btn-primary" data-action="dfStart" type="button">Play again</button>
      ${dfBoardHtml()}
    </div>`;
    return;
  }
  if (df.phase === "paused") {
    ov.innerHTML = `<div class="df-panel">
      <h3>Paused</h3>
      <button class="btn btn-primary" data-action="dfStart" type="button">Resume</button>
    </div>`;
    return;
  }
  if (dfPackError) {
    ov.innerHTML = `<div class="df-panel">
      <h3>Defense Trainer</h3>
      <p class="df-hint">Couldn't load the puzzle boards. Reload the page to try again.</p>
    </div>`;
    return;
  }
  const ready = !!dfPack;
  const best = dfBestScore();
  const board = dfBoardHtml();
  ov.innerHTML = `<div class="df-panel">
    <h3>Defense Trainer</h3>
    <p class="df-hint">Real boards, cut the moment someone declared riichi. It starts
      with one safe tile: it turns face up, then back down, and you tap it. Each round
      adds one more — the riichi player's own pond left to right, then every tile that
      has passed since. Everything else on the table stays face down.</p>
    ${!board && best ? `<p class="df-hint">Personal best: ${best}</p>` : ""}
    <button class="btn btn-primary" data-action="dfStart" type="button" ${ready ? "" : "disabled"}>
      ${ready ? "Play" : "Loading boards…"}</button>
    ${board}
  </div>`;
}

function dfStart() {
  if (!df) return;
  if (df.phase === "paused") {
    dfSfxStart();
    dfRenderOverlay();
    dfBeginStep();      // replay the sequence — a half-watched one isn't fair
    return;
  }
  if (!dfPack) { dfLoadPack(); return; }
  const keep = df.raf;
  dfNewGame();
  df.raf = keep;
  dfSfxStart();
  dfRenderHud();
  dfRenderOverlay();
  dfNextPuzzle();
}

// Pausing mid-playback would leave a half-shown sequence; rewinding to the
// start of the step is the only fair resume, so that's what happens.
function dfPause() {
  if (!df || (df.phase !== "play" && df.phase !== "answer")) return;
  df.phase = "paused";
  dfRenderOverlay();
}

// --- Global listeners (registered once at load; no-ops off the trainer) ------

document.addEventListener("visibilitychange", () => {
  if (document.hidden) dfPause();
});

document.addEventListener("keydown", (e) => {
  if (!df || !document.getElementById("df-stage")) return;
  if (e.target.closest("input, textarea, select")) return;
  if (e.key === " " || e.key === "Enter") {
    if (df.phase === "intro" || df.phase === "over" || df.phase === "paused") {
      dfStart();
      e.preventDefault();
    }
  } else if (e.key === "Escape") {
    dfPause();
  } else if (e.key === "m" || e.key === "M") {
    mgToggleMute();
  }
});
