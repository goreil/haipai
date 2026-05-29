// Network IO for the game list/detail flow: list fetch + per-game fetch +
// annotation save + add-with-progress + delete. The onboarding empty-state
// is rendered from here because it's the failure mode of `fetchGames` when
// the user has zero games — keeping it next to its trigger.

async function fetchGames() {
  const res = await fetch("/api/games");
  state.games = await res.json();
  renderGameList();
  if (state.games.length === 0 && !state.currentGame) {
    showOnboarding();
  }
}

function showOnboarding() {
  document.getElementById("content").innerHTML = `
    <div class="onboarding">
      <h2>Welcome to Haipai</h2>
      <p>Haipai analyzes your Riichi Mahjong games using Mortal AI to help you study your mistakes and track improvement over time.</p>
      <h3>How to add your first game</h3>
      <video class="onboarding-video" src="/static/haipai-bookmarklet-upload.mp4" controls muted playsinline preload="metadata"></video>
      <ol>
        <li>Play a game on <a href="https://tenhou.net" target="_blank">Tenhou</a> or <a href="https://mahjongsoul.game.yo-star.com" target="_blank">Mahjong Soul</a></li>
        <li>Go to <a href="https://mjai.ekyu.moe" target="_blank">mjai.ekyu.moe</a> and paste your replay link</li>
        <li>Wait for Mortal AI to finish analysis</li>
        <li>Download the analysis JSON:
          <ul class="onboarding-sub">
            <li>In the address bar, find the part that says <code>/report/...json</code></li>
            <li>Open that path directly: <code>https://mjai.ekyu.moe/report/abc123.json</code></li>
            <li>You'll see a page of raw data &mdash; press <b>Ctrl+S</b> (Cmd+S on Mac) to save it</li>
          </ul>
        </li>
        <li>Click <strong>+ Add Game</strong> below and upload the saved file</li>
      </ol>
      <button class="btn btn-primary" onclick="showAddModal()">+ Add Game</button>
    </div>
  `;
}

async function fetchGame(id) {
  const res = await fetch(`/api/games/${id}`);
  if (!res.ok) {
    // Bad deep-link or game not owned: drop the hash so the listener doesn't
    // re-fire, and leave the user on the game list.
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search);
    state.currentGame = null;
    state.currentGameData = null;
    document.getElementById("content").innerHTML = '<div class="empty-state">Game not found</div>';
    return;
  }
  state.currentGameData = await res.json();
  state.currentGame = id;
  const want = `#game=${id}`;
  if (window.location.hash !== want) history.replaceState(null, "", want);
  // First render uses any stored prep fields (advisory) + JS categorize so
  // the user sees the game immediately. Then refreshPrepAndRecategorize
  // re-runs prep on the live mortal_data — JS prep is authoritative.
  recategorizeGameInPlace(state.currentGameData);
  state.currentGameData.summary = recomputeSummaryByCategory(state.currentGameData);
  state.prepProgress = _prepProgressInitial(state.currentGameData);
  autoSetSeverityFilters(state.currentGameData);
  if (state.scrollToMistakeId != null) {
    ensureMistakeVisible(state.currentGameData, state.scrollToMistakeId);
  }
  renderGame();
  await refreshPrepAndRecategorize(state.currentGameData, id);
}

async function saveAnnotation(gameId, round, turn, index, note) {
  const res = await apiPost(`/api/games/${gameId}/annotate`, { round, turn, index, note });
  const data = await res.json();
  if (data.ok) {
    state.currentGameData.summary = data.summary;
    const gameInfo = state.games.find(g => g.id === gameId);
    if (gameInfo) {
      gameInfo.summary = data.summary;
      renderGameList();
    }
  }
  return data;
}

async function addGameWithProgress(mortalData, date, onProgress) {
  const res = await apiPost("/api/games/add", { mortal_data: mortalData, date: date || undefined });
  if (!res.ok) {
    const text = await res.text();
    try { return JSON.parse(text); } catch { return { error: `Server error ${res.status}: ${text.slice(0, 200)}` }; }
  }
  return await res.json();
}

// --- Delete game ---

async function deleteGame(id) {
  if (!confirm(`Delete this game? This cannot be undone.`)) return;
  const res = await apiDelete(`/api/games/${id}`);
  const data = await res.json();
  if (data.ok) {
    state.currentGame = null;
    state.currentGameData = null;
    document.getElementById("content").innerHTML = '<div class="empty-state">Game deleted</div>';
    await fetchGames();
  }
}
