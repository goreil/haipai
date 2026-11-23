// Review can mount a whole game's cards at once. Score only cells that enter
// the viewport; expanding and switching discards reuse that cell's analysis.
if (typeof customElements !== "undefined") customElements.define("haipai-iishanten", class extends HTMLElement {
  static visibility = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (!isIntersecting || !target.isConnected) continue;
      target.constructor.visibility.unobserve(target);
      target.showDraws();
    }
  });
  connectedCallback() {
    this.constructor.visibility.observe(this);
  }
  disconnectedCallback() {
    this.constructor.visibility.unobserve(this);
  }
  constructor() {
    super();
    this.addEventListener("toggle", event => {
      if (event.target.open) this.showBranch(event.target);
    }, true);
    this.addEventListener("change", event => {
      if (event.target.matches("select")) this.showBranch(event.target.closest("details"));
    });
  }
  showDraws() {
    if (this.draws !== undefined) return;
    const key = this.closest(".mistake")?.querySelector("[data-comparison-key]")?.dataset.comparisonKey;
    const m = handComparisonContexts.get(key);
    const discard = this.dataset.discard;
    const stat = m?.discard_stats?.find(s => tileBase(s.tile) === tileBase(discard));
    this.draws = stat ? analyzeIishanten(m, discard, stat) : null;
    if (!this.draws) {
      this.insertAdjacentHTML("beforeend", '<small class="continuation-note">Continuation value unavailable</small>');
      return;
    }
    this.board = m.board_state;
    setActiveDora(getDoraTiles(this.board), this.board);
    const count = this.draws.reduce((n, draw) => n + draw.count, 0);
    const conditional = this.draws.some(draw => draw.yaku.some(y => !y.confirmed));
    this.innerHTML = `<div class="continuation-heading">${count} tiles to tenpai</div>`
      + this.draws.map((draw, i) => {
        const tags = draw.yaku.map(y => `<span class="yaku-tag">${escapeHtml(y.name)}${y.confirmed ? "" : "?"}</span>`).join("");
        const status = draw.unavailable ? "Value unavailable" : !draw.branches[0]?.count
          ? "No unseen winning tiles" : !tags ? "No shape yaku" : "";
        return `<details class="continuation" data-draw="${i}"><summary>`
          + `<span class="continuation-draw">${renderTile(draw.tile, "tile-sm")} ×${draw.count}</span>`
          + `<span class="continuation-tags">${tags}${status ? `<small>${status}</small>` : ""}</span></summary></details>`;
      }).join("")
      + (conditional ? '<small class="continuation-note">? depends on discard, wait or win method</small>' : "");
  }
  showBranch(details) {
    const { branches } = this.draws[Number(details.dataset.draw)];
    let panel = details.querySelector(".continuation-panel");
    if (!panel) {
      panel = document.createElement("div");
      panel.className = "continuation-panel";
      details.append(panel);
      if (!branches.length) {
        panel.textContent = "No tenpai continuation available.";
        return;
      }
      const label = b => `${b.discard} · ${b.count} unseen`;
      const control = branches.length === 1 ? `<strong>Discard ${escapeHtml(label(branches[0]))}</strong>`
        : '<label class="continuation-picker">Tenpai discard<select>'
          + branches.map((b, i) => `<option value="${i}">${escapeHtml(label(b))}${b.count === branches[0].count ? " · widest" : ""}</option>`).join("") + '</select></label>';
      panel.innerHTML = control + '<div class="rsc-cell" aria-live="polite"></div>';
    }
    if (!branches.length) return;
    const branch = branches[Number(panel.querySelector("select")?.value || 0)];
    setActiveDora(getDoraTiles(this.board), this.board);
    panel.querySelector(".rsc-cell").innerHTML = branch.groups?.length ? renderRiichiScoreCell(branch.groups, false)
      : `<small>${branch.count === 0 ? "No unseen winning tiles" : "Value unavailable"}</small>`;
  }
});
