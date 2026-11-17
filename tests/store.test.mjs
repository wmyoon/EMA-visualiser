import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, touched } from '../js/store.js';

test('subscribers run once per tick with the keys that changed', async () => {
  const store = createStore({ a: 1, b: 1, c: 1 });
  const calls = [];
  store.subscribe((state, changed) => calls.push([state, [...changed].sort()]));
  store.set({ a: 2 });
  store.set({ b: 2, c: 1 });
  store.set({ a: 2 }); // no change
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][1], ['a', 'b']);
  assert.deepEqual(calls[0][0], { a: 2, b: 2, c: 1 });
  assert.ok(touched(new Set(['a']), 'a', 'z') && !touched(new Set(['a']), 'z'));
});
