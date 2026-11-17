#!/usr/bin/env node
/**
 * Refreshes data/ from the EMA exports.
 *
 *   node scripts/update-data.mjs                         # download every dataset
 *   node scripts/update-data.mjs medicines               # download one
 *   node scripts/update-data.mjs medicines path/to/file  # or convert a local copy
 *
 * EMA publishes `{ meta, data: [...] }`. The app reads two files per dataset:
 *   data/<id>.json       one array, one record per line (diff-friendly)
 *   data/<id>.meta.json  snapshot timestamp, record count and source
 *
 * Field names and values are kept exactly as EMA publishes them. To keep the
 * larger files small, fields whose value is an empty string are left out, and
 * for datasets that list `flags`, yes/no fields whose value is "No" are too.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://www.ema.europa.eu/en/documents/report/';
const DATASETS = {
  guidelines: {
    title: 'Scientific guidelines',
    url: `${BASE}scientific-guidelines-output-json-report_en.json`,
    required: ['title', 'category', 'first_published_date', 'url'],
    flags: [],
  },
  medicines: {
    title: 'Medicines',
    url: `${BASE}medicines-output-medicines_json-report_en.json`,
    required: ['name_of_medicine', 'category', 'medicine_status', 'first_published_date', 'medicine_url'],
    flags: [
      'patient_safety', 'accelerated_assessment', 'additional_monitoring', 'advanced_therapy', 'biosimilar',
      'conditional_approval', 'exceptional_circumstances', 'generic', 'orphan_medicine', 'prime_priority_medicine',
    ],
  },
};
const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data');

async function read(def, source) {
  if (source) return readFile(source, 'utf8');
  const res = await fetch(def.url);
  if (!res.ok) throw new Error(`EMA responded ${res.status} for ${def.url}`);
  return res.text();
}

async function refresh(id, source) {
  const def = DATASETS[id];
  if (!def) throw new Error(`Unknown dataset "${id}". Known: ${Object.keys(DATASETS).join(', ')}.`);
  const raw = JSON.parse((await read(def, source)).replace(/^﻿/, ''));
  if (!raw || !Array.isArray(raw.data)) throw new Error(`${id}: expected an object with a "data" array.`);

  const records = raw.data.map((r, i) => {
    for (const f of def.required) {
      if (typeof r[f] !== 'string' || !r[f].trim()) throw new Error(`${id}: record ${i} has no "${f}".`);
    }
    const out = {};
    for (const [key, value] of Object.entries(r)) {
      if (typeof value !== 'string') throw new Error(`${id}: record ${i} field "${key}" is not text.`);
      const v = value.trim();
      if (v === '' || (v === 'No' && def.flags.includes(key))) continue;
      out[key] = v;
    }
    return out;
  });

  await mkdir(outDir, { recursive: true });
  await writeFile(resolve(outDir, `${id}.json`), `[\n${records.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
  await writeFile(
    resolve(outDir, `${id}.meta.json`),
    `${JSON.stringify(
      {
        dataset: def.title,
        publisher: 'European Medicines Agency',
        source: def.url,
        timestamp: raw.meta?.timestamp ?? null,
        total_records: records.length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`${id}: wrote ${records.length} records (snapshot ${raw.meta?.timestamp ?? 'unknown'}).`);
}

const [id, source] = process.argv.slice(2);
for (const name of id ? [id] : Object.keys(DATASETS)) await refresh(name, id ? source : undefined);
