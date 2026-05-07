// UI plumbing that doesn't belong to one feature: sidebar toggle, add-game
// modal, severity-filter visibility, escapeHtml, keyboard shortcuts, and
// tile hover-highlight (including riichi-genbutsu reveal on hover).

function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// --- Sidebar toggle ---

function toggleSidebar() {
  document.querySelector(".sidebar").classList.toggle("collapsed");
}

// --- Add game modal ---

function showAddModal() {
  document.getElementById("add-modal").classList.add("show");
  document.getElementById("add-file").value = "";
  document.getElementById("add-date").value = "";
  document.getElementById("add-error").textContent = "";
}

function hideAddModal() {
  document.getElementById("add-modal").classList.remove("show");
}

async function submitAddGame() {
  const fileInput = document.getElementById("add-file");
  const date = document.getElementById("add-date").value.trim();
  const errEl = document.getElementById("add-error");
  const btn = document.getElementById("add-submit-btn");

  if (!fileInput.files.length) {
    errEl.textContent = "Select a Mortal analysis JSON file";
    return;
  }

  btn.disabled = true;
  errEl.textContent = "";

  // Show progress bar
  let progressEl = document.getElementById("add-progress");
  if (!progressEl) {
    progressEl = document.createElement("div");
    progressEl.id = "add-progress";
    progressEl.className = "add-progress";
    btn.parentElement.insertBefore(progressEl, btn);
  }
  progressEl.innerHTML = '<div class="add-progress-text">Adding and analyzing game...</div><div class="add-progress-bar"><div class="add-progress-fill" style="width:100%;animation:pulse 1.5s ease-in-out infinite"></div></div>';
  progressEl.style.display = "";

  try {
    const text = await fileInput.files[0].text();
    const mortalData = JSON.parse(text);

    const result = await addGameWithProgress(mortalData, date);

    btn.disabled = false;
    progressEl.style.display = "none";

    if (result.error) {
      errEl.textContent = result.error || result.message;
      return;
    }

    hideAddModal();
    await fetchGames();
    await fetchGame(result.game_id);
    pollCategorization(result.game_id);
  } catch (e) {
    btn.disabled = false;
    progressEl.style.display = "none";
    errEl.textContent = e.message;
  }
}

// --- Keyboard shortcuts ---

// Close toolbar dropdown when clicking outside
document.addEventListener("click", (e) => {
  if (!e.target.closest(".toolbar-menu")) {
    document.querySelectorAll(".toolbar-menu.open").forEach(m => m.classList.remove("open"));
  }
});

// --- Tile hover highlighting ---
// Hovering a tile highlights all copies of that tile type on the board.

document.addEventListener("mouseover", (e) => {
  const tile = e.target.closest("[data-tile]");
  if (tile) {
    const tileType = tile.dataset.tile;
    document.querySelectorAll(`[data-tile="${tileType}"]`).forEach(el => el.classList.add("tile-hover"));
  }
  // Hovering a specific riichi tile: highlight every tile that is genbutsu
  // against THAT riichi — i.e. all discards from the riichi player (any
  // turn), plus every tile discarded by any player after the riichi turn.
  const riichiEl = e.target.closest(".riichi-tile");
  if (riichiEl) {
    const rTurn = parseInt(riichiEl.dataset.riichiTurn, 10);
    const rSeat = parseInt(riichiEl.dataset.riichiSeat, 10);
    const container = riichiEl.closest(".all-discards");
    if (container && Number.isFinite(rTurn) && Number.isFinite(rSeat)) {
      container.querySelectorAll("[data-turn][data-seat]").forEach(el => {
        if (el.classList.contains("skip-placeholder")) return;
        const t = parseInt(el.dataset.turn, 10);
        const s = parseInt(el.dataset.seat, 10);
        if (s === rSeat || t > rTurn) el.classList.add("safe-from-riichi");
      });
    }
  }
});

document.addEventListener("mouseout", (e) => {
  const tile = e.target.closest("[data-tile]");
  if (tile) {
    const tileType = tile.dataset.tile;
    document.querySelectorAll(`[data-tile="${tileType}"]`).forEach(el => el.classList.remove("tile-hover"));
  }
  const riichiEl = e.target.closest(".riichi-tile");
  if (riichiEl) {
    const container = riichiEl.closest(".all-discards");
    if (container) {
      container.querySelectorAll(".safe-from-riichi").forEach(el => el.classList.remove("safe-from-riichi"));
    }
  }
});
