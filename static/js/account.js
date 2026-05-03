// Account page (OAuth link/unlink), Help page, My-Feedback view, and the
// "send feedback" modal. Sibling menu pages reachable from the toolbar
// dropdown.

// --- Account ---

function showAccount() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");

  const me = window._meData || {};
  const hasPassword = me.has_password;
  const discordLinked = me.discord_linked;
  const googleLinked = me.google_linked;

  let html = `<div class="game-header"><h2>Account</h2></div>`;
  html += `<div class="account-section">`;
  html += `<div class="account-row"><span class="account-label">Username</span><span>${me.username || "—"}</span></div>`;

  // Discord
  html += `<div class="account-row"><span class="account-label">Discord</span>`;
  if (discordLinked) {
    html += `<span class="account-linked">Linked</span>`;
    if (hasPassword || googleLinked) {
      html += ` <button class="account-btn" onclick="unlinkOAuth('discord')">Unlink</button>`;
    }
  } else {
    html += `<button class="account-btn" onclick="linkOAuth('discord')">Link Discord</button>`;
  }
  html += `</div>`;

  // Google
  html += `<div class="account-row"><span class="account-label">Google</span>`;
  if (googleLinked) {
    html += `<span class="account-linked">Linked</span>`;
    if (hasPassword || discordLinked) {
      html += ` <button class="account-btn" onclick="unlinkOAuth('google')">Unlink</button>`;
    }
  } else {
    html += `<button class="account-btn" onclick="linkOAuth('google')">Link Google</button>`;
  }
  html += `</div>`;

  html += `</div>`;
  content.innerHTML = html;
}

async function linkOAuth(provider) {
  const res = await fetch("/api/me/link-oauth", {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken},
    body: JSON.stringify({provider}),
  });
  if (res.ok) {
    const data = await res.json();
    window.location.href = data.url;
  }
}

async function unlinkOAuth(provider) {
  const res = await fetch("/api/me/unlink-oauth", {
    method: "POST",
    headers: {"Content-Type": "application/json", "X-CSRFToken": csrfToken},
    body: JSON.stringify({provider}),
  });
  if (res.ok) {
    // Refresh me data and re-render
    const meRes = await fetch("/api/me");
    window._meData = await meRes.json();
    showAccount();
  } else {
    const err = await res.json();
    alert(err.error || "Error unlinking");
  }
}

// --- Help ---

