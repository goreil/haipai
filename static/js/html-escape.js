// escapeHtml, on its own so every shell can have it without dragging in the
// module it used to live in. Three pages build HTML as strings now — the SPA
// (index.html), the read-only shared game (shared.html) and the public
// minigame arcade (play.html) — and only the first of them wants ui.js.
function escapeHtml(s) {
  if (!s) return "";
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
