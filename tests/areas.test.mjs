import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { classifyArea, AREAS, AREA_BY_ID } from '../js/areas.js';
import { filterMask } from '../js/data.js';
import guidelines, { normalise } from '../js/datasets/guidelines.js';

const area = (t) => classifyArea(t);

test('conditions map to their disease area', () => {
  assert.equal(area('Clinical investigation of medicinal products for the treatment of asthma'), 'resp');
  assert.equal(area('Evaluation of anticancer medicinal products'), 'oncology');
  assert.equal(area('Clinical investigation of medicinal products in the treatment of hypertension'), 'cardio');
  assert.equal(area('Clinical investigation of medicinal products for the treatment of pulmonary arterial hypertension'), 'cardio');
  assert.equal(area('Clinical investigation of medicinal products in the treatment of depression'), 'psych');
  assert.equal(area("Clinical investigation of medicinal products in the treatment of Parkinson's disease"), 'neuro');
  assert.equal(area('Clinical development of medicinal products for treatment of HIV infection'), 'infection');
  assert.equal(area('VICH GL7 Efficacy of anthelmintics: general requirements'), 'infection');
  assert.equal(area('Clinical investigation of recombinant and human plasma-derived factor IX products'), 'haem');
  assert.equal(area('Clinical investigation of medicinal products for the treatment of systemic lupus erythematosus and lupus nephritis'), 'immuno');
});

test('look-alike words do not trigger an area', () => {
  assert.equal(area('Data requirements for intravenous liposomal products developed with reference to an innovator liposomal product'), 'general'); // "venous"
  assert.equal(area('Use of herbal medicinal products containing estragole'), 'general'); // "estr…"
  assert.equal(area('VICH GL52 Bioequivalence: blood level bioequivalence study'), 'general');
  assert.equal(area('Allogenic mesenchymal stem cell-based products for veterinary use: specific questions on tumorigenicity'), 'general');
  assert.equal(area('Inclusion of antioxidants and antimicrobial preservatives in medicinal products'), 'general');
  assert.equal(area('Reflection papers on regulatory requirements for the development of medicinal products for chronic non-infectious liver diseases'), 'gastro');
});

test('titles that name no disease stay unassigned', () => {
  assert.equal(area('ICH Q3D Elemental impurities'), 'general');
  assert.equal(area('Stability testing of existing active substances and related finished products'), 'general');
  assert.equal(area('Missing data in confirmatory clinical trials'), 'general');
});

test('bioequivalence guidances are mapped by substance, and unknown substances are left alone', () => {
  assert.equal(area('Imatinib product-specific bioequivalence guidance'), 'oncology');
  assert.equal(area('Ledipasvir/sofosbuvir product-specific bioequivalence guidance'), 'infection');
  assert.equal(area('Metformin  product-specific bioequivalence guidance'), 'endo');
  assert.equal(area('Madeupamab product-specific bioequivalence guidance'), 'general');
});

test('every guideline in the snapshot gets a known area, and the filter uses it', async () => {
  const rows = JSON.parse(await readFile(new URL('../data/guidelines.json', import.meta.url), 'utf8'));
  const records = normalise(rows);
  for (const r of records) assert.ok(r.area in AREA_BY_ID, r.title);
  assert.equal(AREAS[AREAS.length - 1].id, 'general');
  const none = Object.fromEntries(guidelines.facets.map((f) => [f.id, new Set()]));
  const all = { query: '', sel: none, years: null, basis: 'pub' };
  const mask = filterMask(records, { ...all, sel: { ...none, area: new Set(['oncology', 'cardio']) } });
  const hits = records.filter((r) => mask[r.i]);
  assert.ok(hits.length > 50 && hits.every((r) => r.area === 'oncology' || r.area === 'cardio'));
  // Searching for an area's name finds its guidelines even when the title never says it.
  const byName = filterMask(records, { ...all, query: 'oncology' });
  assert.ok(records.some((r) => byName[r.i] && !/oncolog/i.test(r.title)));
});
