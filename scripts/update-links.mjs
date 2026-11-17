#!/usr/bin/env node
/**
 * Builds data/guideline-links.json: which guideline pages on ema.europa.eu
 * link to which other guideline pages.
 *
 *   node scripts/update-links.mjs
 *
 * The EMA export has no cross-references, so this reads each guideline's own
 * page (the URL in data/guidelines.json) once, looks only inside <main>, and
 * keeps the links that point at another guideline in the dataset. Older link
 * forms (".../<slug>-scientific-guideline") are matched by slug, and links that
 * still do not match are followed once to see where EMA redirects them.
 *
 * It is deliberately slow and polite: one request at a time with a pause
 * between them (three seconds unless PAUSE_MS says otherwise). EMA answers HTTP 429 when asked too fast; the script then waits
 * (Retry-After if given), slows down further, and gives up cleanly if the
 * limit persists. Every page read is remembered in .cache/guideline-pages.json,
 * so a second run only asks for the pages still missing. Delete that file to
 * start afresh. Behind a proxy, run with NODE_USE_ENV_PROXY=1.
 *
 * It never replaces the map in data/ with one built from fewer pages than the
 * map already there covers, which is what a run cut short by EMA would
 * otherwise do. It says so and leaves the files alone. Pass --force to write
 * the smaller map anyway.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ORIGIN = 'https://www.ema.europa.eu';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = resolve(root, 'data');
const cacheFile = resolve(root, '.cache', 'guideline-pages.json');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const BASE_PAUSE = Number(process.env.PAUSE_MS) || 3000;
let pause = BASE_PAUSE; // doubles when EMA asks us to slow down, eases back after a run of successes
let streak = 0;
const MAX_PAUSE = 15000;
const GIVE_UP_AFTER = 5; // rate-limit answers in a row for one page

/** The guideline slug a link points at, whichever URL form it uses; null for anything else. */
export function slugOf(href, base = ORIGIN) {
  let u;
  try {
    u = new URL(href.replace(/&amp;/g, '&'), base);
  } catch {
    return null;
  }
  if (u.hostname !== 'www.ema.europa.eu' && u.hostname !== 'ema.europa.eu') return null;
  const path = decodeURIComponent(u.pathname).replace(/^\/en(?=\/)/, '').replace(/\/+$/, '');
  if (path.startsWith('/scientific-guidelines/')) return path.slice('/scientific-guidelines/'.length) || null;
  const old = /^\/([^/]+)-scientific-guideline$/.exec(path);
  return old ? old[1] : null;
}

/** Every link target inside the page's <main> element. */
export function mainLinks(html) {
  const main = /<main\b[\s\S]*?<\/main>/i.exec(html)?.[0] ?? '';
  return [...main.matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"]+)"/gi)].map((m) => m[1]);
}

class RateLimited extends Error {}

