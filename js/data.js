/**
 * Dataset-independent helpers: dates, ids, loading, filtering and sorting.
 * Everything here is pure except `loadDataset`, and is unit-tested in tests/.
 *
 * Every dataset normalises its raw EMA rows into records that share a small
 * common shape, which is all the list, the filters and the 3D stage rely on:
 *
 * @typedef {Object} Record
 * @property {number} i        index in the dataset (stable for one load)
 * @property {string} id       hash-safe id derived from the EMA URL
 * @property {string} title
 * @property {string} url
 * @property {number} pub      the record's primary date, UTC ms
 * @property {number} last     most recent update, UTC ms (never before `pub`)
 * @property {boolean} revised true when `last` is later than `pub`
 * @property {number} pubY     decimal year of `pub`
 * @property {number} lastY    decimal year of `last`
 * @property {Object<string,string[]>} f  values per filter facet, e.g. { audience: ['human'] }
 * @property {string} hay      lower-case search haystack
 */

const DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27/02/2015" → UTC milliseconds, or null when empty or malformed. */
export function parseEmaDate(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  if (!m) return null;
  const t = Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return Number.isNaN(t) ? null : t;
}

/** UTC ms → fractional year, e.g. 2015.158. */
export function decimalYear(ms) {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const start = Date.UTC(y, 0, 1);
  return y + (ms - start) / (Date.UTC(y + 1, 0, 1) - start);
}

/** UTC ms → "27 Feb 2015". */
export function formatDate(ms) {
  if (ms == null) return '';
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The time between two instants, as "11.7 years" / "4 months" / "3 days". */
export function formatSpan(fromMs, toMs) {
  const days = Math.max(0, Math.round((toMs - fromMs) / DAY));
  if (days < 1) return 'the same day';
  if (days < 60) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 365) return `${Math.round(days / 30.44)} months`;
  const years = days / 365.25;
  return `${years < 10 ? years.toFixed(1) : Math.round(years)} years`;
}

/** Short, stable, hash-safe id from an EMA URL (FNV-1a, base 36). */
export function idFromUrl(url) {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

/** Ids for a whole dataset: `idFromUrl`, with a suffix on the rare collision. */
export function uniqueIds() {
  const seen = new Set();
  return (url) => {
    let id = idFromUrl(url);
    while (seen.has(id)) id += 'x';
    seen.add(id);
    return id;
  };
}

/** The date fields every record carries, from its primary date and last update. */
export function dateFields(pub, upd) {
  const last = upd != null && upd > pub ? upd : pub;
  return { pub, last, revised: last > pub, pubY: decimalYear(pub), lastY: decimalYear(last) };
}

const ENTITIES = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
/**
 * EMA's free text carries a few literal HTML entities ("Keytruda&nbsp;as").
 * This turns them back into characters; the result is still plain text and is
 * only ever written to the page with textContent.
 */
export function decodeEntities(text) {
  return text
    .replace(/&(nbsp|amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n));
}

/** Only ever link out to EMA's own site. */
export function isEmaUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'ema.europa.eu' || u.hostname.endsWith('.ema.europa.eu'));
  } catch {
    return false;
  }
}

/**
 * Fetches the snapshot that ships beside the page and normalises it.
 * A dataset may name `extras`: further files beside the page that enrich it.
 * They are optional, so a missing one never stops the dataset from loading.
 * @param {{id:string, extras?:Object<string,string>, normalise:(rows:any[], extras:Object<string,any>)=>Record[]}} dataset
 */
export async function loadDataset(dataset, base = './data/') {
  const optional = async (file) => {
    try {
      const res = await fetch(`${base}${file}`);
      return res.ok ? await res.json() : null;
    } catch {
      return null;
    }
  };
  const extraNames = Object.keys(dataset.extras ?? {});
  const [rowsRes, metaRes, ...extraData] = await Promise.all([
    fetch(`${base}${dataset.id}.json`),
    fetch(`${base}${dataset.id}.meta.json`),
    ...extraNames.map((name) => optional(dataset.extras[name])),
  ]);
  const extras = Object.fromEntries(extraNames.map((name, i) => [name, extraData[i]]));
  if (!rowsRes.ok) throw new Error(`Could not load ${dataset.id}.json (HTTP ${rowsRes.status}).`);
  const rows = await rowsRes.json();
  const meta = metaRes.ok ? await metaRes.json() : { timestamp: null, total_records: rows.length, source: '' };
  return { records: dataset.normalise(Array.isArray(rows) ? rows : rows.data ?? [], extras), meta };
}

/* ---------- filtering and sorting ---------- */

/**
 * Facets combine with AND; the values picked inside one facet combine with OR.
 * @param {Record[]} records
 * @param {{query:string, sel:Object<string,Set<string>>, years:[number,number]|null, basis:'pub'|'last'}} f
 * @param {string|null} [skip] facet id (or 'years') to ignore, for faceted counts
 * @returns {Uint8Array} 1 where the record passes
 */
export function filterMask(records, f, skip = null) {
  const tokens = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const active = Object.entries(f.sel).filter(([id, set]) => id !== skip && set.size);
  const mask = new Uint8Array(records.length);
  next: for (const r of records) {
    if (tokens.length && !tokens.every((t) => r.hay.includes(t))) continue;
    for (const [id, set] of active) if (!r.f[id].some((v) => set.has(v))) continue next;
    if (skip !== 'years' && f.years) {
      const y = Math.floor(f.basis === 'pub' ? r.pubY : r.lastY);
      if (y < f.years[0] || y > f.years[1]) continue;
    }
    mask[r.i] = 1;
  }
  return mask;
}

export const SORTS = {
  'last-desc': { label: 'Recently updated', fn: (a, b) => b.last - a.last || a.title.localeCompare(b.title) },
  'pub-desc': { label: 'Newest first', fn: (a, b) => b.pub - a.pub || a.title.localeCompare(b.title) },
  'pub-asc': { label: 'Oldest first', fn: (a, b) => a.pub - b.pub || a.title.localeCompare(b.title) },
  title: { label: 'A–Z', fn: (a, b) => a.title.localeCompare(b.title) },
};

/** The shared sorts plus any the dataset adds. */
export const sortsFor = (dataset) => ({ ...SORTS, ...dataset.sorts });

/* ---------- title similarity ---------- */

const STOP = new Set(
  'a an and are as at be by for from in into is it its of on or that the their to use used with within which medicinal products product guideline guidance'.split(' '),
);

/** Lower-case content words of a title. */
export function titleTokens(title) {
  return new Set(
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .split(' ')
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

/**
 * The records whose titles share the most content words with `target`.
 * @param {Record[]} records
 * @param {Record} target
 * @param {(a:Record, b:Record)=>boolean} [akin] records that deserve a small bonus
 */
export function similarTitles(records, target, limit = 5, akin = () => false) {
  const a = titleTokens(target.title);
  if (!a.size) return [];
  const scored = [];
  for (const r of records) {
    if (r.i === target.i) continue;
    const b = titleTokens(r.title);
    let shared = 0;
    for (const w of b) if (a.has(w)) shared++;
    if (!shared) continue;
    scored.push([shared / (a.size + b.size - shared) + (akin(r, target) ? 0.08 : 0), r]);
  }
  return scored
    .filter(([s]) => s >= 0.2)
    .sort((x, y) => y[0] - x[0])
    .slice(0, limit)
    .map(([, r]) => r);
}
