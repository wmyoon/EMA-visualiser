/**
 * Dataset: EMA medicines (centrally authorised medicines and applications).
 *
 * Unlike the guidelines, almost everything shown here is an EMA field. Two
 * things are derived:
 *  - the status *bucket* used for colour and skyline rows groups EMA's ten
 *    statuses into four;
 *  - the *class* is the first level of the ATC / ATCvet code. Where EMA lists
 *    no code, it is read from the pharmacotherapeutic group text when that
 *    names a class, and is otherwise "No ATC code".
 *
 * Each medicine is placed in time by one date (see `primaryDate`).
 */
import { parseEmaDate, dateFields, uniqueIds, formatDate, formatSpan, decimalYear, decodeEntities } from '../data.js';
import { ageColors } from '../encodings.js';

/* ---------- status ---------- */

export const BUCKETS = [
  { id: 'authorised', label: 'Authorised', token: '--series-1' },
  { id: 'ended', label: 'Ended or suspended', token: '--neutral' },
  { id: 'declined', label: 'Not authorised', token: '--series-2' },
  { id: 'pending', label: 'Awaiting decision', token: '--series-3' },
];
const BUCKET = Object.fromEntries(BUCKETS.map((b, i) => [b.id, { ...b, order: i }]));

/** EMA's `medicine_status` values, in display order, with the bucket each belongs to. */
const STATUSES = [
  ['Authorised', 'authorised'],
  ['Opinion', 'pending'],
  ['Withdrawn', 'ended'],
  ['Lapsed', 'ended'],
  ['Expired', 'ended'],
  ['Revoked', 'ended'],
  ['Suspended', 'ended'],
  ['Application withdrawn', 'declined'],
  ['Withdrawn from rolling review', 'declined'],
  ['Refused', 'declined'],
];
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const STATUS_OPTIONS = [
  ...STATUSES.map(([label, bucket]) => ({ id: slug(label), label, short: label, bucket, token: BUCKET[bucket].token })),
  { id: 'other', label: 'Other status', short: 'Other', bucket: 'ended', token: '--neutral' },
];
const STATUS_BY_LABEL = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.label, s]));

/* ---------- class (ATC level 1) ---------- */

export const CLASSES = [
  { id: 'L', label: 'Antineoplastic & immunomodulating agents', short: 'Cancer & immune' },
  { id: 'J', label: 'Anti-infectives for systemic use', short: 'Anti-infectives' },
  { id: 'A', label: 'Alimentary tract & metabolism', short: 'Alimentary & metabolism' },
  { id: 'N', label: 'Nervous system', short: 'Nervous system' },
  { id: 'B', label: 'Blood & blood-forming organs', short: 'Blood' },
  { id: 'C', label: 'Cardiovascular system', short: 'Cardiovascular' },
  { id: 'I', label: 'Immunologicals (veterinary vaccines and sera)', short: 'Vet. immunologicals' },
  { id: 'M', label: 'Musculo-skeletal system', short: 'Musculo-skeletal' },
  { id: 'V', label: 'Various', short: 'Various' },
  { id: 'R', label: 'Respiratory system', short: 'Respiratory' },
  { id: 'S', label: 'Sensory organs', short: 'Sensory organs' },
  { id: 'G', label: 'Genito-urinary system & sex hormones', short: 'Genito-urinary' },
  { id: 'H', label: 'Systemic hormonal preparations', short: 'Hormonal' },
  { id: 'P', label: 'Antiparasitic products', short: 'Antiparasitic' },
  { id: 'D', label: 'Dermatologicals', short: 'Dermatological' },
  { id: 'none', label: 'No ATC code', short: 'No ATC code' },
];
const CLASS_BY_ID = Object.fromEntries(CLASSES.map((c) => [c.id, c]));

/** Group-text patterns for records without a code. Ordered; the first match wins. */
const GROUP_HINTS = [
  ['I', /immunological|vaccine/i],
  ['D', /dermat/i],
  ['S', /otological|ophthalm|sensory/i],
  ['P', /antiparasitic|ectoparasit|anthelmintic|endectocide|antiprotozoal|insecticide/i],
  ['J', /antibacterial|anti-?infective|antiviral|antimycotic/i],
  ['M', /anti-inflammatory|anti-rheumatic|oxicam|musculo/i],
  ['N', /nervous|psycholeptic|psychoanaleptic|an(?:a)?esthetic|analgesic/i],
  ['A', /alimentary|diabetes|SGLT2|antiobesity/i],
  ['L', /antineoplastic|immunosuppress|immunostimul|endocrine therapy/i],
  ['H', /hormone|antiadrenal/i],
  ['C', /cardio|cardiac|diuretic|antihypertens/i],
  ['B', /antihemorrhagic|antithrombotic|\bblood\b/i],
  ['G', /genito|urological/i],
  ['R', /respiratory|airway/i],
];