function showHelp() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");

  // Group categories (skip legacy)
  const groups = {};
  for (const [code, info] of Object.entries(CATEGORY_INFO)) {
    if (info.legacy) continue;
    const grp = info.group;
    if (!groups[grp]) groups[grp] = [];
    groups[grp].push({ code, ...info });
  }

  let html = `<div class="game-header"><h2>Help</h2></div>`;

  for (const [grp, cats] of Object.entries(groups)) {
    const color = GROUP_COLORS[grp] || "#888";
    html += `<div class="help-group">`;
    html += `<div class="help-group-header" style="color:${color}">${grp}</div>`;
    for (const cat of cats) {
      html += `<div class="help-cat">
        <span class="help-cat-label">${cat.label}</span>
        <span class="help-cat-desc">${cat.desc || ""}</span>
        ${cat.study ? `<span class="help-cat-study">${cat.study}</span>` : ""}
      </div>`;
    }
    html += `</div>`;
  }

  // How categorization works
  html += `
    <div class="help-section">
      <h3>How Auto-Categorization Works</h3>
      <p>Every discard mistake is categorized in two steps using two independent analyses:</p>
      <p><span style="color:#81c784"><b>Mortal AI</b></span> &mdash; A neural-network mahjong AI that considers the full game state: tile efficiency, defense, hand value, riichi timing, opponent behavior, and more.</p>
      <p><span style="color:#64b5f6"><b>Tile Calculator</b></span> &mdash; A pure tile efficiency engine for shanten and ukeire. It ignores defense and strategy entirely.</p>
      <p style="margin-top:8px"><b>Step 1: Defense check</b></p>
      <p>If an opponent declared riichi, the mistake is categorized as <span style="color:#ff6b6b">Defense</span>, comparing your tile's deal-in rate to Mortal's:</p>
      <p style="padding-left:16px">&bull; <b>D1 Defend</b> &mdash; Mortal's discard has a lower deal-in rate than yours</p>
      <p style="padding-left:16px">&bull; <b>D2 Push</b> &mdash; Mortal took the riskier tile, but basic strategy (shanten or tile acceptance) justifies it</p>
      <p style="padding-left:16px">&bull; <b>D3 Complex</b> &mdash; Mortal took the riskier tile and it's not a basic-strategy call (a real judgment call)</p>
      <p style="margin-top:8px"><b>Step 2: Attack classification</b> (no riichi threat)</p>
      <p>Mistakes are ranked by difficulty, from most basic to most complex:</p>
      <p style="padding-left:16px">&bull; <b>P1 Shanten Failure</b> &mdash; Your discard moved your hand further from winning</p>
      <p style="padding-left:16px">&bull; <b>P2 Tile Efficiency</b> &mdash; Your discard has fewer tile acceptance (ukeire) than Mortal's</p>
      <p style="padding-left:16px">&bull; <b>P3 Hand Value</b> &mdash; Similar tile acceptance, but Mortal's pick keeps a yakuhai or dora that you discarded</p>
      <p style="padding-left:16px">&bull; <b>P4 Complex Decision</b> &mdash; Mortal and calculator disagree with no clear hand-value signal &mdash; a real judgment call</p>
      <p>&bull; <b>Non-discard actions</b> (chi, pon, riichi, kan) are categorized by type: Meld, Riichi, or Kan.</p>
    </div>

    <div class="help-section">
      <h3>Defense &amp; Safety Ratings</h3>
      <p>When an opponent declares riichi, each tile in your hand is rated for safety using <b>suji analysis</b> &mdash; a technique based on which tiles the opponent has discarded and what that implies about their waiting tiles.</p>
      <div class="help-safety-scale">
        <div class="help-safety-item">
          <span class="help-safety-bar" style="background:var(--sev-minor)"></span>
          <span><b>15 &mdash; Genbutsu:</b> Tile the opponent already discarded (or discarded after riichi). Cannot deal in. 100% safe.</span>
        </div>
        <div class="help-safety-item">
          <span class="help-safety-bar" style="background:var(--sev-minor)"></span>
          <span><b>14-11 &mdash; Suji terminal / dead honor:</b> Terminal (1/9) with suji protection (rating decreases as more copies remain in wall). Honor tiles: 14 (0 left), 13 (1 left).</span>
        </div>
        <div class="help-safety-item">
          <span class="help-safety-bar" style="background:var(--sev-medium)"></span>
          <span><b>10-7 &mdash; Suji number / honor (2 left):</b> Number tiles (2-8) with suji protection. Suji 4-5-6 = 9, suji 2/8 = 8, suji 3/7 = 7. Honor with 2 remaining = 10.</span>
        </div>
        <div class="help-safety-item">
          <span class="help-safety-bar" style="background:var(--sev-medium)"></span>
          <span><b>6-5 &mdash; Honor (3 left) / non-suji terminal:</b> Unpaired honors or terminals without suji protection.</span>
        </div>
        <div class="help-safety-item">
          <span class="help-safety-bar" style="background:var(--sev-major)"></span>
          <span><b>3-1 &mdash; Non-suji number tiles:</b> No suji protection. 2/8 = 3, 3/7 = 2, 4-5-6 = 1. Middle tiles without suji are the most dangerous discards.</span>
        </div>
      </div>
      <p>When an opponent is in riichi, their discard pool is shown below your hand. The sideways tile marks their riichi declaration. Tiles they discarded are 100% safe &mdash; study their discards to understand the safety ratings.</p>
    </div>

    <div class="help-section">
      <h3>EV Comparison Table</h3>
      <p><span style="color:#81c784">Mortal Q</span> &mdash; Mortal AI's evaluation. Higher = better strategic play considering defense, hand value, game state. The <b>AI</b> marker shows Mortal's top pick.</p>
      <p>The <b>Speed</b> marker shows the calculator's top pick — the tile that reaches tenpai fastest, ignoring hand value and defense.</p>
      <p><span style="color:var(--sev-major)">You</span> &mdash; The tile you actually played. Compare your choice against both analyses.</p>
      <p>When Mortal Q and Exp Score agree, the correct play is clear. When they disagree, Mortal is weighing factors like defense or hand value that pure efficiency misses.</p>
    </div>

    <div class="help-section">
      <h3>Game Ratings</h3>
      <p>★ <b>One of your best</b> &mdash; EV/decision in the top 25% of your games</p>
      <p>☆ <b>Above your average</b> &mdash; EV/decision in the top 50% of your games</p>
      <p>Ratings are relative to your own history, so they reflect personal improvement. Rounds with zero mistakes get a <span class="clean-badge" style="display:inline">Clean</span> badge.</p>
    </div>

    <!-- practice mode help section hidden for Berlin club demo — 2026-04-23
    <div class="help-section">
      <h3>Practice Mode</h3>
      <p>Practice replays your discard mistakes as quizzes. You see the hand, draw, and board context, then pick a discard. After answering, the full analysis is revealed.</p>
      <p>Problems include all discard-vs-discard mistakes &mdash; efficiency, defense, and strategy. Board context (discards, dora, scores) is shown so you have the same information you'd have in a real game.</p>
      <p><b>Spaced repetition:</b> Problems you get wrong (or haven't seen) appear 3x more often. Problems you've answered correctly multiple times appear less. This focuses practice on your weakest areas.</p>
      <p><b>Filters:</b> Focus on severity levels (??? / ??) or riichi-only situations. Switch between community pool and your own mistakes.</p>
    </div>
    -->

    <div class="help-section">
      <h3>Attribution & Licenses</h3>
      <p style="font-size:13px;color:var(--text-dim)">Haipai is open-source software. See the <code>LICENSE</code> and <code>NOTICE</code> files in the repo for full terms and third-party attribution.</p>
      <div class="help-cat"><span class="help-cat-label">Mortal AI</span><span class="help-cat-desc">Mahjong AI engine for game analysis &mdash; <a href="https://mjai.ekyu.moe" target="_blank" style="color:var(--accent-dim)">mjai.ekyu.moe</a></span></div>
      <div class="help-cat"><span class="help-cat-label">python-mahjong</span><span class="help-cat-desc">Shanten / ukeire calculator by MahjongRepository &mdash; MIT &mdash; <a href="https://github.com/MahjongRepository/mahjong" target="_blank" style="color:var(--accent-dim)">GitHub</a></span></div>
      <div class="help-cat"><span class="help-cat-label">killer_mortal_gui</span><span class="help-cat-desc">Deal-in estimator ported from Andy Olsen &mdash; MIT &mdash; <a href="https://github.com/goreil/killer_mortal_gui" target="_blank" style="color:var(--accent-dim)">GitHub</a></span></div>
      <div class="help-cat"><span class="help-cat-label">Tile Graphics</span><span class="help-cat-desc">SVG tiles by FluffyStuff &mdash; CC0 (Public Domain) &mdash; <a href="https://github.com/FluffyStuff/riichi-mahjong-tiles" target="_blank" style="color:var(--accent-dim)">GitHub</a></span></div>
    </div>
  `;

  content.innerHTML = html;
}

