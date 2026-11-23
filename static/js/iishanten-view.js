// Review can mount a whole game's cards at once. Score only cells that enter
// the viewport; expanding draws reuses that cell's analysis.
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
    this.addEventListener("click", event => {
      const drawButton = event.target.closest("[data-draw-index]");
      if (!drawButton) return;
      const row = drawButton.closest(".continuation");
      const closing = drawButton.getAttribute("aria-expanded") === "true";
      for (const b of row.querySelectorAll("[data-draw-index]")) {
        b.setAttribute("aria-expanded", String(b === drawButton && !closing));
      }
      const panel = row.querySelector(".continuation-panel");
      panel.hidden = closing;
      if (!closing) this.showHand(row, Number(drawButton.dataset.drawIndex));
    });
  }
  showDraws() {
    if (this.rows !== undefined) return;
    const key = this.closest(".mistake")?.querySelector("[data-comparison-key]")?.dataset.comparisonKey;
    const m = handComparisonContexts.get(key);
    const discard = this.dataset.discard;
    const stat = m?.discard_stats?.find(s => tileBase(s.tile) === tileBase(discard));
    const draws = stat ? analyzeIishanten(m, discard, stat) : null;
    this.rows = draws && groupIishantenValues(draws);
    if (!this.rows) {
      this.insertAdjacentHTML("beforeend", '<small class="continuation-note">Continuation value unavailable</small>');
      return;
    }
    this.mistake = m;
    setActiveDora(getDoraTiles(m.board_state), m.board_state);
    const count = draws.reduce((n, draw) => n + draw.count, 0);
    const badge = (label, conditional, bonus) => {
      const tip = bonus ? "The bonus count depends on the winning tile."
        : "This yaku depends on the winning tile or win method.";
      return `<span class="yaku-tag${bonus ? " dora-tag" : ""}">${escapeHtml(label)}`
        + (conditional ? `<abbr class="continuation-question" role="img" aria-label="${tip}" tabindex="0">?</abbr>` : "") + `</span>`;
    };
    this.innerHTML = `<div class="continuation-heading" title="Draws are grouped by value and sorted by highest achievable han.">${count} tiles to tenpai</div>`
      + this.rows.map((r, i) => {
        const tags = r.yaku.map(y => badge(y.name, !y.confirmed, false)).join("")
          + (r.dora ? badge(r.dora.label, r.dora.conditional, true) : "");
        const status = r.unavailable ? "Value unavailable" : r.dead ? "No unseen winning tiles" : "";
        const value = r.maxYakuman ? ` · ${r.maxYakuman}× yakuman` : r.maxHan > 0 ? ` · up to ${r.maxHan} han` : "";
        const tiles = r.draws.map((d, j) => {
          const label = `Show tenpai after drawing ${d.tile} · ${d.count} unseen${value}`;
          return `<button type="button" class="continuation-draw rsc-tile-entry hand-choice-button" data-draw-index="${j}"`
            + ` aria-expanded="false" aria-label="${label}" title="${label}">${renderTile(d.tile, "tile-sm ukeire-tile-img")}`
            + `<span class="rsc-count">×${d.count}</span></button>`;
        }).join("");
        return `<div class="continuation" data-row="${i}"><div class="continuation-summary">`
          + `<div class="continuation-draws">${tiles}</div><div class="continuation-tags">${tags}`
          + (status ? `<small>${status}</small>` : "") + `</div></div><div class="continuation-panel" hidden></div></div>`;
      }).join("");
  }
  showHand(row, index) {
    const draw = this.rows[row.dataset.row].draws[index];
    const panel = row.querySelector(".continuation-panel");
    const branch = draw.branch;
    if (!branch) {
      panel.textContent = draw.unavailable ? "Tenpai discard unavailable." : "No tenpai continuation available.";
      return;
    }
    const m = this.mistake;
    setActiveDora(getDoraTiles(m.board_state), m.board_state);
    const score = branch.groups?.length ? renderRiichiScoreCell(sortIishantenWaitGroups(branch.groups), false)
      : `<small>${branch.count === 0 ? "No unseen winning tiles" : "Value unavailable"}</small>`;
    panel.innerHTML = `<div class="continuation-label">Discard ${escapeHtml(branch.discard)} · ${branch.count} unseen winning tiles</div>`
      + renderIishantenHand(m, this.dataset.discard, draw)
      + `<small class="continuation-note">The cut keeps the widest unseen wait. Ties go to the highest achievable points. Scores include riichi when legal.</small>`
      + `<div class="rsc-cell">${score}</div>`;
  }
});