/**
 * @param {string} code  ATC or ATCvet code as published (may be empty, a list, or "Not yet assigned")
 * @param {string} group pharmacotherapeutic group text
 * @returns {{id:string, from:'code'|'group'|null}}
 */
export function atcClass(code, group) {
  const first = (code || '').split(/[;,]/)[0].trim().toUpperCase();
  if (/^Q?[A-Z][A-Z0-9]/.test(first) && !first.startsWith('NOT')) {
    const letter = first.replace(/^Q/, '')[0];
    if (letter in CLASS_BY_ID) return { id: letter, from: 'code' };
  }
  for (const [id, re] of GROUP_HINTS) if (re.test(group || '')) return { id, from: 'group' };
  return { id: 'none', from: null };
}

/* ---------- type flags ---------- */

const FLAGS = [
  { id: 'generic', field: 'generic', label: 'Generic', token: '--series-1' },
  { id: 'biosimilar', field: 'biosimilar', label: 'Biosimilar', token: '--series-3' },
  { id: 'orphan', field: 'orphan_medicine', label: 'Orphan', token: '--series-2' },
  { id: 'atmp', field: 'advanced_therapy', label: 'Advanced therapy' },
  { id: 'conditional', field: 'conditional_approval', label: 'Conditional approval' },
  { id: 'exceptional', field: 'exceptional_circumstances', label: 'Exceptional circumstances' },
  { id: 'accelerated', field: 'accelerated_assessment', label: 'Accelerated assessment' },
  { id: 'prime', field: 'prime_priority_medicine', label: 'PRIME' },
  { id: 'monitoring', field: 'additional_monitoring', label: 'Additional monitoring' },
  { id: 'safety', field: 'patient_safety', label: 'Patient safety' },
];
const FLAG_BY_ID = Object.fromEntries(FLAGS.map((f) => [f.id, f]));
const TYPE_OPTIONS = [...FLAGS.map((f) => ({ ...f, short: f.label })), { id: 'none', label: 'None of these', short: 'None of these' }];

const AUDIENCES = [
  { id: 'human', label: 'Human', short: 'Human', token: '--human' },
  { id: 'veterinary', label: 'Veterinary', short: 'Veterinary', token: '--veterinary' },
];

/* ---------- dates ---------- */

/** Every dated field, with the words the detail card uses for it. */
const MILESTONES = [
  ['start_of_rolling_review_date', 'Rolling review started'],
  ['start_of_evaluation_date', 'Evaluation started'],
  ['opinion_adopted_date', 'Opinion adopted'],
  ['marketing_authorisation_date', 'Authorised'],
  ['refusal_of_marketing_authorisation_date', 'Refused'],
  ['withdrawal_of_application_date', 'Application withdrawn'],
  ['suspension_of_marketing_authorisation_date', 'Suspended'],
  ['withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date', 'Authorisation ended'],
  ['european_commission_decision_date', 'Latest EC decision'],
  ['first_published_date', 'EMA page published'],
  ['last_updated_date', 'EMA page updated'],
];

/** Which date places a medicine in time, by outcome. The first one present is used. */
const DATE_ORDER = {
  authorised: ['marketing_authorisation_date', 'opinion_adopted_date', 'european_commission_decision_date', 'first_published_date'],
  ended: ['marketing_authorisation_date', 'opinion_adopted_date', 'european_commission_decision_date', 'first_published_date'],
  declined: ['refusal_of_marketing_authorisation_date', 'withdrawal_of_application_date', 'opinion_adopted_date', 'first_published_date'],
  pending: ['opinion_adopted_date', 'first_published_date'],
};
const DATE_WORD = {
  marketing_authorisation_date: 'Authorised',
  opinion_adopted_date: 'Opinion',
  european_commission_decision_date: 'EC decision',
  refusal_of_marketing_authorisation_date: 'Refused',
  withdrawal_of_application_date: 'Withdrawn',
  first_published_date: 'Page published',
};

/** @returns {{ms:number, field:string}|null} */
export function primaryDate(row, bucket) {
  for (const field of DATE_ORDER[bucket]) {
    const ms = parseEmaDate(row[field]);
    if (ms != null) return { ms, field };
  }
  return null;
}

/* ---------- normalise ---------- */

const list = (s) => (s || '').split(';').map((v) => v.trim()).filter(Boolean);

/**
 * @param {Array<Object<string,string>>} rows raw EMA records (empty fields and "No" flags may be absent)
 * @returns {import('../data.js').Record[]} plus the medicine-specific fields used below
 */
