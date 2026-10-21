// Personal contribution balance and a paginated, private award history.
var coinHistory = { entries: [], nextBefore: null, loading: false, generation: 0 };

function updateCoinBalance(amount) {
  if (!Number.isSafeInteger(amount) || amount < 0) return;
  if (window._meData) window._meData.community_coins = amount;
  const button = document.getElementById("community-open");
  if (!button) return;
  button.hidden = false;
  const value = document.getElementById("community-balance");
  value.textContent = amount.toLocaleString();
  document.getElementById("community-open").setAttribute("aria-label",
    `${amount.toLocaleString()} community coins. View your coin activity.`);
}

async function refreshCoinBalance() {
  try {
    const res = await fetch("/api/me/coins");
    if (res.ok) updateCoinBalance((await res.json()).balance);
  } catch (_) { /* Keep the last confirmed balance when offline. */ }
}

function coinMark() {
  return '<span class="coin-mark" aria-hidden="true">H</span>';
}

function coinEntriesHtml(entries) {
  return entries.map(entry => {
    const date = new Date(entry.created_at.replace(" ", "T") + "Z");
    const mistake = `#${entry.mistake_id}`;
    const mistakeLabel = entry.mistake_available
      ? `<a href="#m${entry.mistake_id}">${mistake}</a>` : mistake;
    return `<li class="coin-entry">
      <span class="coin-entry-icon coin-report" aria-hidden="true">✓</span>
      <div class="coin-entry-body"><strong>Mistake ${mistakeLabel}
        <span class="coin-report-id">${entry.kind === "report_submit" ? "Reported" : "Helped fix"}</span>
        ${entry.report_id ? `<span class="coin-report-id">R-${entry.report_id}</span>` : ""}</strong>
        ${entry.report_text ? `<blockquote>${escapeHtml(entry.report_text)}</blockquote>` : ""}
        ${entry.suggested_category ? `<p>${escapeHtml(entry.suggested_category)}</p>` : ""}
        <time datetime="${escapeHtml(date.toISOString())}">${escapeHtml(date.toLocaleDateString())}</time>
      </div><span class="coin-earned">+${entry.amount.toLocaleString()}<small>coins</small></span>
    </li>`;
  }).join("");
}

function coinMakaSummaryHtml(amount) {
  if (!amount) return "";
  return `<li class="coin-entry coin-maka-summary">
    <span class="coin-entry-icon coin-maka" aria-hidden="true">M</span>
    <div class="coin-entry-body"><strong>Maka ranks</strong></div>
    <span class="coin-earned">+${amount.toLocaleString()}<small>coins</small></span>
  </li>`;
}

async function showCoins() {
  state.currentGame = null;
  state.currentGameData = null;
  renderGameList();
  const generation = ++coinHistory.generation;
  coinHistory.entries = [];
  coinHistory.nextBefore = null;
  coinHistory.loading = false;
  const content = document.getElementById("content");
  content.innerHTML = '<div class="coins-page empty-state" role="status">Loading your community coins…</div>';
  try {
    const response = await fetch("/api/me/coins");
    if (!response.ok) throw new Error("Could not load coins");
    const data = await response.json();
    if (generation !== coinHistory.generation || parseTabHash() !== "coins") return;
    updateCoinBalance(data.balance);
    coinHistory.entries = data.entries;
    coinHistory.nextBefore = data.next_before;
    content.innerHTML = `<section class="coins-page" aria-labelledby="coins-title">
      <div class="coins-heading"><h2 id="coins-title">Community coins</h2>
        <a class="coins-back" href="#" data-action="navigateHome">Back to games ↗</a></div>
      <div class="coins-hero">
        <div class="coins-balance-block">${coinMark()}<div><span class="coins-eyebrow">Balance</span>
          <div class="coins-total">${data.balance.toLocaleString()} <span>coins</span></div></div></div>
        <p class="coins-disclaimer">Coins have no use yet.</p>
      </div>
      <p class="coins-rates">Report an issue: 10 × EV · Reports that lead to fixes: an additional 100 × EV · Maka ranks: ${data.maka_rate} coins per grade</p>
      <section class="coins-gain" aria-labelledby="coins-gain-title">
        <h3 id="coins-gain-title">Gain coins</h3>
        <p>Your top 5 hands by EV loss with no Haipai explanation. Open a hand and share your read to earn coins, once per hand.</p>
        <div id="coins-gain-list" role="status">Finding your highest-EV complex hands…</div>
      </section>
      <div class="coins-log-heading"><h3>Activity</h3></div>
      <ul class="coin-log" id="coin-log">${coinMakaSummaryHtml(data.totals.maka_grade || 0)}${coinEntriesHtml(data.entries)}${
        !data.entries.length && !data.totals.maka_grade ? '<li class="coins-empty">No coins yet.</li>' : ""}</ul>
      <div class="coins-load"><button class="btn" id="coins-more" data-action="loadMoreCoins" ${data.next_before ? "" : "hidden"}>Show more activity</button>
        <p id="coins-status" role="status"></p></div>
    </section>`;
    loadCoinGain(generation);
  } catch (_) {
    if (generation === coinHistory.generation && parseTabHash() === "coins") {
      content.innerHTML = '<div class="coins-page empty-state">Could not load your coins. <button class="btn" data-action="showCoins">Try again</button></div>';
    }
  }
}

