/**
 * The results list: a virtualised listbox. Only the rows in view exist in the
 * DOM, so scrolling a thousand guidelines stays cheap. It is also the
 * accessible equivalent of the 3D map: everything on the stage is reachable
 * here by keyboard and screen reader.
 */
import { touched } from '../store.js';
import { $, h, tokenDot, highlight } from './dom.js';

const ROW = 70;
const OVERSCAN = 5;

export function mountList({ dataset, actions }) {
  const list = $('list');
  const pad = $('list-pad');
  const empty = $('list-empty');
  /** @type {Map<number, HTMLElement>} */
  const live = new Map();
  let results = [];
  let tokens = [];
  let active = -1; // keyboard position in `results`
  let hot = null; // guideline index highlighted from the stage
  let selected = null;

  function build(r, at) {
    const d = dataset.row(r);
    const row = h(
      'div',
      { class: 'row', role: 'option', id: `row-${r.id}`, 'aria-selected': 'false', dataset: { i: r.i } },
      tokenDot(d.tokens, 'row__dot'),
      h('div', { class: 'row__title' }, highlight(r.title, tokens)),
      h(
        'div',
        { class: 'row__meta' },
        d.code ? h('span', { class: 'code', text: d.code }) : null,
        ...d.meta.filter(Boolean).map((text) => h('span', { text })),
      ),
    );
    row.style.top = `${at * ROW}px`;
    row.setAttribute('aria-posinset', at + 1);
    row.setAttribute('aria-setsize', results.length);
    return row;
  }

  function paint(row, r, at) {
    row.setAttribute('aria-selected', String(r.i === selected));
    row.dataset.active = String(at === active);
    row.dataset.hot = String(r.i === hot);
  }

  function render() {
    const first = Math.max(0, Math.floor(list.scrollTop / ROW) - OVERSCAN);
    const last = Math.min(results.length - 1, Math.ceil((list.scrollTop + list.clientHeight) / ROW) + OVERSCAN);
    for (const [at, row] of live) {
      if (at < first || at > last) {
        row.remove();
        live.delete(at);
      }
    }
    for (let at = first; at <= last; at++) {
      let row = live.get(at);
      if (!row) {
        row = build(results[at], at);
        live.set(at, row);
        pad.append(row);
      }
      paint(row, results[at], at);
    }
    const current = results[active];
    if (current) list.setAttribute('aria-activedescendant', `row-${current.id}`);
    else list.removeAttribute('aria-activedescendant');
  }

  function reveal(at, { center = false } = {}) {
    const top = at * ROW;
    const view = list.clientHeight;
    if (center && (top < list.scrollTop || top + ROW > list.scrollTop + view)) list.scrollTop = top - view / 2 + ROW / 2;
    else if (top < list.scrollTop) list.scrollTop = top;
    else if (top + ROW > list.scrollTop + view) list.scrollTop = top + ROW - view;
  }

  function setActive(at, { select = false } = {}) {
    if (!results.length) return;
    active = Math.min(results.length - 1, Math.max(0, at));
    reveal(active);
    render();
    actions.hover(results[active].i);
    if (select) actions.select(results[active].i, { from: 'list' });
  }

  list.setAttribute('aria-label', `${dataset.label} matching the current filters`);
  list.addEventListener('scroll', render, { passive: true });
  new ResizeObserver(render).observe(list);

  const rowFrom = (e) => e.target.closest?.('.row');
  list.addEventListener('click', (e) => {
    const row = rowFrom(e);
    if (!row) return;
    active = results.findIndex((r) => r.i === +row.dataset.i);
    actions.select(+row.dataset.i, { from: 'list' });
  });
  list.addEventListener('pointerover', (e) => {
    const row = rowFrom(e);
    if (row && e.pointerType === 'mouse') actions.hover(+row.dataset.i);
  });
  list.addEventListener('pointerleave', () => actions.hover(null));
  list.addEventListener('blur', () => actions.hover(null));

  list.addEventListener('keydown', (e) => {
    const page = Math.max(1, Math.floor(list.clientHeight / ROW) - 1);
    const moves = { ArrowDown: 1, ArrowUp: -1, PageDown: page, PageUp: -page };
    if (e.key in moves) setActive((active < 0 ? (moves[e.key] > 0 ? -1 : 0) : active) + moves[e.key]);
    else if (e.key === 'Home') setActive(0);
    else if (e.key === 'End') setActive(results.length - 1);
    else if (e.key === 'Enter' || e.key === ' ') setActive(Math.max(0, active), { select: true });
    else return;
    e.preventDefault();
  });

  return function update(state, view, changed) {
    const listChanged = !changed || touched(changed, 'query', 'sel', 'years', 'sort', 'basis');
    if (listChanged) {
      results = view.results;
      tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
      for (const row of live.values()) row.remove();
      live.clear();
      pad.style.height = `${results.length * ROW}px`;
      active = -1;
      list.scrollTop = 0;
      empty.hidden = results.length > 0;
      list.hidden = results.length === 0;
    }
    const selectionChanged = selected !== state.selected;
    selected = state.selected;
    hot = state.hovered;
    if (selected != null && (selectionChanged || listChanged)) {
      const at = results.findIndex((r) => r.i === selected);
      if (at >= 0) {
        active = at;
        reveal(at, { center: true });
      }
    }
    render();
  };
}