// --- My Feedback ---

async function showMyFeedback() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const content = document.getElementById("content");
  content.innerHTML = '<div class="empty-state">Loading...</div>';

  const res = await fetch("/api/feedback/mine");
  const items = await res.json();

  const statusColors = { "new": "#4fc3f7", "in-progress": "#ffa94d", "resolved": "#66bb6a" };

  let html = `<div class="game-header"><h2>My Feedback</h2></div>`;

  if (!items.length) {
    html += '<div class="empty-state">No feedback submitted yet</div>';
    content.innerHTML = html;
    return;
  }

  for (const item of items) {
    const sc = statusColors[item.status] || "#888";
    const date = new Date(item.created_at + "Z").toLocaleString();

    html += `<div class="admin-card">
      <div class="admin-card-header">
        <span class="admin-badge" style="background:${sc}20;color:${sc}">${item.status}</span>
        <span class="admin-meta">${item.type} &middot; ${date}</span>
      </div>
      <div class="admin-card-body">${escapeHtml(item.message)}</div>
      ${item.status === "resolved" && item.admin_note ? `<div class="admin-note-display"><b>Response:</b> ${escapeHtml(item.admin_note)}</div>` : ""}
    </div>`;
  }

  content.innerHTML = html;
}

// --- Feedback modal ---

function showFeedbackModal() {
  document.getElementById("feedback-modal").style.display = "flex";
  document.getElementById("feedback-message").value = "";
  document.getElementById("feedback-error").textContent = "";
}

function hideFeedbackModal() {
  document.getElementById("feedback-modal").style.display = "none";
}

async function submitFeedback() {
  const type = document.getElementById("feedback-type").value;
  const message = document.getElementById("feedback-message").value.trim();
  const errEl = document.getElementById("feedback-error");
  const btn = document.getElementById("feedback-submit-btn");

  if (!message) {
    errEl.textContent = "Please enter a message.";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending...";
  errEl.textContent = "";

  const res = await apiPost("/api/feedback", { type, message });
  const data = await res.json();

  btn.disabled = false;
  btn.textContent = "Send";

  if (data.ok) {
    hideFeedbackModal();
  } else {
    errEl.textContent = data.error || "Failed to send feedback.";
  }
}
