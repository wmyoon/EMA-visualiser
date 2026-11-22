import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import guidelines, { normalise } from '../js/datasets/guidelines.js';
import { computeLayout } from '../js/layouts.js';
import { STAGES, STAGE_BY_ID, EMA_STAGE_BY_ID, LIFECYCLE, indexStages } from '../js/stages.js';

const row = (slug, category = 'Human') => ({ title: slug, category, first_published_date: '01/01/2020', url: `https://www.ema.europa.eu/en/scientific-guidelines/${slug}` });
const url = (slug) => row(slug).url;
const assess = (slug, stage, more = {}) => ({ url: url(slug), stage, secondary: null, confidence: 'high', confidence_reason: null, food_chain: false, reasoning: 'Because.', evidence: 'a quote', ...more });

test('every assessed stage sits inside one of EMA’s lifecycle stages, and the lifecycle plan uses each once', () => {
  for (const s of STAGES) assert.ok(EMA_STAGE_BY_ID[s.ema], s.id);
  const planned = [...LIFECYCLE.columns.flatMap((c) => c.blocks), ...LIFECYCLE.band.blocks];
  assert.deepEqual([...planned].sort(), STAGES.map((s) => s.id).sort());
  for (const c of LIFECYCLE.columns) for (const b of c.blocks) assert.equal(STAGE_BY_ID[b].ema, c.ema);
  for (const b of LIFECYCLE.band.blocks) assert.equal(STAGE_BY_ID[b].ema, LIFECYCLE.band.ema);
});

test('indexStages keeps usable assessments and tidies the rest', () => {
  const map = indexStages({
    stages: [
      assess('a', 'CD', { secondary: 'MA', confidence: 'medium', confidence_reason: 'spans-stages' }),
      assess('b', 'ZZ'), // unknown stage: dropped
      { stage: 'NC' }, // no url: dropped
      assess('c', 'NC', { secondary: 'NC?', confidence: 'sure', confidence_reason: 'whim', food_chain: 'yes' }),
    ],
  });
  assert.deepEqual([...map.keys()], [url('a'), url('c')]);
  assert.equal(map.get(url('a')).reason, 'spans-stages');
  const c = map.get(url('c'));
  assert.equal(c.secondary, null);
  assert.equal(c.confidence, 'medium');
  assert.equal(c.reason, null);
  assert.equal(c.foodChain, false);
  assert.equal(indexStages(null).size, 0);
  assert.equal(indexStages({ stages: 'nope' }).size, 0);
});

test('records carry their assessment, the stage and food-chain facets, and stage words for search', () => {
  const records = normalise([row('a'), row('b', 'Veterinary'), row('c')], {
    stages: { stages: [assess('a', 'PA'), assess('b', 'MA', { secondary: 'NC', food_chain: true })] },
  });
  const [a, b, c] = records;
  assert.equal(a.stage.stage, 'PA');
  assert.deepEqual(a.f.stage, ['PA']);
  assert.deepEqual(a.f.food, []);
  assert.deepEqual(b.f.food, ['yes']);
  assert.equal(c.stage, null);
  assert.deepEqual(c.f.stage, ['none']);
  assert.ok(a.hay.includes('post-authorisation'));
  assert.match(guidelines.tooltip(a).meta, /Post-authorisation$/);
});

