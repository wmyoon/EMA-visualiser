import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DATASETS } from '../js/datasets/index.js';
import { laneOf } from '../js/datasets/guidelines.js';
import { computeLayout, packCircles, yearExtent, yearTicks } from '../js/layouts.js';

const load = async (d) => d.normalise(JSON.parse(await readFile(new URL(`../data/${d.id}.json`, import.meta.url), 'utf8')));
const data = Object.fromEntries(await Promise.all(DATASETS.map(async (d) => [d.id, await load(d)])));
const guidelines = DATASETS.find((d) => d.id === 'guidelines');
const records = data.guidelines;
const spec = (id) => guidelines.layouts.find((l) => l.id === id);
const at = (layout, r) => layout.positions.subarray(r.i * 3, r.i * 3 + 3);

for (const dataset of DATASETS) {
  for (const layoutSpec of dataset.layouts) {
    for (const basis of ['pub', 'last']) {
      test(`${dataset.id} / ${layoutSpec.id} / ${basis}: every record gets its own finite position`, () => {
        const rows = data[dataset.id];
        const layout = computeLayout(layoutSpec, rows, basis);
        assert.equal(layout.positions.length, rows.length * 3);
        const seen = new Set();
        for (const r of rows) {
          const p = at(layout, r);
          assert.ok(p.every(Number.isFinite), `record ${r.i}`);
          assert.ok(p[1] >= 0, 'nothing sits below the ground plane');
          const key = Array.from(p, (v) => v.toFixed(2)).join(',');
          assert.ok(!seen.has(key), `two records share ${key}`);
          seen.add(key);
        }
        assert.equal(layout.lines.length % 6, 0, 'guide lines are whole segments');
        assert.ok(layout.labels.length > 0 && layout.fit.w > 0 && layout.fit.h > 0);
        assert.ok(typeof layoutSpec.caption({ id: basis, ...dataset.bases[basis] }) === 'string');
      });
    }
  }
}

test('layouts are deterministic', () => {
  assert.deepEqual(computeLayout(spec('groups'), records, 'pub').positions, computeLayout(spec('groups'), records, 'pub').positions);
});

test('the spiral puts later years further out', () => {
  const { positions } = computeLayout(spec('spiral'), records, 'pub');
  const radius = (r) => Math.hypot(positions[r.i * 3], positions[r.i * 3 + 2]);
  const old = records.filter((r) => r.pubY < 1995);
  const recent = records.filter((r) => r.pubY >= 2025);
  assert.ok(Math.max(...old.map(radius)) < Math.min(...recent.map(radius)));
});

test('the skyline keeps each year in its own column and each audience in its own row', () => {
  const { positions } = computeLayout(spec('skyline'), records, 'pub');
  const a = records.find((r) => Math.floor(r.pubY) === 2005 && laneOf(r) === 'human');
  const b = records.find((r) => Math.floor(r.pubY) === 2015 && laneOf(r) === 'human');
  const c = records.find((r) => Math.floor(r.pubY) === 2015 && laneOf(r) === 'veterinary');
  assert.ok(positions[a.i * 3] < positions[b.i * 3]);
  assert.equal(positions[a.i * 3 + 2], positions[b.i * 3 + 2]);
  assert.notEqual(positions[b.i * 3 + 2], positions[c.i * 3 + 2]);
});

test('packed circles never overlap', () => {
  const circles = [9, 7, 7, 5, 4, 4, 3, 2, 2, 1].map((r, i) => ({ id: `c${i}`, r }));
  const spots = [...packCircles(circles, 2).values()];
  for (let i = 0; i < spots.length; i++)
    for (let j = i + 1; j < spots.length; j++)
      assert.ok(Math.hypot(spots[i].x - spots[j].x, spots[i].z - spots[j].z) >= spots[i].r + spots[j].r + 2 - 1e-6);
});

test('year ticks lead with the ends and never repeat', () => {
  const [y0, y1] = yearExtent(records);
  const ticks = yearTicks(y0, y1);
  assert.equal(ticks[0], y0);
  assert.equal(new Set(ticks).size, ticks.length);
  assert.ok(ticks.every((y) => y >= y0 && y <= y1));
});

test('filtering re-seats matches at the base without changing the set of positions', () => {
  const mask = Uint8Array.from(records, (r) => (r.group === 'ich' ? 1 : 0));
  const full = computeLayout(spec('skyline'), records, 'pub');
  const seated = computeLayout(spec('skyline'), records, 'pub', mask);
  const keys = (l) => new Set(records.map((r) => Array.from(at(l, r), (v) => v.toFixed(2)).join(',')));
  assert.deepEqual(keys(seated), keys(full));
  // In any one column, no unmatched guideline sits below a matched one.
  const columns = new Map();
  for (const r of records) {
    const key = `${Math.floor(r.pubY)}|${laneOf(r)}`;
    const c = columns.get(key) ?? columns.set(key, { hi: -Infinity, lo: Infinity }).get(key);
    const y = seated.positions[r.i * 3 + 1];
    if (mask[r.i]) c.hi = Math.max(c.hi, y);
    else c.lo = Math.min(c.lo, y);
  }
  for (const c of columns.values()) assert.ok(c.hi <= c.lo);
});
