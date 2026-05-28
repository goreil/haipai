// Account page (OAuth link/unlink) and Help page. Sibling menu pages
// reachable from the toolbar dropdown.

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

  // GDPR data export
  html += `<div class="account-section" style="margin-top:16px">
    <div class="account-row" style="border-bottom:none;flex-direction:column;align-items:flex-start;gap:8px">
      <span class="account-label" style="min-width:0">Export your data (GDPR)</span>
      <p class="form-hint" style="margin:0">Download a JSON file containing your account, games, mistakes, category reports, and mailbox messages.</p>
      <a class="account-btn" href="/api/me/export" download>Download JSON</a>
    </div>
  </div>`;

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
      <p>Every discard mistake is categorized against <span style="color:#81c784"><b>Mortal AI</b></span> &mdash; a neural-network mahjong AI that considers the full game state: tile efficiency, defense, hand value, riichi timing, opponent behavior, and more. Mortal's pick is the reference for every category below; the in-app speed calculator (<b>Speed</b> marker in the EV table) is shown for context only and never drives a category.</p>
      <p style="margin-top:8px"><b>Step 1: Defense check</b></p>
      <p>If an opponent declared riichi, the mistake is categorized as <span style="color:#ff6b6b">Defense</span>, comparing your tile's deal-in rate to Mortal's:</p>
      <p style="padding-left:16px">&bull; <b>D1 Defend</b> &mdash; Mortal's discard has a lower deal-in rate than yours</p>
      <p style="padding-left:16px">&bull; <b>D2 Push</b> &mdash; Mortal took the riskier tile, but basic strategy (shanten or tile acceptance) justifies it</p>
      <p style="padding-left:16px">&bull; <b>D3 Complex</b> &mdash; Mortal took the riskier tile and it's not a basic-strategy call (a real judgment call)</p>
      <p style="margin-top:8px"><b>Step 2: Attack classification</b> (no riichi threat)</p>
      <p>Mistakes are ranked by difficulty, from most basic to most complex. All comparisons are against Mortal's recommended discard:</p>
      <p style="padding-left:16px">&bull; <b>P1 Shanten Failure</b> &mdash; Your discard ends up at a worse shanten than Mortal's pick &mdash; your hand moved further from winning</p>
      <p style="padding-left:16px">&bull; <b>P2 Tile Efficiency</b> &mdash; Same shanten as Mortal's pick, but fewer tile acceptance (ukeire)</p>
      <p style="padding-left:16px">&bull; <b>P3 Hand Value</b> &mdash; Your discard gives up a yakuhai or dora that Mortal's pick preserves</p>
      <p style="padding-left:16px">&bull; <b>P4 Complex Decision</b> &mdash; Mortal prefers a different tile for reasons that aren't pure shanten, ukeire, or hand value &mdash; a real judgment call</p>
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
      <p><span style="color:#81c784">Mortal Q</span> &mdash; Mortal AI's evaluation. Higher = better strategic play considering defense, hand value, game state. The <b>AI</b> marker shows Mortal's top pick — this is the reference every category is graded against.</p>
      <p>The <b>Speed</b> marker shows the tile with the highest tile acceptance (ukeire), ignoring hand value and defense. It's a cosmetic hint — it never drives a category or appears in the trainer text. When Speed and Mortal disagree, trust Mortal.</p>
      <p><span style="color:var(--sev-major)">You</span> &mdash; The tile you actually played.</p>
    </div>

    <div class="help-section">
      <h3>Opponent Yaku Panel</h3>
      <p>When an opponent opens their hand (calls chi/pon/kan), a strip of pills appears to the right of their discard row showing which yaku that meld combination still allows. <span style="color:#9fd9a2"><b>Green ✓</b></span> = locked, <span style="color:#e6c275"><b>gold ◐</b></span> = still reachable. The number under a tile chip is how many copies are still live in the wall and opponents' hands; a highlighted chip is a copy <em>you</em> hold — discarding it would feed the pon/ron.</p>
      <p>Pills are ordered by how often each yaku actually closes out an open hand &mdash; the most likely threats sit leftmost so your eye lands on them first. Order follows the open-hand frequency stats at <a href="https://amae-koromo.sapk.ch/statistics/fan-stats" target="_blank" style="color:var(--accent-dim)">amae-koromo.sapk.ch/statistics/fan-stats</a>:</p>
      <p style="padding-left:16px">1. <b>Yakuhai</b> &mdash; triplet of dragons, round wind, or seat wind</p>
      <p style="padding-left:16px">2. <b>Tanyao</b> &mdash; all simples (2&ndash;8 only)</p>
      <p style="padding-left:16px">3. <b>Honitsu</b> &mdash; one suit + honors (+ marks a still-reachable chinitsu upgrade)</p>
      <p style="padding-left:16px">4. <b>Sanshoku</b> &mdash; same run in all three suits</p>
      <p style="padding-left:16px">5. <b>Toitoi</b> &mdash; all triplets (no chi melds)</p>
      <p style="padding-left:16px">6. <b>Ittsuu</b> &mdash; 1&ndash;9 straight in a single suit</p>
      <p style="padding-left:16px">7. <b>Chanta</b> &mdash; every group touches a terminal or honor (+ marks a still-reachable junchan upgrade)</p>
      <p>Yaku eliminated by tile count (a honor with too few copies left to pon, a sanshoku/ittsuu with a dead bottleneck) collapse behind an <b>N dead</b> toggle so the live row stays scannable.</p>
    </div>

    <div class="help-section">
      <h3>Game Ratings</h3>
      <p>★ <b>One of your best</b> &mdash; EV/decision in the top 25% of your games</p>
      <p>☆ <b>Above your average</b> &mdash; EV/decision in the top 50% of your games</p>
      <p>Ratings are relative to your own history, so they reflect personal improvement. Rounds with zero mistakes get a <span class="clean-badge" style="display:inline">Clean</span> badge.</p>
    </div>

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