export function normalise(rows) {
  const idFor = uniqueIds();
  const out = [];
  for (const row of rows) {
    const name = row.name_of_medicine;
    const url = row.medicine_url;
    const status = STATUS_BY_LABEL[row.medicine_status] ?? STATUS_BY_LABEL['Other status'];
    const date = primaryDate(row, status.bucket);
    if (!name || !url || !date) continue; // unusable without a name, link and date
    const audience = row.category === 'Veterinary' ? 'veterinary' : 'human';
    const code = row.atc_code_human || row.atcvet_code_veterinary || '';
    const group = row.pharmacotherapeutic_group_human || row.pharmacotherapeutic_group_veterinary || '';
    const cls = atcClass(code, group);
    const flags = FLAGS.filter((f) => row[f.field] === 'Yes').map((f) => f.id);
    const inn = row.international_non_proprietary_name_common_name || row.active_substance || '';
    out.push({
      i: out.length,
      id: idFor(url),
      title: name,
      url,
      ...dateFields(date.ms, parseEmaDate(row.last_updated_date)),
      dateField: date.field,
      audience,
      status,
      bucket: status.bucket,
      statusLabel: row.medicine_status,
      inn,
      code,
      cls: cls.id,
      clsFrom: cls.from,
      flags,
      raw: row,
      f: { audience: [audience], status: [status.id], class: [cls.id], type: flags.length ? flags : ['none'] },
      hay: [
        name, inn, row.active_substance, code, row.ema_product_number, row.medicine_status, row.category,
        row.marketing_authorisation_developer_applicant_holder, row.therapeutic_area_mesh, group, row.species_veterinary,
        cls.id === 'none' ? '' : CLASS_BY_ID[cls.id].label, flags.map((f) => FLAG_BY_ID[f].label).join(' '),
      ].filter(Boolean).join(' ').toLowerCase(),
    });
  }
  return out;
}

/* ---------- presentation ---------- */

const year = (ms) => new Date(ms).getUTCFullYear();
const rank = (r) => BUCKET[r.bucket].order;
const statusTokens = (r) => [BUCKET[r.bucket].token];
const typeTokens = (r) => {
  const hued = r.flags.map((f) => FLAG_BY_ID[f].token).filter(Boolean);
  return hued.length ? hued.slice(0, 3) : ['--neutral'];
};
const placed = (b) =>
  b.id === 'last'
    ? 'Each medicine sits at the date its EMA page was last updated.'
    : 'Each medicine sits at its authorisation date, or at its refusal or withdrawal date if it was never authorised.';

