// Both depths use the same badges: + is relative to the other pick;
// ? means the selected draw doesn't guarantee this yaku.
function renderValueRowTags(row) {
  const question = '<abbr class="continuation-question" role="img" aria-label="This yaku depends on the winning tile or win method." tabindex="0">?</abbr>';
  return row.yaku.map(y => `<span class="yaku-tag">${row.additional ? "+" : ""}${escapeHtml(y.name)}`
    + `${y.confirmed ? "" : question}</span>`).join("")
    + (row.dora ? `<span class="yaku-tag dora-tag" title="Includes red fives">${escapeHtml(row.dora.label)}</span>` : "")
    + (row.furiten ? '<span class="furiten-badge" title="Ron is blocked by furiten">Furiten</span>' : "")
    + (row.status ? `<small>${escapeHtml(row.status)}</small>` : "");
}

// Compare physical winning tiles before grouping: a shared regular five
// doesn't imply that the red five has the same outcome, or is even available.
function tenpaiValueRows(groups) {
  return groups.flatMap(group => {
    const methods = [group.ron, group.tsumo].filter(Boolean);
    const names = new Set(methods.flatMap(s => s.yaku));
    const yaku = [...names].map(name => ({ name, confirmed: methods.every(s => s.yaku.includes(name)) }));
    const scores = [group];
    return group.tiles.map(t => ({ tile: t.tile, count: t.count, yaku: t.count ? yaku : [], groups: scores,
      dead: t.count === 0 }));
  });
}

function renderTenpaiValue(groups, riichi, otherGroups) {
  const rows = groupValueRows(tenpaiValueRows(groups), otherGroups ? tenpaiValueRows(otherGroups) : null);
  const compact = rows.map(row => {
    const tiles = row.draws.map(t => `<span class="rsc-tile-entry">${renderTile(t.tile, "tile-sm ukeire-tile-img")}`
      + `<span class="rsc-count">×${t.count}</span></span>`).join("");
    return `<div class="continuation"><div class="continuation-summary"><div class="continuation-draws">${tiles}</div>`
      + `<div class="continuation-tags">${renderValueRowTags(row)}</div></div></div>`;
  }).join("");
  return `<div class="value-waits">${compact}<details><summary class="ukeire-shared-pill">All wait scores</summary>`
    + `<div class="rsc-cell">${renderRiichiScoreCell(groups, riichi)}</div></details></div>`;
}
