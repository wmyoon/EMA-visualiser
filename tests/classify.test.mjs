import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, extractCode, GROUPS } from '../js/classify.js';

test('harmonised texts are recognised before any topic rule', () => {
  assert.equal(classify('ICH Q3D Elemental impurities', ['human']), 'ich');
  assert.equal(classify('VICH GL49 Studies to evaluate the metabolism and residue kinetics', ['veterinary']), 'vich');
});

test('VICH is never mistaken for ICH', () => {
  assert.equal(classify('VICH GL3 Stability testing of new veterinary drug substances', ['veterinary']), 'vich');
});

test('topic rules', () => {
  assert.equal(classify('Tofacitinib product-specific bioequivalence guidance', ['human']), 'psbe');
  assert.equal(classify('Clinical investigation of medicinal products for the treatment of asthma', ['human']), 'clinical');
  assert.equal(classify('Non-clinical investigation of the dependence potential of medicinal products', ['human']), 'nonclinical');
  assert.equal(classify('Use of herbal medicinal products containing asarone', ['human', 'herbal']), 'herbal');
  assert.equal(classify('Polysorbates', ['human']), 'quality');
});

test('unmatched titles fall through to "other", and every result is a known group', () => {
  const ids = new Set(GROUPS.map((g) => g.id));
  assert.equal(classify('Interpretation of Article 18(7) of Regulation (EU) 2019/6', ['veterinary']), 'other');
  for (const title of ['', 'x', 'ICH', 'Something entirely new']) assert.ok(ids.has(classify(title, ['human'])));
});

test('reference codes', () => {
  assert.equal(extractCode('ICH Q3C (R9) Residual solvents'), 'Q3C(R9)');
  assert.equal(extractCode('ICH guideline M13B on bioequivalence'), 'M13B');
  assert.equal(extractCode('ICH E14/S7B (R1) Q&As'), 'E14');
  assert.equal(extractCode('VICH GL49 Studies to evaluate'), 'GL49');
  assert.equal(extractCode('Investigation of bioequivalence'), null);
  assert.equal(extractCode('Quality of water for pharmaceutical use (Q6 2020)'), null);
});
