// Downloads the two third-party resources the page uses into vendor/, so the
// app runs offline and makes no request to a CDN or to Google Fonts:
//   three.js (MIT)                     → vendor/three/
//   Archivo, IBM Plex Mono (SIL OFL)  → vendor/fonts/  (Latin and Latin Extended subsets)
// Run it again only to change versions:  npm run vendor
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const THREE = '0.170.0';
const FONTS = 'https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..800&family=IBM+Plex+Mono:wght@400;500&display=swap';
const KEEP = new Set(['latin', 'latin-ext']);
// Google Fonts picks the file format from the User-Agent; this one gets WOFF2.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

const root = fileURLToPath(new URL('../vendor/', import.meta.url));

async function get(url, as = 'text') {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return as === 'bytes' ? Buffer.from(await res.arrayBuffer()) : res.text();
}

async function three() {
  await mkdir(`${root}three`, { recursive: true });
  const base = `https://cdnjs.cloudflare.com/ajax/libs/three.js/${THREE}`;
  await writeFile(`${root}three/three.module.min.js`, await get(`${base}/three.module.min.js`));
  const licence = await get(`https://raw.githubusercontent.com/mrdoob/three.js/r${THREE.split('.')[1]}/LICENSE`);
  await writeFile(`${root}three/LICENSE`, licence);
  console.log(`three.js ${THREE}`);
}

async function fonts() {
  await mkdir(`${root}fonts`, { recursive: true });
  const css = await get(FONTS);
  const out = [];
  // Each block is "/* subset */\n@font-face { … }".
  for (const [, subset, body] of css.matchAll(/\/\*\s*([\w-]+)\s*\*\/\s*(@font-face\s*{[^}]*})/g)) {
    if (!KEEP.has(subset)) continue;
    const family = /font-family:\s*'([^']+)'/.exec(body)[1];
    const weight = /font-weight:\s*([^;]+);/.exec(body)[1].replace(/\s+/g, '-');
    const src = /url\(([^)]+)\)/.exec(body)[1];
    const file = `${family.toLowerCase().replace(/\s+/g, '-')}-${weight}-${subset}.woff2`;
    await writeFile(`${root}fonts/${file}`, await get(src, 'bytes'));
    out.push(`/* ${family}, ${subset} */\n${body.replace(src, `./${file}`)}`);
  }
  if (out.length !== 6) throw new Error(`expected 6 font faces, got ${out.length}`);
  await writeFile(`${root}fonts/fonts.css`,
    `/* Archivo and IBM Plex Mono, from Google Fonts, under the SIL Open Font License 1.1 (OFL-Archivo.txt, OFL-IBM-Plex.txt). */\n\n${out.join('\n\n')}\n`);
  await writeFile(`${root}fonts/OFL-Archivo.txt`, await get('https://raw.githubusercontent.com/google/fonts/main/ofl/archivo/OFL.txt'));
  await writeFile(`${root}fonts/OFL-IBM-Plex.txt`, await get('https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexmono/OFL.txt'));
  console.log(`${out.length} font faces`);
}

await three();
await fonts();
