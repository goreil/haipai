// Shared sound engine for the minigames (Waits Trainer, Defense Trainer).
//
// Every effect is synthesized on the fly with WebAudio — no asset files, no
// preloading, nothing to 404. The whole palette is a couple of enveloped
// oscillators plus a noise burst, which is enough for arcade feedback and
// keeps the trainers as self-contained as the rest of them. The per-game
// cues (which notes, in what order) stay in each game's own file; only the
// engine, the mute state and the speaker button live here.
//
// The context is created lazily on the first sound, which only ever happens
// inside a click/keypress handler (Play, or a tile tap), so autoplay policy
// is satisfied without a separate "enable audio" gesture.
//
// Mute is one preference across all minigames: turning the sound off in the
// Waits Trainer keeps it off in the Defense Trainer.

var MG_MUTE_KEY = "haipai.minigame.muted";
// Pre-split key, read once so an existing player keeps their choice.
var MG_MUTE_KEY_LEGACY = "haipai.waitsTrainer.muted";

var mgAudio = null;   // { ctx, master } once built; { ctx: null } if unsupported
var mgMuted = (function () {
  try {
    const v = localStorage.getItem(MG_MUTE_KEY);
    if (v !== null) return v === "1";
    return localStorage.getItem(MG_MUTE_KEY_LEGACY) === "1";
  } catch (e) {
    return false;   // private mode / storage disabled
  }
})();

function mgAudioOut() {
  if (mgMuted) return null;
  if (!mgAudio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { mgAudio = { ctx: null }; return null; }
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
    mgAudio = { ctx: ctx, master: master };
  }
  if (!mgAudio.ctx) return null;
  // Browsers suspend the context when the tab is backgrounded (and Safari
  // starts it suspended); resuming is a no-op when it's already running.
  if (mgAudio.ctx.state === "suspended") mgAudio.ctx.resume();
  return mgAudio;
}

// One enveloped oscillator. `to` sweeps the pitch across the note, `delay`
// staggers notes into an arpeggio without needing a scheduler.
function mgTone(o) {
  const a = mgAudioOut();
  if (!a) return;
  const t = a.ctx.currentTime + (o.delay || 0);
  const dur = o.dur || 0.12;
  const peak = o.gain == null ? 0.22 : o.gain;
  const osc = a.ctx.createOscillator();
  osc.type = o.type || "triangle";
  osc.frequency.setValueAtTime(o.freq, t);
  if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = a.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + Math.min(0.012, dur / 3));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g);
  g.connect(a.master);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}

// Filtered white noise — the percussive half of the palette (the miss thud,
// the life-lost crash, the soft spawn whoosh).
function mgNoise(o) {
  const a = mgAudioOut();
  if (!a) return;
  const t = a.ctx.currentTime + (o.delay || 0);
  const dur = o.dur || 0.15;
  const buf = a.ctx.createBuffer(1, Math.ceil(a.ctx.sampleRate * dur), a.ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = a.ctx.createBufferSource();
  src.buffer = buf;
  const f = a.ctx.createBiquadFilter();
  f.type = o.filter || "lowpass";
  f.frequency.setValueAtTime(o.freq || 1200, t);
  if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + dur);
  const g = a.ctx.createGain();
  const peak = o.gain == null ? 0.18 : o.gain;
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f);
  f.connect(g);
  g.connect(a.master);
  src.start(t);
  src.stop(t + dur);
}

// --- Speaker button ---------------------------------------------------------

// Each game styles its own button (.wt-mute / .df-mute) but marks it with
// `data-mg-mute` so a toggle anywhere re-renders every one of them.

function mgToggleMute() {
  mgMuted = !mgMuted;
  try { localStorage.setItem(MG_MUTE_KEY, mgMuted ? "1" : "0"); } catch (e) { /* private mode */ }
  if (mgMuted && mgAudio && mgAudio.ctx) mgAudio.ctx.suspend();
  mgRenderMuteButtons();
  if (!mgMuted) mgTone({ freq: 880, dur: 0.09, type: "sine", gain: 0.14 });
}

// An inline SVG speaker rather than the 🔊/🔇 emoji: the emoji is a colour
// glyph that renders at a different size (or not at all) depending on the
// platform's font, and these buttons sit inline in a HUD row.
function mgRenderMuteButtons() {
  const waves = mgMuted
    ? `<path d="M11 6l4 4M15 6l-4 4" />`
    : `<path d="M11 5.2a3.6 3.6 0 0 1 0 5.6" /><path d="M12.8 3.2a6.2 6.2 0 0 1 0 9.6" />`;
  const svg = `<svg viewBox="0 0 17 16" width="17" height="16" fill="none"
      stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
      aria-hidden="true"><path d="M4.5 6h-2v4h2l3.5 3V3L4.5 6z" fill="currentColor" />${waves}</svg>`;
  for (const btn of document.querySelectorAll("[data-mg-mute]")) {
    btn.classList.toggle("muted", mgMuted);
    btn.innerHTML = svg;
    btn.setAttribute("aria-pressed", mgMuted ? "true" : "false");
    btn.setAttribute("aria-label", mgMuted ? "Sound off" : "Sound on");
    btn.title = mgMuted ? "Sound off (m)" : "Sound on (m)";
  }
}
