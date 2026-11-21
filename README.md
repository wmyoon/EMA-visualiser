# Regulatory Atlas

An unofficial 3D explorer for the European Medicines Agency's
[open website data](https://www.ema.europa.eu/en/about-us/about-website/download-website-data-json-data-format).
Every record is one dot. The same records are always available as a
searchable, keyboard-friendly list beside the map.

Two datasets so far, switched from the tabs under the title:

| Dataset | Records | EMA file |
|---|---|---|
| **Guidelines** | 1,001 scientific guidelines | `scientific-guidelines-output-json-report_en.json` |
| **Medicines** | 2,765 medicines and applications | `medicines-output-medicines_json-report_en.json` |

Not affiliated with EMA. Links go to the pages on ema.europa.eu.

## Run it

```bash
npm start
```

Then open http://localhost:4173. There is no build step and no dependency to
install: the app is native ES modules. three.js and the two fonts are bundled in
`vendor/`, so the page makes no request beyond its own folder. Any static file
server works.

```bash
npm test
```

## Mac app

```bash
npm run build:mac
```

Builds `macos/build/Regulatory Atlas.app`, a native macOS app (about 6 MB)
that shows the same page in a window and works offline. It needs macOS 12 or
later and Apple's Command Line Tools (`xcode-select --install`), not Xcode.
Add `-- --install` to copy it to /Applications, `-- --universal` to build for
both Apple silicon and Intel, `-- --open` to launch it.

The app is a small Swift program, [`macos/RegulatoryAtlas.swift`](macos/RegulatoryAtlas.swift):
a WebKit view serving the page from inside the app bundle. Links to
ema.europa.eu open in your default browser. It carries a snapshot of `data/`
from build time; run `npm run update-data` and build again to refresh it.

The app is signed ad hoc for the Mac that built it. Copied to another Mac,
macOS will refuse to open it until it is allowed in System Settings ▸ Privacy &
Security; sharing it widely would need an Apple Developer ID and notarisation.

## What you can do

| | |
|---|---|
| **Arrangements** | *Spiral*: one turn per year, January at the top, stacks where records share a few days. *Skyline*: one column per year, with rows by audience (guidelines) or outcome (medicines). *Clusters*: guidelines by subject or disease area; medicines by ATC class. |
| **Two date bases** | Place by the record's primary date or by its last update. The year filter follows the same choice. |
| **Colour** | Guidelines: audience or update age. Medicines: status, type (generic, biosimilar, orphan), audience or update age. |
| **Search and filter** | Free-text search, chips with live counts, and a year range. Matches re-seat at the base of each stack so a filter reads as a bar inside the full bar. |
| **Detail card** | Dates, a lifetime bar, the EMA link, and related records. For a guideline: the guidelines that reference it and the ones it refers to, also drawn as arcs on the map. For a medicine: every dated milestone and other medicines with the same active substance. |
| **Deep links** | `#g-<id>` selects a guideline, `#m-<id>` a medicine, `#medicines` opens that dataset. |

Controls: drag to orbit, scroll or pinch to zoom toward the pointer, right-drag
or Shift-drag to pan. `/` search, number keys for arrangements, `J` `K` step
through results, `Esc` close.

## What is EMA data and what is derived

### Guidelines

The export has five fields: `title`, `category`, `first_published_date`,
`last_updated_date` and `url`. Three things are **inferred from the title** and
labelled as such in the interface:

- **Subject** (Clinical, Quality, ICH, …): ordered keyword rules in
  [`js/classify.js`](js/classify.js). About 4% of titles match no rule and land
  in "Other". Treat the grouping as a navigation aid, not a classification.
- **Disease area** (Oncology, Cardiovascular, Infections, …): ordered keyword
  rules in [`js/areas.js`](js/areas.js). A title is assigned only when it names
  a disease, organ system or condition; in this snapshot that is 435 of 1,001
  guidelines, and the other 566 are shown as "No disease named".
  Product-specific bioequivalence guidances are titled by substance alone, so
  they are mapped through a hand-written substance table giving each one's main
  use. That table reflects general pharmacology knowledge, not EMA data.
- **Code** (`Q3D`, `E6(R3)`, `GL49`): parsed from ICH and VICH titles.

**References between guidelines** are not in the export. They come from
`data/guideline-links.json`, built by `scripts/update-links.mjs`, which reads
each guideline's page on ema.europa.eu once and keeps the links inside the
page's main content that point at another guideline in the dataset. So
"Referenced by" means *another guideline's EMA page links to this one*. It does
not cover citations that appear only inside the PDF documents.

The bundled link map covers all 1,001 guideline pages: 407 of them link to
another guideline, 1,196 links in all (see `data/guideline-links.meta.json`).
Running `npm run update-links` rebuilds it from the current EMA pages.

### Medicines

Almost everything shown is an EMA field, verbatim. Two things are derived:

- **Class** is the first level of the ATC or ATCvet code. Where EMA lists no
  code (most veterinary medicines), it is read from the pharmacotherapeutic
  group text when that names a class; otherwise the medicine is under "No ATC
  code". The detail card says which applies.
- **Outcome** groups EMA's ten statuses into four for colour and skyline rows:
  authorised; ended or suspended; not authorised (refused or application
  withdrawn); awaiting decision. The filter chips use EMA's own ten.

Each medicine is placed in time by one date: its marketing authorisation date;
for a refused or withdrawn application, the refusal or withdrawal date; for an
opinion, the opinion date. Where EMA gives none of these (about 320 medicines,
mostly veterinary), the date its EMA page was first published is used, and the
detail card says so. Those page dates cluster in 2017–2018, when the pages were
republished, so that bump in the veterinary timeline is not a real surge.

## Refresh the data

```bash
npm run update-data
```

Downloads the current EMA files and rewrites `data/<dataset>.json` (one record
per line) and `data/<dataset>.meta.json`. Empty fields and "No" flags are left
out to keep the files small; everything else is as EMA publishes it.

```bash
npm run update-links
```

Rebuilds the guideline reference map. It makes about a thousand page requests
to ema.europa.eu, one every three seconds, so a full run takes about an hour.
If EMA answers "too many requests" it waits, slows down, and stops cleanly if
the refusals persist. Pages already read are kept in `.cache/` (not committed),
so running it again on the same machine only asks for the pages still missing.
It never replaces the bundled map with one built from fewer pages (a run cut
short by EMA, say); it leaves the files alone and says so. Add `--force` to
override that.

```bash
npm run vendor
```

Downloads three.js and the Archivo and IBM Plex Mono fonts into `vendor/`. The
files are committed, so run this only to change versions (set in
`scripts/vendor.mjs`). Licences are kept next to the files.

## Layout of the code

```
index.html              page shell
css/app.css             design tokens (light and dark) and all styles
js/main.js              mounts one dataset at a time; state, keyboard, deep links
js/datasets/index.js    the datasets on offer
js/datasets/*.js        one definition per dataset: fields, facets, colours, arrangements, card
js/data.js              dates, loading, filtering, sorting           (pure, tested)
js/classify.js          guideline title → subject and code           (pure, tested)
js/areas.js             guideline title → disease area               (pure, tested)
js/layouts.js           records → 3D positions, guides, labels       (pure, tested)
js/encodings.js         colour modes, read from the CSS tokens
js/scene.js             WebGL stage: points shader, picking, labels, link arcs
js/camera.js            orbit / pan / zoom rig
js/ui/*.js              sidebar, virtualised list, detail card, stage controls
scripts/                dev server, data refresh, guideline link map, vendoring
vendor/                 three.js and fonts, with their licences
macos/                  Mac app: Swift source, icon, build script
tests/                  node:test suites for the pure modules
```

Adding another EMA dataset means one new file in `js/datasets/` (use
`guidelines.js` as the template), an entry in `js/datasets/index.js` and in
`scripts/update-data.mjs`. The list, filters, stage and card are generic.

## Notes on behaviour

- The map renders on demand, in one draw call per dataset, and idles at zero GPU work.
- The medicines file is about 3.4 MB and is fetched only when that tab is opened.
- Colours come from CSS custom properties, so the map follows the page theme.
  The three categorical hues were checked for colour-vision-deficiency
  separation on both backgrounds; what they encode is also written out in the
  list and detail card.
- `prefers-reduced-motion` turns off the opening animation and all morphs.
- Without WebGL the list, filters and detail card still work.
