// Manual Maka grades stay separate from Haipai's computed ratings.
function renderMakaRatings(game) {
  const draft = game._makaDraft || (game._makaDraft = {
    overall: game.maka_ratings?.overall || "",
    matches: game.rounds.map((_, i) => game.maka_ratings?.matches?.[i] || ""),
  });
  const field = (label, value, index) => `<label>${escapeHtml(label)}
    <input type="text" maxlength="4" pattern="[A-Za-z]{1,3}[+\\-]?" autocomplete="off"
      placeholder="e.g. B+" value="${escapeHtml(value)}" data-maka-index="${index}">
    </label>`;
  return `<details class="maka-ratings" ${game._makaOpen ? "open" : ""}>
    <summary>Maka Ratings <span>(optional)</span></summary>
    <form class="maka-form">
      <p>Enter Maka ratings from the in-game log. You can leave fields blank.</p>
      ${field("Overall Score – entire Hanchan", draft.overall, "overall")}
      <div class="maka-hands">${game.rounds.map((round, i) =>
        field(`Hand ${i + 1} · ${round.round} – Match Score`, draft.matches[i], i)).join("")}</div>
      <button type="submit" class="btn" ${game._makaSaving ? "disabled" : ""}>Save</button>
      <span class="maka-status" role="status">${escapeHtml(game._makaStatus || "")}</span>
    </form>
  </details>`;
}

function bindMakaRatings(game) {
  const panel = document.querySelector(".maka-ratings");
  if (!panel) return;
  panel.addEventListener("toggle", () => { game._makaOpen = panel.open; });
  const form = panel.querySelector("form");
  form.addEventListener("input", event => {
    const index = event.target.dataset.makaIndex;
    if (index === undefined) return;
    if (index === "overall") game._makaDraft.overall = event.target.value;
    else game._makaDraft.matches[Number(index)] = event.target.value;
    game._makaStatus = "Unsaved changes";
    form.querySelector(".maka-status").textContent = game._makaStatus;
  });
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (game._makaSaving) return;
    game._makaSaving = true;
    const payload = JSON.parse(JSON.stringify(game._makaDraft));
    const button = form.querySelector("button");
    button.disabled = true;
    game._makaStatus = "Saving …";
    form.querySelector(".maka-status").textContent = game._makaStatus;
    try {
      const response = await apiPost(`/api/games/${game.id}/maka-ratings`, payload);
      if (!response.ok) throw new Error("Save failed");
      game.maka_ratings = await response.json();
      game._makaStatus = JSON.stringify(payload) === JSON.stringify(game._makaDraft)
        ? "Saved" : "Unsaved changes";
    } catch (_) {
      game._makaStatus = "Could not save. Please try again.";
    } finally {
      game._makaSaving = false;
      // Rendering/filter changes may have replaced the form while saving.
      if (state.currentGameData === game) {
        const current = document.querySelector(".maka-form");
        if (current) {
          current.querySelector("button").disabled = false;
          current.querySelector(".maka-status").textContent = game._makaStatus;
        }
      }
    }
  });
}
