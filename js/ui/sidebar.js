/**
 * Brand, dataset switch, search box, facet chips, the year histogram with its
 * two-thumb range, and the results header. Facets come from the dataset.
 * Counts on every chip are faceted: they show what you would get by adding
 * that chip to the other filters already applied.
 */
import { sortsFor } from '../data.js';
import { touched } from '../store.js';
import { $, h, nf } from './dom.js';

const toggle = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export function mountSidebar({ store, dataset, datasets, records, meta, extent, actions }) {
  const [y0, y1] = extent;

  /* brand and dataset switch */
  $('brand-total').textContent = nf.format(records.length);
  $('brand-title').textContent = dataset.title;
  const stamp = meta.timestamp ? new Date(meta.timestamp) : null;
  $('brand-snapshot').textContent = stamp
    ? stamp.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
    : 'date unknown';
  if (stamp) $('brand-snapshot').dateTime = meta.timestamp;
  $('dataset-switch').append(
    ...datasets.map((d) =>
      h('button', {
        class: 'switch__btn', type: 'button', role: 'tab', id: `dataset-${d.id}`,
        'aria-selected': String(d.id === dataset.id), tabindex: d.id === dataset.id ? '0' : '-1',
        text: d.label, onClick: () => d.id !== dataset.id && actions.openDataset(d.id),
      }),
    ),
  );

  /* search */
  const q = $('q');
  q.placeholder = dataset.searchPlaceholder;
  q.setAttribute('aria-label', `Search ${dataset.noun[1]}`);
  q.addEventListener('input', () => store.set({ query: q.value }));
  q.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && q.value) {
      q.value = '';
      store.set({ query: '' });
      e.stopPropagation();
    } else if (e.key === 'ArrowDown') {
      $('list').focus();
      e.preventDefault();
    }
  });

  /* facets */
  const present = Object.fromEntries(dataset.facets.map((f) => [f.id, new Set()]));
  for (const r of records) for (const f of dataset.facets) for (const v of r.f[f.id]) present[f.id].add(v);

  /** @type {{facet:string, id:string, node:HTMLElement, count:HTMLElement}[]} */
  const chips = [];
  const chipsFor = (facet) => {
    const box = h('div', { class: 'chips', id: `facet-${facet.id}` });
    for (const o of facet.options) {
      if (!present[facet.id].has(o.id)) continue; // nothing in this snapshot wears it
      const count = h('span', { class: 'chip__n' });
      const node = h(
        'button',
        {
          class: 'chip', type: 'button', id: `chip-${facet.id}-${o.id}`, 'aria-pressed': 'false',
          title: o.label !== (o.short ?? o.label) || o.about ? [o.label, o.about].filter(Boolean).join('. ') : null,
          onClick: () => {
            const sel = store.get().sel;
            store.set({ sel: { ...sel, [facet.id]: toggle(sel[facet.id], o.id) } });
          },
        },
        o.token ? h('span', { class: 'dot', style: { '--c': `var(${o.token})` }, 'aria-hidden': 'true' }) : null,
        h('span', { text: o.short ?? o.label }),
        count,
      );
      chips.push({ facet: facet.id, id: o.id, node, count });
      box.append(node);
    }
    return box;
  };

  const host = $('facets');
  for (const facet of dataset.facets.filter((f) => !f.tab)) {
    const title = h('h2', { class: 'facet__title', id: `facet-${facet.id}-title`, text: facet.label });
    const box = chipsFor(facet);
    box.setAttribute('role', 'group');
    box.setAttribute('aria-labelledby', title.id);
    host.append(h('section', { class: 'facet' }, title, box));
  }

  // Facets marked `tab` share one block of the panel, one visible at a time.
  const tabbed = dataset.facets.filter((f) => f.tab);
  const tabs = tabbed.map((facet) => {
    const badge = h('span', { class: 'tab__n', hidden: true });
    const tab = h('button', { class: 'tab', type: 'button', role: 'tab', id: `tab-${facet.id}`, 'aria-controls': `facet-${facet.id}` }, facet.label, ' ', badge);
    const panel = chipsFor(facet);
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tab.id);
    return { facet, tab, panel, badge };
  });
  const note = h('span', { class: 'facet__note' });
  const showTab = (id) => {
    for (const t of tabs) {
      const on = t.facet.id === id;
      t.tab.setAttribute('aria-selected', String(on));
      t.tab.tabIndex = on ? 0 : -1;
      t.panel.hidden = !on;
      if (on) note.textContent = t.facet.note ?? '';
    }
  };
  if (tabs.length) {
    tabs.forEach((t, at) => {
      t.tab.addEventListener('click', () => showTab(t.facet.id));
      t.tab.addEventListener('keydown', (e) => {
        const dir = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
        if (!dir) return;
        const other = tabs[(at + dir + tabs.length) % tabs.length];
        showTab(other.facet.id);
        other.tab.focus();
        e.preventDefault();
      });
    });
    host.append(
      h(
        'section',
        { class: 'facet', 'aria-label': tabbed.map((f) => f.label).join(' and ') },
        h('div', { class: 'facet__title' }, h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Group by' }, ...tabs.map((t) => t.tab)), note),
        ...tabs.map((t) => t.panel),
      ),
    );
    showTab(tabs[0].facet.id);
  }

  /* years */
  const bars = [];
  for (let y = y0; y <= y1; y++) {
    const bar = h('div', { class: 'years__bar' });
    bars.push(bar);
    $('years-bars').append(bar);
  }
  const from = $('years-from');
  const to = $('years-to');
  for (const input of [from, to]) {
    input.min = y0;
    input.max = y1;
  }
  from.value = y0;
  to.value = y1;
  const onRange = (moved) => {
    let a = +from.value;
    let b = +to.value;
    if (a > b) moved === from ? (b = a) : (a = b);
    from.value = a;
    to.value = b;
    store.set({ years: a === y0 && b === y1 ? null : [a, b] });
  };
  from.addEventListener('input', () => onRange(from));
  to.addEventListener('input', () => onRange(to));

  /* sort and clear */
  const sort = $('sort');
  for (const [id, s] of Object.entries(sortsFor(dataset))) sort.append(h('option', { value: id, text: s.label }));
  sort.addEventListener('change', () => store.set({ sort: sort.value }));
  const clear = () => {
    q.value = '';
    store.set({ query: '', sel: Object.fromEntries(dataset.facets.map((f) => [f.id, new Set()])), years: null });
  };
  $('clear-filters').addEventListener('click', clear);
  $('empty-clear').addEventListener('click', clear);

  return function update(state, view, changed) {
    // The chips on show follow the arrangement: disease chips beside the disease map.
    if (!changed || changed.has('layout')) {
      const facet = dataset.layouts.find((l) => l.id === state.layout)?.facet;
      if (facet && tabs.some((t) => t.facet.id === facet)) showTab(facet);
      else if (!changed) {
        const used = tabs.find((t) => state.sel[t.facet.id].size);
        if (used) showTab(used.facet.id);
      }
    }
    if (changed && !touched(changed, 'query', 'sel', 'years', 'basis', 'sort')) return;
    if (q.value !== state.query) q.value = state.query;
    sort.value = state.sort;

    for (const c of chips) {
      const n = view.counts.facets[c.facet][c.id] ?? 0;
      c.count.textContent = nf.format(n);
      c.node.setAttribute('aria-pressed', String(state.sel[c.facet].has(c.id)));
      c.node.dataset.empty = String(n === 0);
    }
    for (const t of tabs) {
      const n = state.sel[t.facet.id].size;
      t.badge.hidden = n === 0;
      t.badge.textContent = String(n);
    }

    const [a, b] = state.years ?? [y0, y1];
    from.value = a;
    to.value = b;
    const peak = Math.max(1, ...view.counts.years);
    bars.forEach((bar, i) => {
      const n = view.counts.years[i];
      bar.style.height = `${n ? Math.max(6, (n / peak) * 100) : 0}%`;
      bar.dataset.in = String(y0 + i >= a && y0 + i <= b);
      bar.title = `${y0 + i}: ${n}`;
    });
    $('years-basis').textContent = dataset.bases[state.basis].label;
    $('years-value').textContent = a === b ? String(a) : `${a}–${b}`;

    const active = Object.values(state.sel).reduce((n, set) => n + set.size, 0) + (state.years ? 1 : 0);
    const badge = $('filter-badge');
    badge.hidden = active === 0;
    badge.textContent = String(active);
    $('clear-filters').hidden = active === 0 && !state.query;

    const total = records.length;
    const shown = view.results.length;
    const count = $('result-count');
    count.textContent = '';
    count.append(
      shown === total ? `${nf.format(total)} ${dataset.noun[1]}` : `${nf.format(shown)} `,
      shown === total ? '' : h('span', { text: `of ${nf.format(total)} ${dataset.noun[1]}` }),
    );
  };
}
