/**
 * Dataset: EMA scientific guidelines.
 * Raw fields: title, category, first_published_date, last_updated_date, url.
 * Subject, disease area and reference code are inferred from the title.
 *
 * Optional extra, data/guideline-links.json: which guideline pages on
 * ema.europa.eu link to which others (see scripts/update-links.mjs). From it
 * each record gets `out` (guidelines its page links to) and `back` (guidelines
 * whose pages link to it), as record indices.
 */
import { parseEmaDate, dateFields, uniqueIds, formatDate, formatSpan, similarTitles } from '../data.js';
import { GROUPS, GROUP_BY_ID, ICH_SERIES, classify, extractCode } from '../classify.js';
import { AREAS, AREA_BY_ID, classifyArea } from '../areas.js';
import { ageColors } from '../encodings.js';

export const AUDIENCES = [
  { id: 'human', label: 'Human', short: 'Human', token: '--human' },
  { id: 'veterinary', label: 'Veterinary', short: 'Veterinary', token: '--veterinary' },
  { id: 'herbal', label: 'Herbal', short: 'Herbal', token: '--herbal' },
];
const AUDIENCE = Object.fromEntries(AUDIENCES.map((a, i) => [a.id, { ...a, order: i }]));

/**
 * @param {Array<Object<string,string>>} rows raw EMA records
 * @param {{links?: {from:string, to:string[]}[]|null, linksMeta?: {pages_read:number, pages_total:number}|null}} [extras]
 * @returns {import('../data.js').Record[]} plus cats, group, area, code, upd, out, back, linked
 */
export function normalise(rows, extras = {}) {
  const idFor = uniqueIds();
  const out = [];
  for (const r of rows) {
    const pub = parseEmaDate(r.first_published_date);
    if (pub == null || !r.title || !r.url) continue; // unusable without a date, title and link
    const upd = parseEmaDate(r.last_updated_date);
    let cats = String(r.category || '')
      .split(';')
      .map((c) => c.trim().toLowerCase())
      .filter((c) => c in AUDIENCE)
      .sort((a, b) => AUDIENCE[a].order - AUDIENCE[b].order);
    if (!cats.length) cats = ['human'];
    const group = classify(r.title, cats);
    const area = classifyArea(r.title);
    const code = extractCode(r.title);
    out.push({
      i: out.length,
      id: idFor(r.url),
      title: r.title,
      url: r.url,
      ...dateFields(pub, upd),
      upd,
      cats,
      group,
      area,
      code,
      out: [],
      back: [],
      linked: Array.isArray(extras.links), // false when the link map is not available
      f: { audience: cats, group: [group], area: [area] },
      hay: `${r.title} ${code ?? ''} ${cats.join(' ')} ${area === 'general' ? '' : AREA_BY_ID[area].label}`.toLowerCase(),
    });
  }
  coverage = extras.linksMeta && extras.linksMeta.pages_read < extras.linksMeta.pages_total ? extras.linksMeta : null;
  if (Array.isArray(extras.links)) {
    const byUrl = new Map(out.map((r) => [r.url, r]));
    for (const { from, to } of extras.links) {
      const a = byUrl.get(from);
      if (!a || !Array.isArray(to)) continue;
      for (const url of to) {
        const b = byUrl.get(url);
        if (!b || b === a || a.out.includes(b.i)) continue;
        a.out.push(b.i);
        b.back.push(a.i);
      }
    }
  }
  return out;
}

/** Set when the link map covers only part of the guideline pages, so the card can say so. */
let coverage = null;

/** Skyline rows, back to front. */
export const LANES = [
  { id: 'human', label: 'Human' },
  { id: 'veterinary', label: 'Veterinary' },
  { id: 'shared', label: 'Human + Veterinary' },
  { id: 'herbal', label: 'Herbal' },
];
export function laneOf(r) {
  if (r.cats.includes('herbal')) return 'herbal';
  if (r.cats.length > 1) return 'shared';
  return r.cats[0];
}

const rank = (r) => r.cats.reduce((s, c) => s * 4 + AUDIENCE[c].order + 1, 0);
const audienceTokens = (r) => r.cats.map((c) => AUDIENCE[c].token);
const year = (ms) => new Date(ms).getUTCFullYear();

