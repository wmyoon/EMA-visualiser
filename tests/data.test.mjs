import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseEmaDate, decimalYear, formatDate, formatSpan, idFromUrl, isEmaUrl, filterMask, similarTitles, decodeEntities, SORTS } from '../js/data.js';
import guidelines, { normalise } from '../js/datasets/guidelines.js';

const rows = JSON.parse(await readFile(new URL('../data/guidelines.json', import.meta.url), 'utf8'));
const meta = JSON.parse(await readFile(new URL('../data/guidelines.meta.json', import.meta.url), 'utf8'));
const records = normalise(rows);
const none = () => Object.fromEntries(guidelines.facets.map((f) => [f.id, new Set()]));
const all = { query: '', sel: none(), years: null, basis: 'pub' };
const pick = (facet, ...ids) => ({ ...none(), [facet]: new Set(ids) });
const count = (mask) => mask.reduce((n, v) => n + v, 0);

test('dates', () => {
  assert.equal(parseEmaDate('27/02/2015'), Date.UTC(2015, 1, 27));
  assert.equal(parseEmaDate(''), null);
  assert.equal(parseEmaDate('2015-02-27'), null);
  assert.equal(formatDate(Date.UTC(2015, 1, 27)), '27 Feb 2015');
  assert.equal(decimalYear(Date.UTC(2015, 0, 1)), 2015);
  assert.ok(Math.abs(decimalYear(Date.UTC(2015, 6, 2, 12)) - 2015.5) < 0.001);
  assert.equal(formatSpan(Date.UTC(2020, 0, 1), Date.UTC(2020, 0, 4)), '3 days');
  assert.equal(formatSpan(Date.UTC(2015, 0, 1), Date.UTC(2026, 8, 1)), '12 years');
});

test('the bundled snapshot normalises completely', () => {
  assert.equal(records.length, meta.total_records);
  assert.equal(new Set(records.map((r) => r.id)).size, records.length, 'ids are unique');
  for (const r of records) {
    assert.ok(r.cats.length >= 1 && r.cats.length <= 3);
    assert.ok(Number.isFinite(r.pub) && r.last >= r.pub);
    assert.equal(r.revised, r.last > r.pub);
    assert.match(r.id, /^[a-z0-9]+$/);
    assert.ok(isEmaUrl(r.url), r.url);
  }
});

test('records without a usable date, title or link are dropped, not guessed', () => {
  const out = normalise([
    { title: 'A', category: 'Human', first_published_date: '', last_updated_date: '', url: 'https://www.ema.europa.eu/a' },
    { title: 'B', category: 'Human;Veterinary', first_published_date: '01/01/2020', url: 'https://www.ema.europa.eu/b' },
  ]);
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].cats, ['human', 'veterinary']);
  assert.equal(out[0].upd, null);
  assert.equal(out[0].revised, false);
});

test('only EMA links are trusted', () => {
  assert.ok(isEmaUrl('https://www.ema.europa.eu/en/x'));
  assert.ok(!isEmaUrl('http://www.ema.europa.eu/en/x'));
  assert.ok(!isEmaUrl('https://ema.europa.eu.example.com/x'));
  assert.ok(!isEmaUrl('javascript:alert(1)'));
});

test('ids are stable for a URL', () => {
  assert.equal(idFromUrl('https://www.ema.europa.eu/a'), idFromUrl('https://www.ema.europa.eu/a'));
  assert.notEqual(idFromUrl('https://www.ema.europa.eu/a'), idFromUrl('https://www.ema.europa.eu/b'));
});

test('filters combine with AND across facets and OR within one', () => {
  assert.equal(count(filterMask(records, all)), records.length);
  const vet = count(filterMask(records, { ...all, sel: pick('audience', 'veterinary') }));
  const herbal = count(filterMask(records, { ...all, sel: pick('audience', 'herbal') }));
  const either = count(filterMask(records, { ...all, sel: pick('audience', 'veterinary', 'herbal') }));
  assert.ok(either >= Math.max(vet, herbal) && either <= vet + herbal);
  const vetIch = filterMask(records, { ...all, sel: { ...pick('audience', 'veterinary'), group: new Set(['vich']) } });
  for (const r of records) if (vetIch[r.i]) assert.ok(r.cats.includes('veterinary') && r.group === 'vich');
  const q = filterMask(records, { ...all, query: 'Q3D elemental' });
  assert.ok(count(q) >= 1);
  for (const r of records) if (q[r.i]) assert.ok(/q3d/i.test(r.hay) && /elemental/i.test(r.hay));
});

test('the year filter follows the chosen date basis', () => {
  const byPub = filterMask(records, { ...all, years: [2026, 2026], basis: 'pub' });
  const byLast = filterMask(records, { ...all, years: [2026, 2026], basis: 'last' });
  assert.ok(count(byLast) > count(byPub));
  for (const r of records) if (byPub[r.i]) assert.equal(new Date(r.pub).getUTCFullYear(), 2026);
  assert.equal(count(filterMask(records, { ...all, years: [2026, 2026], basis: 'pub' }, 'years')), records.length);
});

test('sorts are total orders over the snapshot', () => {
  for (const { fn } of Object.values(SORTS)) {
    const sorted = records.slice().sort(fn);
    for (let i = 1; i < sorted.length; i++) assert.ok(fn(sorted[i - 1], sorted[i]) <= 0);
  }
});

test('related titles exclude the guideline itself and stay on topic', () => {
  const target = records.find((r) => /product-specific bioequivalence/i.test(r.title));
  const sims = similarTitles(records, target);
  assert.ok(sims.length > 0 && sims.length <= 5);
  assert.ok(sims.every((s) => s.i !== target.i));
  assert.ok(sims.every((s) => /bioequivalence/i.test(s.title)));
});

test('faceted counts ignore only the facet being counted', () => {
  const sel = { ...pick('audience', 'veterinary'), group: new Set(['vich']) };
  const withoutGroup = filterMask(records, { ...all, sel }, 'group');
  assert.equal(count(withoutGroup), count(filterMask(records, { ...all, sel: pick('audience', 'veterinary') })));
});

test('literal entities in EMA text become characters, and nothing else changes', () => {
  assert.equal(decodeEntities('Keytruda&nbsp;as monotherapy, weight &lt;40 kg &amp; &gt;12 years'), 'Keytruda as monotherapy, weight <40 kg & >12 years');
  assert.equal(decodeEntities('plain <b>text</b> &unknown;'), 'plain <b>text</b> &unknown;');
});
