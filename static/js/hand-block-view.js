// Full-hand grouping replaces the tile row in place. Search stays in prep.
var blockViewStates = new WeakMap();

function renderHandBlockControls() {
  return `<span class="block-view-controls"><button type="button" class="block-view-toggle"`
    + ` data-action="toggleHandBlocks" aria-pressed="false" title="Group the whole hand into blocks">Blocks</button>`
    + `<span class="block-view-navigation" hidden><button type="button" class="block-view-prev" data-action="cycleHandBlocks" data-direction="-1"`
    + ` aria-label="Previous grouping" hidden>&lt;-</button>`
    + `<button type="button" class="block-view-next" data-action="cycleHandBlocks" data-direction="1"`
    + ` aria-label="Next grouping" hidden>-&gt;</button>`
    + `</span><span class="block-view-counter" hidden></span></span>`;
}

function toggleHandBlocks(button) {
  const row = button.closest('.hand-row');
  const open = button.getAttribute('aria-pressed') !== 'true';
  button.setAttribute('aria-pressed', String(open));
  button.title = open ? 'Restore the normal hand order' : 'Group the whole hand into blocks';
  row.querySelector('.hand-normal-tiles').hidden = open;
  row.querySelector('.block-view-body').hidden = !open;
  const st = blockViewStates.get(row);
  if (!open) {
    if (st) st.version++;
    row.querySelector('.block-view-navigation').hidden = true;
    row.querySelectorAll('.block-view-prev, .block-view-next').forEach(el => { el.hidden = true; });
    row.querySelector('.block-view-counter').hidden = true;
    return;
  }
  if (st?.prepared) renderGroupedHand(row, st);
  else prepareGroupedHand(row);
}

function prepareGroupedHand(row) {
  const st = blockViewStates.get(row) || { version: 0, index: 0 };
  blockViewStates.set(row, st);
  const version = ++st.version;
  const body = row.querySelector('.block-view-body');
  body.textContent = 'Grouping tiles…';
  setTimeout(() => {
    if (!row.isConnected || st.version !== version || body.hidden) return;
    const m = handComparisonContexts.get(row.dataset.comparisonKey);
    try {
      st.prepared = haipaiBlockViewPrep.prepareHand(m);
      renderGroupedHand(row, st);
    } catch (e) {
      body.textContent = 'Block grouping is unavailable for this hand.';
      console.warn('Hand blocks:', e);
    }
  }, 0);
}

function cycleHandBlocks(button) {
  const row = button.closest('.hand-row');
  const st = blockViewStates.get(row);
  if (!st?.prepared) return;
  const count = st.prepared.options.length;
  st.index = (st.index + Number(button.dataset.direction || 1) + count) % count;
  renderGroupedHand(row, st);
}

function renderGroupedHand(row, st) {
  const m = handComparisonContexts.get(row.dataset.comparisonKey);
  const { result, options } = st.prepared;
  const option = options[st.index];
  const markers = handChoiceMarkers(m);
  const selectable = row.querySelector('.hand-normal-tiles .hand-choice-button') != null;
  const drawIndex = m.draw && m.hand[m.hand.length - 1] === m.draw ? result.tiles.lastIndexOf(m.draw) : -1;
  setActiveDora(getDoraTiles(m.board_state), m.board_state);
  row.querySelector('.block-view-body').innerHTML = `<span class="block-view-blocks">`
    + option.blocks.map(b => `<span class="hand-block" title="${handBlockLabel(option, b)}"><span class="hand-block-tiles">`
      + b.tileIndices.map(i => {
        const t = result.tiles[i];
        const tabs = i === result.tiles.lastIndexOf(t) ? markers.get(t) : null;
        return renderHandTile(t, i === drawIndex ? 'draw' : '', tabs, selectable ? row.dataset.comparisonKey : null);
      }).join('') + `</span></span>`).join('')
    + `</span>`;
  for (const button of row.querySelectorAll('.block-view-body .hand-choice-button')) {
    button.setAttribute('aria-pressed', String(!!row.dataset.selectedTile
      && button.dataset.choiceTile === row.dataset.selectedTile));
  }
  row.querySelector('.block-view-navigation').hidden = options.length < 2;
  row.querySelectorAll('.block-view-prev, .block-view-next').forEach(el => { el.hidden = options.length < 2; });
  const counter = row.querySelector('.block-view-counter');
  counter.hidden = false;
  counter.textContent = handBlockCategory(option);
  counter.title = `Grouping ${st.index + 1} of ${options.length}. A selection of full-hand groupings.`;
}

function handBlockCategory(option) {
  if (option.id === 'sevenPairs') return '7 pairs';
  if (option.id === 'thirteenOrphans') return '13 orphans';
  return `${option.config.candidateBlockCount} blocks`;
}

function handBlockLabel(option, b) {
  if (option.id === 'sevenPairs') return b.kind === 'pair' ? 'Pair' : 'Single';
  if (option.id === 'thirteenOrphans') return b.kind === 'pair' ? 'Head pair'
    : option.config.blocks.includes(b) ? 'Terminal / honor' : 'Leftover';
  return b.role === 'head' ? 'Head pair' : ({ sequence: 'Sequence', triplet: 'Triplet',
    pair: 'Pair · set candidate', side: 'Side wait', closed: 'Closed wait', edge: 'Edge wait',
    singleton: b.role === 'head_candidate' ? 'Single · head candidate' : 'Single' })[b.kind];
}