export default {
  id: 'guidelines',
  prefix: 'g',
  label: 'Guidelines',
  title: 'scientific guidelines',
  noun: ['guideline', 'guidelines'],
  searchPlaceholder: 'Search titles and codes: Q3D, asthma, GL49',
  extras: { links: 'guideline-links.json', linksMeta: 'guideline-links.meta.json' },
  normalise,

  sorts: {
    'back-desc': { label: 'Most referenced', fn: (a, b) => b.back.length - a.back.length || b.last - a.last || a.title.localeCompare(b.title) },
  },

  /** Connections drawn as arcs on the map when a guideline is selected. */
  links: (r) => ({ from: r.i, incoming: r.back, outgoing: r.out.filter((i) => !r.back.includes(i)) }),

  bases: {
    pub: { label: 'First published', verb: 'published', noun: 'of first publication' },
    last: { label: 'Last updated', verb: 'updated', noun: 'of last update' },
  },

  facets: [
    { id: 'audience', label: 'Audience', options: AUDIENCES },
    { id: 'group', label: 'Subject', tab: true, note: 'inferred from the title', options: GROUPS },
    { id: 'area', label: 'Disease area', tab: true, note: 'inferred from the title', options: AREAS },
  ],

  layouts: [
    {
      id: 'spiral', label: 'Spiral', kind: 'spiral', rank,
      caption: (b) => `Time winds outward from the centre. One turn is one year, January at the top. Dots ${b.verb} within days of each other stack upward.`,
    },
    {
      id: 'skyline', label: 'Skyline', kind: 'skyline', rank, lanes: LANES, laneOf,
      caption: (b) => `One column per year ${b.noun}, one row per audience. Taller columns were busier years.`,
    },
    {
      id: 'groups', label: 'Subjects', kind: 'clusters', facet: 'group', defs: GROUPS, keyOf: (r) => r.group,
      caption: (b) => `Clusters by subject, inferred from each title. Within a cluster the most recently ${b.verb} sit at the peak.`,
    },
    {
      id: 'areas', label: 'Diseases', kind: 'clusters', facet: 'area', defs: AREAS, keyOf: (r) => r.area, last: 'general',
      caption: (b) => `Clusters by disease area, inferred from each title. Guidelines that name no disease form the large cluster apart. The most recently ${b.verb} sit at each peak.`,
    },
  ],

  colors: [
    {
      id: 'audience',
      label: 'Audience',
      of: audienceTokens,
      legend: [
        ...AUDIENCES.map((a) => ({ label: a.label, tokens: [a.token] })),
        { label: 'Split dot: shared', tokens: ['--human', '--veterinary'] },
      ],
    },
    ageColors,
  ],

  /** What a list row shows. */
  row: (r) => ({
    tokens: audienceTokens(r),
    code: r.code,
    meta: [
      r.revised ? `${year(r.pub)} → ${year(r.last)}` : String(year(r.pub)),
      r.back.length ? `${r.back.length} backlink${r.back.length === 1 ? '' : 's'}` : null,
      r.area === 'general' ? GROUP_BY_ID[r.group].short : `${GROUP_BY_ID[r.group].short} · ${AREA_BY_ID[r.area].short}`,
    ],
  }),

  tooltip: (r) => ({
    title: r.title,
    meta: `${r.code ? `${r.code} · ` : ''}${r.revised ? `Pub ${formatDate(r.pub)} · Rev ${formatDate(r.last)}` : `Pub ${formatDate(r.pub)}`}`,
  }),

  /** Content of the detail card, as plain data the card component lays out. */
  detail(r, { snapshotMs, records }) {
    const group = GROUP_BY_ID[r.group];
    const newestFirst = (list) => list.map((i) => records[i]).sort((a, b) => b.last - a.last || a.title.localeCompare(b.title));
    const since = formatSpan(r.last, snapshotMs);
    return {
      tags: r.cats.map((c) => ({ label: AUDIENCE[c].label, tokens: [AUDIENCE[c].token] })),
      title: r.title,
      subject: {
        code: r.code,
        parts: [
          group.label,
          r.group === 'ich' && r.code && ICH_SERIES[r.code[0]] ? `${ICH_SERIES[r.code[0]]} series` : null,
          r.area === 'general' ? null : AREA_BY_ID[r.area].label,
        ].filter(Boolean),
        note: 'inferred',
        hint: `${group.about} Inferred from the title, not an EMA field.`,
      },
      stamps: [
        { key: 'PUB', value: formatDate(r.pub), note: 'First published' },
        r.revised
          ? { key: 'REV', value: formatDate(r.last), note: `Last updated ${formatSpan(r.pub, r.last)} after publication, ${since} before this snapshot` }
          : { key: 'REV', empty: 'No later update recorded', note: `Unchanged for ${since} at this snapshot` },
      ],
      life: {
        from: r.pubY,
        to: r.revised ? r.lastY : null,
        label: r.revised ? `Published ${formatDate(r.pub)}, last updated ${formatDate(r.last)}` : `Published ${formatDate(r.pub)}`,
      },
      lists: r.linked
        ? [
            {
              id: 'back',
              label: 'Referenced by',
              items: newestFirst(r.back),
              tone: 'accent',
              empty: 'No other guideline page links to this one.',
              note: 'Guidelines whose EMA page links to this one.',
              caveat: coverage
                ? `Incomplete: ${coverage.pages_read} of ${coverage.pages_total} guideline pages have been read so far, so some references are missing.`
                : null,
            },
            { id: 'out', label: 'Refers to', items: newestFirst(r.out), tone: 'muted', note: 'Guidelines that this one’s EMA page links to.' },
          ]
        : [],
    };
  },

  related: (records, r) => ({
    label: 'Similar titles',
    items: similarTitles(records, r, 5, (a, b) => a.group === b.group),
  }),
};
