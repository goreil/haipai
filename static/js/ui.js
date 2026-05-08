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
  refreshUploadBookmarklet();
}

function hideAddModal() {
  document.getElementById("add-modal").classList.remove("show");
}

// Build the "Send to Haipai" bookmarklet href from the user's upload token.
// The bookmarklet runs in the mjai.ekyu.moe report page, reads the ?data=
// query param to get the analysis JSON URL, fetches it same-origin, then
// POSTs the JSON to /api/games/upload here.
function buildUploadBookmarkletHref(token, origin) {
  const code = `(function(){var u=location.origin+new URLSearchParams(location.search).get('data');if(!u||u===location.origin+'null'){alert('No ?data= param found.');return;}fetch(u).then(function(r){return r.json();}).then(function(d){return fetch('${origin}/api/games/upload',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer ${token}'},body:JSON.stringify({mortal_data:d})});}).then(function(r){return r.json().then(function(j){return{status:r.status,j:j};});}).then(function(x){if(x.status>=200&&x.status<300)location.href='${origin}/';else alert('Upload failed ('+x.status+'): '+(x.j&&x.j.error||''));}).catch(function(e){alert('Upload failed: '+e);});})();`;
  return "javascript:" + encodeURIComponent(code);
}

async function refreshUploadBookmarklet() {
  const link = document.getElementById("upload-bookmarklet");
  if (!link) return;
  try {
    const res = await fetch("/api/upload-token");
    if (!res.ok) throw new Error("token fetch failed");
    const { token } = await res.json();
    link.href = buildUploadBookmarkletHref(token, window.location.origin);
  } catch (e) {
    link.href = "javascript:alert('Could not load upload token')";
  }
}

async function regenerateUploadToken() {
  if (!confirm("Regenerate your upload token? Any installed bookmarklets will stop working.")) return;
  const res = await apiPost("/api/upload-token/regenerate", {});
  if (!res.ok) {
    alert("Could not regenerate token");
    return;
  }
  const { token } = await res.json();
  const link = document.getElementById("upload-bookmarklet");
  if (link) link.href = buildUploadBookmarkletHref(token, window.location.origin);
  alert("New bookmarklet ready — drag the link to your bookmark bar to replace the old one.");
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
