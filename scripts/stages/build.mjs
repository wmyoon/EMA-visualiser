#!/usr/bin/env node
/**
 * Builds data/guideline-stages.json (read by the app) and
 * data/guideline-stages.csv (for spreadsheets) from the assessments recorded
 * in .cache/guidelines/stages/*.jsonl by scripts/stages/record.py.
 *
 *   node scripts/stages/build.mjs [stages dir]
 *
 * Guidelines are listed in the order of data/guidelines.json. An assessment
 * for a guideline that is no longer in the dataset is dropped with a warning;
 * a guideline assessed twice stops the build.
 */
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGES, EMA_STAGES, STAGE_BY_ID, EMA_STAGE_BY_ID } from '../../js/stages.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(process.argv[2] ?? join(root, '.cache/guidelines/stages'));

const rows = JSON.parse(await readFile(join(root, 'data/guidelines.json'), 'utf8'));
const order = new Map(rows.map((r, i) => [r.url, i]));

const byUrl = new Map();
for (const name of (await readdir(dir)).filter((n) => n.endsWith('.jsonl')).sort()) {
  const lines = (await readFile(join(dir, name), 'utf8')).split('\n').filter((l) => l.trim());
  for (const line of lines) {
    const a = JSON.parse(line);
    if (!order.has(a.url)) {
      console.warn(`skipped ${a.id} (${name}): not in data/guidelines.json`);
      continue;
    }
    if (byUrl.has(a.url)) throw new Error(`${a.id} is assessed twice (${byUrl.get(a.url).file} and ${name})`);
    if (!STAGE_BY_ID[a.stage]) throw new Error(`${a.id}: unknown stage ${a.stage}`);
    byUrl.set(a.url, { ...a, file: name });
  }
}

const FIELDS = ['url', 'title', 'category', 'stage', 'secondary', 'confidence', 'confidence_reason', 'food_chain',
  'reasoning', 'evidence', 'evidence_source', 'document', 'document_status', 'document_url'];
const stages = [...byUrl.values()]
  .sort((a, b) => order.get(a.url) - order.get(b.url))
  .map((a) => Object.fromEntries(FIELDS.map((k) => [k, a[k] ?? null])));

const tally = (key) => stages.reduce((t, s) => ((t[s[key]] = (t[s[key]] ?? 0) + 1), t), {});
const meta = {
  generated: new Date().toISOString().slice(0, 10),
  assessed: stages.length,
  total_guidelines: rows.length,
  by_stage: tally('stage'),
  by_confidence: tally('confidence'),
  food_chain: stages.filter((s) => s.food_chain).length,
  method:
    'Each guideline was assessed by reading the current document listed on its EMA page, following scripts/stages/RULES.md. ' +
    'The evidence is a quote checked word for word against the document text (or, where there was none, EMA’s page summary). ' +
    'These assessments are this project’s, not EMA’s.',
  framework: {
    source: ['https://www.ema.europa.eu/en/human-regulatory-overview', 'https://www.ema.europa.eu/en/veterinary-regulatory-overview'],
    ema_stages: EMA_STAGES.map(({ id, label }) => ({ id, label })),
    stages: STAGES.map(({ id, label, ema }) => ({ id, label, within: EMA_STAGE_BY_ID[ema].label })),
  },
};

await writeFile(join(root, 'data/guideline-stages.json'), JSON.stringify({ meta, stages }, null, 1) + '\n');

const cell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const label = (id) => (id ? STAGE_BY_ID[id].label : '');
const csvRows = [
  ['title', 'category', 'ema_lifecycle_stage', 'stage', 'secondary_stage', 'confidence', 'confidence_reason', 'food_chain',
    'reasoning', 'evidence', 'evidence_source', 'document', 'document_status', 'guideline_url', 'document_url'],
  ...stages.map((s) => [
    s.title, s.category, EMA_STAGE_BY_ID[STAGE_BY_ID[s.stage].ema].label, label(s.stage), label(s.secondary), s.confidence,
    s.confidence_reason, s.food_chain ? 'yes' : 'no', s.reasoning, s.evidence, s.evidence_source, s.document, s.document_status,
    s.url, s.document_url,
  ]),
];
// A byte-order mark so that Excel reads the file as UTF-8.
await writeFile(join(root, 'data/guideline-stages.csv'), '﻿' + csvRows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');

console.log(`${stages.length} of ${rows.length} guidelines assessed.`);
console.log('By stage:', meta.by_stage);
console.log('By confidence:', meta.by_confidence, '· food chain:', meta.food_chain);
const missing = rows.filter((r) => !byUrl.has(r.url));
if (missing.length) console.log(`Not yet assessed: ${missing.length}`);
