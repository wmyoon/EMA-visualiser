#!/usr/bin/env node
/**
 * Downloads the current document of every scientific guideline.
 *
 *   node scripts/download-guidelines.mjs            # into .cache/guidelines/
 *   OUT_DIR=~/EMA-guidelines node scripts/download-guidelines.mjs
 *
 * For each guideline in data/guidelines.json it reads the guideline's page on
 * ema.europa.eu, lists every document the page offers, picks the one in force,
 * and saves it as pdf/<id>.pdf (the id is the one the app uses in #g-<id>).
 * If `pdftotext` is installed (poppler: `brew install poppler` on a Mac) the
 * text is also saved as text/<id>.txt.
 *
 * Which document: the first one under "Current (effective) version"; failing
 * that, the first adopted one in the history section marked "(current
 * version)"; failing that, the most recent adopted one; failing that (a
 * guideline only out for consultation), the most recent draft. manifest.json
 * records every document listed on each page and which rule picked the file.
 *
 * About 2,000 requests, one at a time with a pause between them (six
 * seconds unless PAUSE_MS says otherwise), so a full run takes three to four
 * hours. It slows down when EMA answers 429 or 503 and stops cleanly if that
 * goes on.
 * Run it again to continue: guidelines already in the manifest are skipped.
 * Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { idFromUrl } from '../js/data.js';

const ORIGIN = 'https://www.ema.europa.eu';
const UA = 'guideline-download/1.0 (one-off research script)';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const text = (html) =>
  (html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Everything useful on a guideline page: the summary paragraphs above the
 * documents, and each documents section with its files.
 */
export function parseGuidelinePage(html) {
  const main = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] ?? '';
  const marker = 'paragraph--type--ema-documents';
  const first = main.indexOf(marker);
  const intro = first < 0 ? main : main.slice(0, first);
  const summary = [...intro.matchAll(/paragraph--type--oe-rich-text[\s\S]*?(?=<div class="item">|$)/g)]
    .map((m) => text(m[0].replace(/^[^>]*>/, '')))
    .filter(Boolean)
    .join('\n\n');

  const sections = [];
  if (first >= 0) {
    const starts = [];
    for (let i = first; i >= 0; i = main.indexOf(marker, i + 1)) starts.push(i);
    starts.forEach((start, k) => {
      const block = main.slice(start, starts[k + 1] ?? main.length);
      const heading = text(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/i.exec(block)?.[1]);
      const docs = block.split(/(?=<div data-ema-document-type=)/).slice(1).map((card) => {
        const value = (cls) => text(new RegExp(`${cls}[^"]*"[^>]*>[\\s\\S]*?<span class="value">([\\s\\S]*?)<\\/span>`).exec(card)?.[1]);
        const href = /<a\b[^>]*href="([^"]+)"[^>]*>\s*View/i.exec(card)?.[1] ?? /<a\b[^>]*href="([^"]+\.pdf)"/i.exec(card)?.[1] ?? null;
        return {
          title: text(/class="file-title[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(card)?.[1]),
          type: /data-ema-document-type="([^"]+)"/.exec(card)?.[1] ?? null,
          status: text(/file-metadata-row[^"]*text-muted"[^>]*>\s*<span class="value">([\s\S]*?)<\/span>/.exec(card)?.[1]) || null,
          reference: value('reference-number') || null,
          effective: value('legal-effective-date') || null,
          published: /First published:\s*(?:<[^>]+>\s*)*(\d{2}\/\d{2}\/\d{4})/.exec(card)?.[1] ?? null,
          href: href ? new URL(href.replace(/&amp;/g, '&'), ORIGIN).href : null,
        };
      }).filter((d) => d.href);
      sections.push({ heading, docs });
    });
  }
  return { summary, sections };
}

