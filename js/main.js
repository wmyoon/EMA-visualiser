/**
 * Entry point. The page shows one dataset at a time; `open()` builds a fresh
 * instance of the app for it (state, list, detail card, 3D stage) inside a
 * pristine copy of the page shell, and tears the previous one down.
 *
 * The stage is loaded with a dynamic import so that the list and filters keep
 * working when WebGL or the 3D library is unavailable.
 */
import { loadDataset, filterMask, sortsFor } from './data.js';
import { DATASETS, DATASET_BY_ID, DATASET_BY_PREFIX } from './datasets/index.js';
import { computeLayout, yearExtent, BASIS_FIELDS } from './layouts.js';
import { colorScale, readTheme } from './encodings.js';
import { createStore, touched } from './store.js';
import { $ } from './ui/dom.js';
import { mountSidebar } from './ui/sidebar.js';
import { mountList } from './ui/list.js';
import { mountDetail } from './ui/detail.js';
import { mountStagebar } from './ui/stagebar.js';

const PREFS_KEY = 'regulatory-atlas:v2';
const FILTER_KEYS = ['query', 'sel', 'years', 'basis', 'sort'];

/* ---------- per-viewer conveniences; the page works the same without storage ---------- */

function readPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return { dataset: p.dataset, views: p.views && typeof p.views === 'object' ? p.views : {} };
  } catch {
    return { views: {} };
  }
}
function savePrefs(dataset, { layout, basis, colorBy, sort }) {
  try {
    const p = readPrefs();
    p.dataset = dataset.id;
    p.views[dataset.id] = { layout, basis, colorBy, sort };
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* storage may be unavailable */
  }
}

/** `#g-<id>` or `#m-<id>` selects a record; `#medicines` opens a dataset. */
function parseHash() {
  const record = /^#([a-z])-([a-z0-9]+)$/.exec(location.hash);
  if (record && DATASET_BY_PREFIX[record[1]]) return { dataset: DATASET_BY_PREFIX[record[1]].id, record: record[2] };
  const name = location.hash.slice(1);
  return name in DATASET_BY_ID ? { dataset: name, record: null } : null;
}
function writeHash(hash) {
  if (location.hash === hash || (!hash && !location.hash)) return;
  try {
    history.replaceState(null, '', hash || location.pathname + location.search);
  } catch {
    location.hash = hash;
  }
}

/* ---------- derived data ---------- */

/** Everything derived from the filters, computed once per change. */
function deriveView(dataset, records, state, extent) {
  const filter = { query: state.query, sel: state.sel, years: state.years, basis: state.basis };
  const mask = filterMask(records, filter);
  const results = records.filter((r) => mask[r.i]).sort(sortsFor(dataset)[state.sort].fn);

  const counts = { facets: {}, years: new Array(extent[1] - extent[0] + 1).fill(0) };
  for (const facet of dataset.facets) {
    const others = filterMask(records, filter, facet.id);
    const tally = (counts.facets[facet.id] = {});
    for (const r of records) if (others[r.i]) for (const v of r.f[facet.id]) tally[v] = (tally[v] ?? 0) + 1;
  }
  const forYears = filterMask(records, filter, 'years');
  const yearKey = BASIS_FIELDS[state.basis].key;
  for (const r of records) if (forYears[r.i]) counts.years[Math.floor(r[yearKey]) - extent[0]]++;
  return { mask, results, counts };
}

