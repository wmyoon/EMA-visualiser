/**
 * A very small observable store. State is replaced, never mutated in place,
 * and subscribers are told which keys changed so they can skip work.
 */

/**
 * @template T
 * @param {T} initial
 */
export function createStore(initial) {
  let state = { ...initial };
  /** @type {Set<(state:T, changed:Set<string>) => void>} */
  const listeners = new Set();
  let queued = null;

  function flush() {
    const changed = queued;
    queued = null;
    for (const fn of listeners) fn(state, changed);
  }

  return {
    get: () => state,
    /** Merge a patch. Subscribers run once per microtask, however many patches arrive. */
    set(patch) {
      const changed = Object.keys(patch).filter((k) => !Object.is(state[k], patch[k]));
      if (!changed.length) return;
      state = { ...state, ...patch };
      if (!queued) {
        queued = new Set();
        queueMicrotask(flush);
      }
      for (const k of changed) queued.add(k);
    },
    /** @param {(state:T, changed:Set<string>) => void} fn */
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

/** True when any of `keys` is in the changed set. */
export const touched = (changed, ...keys) => keys.some((k) => changed.has(k));