const ms = (d) => (d ? Date.UTC(+d.slice(6, 10), +d.slice(3, 5) - 1, +d.slice(0, 2)) : 0);
const isComments = (d) => /overview of comments|comments received/i.test(d.title) || d.type === 'comments';
const isAdopted = (d) => /adopted|final/i.test(d.status ?? '') && !isComments(d);
const isDraftLike = (d) => /draft|consultation|concept paper/i.test(`${d.status ?? ''} ${d.title}`);

/** The document in force on a parsed page, and the rule that chose it. */
export function chooseDocument({ sections }) {
  const current = sections.find((s) => /^current\b/i.test(s.heading));
  const inCurrent = current?.docs.find((d) => !isComments(d));
  if (inCurrent) return { doc: inCurrent, rule: 'current version section' };
  const history = sections.find((s) => /\(current version\)/i.test(s.heading));
  const fromHistory = history?.docs.find(isAdopted);
  if (fromHistory) return { doc: fromHistory, rule: 'history section marked current' };
  const lead = sections.find((s) => !/history/i.test(s.heading))?.docs.find(isAdopted);
  if (lead) return { doc: lead, rule: 'first adopted document listed' };
  const all = sections.flatMap((s) => s.docs).filter((d) => !isComments(d));
  const newest = (list) => [...list].sort((a, b) => ms(b.published) - ms(a.published))[0];
  const adopted = newest(all.filter(isAdopted));
  if (adopted) return { doc: adopted, rule: 'most recent adopted document' };
  const unmarked = newest(all.filter((d) => !isDraftLike(d)));
  if (unmarked) return { doc: unmarked, rule: 'most recent document without a draft status' };
  const draft = newest(all);
  if (draft) return { doc: draft, rule: 'most recent draft (no adopted version listed)' };
  return { doc: null, rule: 'no document listed' };
}

// ---------------------------------------------------------------- fetching

class RateLimited extends Error {}
const BASE_PAUSE = Number(process.env.PAUSE_MS) || 6000;
let pause = BASE_PAUSE;
let streak = 0;