/** Dots set off in date order, so a rearrangement sweeps through time. */
function morphOrder(records, basis) {
  const key = BASIS_FIELDS[basis].ms;
  const ranked = records.map((r) => r.i).sort((a, b) => records[a][key] - records[b][key]);
  const order = new Float32Array(records.length);
  ranked.forEach((i, rank) => (order[i] = rank / Math.max(1, records.length - 1)));
  return order;
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/* ---------- one mounted dataset ---------- */

/**
 * @param {typeof DATASETS[number]} dataset
 * @param {{records:any[], meta:any}} loaded
 * @param {object} saved  state to restore: a hot-reload snapshot, or `{selected: id}` from a link
 * @returns {Promise<{destroy:()=>void, snapshot:()=>object, select:(id:string|null)=>void}>}
 */
async function mount(dataset, { records, meta }, saved) {
  const abort = new AbortController();
  const { signal } = abort;
  const cleanups = [];
  const byId = new Map(records.map((r) => [r.id, r]));
  const extent = yearExtent(records);
  const snapshotMs = meta.timestamp ? Date.parse(meta.timestamp) : Math.max(...records.map((r) => r.last));
  const layoutOf = (id) => dataset.layouts.find((l) => l.id === id);

  const prefs = readPrefs().views[dataset.id] ?? {};
  const want = (key) => saved[key] ?? prefs[key];
  const store = createStore({
    layout: pick(want('layout'), dataset.layouts.map((l) => l.id), dataset.layouts[0].id),
    basis: pick(want('basis'), Object.keys(dataset.bases), 'pub'),
    colorBy: pick(want('colorBy'), dataset.colors.map((c) => c.id), dataset.colors[0].id),
    sort: pick(want('sort'), Object.keys(sortsFor(dataset)), 'last-desc'),
    query: typeof saved.query === 'string' ? saved.query : '',
    sel: Object.fromEntries(
      dataset.facets.map((f) => [f.id, new Set((saved.sel?.[f.id] ?? []).filter((v) => f.options.some((o) => o.id === v)))]),
    ),
    years: Array.isArray(saved.years) ? saved.years : null,
    selected: byId.get(saved.selected)?.i ?? null,
    folded: saved.folded === true && byId.has(saved.selected), // the card is minimised to a bar; the record stays selected and its arcs stay drawn
    hovered: null,
  });

  /** @type {ReturnType<import('./scene.js').createScene>|null} */
  let stage = null;
  let selectFrom = 'load';
  let reseat = 0;

  const actions = {
    hover: (i) => store.set({ hovered: i }),
    select(i, { from = 'stage' } = {}) {
      selectFrom = from;
      // Closing the card ends the minimised state too: the next record opens in full.
      store.set(i == null ? { selected: null, folded: false } : { selected: i });
    },
    fold: (on) => store.set({ folded: on && store.get().selected != null }),
    zoom: (f) => stage?.zoom(f),
    resetView: () => stage?.resetView(),
    openDataset: (id) => open(id),
  };

  const ctx = { store, dataset, datasets: DATASETS, records, meta, extent, snapshotMs, actions, signal };
  const sidebar = mountSidebar(ctx);
  const list = mountList(ctx);
  const detail = mountDetail(ctx);
  const stagebar = mountStagebar(ctx);

  let view = deriveView(dataset, records, store.get(), extent);
  const paint = (state, changed) => {
    sidebar(state, view, changed);
    list(state, view, changed);
    detail.update(state, view, changed);
    stagebar.update(state, view, changed);
  };
  paint(store.get(), null);
  writeHash(store.get().selected == null ? (dataset === DATASETS[0] ? '' : `#${dataset.id}`) : `#${dataset.prefix}-${records[store.get().selected].id}`);

  /* ---------- the 3D stage ---------- */
  const applyTheme = () => {
    if (!stage) return;
    const theme = readTheme();
    stage.setTheme(theme);
    const mode = dataset.colors.find((c) => c.id === store.get().colorBy);
    stage.setColors(colorScale(records, mode, theme.hex, snapshotMs));
  };
  const narrow = matchMedia('(max-width: 880px)');
  const detailInset = () => {
    const { selected, folded } = store.get();
    const open = selected != null && !folded && !narrow.matches;
    stage?.setRightInset(open ? Math.min(404, $('stage').clientWidth * 0.5) : 0);
  };
  /** The selected record's connections to other records, for the arcs on the map. */
  const linksOf = (i) => (i == null ? null : dataset.links?.(records[i]) ?? null);
  const layoutFor = (state) => computeLayout(layoutOf(state.layout), records, state.basis, view.mask);

  try {
    const { createScene, webglAvailable } = await import('./scene.js');
    if (signal.aborted) return null;
    if (!webglAvailable()) throw new Error('WebGL is not available in this browser.');
    const stageEl = $('stage');
    stage = createScene({
      canvas: $('canvas'),
      overlay: $('overlay'),
      count: records.length,
      describe: (i) => dataset.tooltip(records[i]),
      onHover: actions.hover,
      onSelect: (i) => actions.select(i, { from: 'stage' }),
    });
    const padding = () => {
      const box = stageEl.getBoundingClientRect();
      return {
        top: Math.min(110, $('seg-layout').parentElement.getBoundingClientRect().bottom - box.top + 6),
        bottom: narrow.matches ? box.bottom - $('legend').getBoundingClientRect().top + 4 : 30,
      };
    };
    const resize = new ResizeObserver(() => {
      stage.resize(stageEl.clientWidth, stageEl.clientHeight);
      stage.setPadding(padding());
      detailInset();
    });
    resize.observe(stageEl);
    stage.resize(stageEl.clientWidth, stageEl.clientHeight);
    stage.setPadding(padding());
    applyTheme();
    const s = store.get();
    stage.setVisible(view.mask);
    stage.setLayout(layoutFor(s), { order: morphOrder(records, s.basis), intro: s.selected == null });
    stage.setSelected(s.selected);
    stage.setLinks(linksOf(s.selected));
    detailInset();

    // Follow the viewer's theme, whether set by the host page or the OS.
    const themeWatch = new MutationObserver(applyTheme);
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme, { signal });
    cleanups.push(() => resize.disconnect(), () => themeWatch.disconnect(), () => stage.dispose());
  } catch (err) {
    stage = null;
    $('app').dataset.map = 'off';
    $('canvas').hidden = true;
    $('stage-notice').hidden = false;
    $('stage-notice').textContent = `The 3D map could not start (${err.message}) The list and filters still work.`;
  }

  /* ---------- state → everything ---------- */
  store.subscribe((state, changed) => {
    if (signal.aborted) return;
    if (touched(changed, ...FILTER_KEYS)) view = deriveView(dataset, records, state, extent);
    paint(state, changed);

    if (stage) {
      const filtered = touched(changed, 'query', 'sel', 'years', 'basis');
      if (filtered) stage.setVisible(view.mask);
      if (touched(changed, 'layout', 'basis')) {
        clearTimeout(reseat);
        stage.setLayout(layoutFor(state), { order: morphOrder(records, state.basis) });
      } else if (filtered) {
        // Dim at once; re-seat the matches a beat later so typing does not thrash the map.
        clearTimeout(reseat);
        reseat = setTimeout(() => !signal.aborted && stage.setPositions(layoutFor(store.get()).positions), 180);
      }
      if (changed.has('colorBy')) applyTheme();
      if (changed.has('hovered')) stage.setHover(state.hovered);
      if (changed.has('folded')) detailInset(); // a minimised card gives the map its full width
      if (changed.has('selected')) {
        stage.setSelected(state.selected);
        stage.setLinks(linksOf(state.selected));
        detailInset();
        // A dot picked on the map stays under the pointer; one picked from the list is brought to you.
        if (state.selected != null) stage.focusOn(state.selected, selectFrom === 'stage' ? { onlyIfCovered: true } : { closer: true });
      }
    }

    if (changed.has('selected')) {
      writeHash(state.selected == null ? (dataset === DATASETS[0] ? '' : `#${dataset.id}`) : `#${dataset.prefix}-${records[state.selected].id}`);
    }
    if (touched(changed, 'layout', 'basis', 'colorBy', 'sort')) savePrefs(dataset, state);
  });

  /* ---------- keyboard ---------- */
  addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = e.target.matches?.('input, select, textarea');
      if (e.key === 'Escape') {
        if (stagebar.closeHelp()) return;
        if (store.get().selected != null) actions.select(null);
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        $('q').focus();
        $('q').select();
        e.preventDefault();
      } else if (+e.key >= 1 && +e.key <= dataset.layouts.length && e.target !== $('canvas')) {
        store.set({ layout: dataset.layouts[+e.key - 1].id });
      } else if (e.key === 'm' || e.key === 'M') {
        if (store.get().selected != null) actions.fold(!store.get().folded);
      } else if (e.key === 'j' || e.key === 'k') {
        if (store.get().selected != null) detail.step(e.key === 'j' ? 1 : -1);
        else if (view.results.length) actions.select(view.results[0].i, { from: 'list' });
      }
    },
    { signal },
  );

  // Filters start collapsed on small screens, where the list needs the room.
  if (narrow.matches) $('filters').open = false;
  savePrefs(dataset, store.get());

  return {
    select: (id) => actions.select(id == null ? null : byId.get(id)?.i ?? null, { from: 'list' }),
    selectedId: () => (store.get().selected == null ? null : records[store.get().selected].id),
    snapshot() {
      const s = store.get();
      return {
        dataset: dataset.id, layout: s.layout, basis: s.basis, colorBy: s.colorBy, sort: s.sort, query: s.query,
        sel: Object.fromEntries(Object.entries(s.sel).map(([k, set]) => [k, [...set]])), years: s.years,
        selected: s.selected == null ? null : records[s.selected].id, folded: s.folded,
      };
    },
    destroy() {
      clearTimeout(reseat);
      abort.abort();
      for (const fn of cleanups) fn();
    },
  };
}

