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
        <p>Review complex hands and share your read to earn coins.</p>
        <button class="btn" data-action="showCoinGain">Gain coins ↗</button>
      </section>
      <div class="coins-log-heading"><h3>Activity</h3></div>
      <ul class="coin-log" id="coin-log">${coinMakaSummaryHtml(data.totals.maka_grade || 0)}${coinEntriesHtml(data.entries)}${
        !data.entries.length && !data.totals.maka_grade ? '<li class="coins-empty">No coins yet.</li>' : ""}</ul>
      <div class="coins-load"><button class="btn" id="coins-more" data-action="loadMoreCoins" ${data.next_before ? "" : "hidden"}>Show more activity</button>
        <p id="coins-status" role="status"></p></div>
    </section>`;
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

// Own modal state keeps report edits independent of the game behind the window.
var coinGain = { hands: [], worker: null, timer: null, opener: null, before: null, loading: false };

function coinGainHtml(hands) {
  return hands.map(hand => `<article class="coins-gain-card">
    <div class="coins-gain-reward"><span>Game #${hand.game_id}</span>
      <span class="coin-earned">+${hand.coins.toLocaleString()}<small>coins for your report</small></span></div>
    ${renderMistakeCard(hand.mistake)}${trainerBubbleHtml(hand.mistake)}
  </article>`).join("");
}

function stopCoinGain() {
  coinGain.worker?.terminate();
  coinGain.worker = null;
  clearTimeout(coinGain.timer);
  coinGain.loading = false;
}

function closeCoinGain() {
  stopCoinGain();
  document.getElementById("coins-gain-dialog")?.remove();
  coinGain.hands = [];
  coinGain.opener?.focus();
  coinGain.opener = null;
}

function showCoinGain() {
  if (document.getElementById("coins-gain-dialog")) return;
  coinGain.opener = document.activeElement;
  coinGain.hands = [];
  coinGain.before = null;
  const dialog = document.createElement("dialog");
  dialog.id = "coins-gain-dialog";
  dialog.setAttribute("aria-labelledby", "coins-gain-window-title");
  dialog.innerHTML = `<div class="coins-gain-window-heading"><h2 id="coins-gain-window-title">Gain coins</h2>
    <button class="btn" data-action="closeCoinGain" aria-label="Close gain coins">Close ×</button></div>
    <p class="coins-gain-scope">Review one unreported complex hand at a time, highest EV loss first.
      Share your read to earn coins, or choose Next to keep searching through your games.</p>
    <p id="coins-gain-status" role="status">Finding complex hands…</p>
    <div id="coins-gain-list"></div>
    <div class="coins-gain-navigation"><button class="btn" id="coins-gain-next" data-action="nextCoinGain">Next →</button></div>`;
  dialog.addEventListener("cancel", event => { event.preventDefault(); closeCoinGain(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) closeCoinGain(); });
  document.body.append(dialog);
  dialog.showModal();
  nextCoinGain();
}

function nextCoinGain() {
  if (coinGain.loading) return;
  coinGain.loading = true;
  coinGain.hands = [];
  const button = document.getElementById("coins-gain-next");
  button.disabled = true;
  document.getElementById("coins-gain-list").innerHTML = "";
  document.getElementById("coins-gain-status").textContent = "Finding the next complex hand…";
  document.getElementById("coins-gain-dialog").scrollTop = 0;
  const finish = (message, exhausted = false) => {
    clearTimeout(coinGain.timer);
    coinGain.loading = false;
    button.disabled = exhausted;
    document.getElementById("coins-gain-status").textContent = message;
    document.getElementById("coins-gain-list").innerHTML = coinGainHtml(coinGain.hands);
  };
  coinGain.timer = setTimeout(() => {
    stopCoinGain();
    finish("No match within the time limit. Choose Next to continue searching.");
  }, 1800);
  try {
    if (!coinGain.worker) coinGain.worker = new Worker("/static/js/coins-worker.js");
    coinGain.worker.onmessage = ({data}) => {
      if (data.before) coinGain.before = data.before;
      if (data.hand) { coinGain.hands = [data.hand]; finish(""); }
      if (data.done) finish("You've reached the end of your unreported hands.", true);
      if (data.error) {
        stopCoinGain();
        finish("Could not analyze your hands. Choose Next to try again.");
      }
    };
    coinGain.worker.onerror = () => {
      stopCoinGain();
      finish("Could not analyze your hands. Choose Next to try again.");
    };
    coinGain.worker.postMessage({before: coinGain.before});
  } catch (_) {
    stopCoinGain();
    finish("Could not start analysis. Choose Next to try again.");
  }
}
