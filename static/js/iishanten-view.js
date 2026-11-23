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
      const toggle = event.target.closest("[data-all-draws]");
      if (toggle) {
        const all = toggle.getAttribute("aria-expanded") === "false";
        toggle.setAttribute("aria-expanded", String(all));
        toggle.textContent = all ? "Show differences" : "Show all draws";
        this.renderRows(all ? (this.fullRows ??= groupIishantenValues(this.draws)) : this.diffRows);
        return;
      }
      const cut = event.target.closest("[data-cut]");
      if (cut) {
        const row = cut.closest(".continuation");
        const drawIndex = row.querySelector('[data-draw-index][aria-expanded="true"]').dataset.drawIndex;
        const draw = this.rows[row.dataset.row].draws[drawIndex];
        this.showCut(row.querySelector(".continuation-panel"), draw.branches[cut.dataset.cut], draw);
        return;
      }
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
    if (this.draws !== undefined) return;
    const key = this.closest(".mistake")?.querySelector("[data-comparison-key]")?.dataset.comparisonKey;
    const m = handComparisonContexts.get(key);
    const analyze = discard => {
      const stat = m?.discard_stats?.find(s => tileBase(s.tile) === tileBase(discard));
      return stat ? analyzeIishanten(m, discard, stat) : null;
    };
    this.draws = analyze(this.dataset.discard);
    if (!this.draws) {
      this.insertAdjacentHTML("beforeend", '<small class="continuation-note">Continuation value unavailable</small>');
      return;
    }
    this.mistake = m;
    const other = this.dataset.compareDiscard && analyze(this.dataset.compareDiscard);
    this.diffRows = other ? groupIishantenValues(this.draws, other) : null;
    this.innerHTML = (this.diffRows && this.draws.length
      ? `<button type="button" class="ukeire-shared-pill" data-all-draws aria-expanded="false">Show all draws</button>` : "")
      + `<div class="continuation-rows"></div>`;
    this.renderRows(this.diffRows ?? groupIishantenValues(this.draws));
  }
  renderRows(rows) {
    this.rows = rows;
    const m = this.mistake;
    setActiveDora(getDoraTiles(m.board_state), m.board_state);
    this.querySelector(".continuation-rows").innerHTML = rows.map((r, i) => {
      const tiles = r.draws.map((d, j) => {
        const points = d.branch?.profile?.maxPoints;
        const label = `Show tenpai after drawing ${d.tile} · ${d.count} unseen${points ? ` · up to ${points} points` : ""}`;
        return `<button type="button" class="continuation-draw rsc-tile-entry hand-choice-button" data-draw-index="${j}"`
          + ` aria-expanded="false" aria-label="${label}" title="${label}">${renderTile(d.tile, "tile-sm ukeire-tile-img")}`
          + `<span class="rsc-count">×${d.count}</span></button>`;
      }).join("");
      return `<div class="continuation" data-row="${i}"><div class="continuation-summary">`
        + `<div class="continuation-draws">${tiles}</div><div class="continuation-tags">${renderValueRowTags(r)}</div>`
        + `</div><div class="continuation-panel" hidden></div></div>`;
    }).join("");
  }
  showHand(row, index) {
    const draw = this.rows[row.dataset.row].draws[index];
    const panel = row.querySelector(".continuation-panel");
    if (!draw.branches.length) {
      panel.textContent = "No tenpai continuation available.";
      return;
    }
    const m = this.mistake;
    setActiveDora(getDoraTiles(m.board_state), m.board_state);
    panel.innerHTML = `<div class="continuation-label"></div>` + renderIishantenHand(m, this.dataset.discard, draw)
      + `<div class="rsc-cell" aria-live="polite"></div>`;
    this.showCut(panel, draw.branch ?? draw.branches[0], draw);
  }
  showCut(panel, branch, draw) {
    setActiveDora(getDoraTiles(this.mistake.board_state), this.mistake.board_state);
    for (const b of panel.querySelectorAll("[data-cut]")) {
      b.setAttribute("aria-pressed", String(draw.branches[b.dataset.cut] === branch));
    }
    panel.querySelector(".continuation-label").textContent = `Discard ${branch.discard} · ${branch.count} unseen winning tiles`;
    const score = branch.groups?.length ? renderRiichiScoreCell(sortIishantenWaitGroups(branch.groups), false)
      : `<small>${branch.count === 0 ? "No unseen winning tiles" : "Value unavailable"}</small>`;
    panel.querySelector(".rsc-cell").innerHTML = score;
  }
});