async function get(url, as = 'text') {
  for (let limited = 0, attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA } });
    } catch (err) {
      if (attempt >= 3) return { status: 0, error: String(err.message ?? err) };
      await sleep(3000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      if (++limited >= 5) throw new RateLimited(`EMA is still answering ${res.status} after ${limited} waits.`);
      const asked = Number(res.headers.get('retry-after'));
      const wait = Math.min(300, Number.isFinite(asked) && asked > 0 ? asked : 45 * limited) * 1000;
      pause = Math.min(15000, pause * 2);
      streak = 0;
      console.log(`  ${res.status}: waiting ${wait / 1000}s, then one request every ${pause / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) return { status: res.status, error: `HTTP ${res.status}` };
    if (++streak % 20 === 0 && pause > BASE_PAUSE) pause = Math.max(BASE_PAUSE, Math.round(pause * 0.8));
    const body = as === 'bytes' ? Buffer.from(await res.arrayBuffer()) : await res.text();
    return { status: res.status, url: res.url, type: res.headers.get('content-type'), body };
  }
}

const pdftotext = (pdf, txt) =>
  new Promise((done) => execFile('pdftotext', ['-enc', 'UTF-8', pdf, txt], (err) => done(!err)));

function runDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runDirectly()) {
  const out = resolve((process.env.OUT_DIR || resolve(root, '.cache', 'guidelines')).replace(/^~(?=\/|$)/, homedir()));
  await mkdir(resolve(out, 'pdf'), { recursive: true });
  await mkdir(resolve(out, 'text'), { recursive: true });
  const manifestFile = resolve(out, 'manifest.json');
  const rows = JSON.parse(await readFile(resolve(root, 'data', 'guidelines.json'), 'utf8'));

  /** @type {Object<string, any>} */
  let manifest = {};
  try {
    manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  } catch {}
  const save = () => writeFile(manifestFile, JSON.stringify(manifest, null, 1));
  // Stopped with Ctrl-C (or killed): keep what was read since the last save.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => save().finally(() => process.exit(130)));
  }

  // Same ids as the app; a suffix on the rare collision, in dataset order.
  const ids = new Map();
  const used = new Set();
  for (const r of rows) {
    let id = idFromUrl(r.url);
    for (let n = 2; used.has(id); n++) id = `${idFromUrl(r.url)}-${n}`;
    used.add(id);
    ids.set(r.url, id);
  }

  // Entries saved by an earlier version of the rules: keep the page, refetch the document if the choice changed.
  for (const r of rows) {
    const e = manifest[r.url];
    if (!e?.sections) continue;
    const { doc, rule } = chooseDocument(e);
    if (doc?.href !== e.chosen?.href) {
      Object.assign(e, { chosen: doc, rule, file: undefined, text: undefined, bytes: undefined, final: !doc });
      e.refetch = true;
    } else e.rule = rule;
  }
  let todo = rows.filter((r) => !manifest[r.url]?.file && !manifest[r.url]?.final);
  // SPREAD=1 visits the list in an order spread across it (every 37th first), so an
  // early stop still leaves a sample of the whole collection rather than its newest part.
  if (process.env.SPREAD) todo = todo.map((r, i) => [((i * 37) % todo.length) + i / todo.length, r]).sort((a, b) => a[0] - b[0]).map(([, r]) => r);
  console.log(`${rows.length - todo.length} guidelines already done; ${todo.length} to fetch. Saving to ${out}`);
  let done = 0;
  try {
    for (const row of todo) {
      const id = ids.get(row.url);
      const entry = { id, title: row.title, category: row.category };
      const known = manifest[row.url]?.refetch ? manifest[row.url] : null;
      const page = known ? { body: null } : await get(row.url);
      if (!known) await sleep(pause);
      if (known) {
        Object.assign(entry, { summary: known.summary, sections: known.sections, chosen: known.chosen, rule: known.rule });
      } else if (!page.body) {
        Object.assign(entry, { error: `page: ${page.error}`, final: page.status === 404 || page.status === 410 });
      } else {
        const parsed = parseGuidelinePage(page.body);
        const { doc, rule } = chooseDocument(parsed);
        Object.assign(entry, { summary: parsed.summary, sections: parsed.sections, chosen: doc, rule });
      }
      if (entry.sections) {
        const doc = entry.chosen;
        if (!doc) {
          entry.final = true;
        } else {
          const file = await get(doc.href, 'bytes');
          await sleep(pause);
          if (!file.body) {
            entry.error = `document: ${file.error}`;
          } else if (file.body.subarray(0, 5).toString() !== '%PDF-') {
            entry.error = `document is not a PDF (${file.type})`;
            entry.final = true;
          } else {
            const pdf = resolve(out, 'pdf', `${id}.pdf`);
            await writeFile(pdf, file.body);
            entry.file = `pdf/${id}.pdf`;
            entry.bytes = file.body.length;
            if (await pdftotext(pdf, resolve(out, 'text', `${id}.txt`))) entry.text = `text/${id}.txt`;
          }
        }
      }
      manifest[row.url] = entry;
      if (++done % 10 === 0) {
        await save();
        console.log(`  ${done} / ${todo.length}`);
      }
    }
  } catch (err) {
    if (!(err instanceof RateLimited)) throw err;
    console.log(`Stopped: ${err.message} Run again later to continue.`);
  }
  await save();
  const entries = Object.values(manifest);
  const files = entries.filter((e) => e.file).length;
  const bytes = entries.reduce((n, e) => n + (e.bytes ?? 0), 0);
  console.log(`${files} of ${rows.length} guidelines saved (${(bytes / 1e6).toFixed(0)} MB).`);
  const problems = entries.filter((e) => e.error || !e.chosen);
  if (problems.length) console.log(`${problems.length} without a document; see "error" and "rule" in manifest.json.`);
  const rules = entries.reduce((m, e) => ((m[e.rule] = (m[e.rule] ?? 0) + 1), m), {});
  console.log('Chosen by:', rules);
}
