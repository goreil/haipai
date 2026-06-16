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
      <div class="tutorial-tabs-wrap">
        <div class="tutorial-tabs">
          <button type="button" class="tutorial-tab active" data-action="switchTutorial" data-tutorial-key="tenhou">Tenhou</button>
          <button type="button" class="tutorial-tab" data-action="switchTutorial" data-tutorial-key="mahjong-soul">Mahjong Soul</button>
          <button type="button" class="tutorial-tab" data-action="switchTutorial" data-tutorial-key="riichi-city">Riichi City</button>
        </div>
        <video class="onboarding-video tutorial-video active" data-tutorial="tenhou" src="/static/haipai-bookmarklet-upload.mp4" controls muted playsinline preload="metadata"></video>
        <video class="onboarding-video tutorial-video" data-tutorial="mahjong-soul" src="/static/haipai_mahjong_soul_guide.mp4" controls muted playsinline preload="metadata"></video>
        <video class="onboarding-video tutorial-video" data-tutorial="riichi-city" src="/static/haipai_riichi_city.mp4" controls muted playsinline preload="metadata"></video>
      </div>
      <button class="btn btn-primary" data-action="showAddModal">+ Add Game</button>
    </div>
  `;
}

async function fetchGame(id) {
  // mortal_data ships from its own endpoint with immutable cache headers,
  // so revisits only re-download the (small) game payload.
  const [res, mres] = await Promise.all([
    fetch(`/api/games/${id}`),
    fetch(`/api/games/${id}/mortal`),
  ]);
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
  if (mres.ok) state.currentGameData.mortal_data = await mres.json();
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
