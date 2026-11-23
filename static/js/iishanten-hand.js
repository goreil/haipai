// The caller supplies one analyzed draw, with its own physical tenpai discards.
function renderIishantenHand(m, firstDiscard, draw, selectedDiscard) {
  const hand = m.hand.slice();
  const removed = hand.indexOf(firstDiscard);
  if (removed < 0) return "";
  hand.splice(removed, 1);
  const order = haipaiPrepTiles.MJAI_TO_RT;
  hand.sort((a, b) => order[a] - order[b] || a.length - b.length);
  hand.push(draw.tile);

  const choices = new Set(draw.branches.map(b => b.discard));
  let html = '<div class="continuation-hand" role="group" aria-label="Hand after drawing ' + draw.tile + '"><span class="tiles">';
  hand.forEach((t, i) => {
    const drawn = i === hand.length - 1;
    if (!choices.has(t)) {
      html += renderTile(t, drawn ? "tile-sm draw" : "tile-sm");
      return;
    }
    html += `<button type="button" class="hand-choice hand-choice-button${drawn ? " draw" : ""}"`
      + ` data-branch-discard="${t}" aria-label="Discard ${drawn ? "drawn " : ""}${t} to see its waits and value" aria-pressed="${t === selectedDiscard}">`
      + renderTile(t, "tile-sm")
      + '<span class="hand-choice-tabs" aria-hidden="true"><span class="hand-choice-tab">Cut</span></span></button>';
  });
  html += '</span>';
  if (m.melds?.length) {
    const seat = mistakeActorSeat(m), oya = mistakeOya(m);
    const dora = getDoraTiles(m.board_state);
    html += '<span class="inline-melds" role="group" aria-label="Fixed melds">';
    for (const meld of m.melds) html += renderMeld(meld, "action-tile-sm", seat, dora, oya);
    html += '</span>';
  }
  return html + '</div>';
}