export default {
  id: 'medicines',
  prefix: 'm',
  label: 'Medicines',
  title: 'medicines',
  noun: ['medicine', 'medicines'],
  searchPlaceholder: 'Search name, substance, ATC code, company',
  normalise,

  bases: {
    pub: { label: 'Authorised or decided', verb: 'decided', noun: 'of authorisation or outcome' },
    last: { label: 'Last updated', verb: 'updated', noun: 'of last update' },
  },

  facets: [
    { id: 'audience', label: 'Audience', options: AUDIENCES },
    { id: 'status', label: 'Status', tab: true, note: 'as published by EMA', options: STATUS_OPTIONS },
    { id: 'class', label: 'Class', tab: true, note: 'first level of the ATC code', options: CLASSES },
    { id: 'type', label: 'Type', tab: true, note: 'as flagged by EMA', options: TYPE_OPTIONS },
  ],

  layouts: [
    {
      id: 'spiral', label: 'Spiral', kind: 'spiral', rank,
      caption: (b) => `Time winds outward from the centre. One turn is one year, January at the top. ${placed(b)}`,
    },
    {
      id: 'skyline', label: 'Skyline', kind: 'skyline', rank,
      lanes: BUCKETS.map((b) => ({ id: b.id, label: b.label })), laneOf: (r) => r.bucket,
      caption: (b) => `One column per year, one row per outcome. ${placed(b)}`,
    },
    {
      id: 'classes', label: 'Classes', kind: 'clusters', facet: 'class', defs: CLASSES, keyOf: (r) => r.cls, last: 'none',
      caption: (b) => `Clusters by the first level of the ATC code. Where EMA lists no code, the class is read from the pharmacotherapeutic group if it names one. The most recently ${b.verb} sit at each peak.`,
    },
  ],

  colors: [
    {
      id: 'status',
      label: 'Status',
      of: statusTokens,
      legend: [
        { label: 'Authorised', tokens: ['--series-1'] },
        { label: 'Ended or suspended', tokens: ['--neutral'], title: 'Withdrawn, lapsed, expired, revoked or suspended' },
        { label: 'Not authorised', tokens: ['--series-2'], title: 'Refused, application withdrawn, or withdrawn from rolling review' },
        { label: 'Awaiting decision', tokens: ['--series-3'], title: 'Opinion adopted, European Commission decision pending' },
      ],
    },
    {
      id: 'type',
      label: 'Type',
      of: typeTokens,
      legend: [
        { label: 'Generic', tokens: ['--series-1'] },
        { label: 'Biosimilar', tokens: ['--series-3'] },
        { label: 'Orphan', tokens: ['--series-2'] },
        { label: 'None of these', tokens: ['--neutral'] },
      ],
    },
    {
      id: 'audience',
      label: 'Audience',
      of: (r) => [r.audience === 'veterinary' ? '--veterinary' : '--human'],
      legend: AUDIENCES.map((a) => ({ label: a.label, tokens: [a.token] })),
    },
    ageColors,
  ],

  row: (r) => ({
    tokens: statusTokens(r),
    code: null,
    meta: [`${r.statusLabel} ${year(r.pub)}`, r.inn],
  }),

  tooltip: (r) => ({
    title: r.title,
    meta: `${r.inn ? `${r.inn} · ` : ''}${r.statusLabel} · ${DATE_WORD[r.dateField]} ${formatDate(r.pub)}`,
  }),

  detail(r, { snapshotMs }) {
    const row = r.raw;
    const cls = CLASS_BY_ID[r.cls];
    const dated = MILESTONES.map(([field, label]) => ({ field, label, ms: parseEmaDate(row[field]) }))
      .filter((m) => m.ms != null)
      .sort((a, b) => a.ms - b.ms);
    const authorised = parseEmaDate(row.marketing_authorisation_date);
    const ended = parseEmaDate(row.withdrawal_expiry_revocation_lapse_of_marketing_authorisation_date);
    const substance = row.active_substance && row.active_substance.toLowerCase() !== r.inn.toLowerCase() ? row.active_substance : null;

    let life = { from: r.pubY, to: null, label: `${DATE_WORD[r.dateField]} ${formatDate(r.pub)}` };
    if (authorised != null && ended != null && ended > authorised) {
      life = { from: decimalYear(authorised), to: decimalYear(ended), label: `Authorised ${formatDate(authorised)}, ended ${formatDate(ended)}, after ${formatSpan(authorised, ended)}` };
    } else if (authorised != null && r.bucket === 'authorised') {
      life = { from: decimalYear(authorised), to: decimalYear(snapshotMs), label: `Authorised ${formatDate(authorised)}, ${formatSpan(authorised, snapshotMs)} ago` };
    }

    return {
      tags: [
        { label: r.audience === 'veterinary' ? 'Veterinary' : 'Human', tokens: [r.audience === 'veterinary' ? '--veterinary' : '--human'] },
        { label: row.opinion_status ? `${r.statusLabel} (${row.opinion_status.toLowerCase()} opinion)` : r.statusLabel, tokens: statusTokens(r) },
      ],
      title: r.title,
      subtitle: r.inn || null,
      subject: {
        code: r.code || null,
        parts: [cls.label],
        note: r.clsFrom === 'group' ? 'from the pharmacotherapeutic group' : null,
        hint: r.clsFrom === 'group' ? 'EMA lists no ATC code for this medicine; the class is read from its pharmacotherapeutic group.' : null,
      },
      flags: r.flags.map((f) => FLAG_BY_ID[f].label),
      facts: [
        ['Active substance', substance],
        ['Therapeutic area', list(row.therapeutic_area_mesh).join(', ')],
        ['Pharmacotherapeutic group', list(row.pharmacotherapeutic_group_human || row.pharmacotherapeutic_group_veterinary).join(', ')],
        ['Species', list(row.species_veterinary).join(', ')],
        ['Holder or applicant', row.marketing_authorisation_developer_applicant_holder],
        ['EMA product number', row.ema_product_number],
        ['Revision', row.revision_number],
      ].filter(([, value]) => value),
      text: row.therapeutic_indication ? { label: 'Therapeutic indication', body: decodeEntities(row.therapeutic_indication) } : null,
      stamps: dated.map((m) => ({ key: m.label, value: formatDate(m.ms) })),
      stampsWide: true,
      notice:
        r.dateField === 'first_published_date'
          ? 'EMA gives no authorisation or outcome date for this medicine, so the map places it at the date its EMA page was first published.'
          : null,
      life,
    };
  },

  /** Other medicines with the same INN: the generics and biosimilars of a reference product, usually. */
  related(records, r) {
    const key = r.inn.toLowerCase();
    if (!key) return { label: 'Same active substance', items: [] };
    return {
      label: 'Same active substance',
      items: records
        .filter((o) => o.i !== r.i && o.inn.toLowerCase() === key)
        .sort((a, b) => BUCKET[a.bucket].order - BUCKET[b.bucket].order || b.pub - a.pub)
        .slice(0, 8),
    };
  },
};