async function loadMoreCoins() {
  if (coinHistory.loading || !coinHistory.nextBefore) return;
  const generation = coinHistory.generation;
  coinHistory.loading = true;
  const button = document.getElementById("coins-more");
  button.disabled = true;
  document.getElementById("coins-status").textContent = "Loading…";
  try {
    const response = await fetch(`/api/me/coins?before=${coinHistory.nextBefore}`);
    if (!response.ok) throw new Error("Could not load history");
    const data = await response.json();
    if (generation !== coinHistory.generation || parseTabHash() !== "coins") return;
    document.getElementById("coin-log").insertAdjacentHTML("beforeend", coinEntriesHtml(data.entries));
    coinHistory.entries.push(...data.entries);
    coinHistory.nextBefore = data.next_before;
    button.hidden = !data.next_before;
    document.getElementById("coins-status").textContent = "";
  } catch (_) {
    if (generation === coinHistory.generation && parseTabHash() === "coins") {
      document.getElementById("coins-status").textContent = "Could not load more activity. Please try again.";
    }
  } finally {
    if (generation === coinHistory.generation) coinHistory.loading = false;
    button.disabled = false;
  }
}

function coinGainHtml(hands) {
  if (!hands.length) return '<p class="coins-gain-empty">No unreported complex hands available. Add more games to find new opportunities.</p>';
  return `<ol class="coins-gain-hands">${hands.map(hand => `
    <li><a href="#m${hand.id}">
      <span><strong>${escapeHtml(hand.round_name)} · Turn ${hand.turn}</strong>
        <small>Game #${hand.game_id} · ${hand.ev_loss.toLocaleString(undefined, {maximumFractionDigits: 3})} EV loss</small></span>
      <span class="coin-earned">+${hand.coins.toLocaleString()}<small>coins ↗</small></span>
    </a></li>`).join("")}</ol>`;
}

// Candidates span all own games in EV order. Prepare each game once and stop
// only after finding the five highest-EV complex hands.
async function findCoinGain(candidates, loadGame, isCurrent) {
  const games = new Map();
  const hands = [];
  for (const candidate of candidates) {
    if (!isCurrent()) return null;
    if (!games.has(candidate.game_id)) {
      const game = await loadGame(candidate.game_id);
      // Retain IDs only; full prepared games and Mortal logs can be large.
      games.set(candidate.game_id, new Set((game.rounds || []).flatMap(round => round.mistakes || [])
        .filter(m => !m.my_report && m.shape === "complex").map(m => m.id)));
    }
    if (!isCurrent()) return null;
    if (games.get(candidate.game_id).has(candidate.id)) hands.push(candidate);
    if (hands.length === 5) break;
  }
  return hands;
}

async function loadCoinGain(generation) {
  const isCurrent = () => generation === coinHistory.generation && parseTabHash() === "coins";
  try {
    const response = await fetch("/api/me/coins/gain");
    if (!response.ok) throw new Error("Could not load opportunities");
    const data = await response.json();
    const hands = await findCoinGain(data.candidates, async id => {
      const [res, mres] = await Promise.all([
        fetch(`/api/games/${id}`), fetch(`/api/games/${id}/mortal?v=2`),
      ]);
      if (!res.ok || !mres.ok) throw new Error("Could not analyze game");
      const game = await res.json();
      game.mortal_data = await mres.json();
      if (!game.mortal_data) throw new Error("Game analysis unavailable");
      await haipaiPrep.prepGameAsync(game, game.mortal_data);
      recategorizeGameInPlace(game);
      return game;
    }, isCurrent);
    if (isCurrent() && hands) document.getElementById("coins-gain-list").innerHTML = coinGainHtml(hands);
  } catch (_) {
    if (isCurrent()) document.getElementById("coins-gain-list").textContent =
      "Could not analyze your hands. Reopen Community coins to try again.";
  }
}
