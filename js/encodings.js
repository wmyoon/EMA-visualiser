/**
 * Colour encodings. Hex values live in the stylesheet as tokens, so the stage
 * always matches the page theme. A colour mode only names the tokens a record
 * wears (`of`) and the legend that explains them.
 *
 * @typedef {Object} ColorMode
 * @property {string} id
 * @property {string} label
 * @property {string} [legendTitle]
 * @property {(r:any, ctx:{snapshotMs:number})=>string[]} of  one to three CSS custom-property names
 * @property {{label:string, tokens:string[]}[]} legend
 */

const YEAR = 365.25 * 86400000;

/** Years since the last update, bucketed. Index 0 is the most recent. */
export const AGE_BUCKETS = [
  { under: 1, label: 'Under 1 yr' },
  { under: 3, label: '1–3' },
  { under: 7, label: '3–7' },
  { under: 15, label: '7–15' },
  { under: Infinity, label: '15+ yr' },
];

export function ageBucket(record, snapshotMs) {
  const years = (snapshotMs - record.last) / YEAR;
  return AGE_BUCKETS.findIndex((b) => years < b.under);
}

/** Shared by every dataset: colour by time since the last update. @type {ColorMode} */
export const ageColors = {
  id: 'age',
  label: 'Update age',
  legendTitle: 'Last updated',
  of: (r, { snapshotMs }) => [`--age-${ageBucket(r, snapshotMs) + 1}`],
  legend: AGE_BUCKETS.map((b, i) => ({ label: b.label, tokens: [`--age-${i + 1}`] })),
};

/** Reads the stage furniture and a token resolver from the live stylesheet. */
export function readTheme() {
  const css = getComputedStyle(document.documentElement);
  const cache = new Map();
  const hex = (name) => {
    if (!cache.has(name)) cache.set(name, css.getPropertyValue(name).trim());
    return cache.get(name);
  };
  return {
    surface: hex('--surface'),
    dim: hex('--dim'),
    line: hex('--guide'),
    lineStrength: parseFloat(hex('--guide-strength')) || 0.5,
    accent: hex('--accent'),
    muted: hex('--ink-3'),
    hex,
  };
}

/**
 * @param {any[]} records
 * @param {ColorMode} mode
 * @param {(token:string)=>string} hex
 * @returns {(i:number)=>string[]} one to three hex colours for record i
 */
export function colorScale(records, mode, hex, snapshotMs) {
  return (i) => mode.of(records[i], { snapshotMs }).map(hex);
}