/** One page. Throws RateLimited when EMA keeps answering 429. */
async function get(url) {
  for (let limited = 0, attempt = 1; ; attempt++) {
    let res;
    try {
      res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'guideline-link-map/1.0 (one-off research script)' } });
    } catch (err) {
      if (attempt >= 3) return { status: 0, url, text: '', error: String(err.message ?? err) };
      await sleep(3000 * attempt);
      continue;
    }
    if (res.status === 429 || res.status === 503) {
      if (++limited >= GIVE_UP_AFTER) throw new RateLimited(`EMA is still answering ${res.status} after ${limited} waits.`);
      const asked = Number(res.headers.get('retry-after'));
      const wait = Math.min(300, Number.isFinite(asked) && asked > 0 ? asked : 45 * limited) * 1000;
      pause = Math.min(MAX_PAUSE, pause * 2);
      streak = 0;
      console.log(`  ${res.status}: waiting ${wait / 1000}s, then one request every ${pause / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (res.status === 404 || res.status === 410) return { status: res.status, url: res.url, text: '' };
    if (!res.ok) return { status: res.status, url: res.url, text: '', error: `HTTP ${res.status}` };
    if (++streak % 20 === 0 && pause > BASE_PAUSE) pause = Math.max(BASE_PAUSE, Math.round(pause * 0.8));
    return { status: res.status, url: res.url, text: await res.text() };
  }
}

/**
 * Whether a map built from `read` pages may replace the existing one.
 * @param {{pages_read?: unknown}|null} existing  the current meta file, if any
 */
export function mayReplace(existing, read, force = false) {
  const before = Number(existing?.pages_read);
  return force || !Number.isFinite(before) || read >= before;
}

/** True when this file was started with `node`, not imported. Works on Windows and with spaces in the path. */
function runDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runDirectly()) {
  const rows = JSON.parse(await readFile(resolve(dataDir, 'guidelines.json'), 'utf8'));
  const urlBySlug = new Map(rows.map((r) => [slugOf(r.url), r.url]));

  /** @type {{pages: Object<string,string[]>, alias: Object<string,string|null>}} what earlier runs already read */
  let cache = { pages: {}, alias: {} };
  try {
    cache = { ...cache, ...JSON.parse(await readFile(cacheFile, 'utf8')) };
  } catch {
    /* first run */
  }
  const save = async () => {
    await mkdir(dirname(cacheFile), { recursive: true });
    await writeFile(cacheFile, JSON.stringify(cache));
  };

  const todo = rows.filter((r) => !(r.url in cache.pages));
  const failed = [];
  let stopped = null;
  console.log(`${rows.length - todo.length} pages already read; reading ${todo.length} more, one every ${pause / 1000}s…`);
  try {
    for (const [n, row] of todo.entries()) {
      const page = await get(row.url);
      if (page.text) {
        const own = slugOf(row.url);
        cache.pages[row.url] = [...new Set(mainLinks(page.text).map((h) => slugOf(h)).filter((s) => s && s !== own))];
      } else failed.push({ url: row.url, reason: page.error ?? `HTTP ${page.status}` });
      if ((n + 1) % 25 === 0) {
        await save();
        console.log(`  ${n + 1} / ${todo.length}`);
      }
      await sleep(pause);
    }

    // Slugs that are not in the dataset as written: see where EMA sends them.
    const unknown = [...new Set(Object.values(cache.pages).flat())].filter((s) => !urlBySlug.has(s) && !(s in cache.alias));
    console.log(`Resolving ${unknown.length} link targets that do not match a dataset URL…`);
    for (const slug of unknown) {
      cache.alias[slug] = null;
      for (const candidate of [`${ORIGIN}/en/scientific-guidelines/${slug}`, `${ORIGIN}/en/${slug}-scientific-guideline`]) {
        const page = await get(candidate);
        await sleep(pause);
        const landed = page.status === 200 ? slugOf(page.url) : null;
        if (landed && urlBySlug.has(landed)) {
          cache.alias[slug] = landed;
          break;
        }
      }
    }
  } catch (err) {
    if (!(err instanceof RateLimited)) throw err;
    stopped = err.message;
  }
  await save();

  const records = [];
  let links = 0;
  for (const row of rows) {
    const slugs = cache.pages[row.url] ?? [];
    const to = [...new Set(slugs.map((s) => urlBySlug.get(cache.alias[s] ?? s)).filter((u) => u && u !== row.url))].sort();
    if (!to.length) continue;
    links += to.length;
    records.push({ from: row.url, to });
  }
  const read = rows.filter((r) => r.url in cache.pages).length;
  const metaFile = resolve(dataDir, 'guideline-links.meta.json');
  let existing = null;
  try {
    existing = JSON.parse(await readFile(metaFile, 'utf8'));
  } catch {
    /* no map yet */
  }
  if (!mayReplace(existing, read, process.argv.includes('--force'))) {
    console.log(`Read ${read} of ${rows.length} pages, fewer than the ${existing.pages_read} the current map covers.`);
    console.log('Left data/guideline-links.json and its meta file unchanged. Pages read are kept in .cache/ for the next run.');
    console.log('To write the smaller map anyway, run again with --force.');
    if (stopped) console.log(`Stopped early: ${stopped} Run again later to read the rest.`);
    for (const f of failed.slice(0, 20)) console.log(`  not read: ${f.url} (${f.reason})`);
    process.exit(0);
  }
  await writeFile(resolve(dataDir, 'guideline-links.json'), `[\n${records.map((r) => JSON.stringify(r)).join(',\n')}\n]\n`);
  await writeFile(
    metaFile,
    `${JSON.stringify(
      {
        description: 'Links between guideline pages on ema.europa.eu, read from the <main> element of each page.',
        crawled_at: new Date().toISOString(),
        pages_total: rows.length,
        pages_read: read,
        pages_with_links: records.length,
        links,
        unmatched_link_targets: Object.values(cache.alias).filter((v) => v === null).length,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Wrote ${links} links from ${records.length} pages. Read ${read} of ${rows.length} pages.`);
  if (stopped) console.log(`Stopped early: ${stopped} Run again later to read the rest.`);
  for (const f of failed.slice(0, 20)) console.log(`  not read: ${f.url} (${f.reason})`);
}
