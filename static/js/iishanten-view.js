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
        this.renderDrawMode(toggle.getAttribute("aria-expanded") === "false");
        return;
      }
      const cut = event.target.closest("[data-cut]");
      if (cut) {
        const row = cut.closest(".continuation");
        const drawIndex = row.querySelector('[data-draw-index][aria-expanded="true"]').dataset.drawIndex;
        const draw = this.rows[row.dataset.row][row.dataset.side].draws[drawIndex];
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
    if (this.discards) return;
    const key = this.closest(".mistake")?.querySelector("[data-comparison-key]")?.dataset.comparisonKey;
    const m = handComparisonContexts.get(key);
    const analyze = discard => {
      const stat = m?.discard_stats?.find(s => tileBase(s.tile) === tileBase(discard));
      return stat ? analyzeIishanten(m, discard, stat) : null;
    };
    this.discards = [this.dataset.discard];
    if (this.dataset.compareDiscard) this.discards.push(this.dataset.compareDiscard);
    this.draws = this.discards.map(analyze);
    this.mistake = m;
    const compared = this.draws.length === 2 && this.draws.every(Boolean);
    const headers = this.draws.map((draws, side) => this.columnHtml(side, compared
      ? '<button type="button" class="ukeire-shared-pill" data-all-draws></button>'
      : draws ? "" : '<small class="continuation-note">Continuation value unavailable</small>')).join("");
    this.innerHTML = headers + `<div class="continuation-rows"></div>`;
    if (compared) {
      this.comparison = compareIishantenValues(...this.draws);
      this.totals = this.draws.map(draws => draws.reduce((n, d) => n + d.count, 0));
      this.renderDrawMode(false);
    } else {
      const columns = this.draws.map(draws => draws ? groupIishantenValues(draws) : []);
      const height = Math.max(...columns.map(groups => groups.length));
      this.renderRows(Array.from({ length: height }, (_, i) => columns.map(groups => groups[i])));
    }
  }
  renderDrawMode(expanded) {
    this.querySelectorAll("[data-all-draws]").forEach((toggle, side) => {
      toggle.setAttribute("aria-expanded", String(expanded));
      toggle.title = expanded ? "Show only draw differences for both picks"
        : "Draw copies with equal value outcomes — show all draws for both picks";
      toggle.innerHTML = (expanded ? this.totals[side] : `${this.comparison.equalCount} equal`)
        + `<span class="ukeire-shared-caret" aria-hidden="true">${expanded ? "◂" : "▸"}</span>`;
    });
    this.renderRows(expanded ? (this.fullRows ??= compareIishantenValues(...this.draws, true).rows)
      : this.comparison.rows);
  }
  columnHtml(side, content) {
    return this.discards.length === 1 ? content : `<div class="col-${side ? "expected" : "actual"}">${content}</div>`;
  }
  renderRows(rows) {
    this.rows = rows;
    const m = this.mistake;
    if (m) setActiveDora(getDoraTiles(m.board_state), m.board_state);
    this.querySelector(".continuation-rows").innerHTML = rows.map((pair, i) => pair.map((group, side) =>
      this.columnHtml(side, group ? this.drawGroupHtml(group, i, side) : "")).join("")).join("");
  }
  drawGroupHtml(r, i, side) {
    const tiles = r.draws.map((d, j) => {
      const points = d.branch?.profile?.maxPoints;
      const label = `Show tenpai after drawing ${d.tile} · ${d.count} unseen${points ? ` · up to ${points} points` : ""}`;
      return `<button type="button" class="continuation-draw rsc-tile-entry hand-choice-button" data-draw-index="${j}"`
        + ` aria-expanded="false" aria-label="${label}" title="${label}">${renderTile(d.tile, "tile-sm ukeire-tile-img")}`
        + `<span class="rsc-count">×${d.count}</span></button>`;
    }).join("");
    return `<div class="continuation" data-row="${i}" data-side="${side}"><div class="continuation-summary">`
      + `<div class="continuation-draws">${tiles}</div><div class="continuation-tags">${renderValueRowTags(r)}</div>`
      + `</div><div class="continuation-panel" hidden></div></div>`;
  }
  showHand(row, index) {
    const side = row.dataset.side;
    const draw = this.rows[row.dataset.row][side].draws[index];
    const panel = row.querySelector(".continuation-panel");
    if (!draw.branches.length) {
      panel.textContent = "No tenpai continuation available.";
      return;
    }
    const m = this.mistake;
    setActiveDora(getDoraTiles(m.board_state), m.board_state);
    panel.innerHTML = `<div class="continuation-label"></div>` + renderIishantenHand(m, this.discards[side], draw)
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
