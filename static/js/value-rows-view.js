// + is relative to the other pick; ? means the draw doesn't guarantee this yaku.
function renderValueRowTags(row) {
  const question = '<abbr class="continuation-question" role="img" aria-label="This yaku depends on the winning tile or win method." tabindex="0">?</abbr>';
  return row.yaku.map(y => `<span class="yaku-tag">${row.additional ? "+" : ""}${escapeHtml(y.name)}`
    + `${y.confirmed ? "" : question}</span>`).join("")
    + (row.dora ? `<span class="yaku-tag dora-tag" title="Includes red fives">${escapeHtml(row.dora.label)}</span>` : "")
    + (row.furiten ? '<span class="furiten-badge" title="Ron is blocked by furiten">Furiten</span>' : "")
    + (row.status ? `<small>${escapeHtml(row.status)}</small>` : "");
}