/* ---------- switching datasets ---------- */

const shell = $('app').cloneNode(true); // the page as authored, before any dataset filled it in
const loaded = new Map(); // dataset id → Promise<{records, meta}>
let current = null; // { id, instance }
let opening = 0;

async function open(id, saved = {}) {
  const dataset = DATASET_BY_ID[id] ?? DATASETS[0];
  const ticket = ++opening;
  current?.instance?.destroy();
  current = { id: dataset.id, instance: null };
  $('app').replaceWith(shell.cloneNode(true));
  $('brand-title').textContent = dataset.title;
  $('result-count').textContent = `Loading ${dataset.noun[1]}…`;

  if (!loaded.has(dataset.id)) loaded.set(dataset.id, loadDataset(dataset));
  let data;
  try {
    data = await loaded.get(dataset.id);
  } catch (err) {
    loaded.delete(dataset.id);
    if (ticket !== opening) return;
    $('stage-notice').hidden = false;
    $('stage-notice').textContent = `The ${dataset.label.toLowerCase()} data did not load. ${err.message} Reload the page to try again.`;
    $('result-count').textContent = 'No data';
    return;
  }
  if (ticket !== opening) return; // another dataset was opened meanwhile
  const instance = await mount(dataset, data, saved);
  if (ticket !== opening) return instance?.destroy();
  current.instance = instance;
}

addEventListener('hashchange', () => {
  const target = parseHash();
  if (!target) {
    if (location.hash === '' && current?.instance?.selectedId() != null) current.instance.select(null);
    return;
  }
  if (target.dataset !== current?.id) open(target.dataset, { selected: target.record });
  else if (target.record !== current.instance?.selectedId()) current.instance?.select(target.record);
});

function start(hot = {}) {
  const link = parseHash();
  const id = link?.dataset ?? hot.dataset ?? readPrefs().dataset ?? DATASETS[0].id;
  const saved = hot.dataset === id ? { ...hot } : {};
  if (link) saved.selected = link.record;
  // Keep the viewer's place when the page is republished underneath them.
  window.claude?.hot?.snapshot?.(() => current?.instance?.snapshot() ?? { dataset: current?.id });
  open(id, saved);
}

if (window.claude?.hot?.ready) window.claude.hot.ready(start);
else start(window.claude?.hot?.data ?? {});