test('the card shows the path through EMA’s lifecycle once, with the reasoning and its source', () => {
  const records = normalise([row('a'), row('b'), row('c')], {
    stages: {
      stages: [
        assess('a', 'MA', { secondary: 'PA', document: 'Guideline on A', document_status: 'Adopted', document_url: 'https://www.ema.europa.eu/en/documents/a.pdf' }),
        assess('b', 'NC', { confidence: 'low', confidence_reason: 'limited-source', food_chain: true, evidence_source: 'page summary' }),
      ],
    },
  });
  const card = (r) => guidelines.detail(r, { snapshotMs: Date.UTC(2026, 0, 1), records }).assessment;
  const a = card(records[0]);
  assert.deepEqual(a.path, ['Marketing authorisation']);
  assert.deepEqual(a.facts, [['Also serves', 'Post-authorisation'], ['Confidence', 'High']]);
  assert.equal(a.source.document, 'Guideline on A');
  const b = card(records[1]);
  assert.deepEqual(b.path, ['Research and development', 'Non-clinical development']);
  assert.match(b.facts.find(([k]) => k === 'Confidence')[1], /^Low: little text/);
  assert.ok(b.facts.some(([k]) => k === 'Food chain'));
  assert.equal(b.source.label, 'From EMA’s page summary');
  assert.equal(card(records[2]).empty, 'Not yet assessed.');
});

test('the lifecycle runs left to right, with the spanning topics in front and lean towards the secondary stage', () => {
  const plan = [
    ...['NC', 'CD', 'MA', 'PA', 'QM', 'XC'].flatMap((s) => Array.from({ length: 30 }, (_, k) => [`${s}-${k}`, s, null])),
    ['cd-left', 'CD', 'NC'],
    ['cd-right', 'CD', 'MA'],
    ['loose', null, null],
  ];
  const stages = plan.filter(([, s]) => s).map(([slug, s, sec]) => assess(slug, s, { secondary: sec }));
  const records = normalise(plan.map(([slug]) => row(slug)), { stages: { stages } });
  const layout = computeLayout(guidelines.layouts.find((l) => l.id === 'lifecycle'), records, 'pub');
  const mean = (stage, axis) => {
    const list = records.filter((r) => r.stage?.stage === stage);
    return list.reduce((s, r) => s + layout.positions[r.i * 3 + axis], 0) / list.length;
  };
  assert.ok(mean('NC', 0) < mean('CD', 0) && mean('CD', 0) < mean('MA', 0) && mean('MA', 0) < mean('PA', 0), 'EMA’s stages in order');
  assert.ok(mean('QM', 2) > mean('MA', 2) + 5 && mean('XC', 2) > mean('MA', 2) + 5, 'the spanning band is in front');
  const x = (slug) => layout.positions[records.find((r) => r.title === slug).i * 3];
  assert.ok(x('cd-left') < x('cd-right'), 'a clinical guideline that also serves non-clinical work sits left of one that also serves authorisation');
  assert.ok(layout.labels.some((l) => l.text === 'Not yet assessed'), 'unassessed guidelines get their own block');
  for (const label of ['Research and development', 'Marketing authorisation', 'Post-authorisation', 'Topics that span the product lifecycle']) {
    assert.ok(layout.labels.some((l) => l.kind === 'stage' && l.text === label), label);
  }
});

test('the shipped stage file matches the dataset', async (t) => {
  let file;
  try {
    file = JSON.parse(await readFile(new URL('../data/guideline-stages.json', import.meta.url), 'utf8'));
  } catch {
    t.skip('data/guideline-stages.json not built');
    return;
  }
  const rows = JSON.parse(await readFile(new URL('../data/guidelines.json', import.meta.url), 'utf8'));
  const urls = new Set(rows.map((r) => r.url));
  const seen = new Set();
  for (const s of file.stages) {
    assert.ok(urls.has(s.url), `unknown guideline ${s.url}`);
    assert.ok(!seen.has(s.url), `assessed twice: ${s.url}`);
    seen.add(s.url);
    assert.ok(STAGE_BY_ID[s.stage], s.url);
    assert.ok(s.secondary === null || (STAGE_BY_ID[s.secondary] && s.secondary !== s.stage), s.url);
    assert.ok(['high', 'medium', 'low'].includes(s.confidence), s.url);
    assert.equal(s.confidence === 'high', s.confidence_reason === null, s.url);
    assert.ok(s.reasoning.length > 20 && s.evidence.split(' ').length >= 6, s.url);
  }
  assert.equal(indexStages(file).size, file.stages.length);
  assert.equal(file.meta.assessed, file.stages.length);
});
