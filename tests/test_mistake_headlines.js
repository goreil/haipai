const assert = require('node:assert/strict');
const { test } = require('node:test');
const { categorize } = require('../static/js/categorize.js');
const comparator = require('../static/js/compare-dimensions.js');
const { mistakeFacet, mistakeBadge, SHAPE_INFO } = require('../static/js/categorize-metadata.js');
const concepts = require('../static/js/game-concept-breakdown.js');
const fixtures = require('./fixtures/categorize_parity.json').fixtures;

function mistake(id) {
  const input = structuredClone(fixtures.find(f => f.mistake_id === id).inputs);
  return { ...input, id, ev_loss: 1, ...categorize(input) };
}

function summary(mistakes) {
  return concepts.tradeoffBoxes({ rounds: [{ mistakes }] }, comparator.compareDimensions,
    comparator.comparedTiles, () => 'mistake');
}

test('concrete one-sided comparisons combine visible improvements and deduplicate value', () => {
  assert.equal(mistakeFacet(mistake(6099)).label, 'Efficiency + Value');
  assert.equal(mistakeFacet(mistake(5502)).label, 'Efficiency + Value + Safety');
  const duplicateValue = mistake(4564);
  assert.deepEqual(duplicateValue.wins.filter(w => !w.suppressed && w.group === 'Dora').map(w => w.dim),
    ['dora_kept', 'dora_acceptance']);
  assert.equal(mistakeFacet(duplicateValue).label, 'Efficiency + Value');
});

test('suppressed pattern potential cannot become a visible badge concept or trade-off', () => {
  const m = mistake(6084);
  assert.ok(m.wins.some(w => w.group === 'Yaku' && w.suppressed));
  assert.equal(mistakeBadge(m).label, 'Attack / Efficiency');
});

test('concrete trade-offs name one recommended direction, not the stored shape', () => {
  for (const [id, label] of [
    [6073, 'Prioritize value'], [6094, 'Prioritize speed'],
    [6077, 'Should fold'], [6108, 'Should push'],
    [6074, 'Prioritize safety'], [6078, 'Safety trade-off'],
  ]) {
    assert.equal(mistakeFacet(mistake(id)).label, label, `mistake ${id}`);
  }
});

test('tiny risk only yields headline precedence when speed/value is another visible trade-off', () => {
  const tinyWithAlternative = mistake(6827);
  const tinyWithoutAlternative = mistake(2066);
  assert.equal(mistakeFacet(tinyWithAlternative).label, 'Prioritize value');
  assert.equal(mistakeFacet(tinyWithoutAlternative).label, 'Should push');
  assert.ok(tinyWithAlternative.wins.some(w => w.dim === 'deal_in' && !w.suppressed));
  assert.ok(tinyWithoutAlternative.wins.some(w => w.dim === 'deal_in' && !w.suppressed));
});

test('half-percentage-point boundary gives push/fold precedence without changing risk evidence', () => {
  for (const [gap, label] of [[0.499, 'Prioritize value'], [0.5, 'Should push'], [0.501, 'Should push']]) {
    const m = mistake(6827);
    const actualTile = m.actual.pai, expectedTile = m.expected.pai;
    for (const rates of [m.dealin_rates, ...m.per_threat.map(t => t.dealin_rates)]) {
      rates[expectedTile] = rates[actualTile] + gap;
    }
    Object.assign(m, categorize(m));
    const risk = m.wins.find(w => w.dim === 'deal_in');
    assert.ok(Math.abs(risk.pct - gap) < 1e-9);
    assert.equal(mistakeFacet(m).label, label);
    assert.equal(risk.suppressed, undefined);
  }
});

test('summary directions and filters distinguish tiny-risk, pre-threat, and mixed-opponent decisions', () => {
  const rows = [mistake(6827), mistake(2066), mistake(6074), mistake(6078)];
  const boxes = summary(rows);
  const expected = [
    [6827, 'speed_value', 'Prioritize value'],
    [2066, 'push_fold', 'Should push'],
    [6074, 'other', 'Prioritize safety'],
    [6078, 'push_fold', 'Safety trade-off'],
  ];
  for (const [id, axis, direction] of expected) {
    assert.equal(boxes.find(b => b.key === axis).mistakes.find(m => m.id === id).direction, direction);
    const filter = { side: 'tradeoff', group: axis, dim: direction };
    const matching = rows.filter(m => concepts.mistakeTouchesConcept(m, comparator.compareDimensions, filter));
    assert.deepEqual(matching.map(m => m.id), [id]);
  }
});

test('facet grouping cannot merge different headlines sharing the same stored shape', () => {
  const rows = [mistake(6084), mistake(6099)];
  const totals = new Map();
  for (const m of rows) {
    const facet = mistakeFacet(m);
    const bucket = totals.get(facet.key) || { label: facet.label, count: 0 };
    bucket.count++;
    totals.set(facet.key, bucket);
  }
  assert.deepEqual([...totals.values()], [
    { label: 'Efficiency', count: 1 }, { label: 'Efficiency + Value', count: 1 },
  ]);
  assert.ok(rows.every(m => m.shape === 'obvious'));
});

test('Complex, action badges, and their summary catch-all remain unchanged', () => {
  const complex = mistake(6075), action = mistake(6076);
  assert.deepEqual(mistakeFacet(complex), {
    key: 'complex', label: 'Complex', desc: SHAPE_INFO.complex.desc,
  });
  assert.equal(mistakeBadge(complex).label, 'Attack / Complex');
  assert.equal(mistakeBadge(action).label, 'Meld / Bad Call');
  const box = summary([complex, action]);
  assert.deepEqual(box.map(b => b.key), ['other']);
  assert.deepEqual(box[0].mistakes.map(m => m.direction), ['Other trade-offs', 'Other trade-offs']);
});

test('presentation and summary selection preserve original comparison inputs and outputs', () => {
  const m = mistake(6827), before = structuredClone(m);
  mistakeBadge(m);
  mistakeFacet(m);
  summary([m]);
  assert.deepEqual(m, before);
  assert.deepEqual(categorize(m), categorize(before));
});
