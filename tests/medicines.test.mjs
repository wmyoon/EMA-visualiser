import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { filterMask, isEmaUrl, parseEmaDate } from '../js/data.js';
import medicines, { normalise, atcClass, primaryDate, CLASSES, BUCKETS } from '../js/datasets/medicines.js';

const rows = JSON.parse(await readFile(new URL('../data/medicines.json', import.meta.url), 'utf8'));
const meta = JSON.parse(await readFile(new URL('../data/medicines.meta.json', import.meta.url), 'utf8'));
const records = normalise(rows);
const none = () => Object.fromEntries(medicines.facets.map((f) => [f.id, new Set()]));
const all = { query: '', sel: none(), years: null, basis: 'pub' };
const count = (mask) => mask.reduce((n, v) => n + v, 0);

test('the bundled snapshot normalises completely', () => {
  assert.equal(records.length, meta.total_records);
  assert.equal(new Set(records.map((r) => r.id)).size, records.length, 'ids are unique');
  const classes = new Set(CLASSES.map((c) => c.id));
  const buckets = new Set(BUCKETS.map((b) => b.id));
  for (const r of records) {
    assert.ok(Number.isFinite(r.pub) && r.last >= r.pub, r.title);
    assert.ok(classes.has(r.cls) && buckets.has(r.bucket));
    assert.ok(isEmaUrl(r.url), r.url);
    for (const facet of medicines.facets) {
      assert.ok(r.f[facet.id].length > 0);
      for (const v of r.f[facet.id]) assert.ok(facet.options.some((o) => o.id === v), `${facet.id}: ${v}`);
    }
  }
});

test('no status in the snapshot falls back to "other"', () => {
  assert.equal(records.filter((r) => r.status.id === 'other').length, 0);
});

test('ATC class comes from the code, then the group text, then nothing', () => {
  assert.deepEqual(atcClass('N02CD', 'Analgesics'), { id: 'N', from: 'code' });
  assert.deepEqual(atcClass('QI04AA02', ''), { id: 'I', from: 'code' });
  assert.deepEqual(atcClass('QM01AC06', ''), { id: 'M', from: 'code' });
  assert.deepEqual(atcClass('A10AB04;A10AD04', ''), { id: 'A', from: 'code' });
  assert.deepEqual(atcClass('Not yet assigned', ''), { id: 'none', from: null });
  assert.deepEqual(atcClass('', 'Immunologicals for aves;Domestic fowl'), { id: 'I', from: 'group' });
  assert.deepEqual(atcClass('', 'Corticosteroids, dermatological preparations'), { id: 'D', from: 'group' });
  assert.deepEqual(atcClass('', ''), { id: 'none', from: null });
});

test('each outcome is placed by the date that defines it', () => {
  const row = {
    marketing_authorisation_date: '24/01/2022', refusal_of_marketing_authorisation_date: '01/02/2020',
    withdrawal_of_application_date: '03/03/2019', opinion_adopted_date: '11/11/2021', first_published_date: '05/05/2018',
  };
  assert.equal(primaryDate(row, 'authorised').field, 'marketing_authorisation_date');
  assert.equal(primaryDate(row, 'declined').field, 'refusal_of_marketing_authorisation_date');
  assert.equal(primaryDate(row, 'pending').field, 'opinion_adopted_date');
  assert.equal(primaryDate({ first_published_date: '05/05/2018' }, 'authorised').field, 'first_published_date');
  assert.equal(primaryDate({}, 'authorised'), null);
  const authorised = records.filter((r) => r.statusLabel === 'Authorised' && r.raw.marketing_authorisation_date);
  for (const r of authorised) assert.equal(r.pub, parseEmaDate(r.raw.marketing_authorisation_date));
});

test('filters: status, class and type', () => {
  const refused = filterMask(records, { ...all, sel: { ...none(), status: new Set(['refused']) } });
  assert.equal(count(refused), rows.filter((r) => r.medicine_status === 'Refused').length);
  const generics = filterMask(records, { ...all, sel: { ...none(), type: new Set(['generic']) } });
  assert.equal(count(generics), rows.filter((r) => r.generic === 'Yes').length);
  const plain = filterMask(records, { ...all, sel: { ...none(), type: new Set(['none']) } });
  for (const r of records) if (plain[r.i]) assert.equal(r.flags.length, 0);
  const vetVaccines = filterMask(records, { ...all, sel: { ...none(), audience: new Set(['veterinary']), class: new Set(['I']) } });
  assert.ok(count(vetVaccines) > 50);
});

test('search reaches substance, ATC code, company and product number', () => {
  const hit = (query) => count(filterMask(records, { ...all, query }));
  assert.ok(hit('adalimumab') >= 10);
  assert.ok(hit('L04AB04') >= 10);
  assert.ok(hit('novartis') >= 50);
  assert.equal(hit('EMEA/H/C/005287'), 1);
});

test('related medicines share the active substance', () => {
  const target = records.find((r) => r.inn.toLowerCase() === 'adalimumab');
  const { items } = medicines.related(records, target);
  assert.ok(items.length > 0 && items.length <= 8);
  assert.ok(items.every((o) => o.i !== target.i && o.inn.toLowerCase() === 'adalimumab'));
});

test('the detail card lists every dated milestone in order', () => {
  const r = records.find((x) => x.raw.ema_product_number === 'EMEA/H/C/005287');
  const d = medicines.detail(r, { snapshotMs: Date.parse(meta.timestamp) });
  assert.equal(d.title, 'Vyepti');
  assert.equal(d.subtitle, 'eptinezumab');
  assert.deepEqual(d.stamps.map((s) => s.key), ['Opinion adopted', 'EMA page published', 'Authorised', 'Latest EC decision', 'EMA page updated']);
  assert.equal(d.notice, null);
  assert.ok(d.life.to > d.life.from);
});
