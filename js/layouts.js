/**
 * Layouts: pure functions from records to 3D positions plus the guide lines
 * and labels that explain the space. No rendering code lives here, so every
 * layout can be unit-tested without a GPU.
 *
 * World units: one dot is about 0.8 units across.
 */
const TAU = Math.PI * 2;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * @typedef {Object} Label
 * @property {string} text
 * @property {string} [sub]   secondary line (a count, for example)
 * @property {'axis'|'minor'|'lane'|'group'} kind
 * @property {[number,number,number]} at
 *
 * @typedef {Object} Layout
 * @property {Float32Array} positions  xyz per record, indexed by record.i
 * @property {Float32Array} lines      xyz pairs for guide line segments
 * @property {Label[]} labels
 * @property {[number,number,number]} center  what the camera looks at
 * @property {{w:number,h:number,left?:number}} fit  half-extents of the silhouette from the home view,
 *                                              plus px to keep clear on the left for row labels
 * @property {{phi:number,theta:number}} view home camera angles (polar from +Y, azimuth)
 */

/** Which record fields carry each date basis. Labels come from the dataset. */
export const BASIS_FIELDS = {
  pub: { key: 'pubY', ms: 'pub' },
  last: { key: 'lastY', ms: 'last' },
};

/** 0 for records that pass the filters, 1 for the rest: matches are seated first. */
const seat = (mask) => (mask ? (r) => (mask[r.i] ? 0 : 1) : () => 0);

/** Year span covered by the data on either basis: [first year, last year]. */
export function yearExtent(records) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of records) {
    lo = Math.min(lo, Math.floor(r.pubY));
    hi = Math.max(hi, Math.floor(r.lastY), Math.floor(r.pubY));
  }
  return [lo, hi];
}

/**
 * Years worth labelling, most important first. The stage drops later labels
 * that would collide with earlier ones, so a small screen keeps the ends and
 * the decades and a large one shows every fifth year.
 */
export function yearTicks(y0, y1) {
  const fives = [];
  for (let y = Math.ceil(y0 / 5) * 5; y <= y1; y += 5) fives.push(y);
  const latest = fives[fives.length - 1] ?? y1;
  const ranked = [y0, latest, ...fives.filter((y) => y % 10 === 0), ...fives];
  return [...new Set(ranked)].filter((y) => y === y0 || y - y0 >= 3);
}

/* ------------------------------ spiral ------------------------------ */

function spiral(records, basis, [y0, y1], out, rank) {
  const R0 = 5; // radius where the first year starts
  const DR = 1.0; // radial gain per year
  const SLOT = 0.9; // arc length given to one stack
  const RISE = 0.82; // vertical step inside a stack
  const positions = new Float32Array(records.length * 3);
  const years = y1 - y0 + 1;

  /** @type {Map<number, any[]>} */
  const stacks = new Map();
  for (const r of records) {
    const t = r[basis.key];
    const ring = Math.floor(t) - y0;
    const n = Math.max(12, Math.floor((TAU * (R0 + (ring + 0.5) * DR)) / SLOT));
    const slot = Math.min(n - 1, Math.floor((t - Math.floor(t)) * n));
    const key = ring * 4096 + slot;
    if (!stacks.has(key)) stacks.set(key, []);
    stacks.get(key).push({ r, ring, slot, n });
  }
  let tallest = 0;
  for (const stack of stacks.values()) {
    stack.sort((a, b) => out(a.r) - out(b.r) || rank(a.r) - rank(b.r) || a.r[basis.ms] - b.r[basis.ms]);
    tallest = Math.max(tallest, stack.length);
    stack.forEach(({ r, ring, slot, n }, level) => {
      const f = (slot + 0.5) / n;
      const rad = R0 + (ring + f) * DR;
      positions[r.i * 3] = rad * Math.sin(f * TAU);
      positions[r.i * 3 + 1] = 0.4 + level * RISE;
      positions[r.i * 3 + 2] = -rad * Math.cos(f * TAU);
    });
  }

  // The spiral itself, as short segments.
  const STEPS = 96;
  const lines = [];
  const pt = (t) => {
    const rad = R0 + t * DR;
    return [rad * Math.sin(t * TAU), 0, -rad * Math.cos(t * TAU)];
  };
  for (let s = 0; s < years * STEPS; s++) lines.push(...pt(s / STEPS), ...pt((s + 1) / STEPS));
  const rOut = R0 + years * DR;
  // Month spokes just outside the last turn.
  for (let m = 0; m < 12; m++) {
    const a = (m / 12) * TAU;
    lines.push((rOut + 0.8) * Math.sin(a), 0, -(rOut + 0.8) * Math.cos(a), (rOut + 2) * Math.sin(a), 0, -(rOut + 2) * Math.cos(a));
  }

  /** @type {Label[]} */
  const labels = [];
  for (const y of yearTicks(y0, y1)) labels.push({ text: String(y), kind: 'axis', at: [0, 0, -(R0 + (y - y0) * DR)] });
  for (let m = 0; m < 12; m++) {
    const a = ((m + 0.5) / 12) * TAU;
    labels.push({ text: MONTHS[m], kind: 'minor', at: [(rOut + 3.4) * Math.sin(a), 0, -(rOut + 3.4) * Math.cos(a)] });
  }

  return {
    positions,
    lines: new Float32Array(lines),
    labels,
    center: [0, Math.min(3, tallest * RISE * 0.25), 4.5],
    fit: { w: rOut + 7, h: (rOut + 7) * 0.76 },
    view: { phi: 0.86, theta: 0 },
  };
}

/* ------------------------------ skyline ------------------------------ */

/**
 * @param {{lanes:{id:string,label:string}[], laneOf:(r:any)=>string}} rows back row first; the
 *   last lane stands at the front, so list the tallest first.
 */
function skyline(records, basis, [y0, y1], out, rank, rows) {
  const LANES = rows.lanes;
  const DX = 0.8;
  const DY = 0.8;
  const LANE = 4.2; // distance between rows
  const years = y1 - y0 + 1;
  const positions = new Float32Array(records.length * 3);

  /** @type {Map<string, any[]>} */
  const columns = new Map();
  for (const r of records) {
    const key = `${Math.floor(r[basis.key])}|${rows.laneOf(r)}`;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key).push(r);
  }
  // Wide enough that the busiest column stays under about 38 storeys.
  let busiest = 0;
  for (const column of columns.values()) busiest = Math.max(busiest, column.length);
  const COLS = Math.max(2, Math.ceil(busiest / 38)); // dots per storey
  const PITCH = COLS * DX + 0.7; // one year
  const xOf = (year) => (year - y0 - (years - 1) / 2) * PITCH;
  const zOf = (lane) => (LANES.findIndex((l) => l.id === lane) - (LANES.length - 1) / 2) * LANE;
  let top = 0;
  for (const [key, column] of columns) {
    const [year, lane] = key.split('|');
    column.sort((a, b) => out(a) - out(b) || rank(a) - rank(b) || a[basis.ms] - b[basis.ms]);
    column.forEach((r, j) => {
      const y = 0.45 + Math.floor(j / COLS) * DY;
      top = Math.max(top, y);
      positions[r.i * 3] = xOf(+year) + ((j % COLS) - (COLS - 1) / 2) * DX;
      positions[r.i * 3 + 1] = y;
      positions[r.i * 3 + 2] = zOf(lane);
    });
  }

  const x0 = xOf(y0) - PITCH / 2;
  const x1 = xOf(y1) + PITCH / 2;
  const zFront = zOf(LANES[LANES.length - 1].id) + LANE * 0.55;
  const lines = [];
  for (const lane of LANES) lines.push(x0, 0, zOf(lane.id), x1, 0, zOf(lane.id));
  for (let y = y0; y <= y1; y++) {
    const long = y % 5 === 0 || y === y0;
    lines.push(xOf(y), 0, zFront, xOf(y), 0, zFront + (long ? 1.1 : 0.45));
  }

  /** @type {Label[]} */
  const labels = [];
  for (const y of yearTicks(y0, y1)) labels.push({ text: String(y), kind: 'axis', at: [xOf(y), 0, zFront + 2.4] });
  for (const lane of LANES) labels.push({ text: lane.label, kind: 'lane', at: [x0 - 1.2, 0, zOf(lane.id)] });

  return {
    positions,
    lines: new Float32Array(lines),
    labels,
    center: [0, top * 0.36, 0],
    fit: { w: (x1 - x0) / 2 + 4, h: Math.max(14, top * 0.6 + 7), left: 8 + 7 * Math.max(...LANES.map((l) => l.label.length)) },
    view: { phi: 1.18, theta: -0.24 },
  };
}

/* ------------------------------ groups ------------------------------ */

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

/**
 * Greedy circle packing, largest first, biased toward a wide footprint so the
 * result suits a landscape stage. Deterministic for a given input.
 * @param {{id:string,r:number}[]} circles sorted largest first
 * @returns {Map<string,{x:number,z:number,r:number}>}
 */
export function packCircles(circles, gap = 4.6, stretch = 1.5) {
  const placed = [];
  const out = new Map();
  for (const c of circles) {
    let best = null;
    if (!placed.length) best = { x: 0, z: 0 };
    else {
      for (const p of placed) {
        const d = p.r + c.r + gap;
        for (let k = 0; k < 72; k++) {
          const a = (k / 72) * TAU;
          const cand = { x: p.x + d * Math.cos(a), z: p.z + d * Math.sin(a) };
          if (placed.some((q) => Math.hypot(q.x - cand.x, q.z - cand.z) < q.r + c.r + gap - 1e-6)) continue;
          const cost = Math.hypot(cand.x, cand.z * stretch);
          if (!best || cost < best.cost) best = { ...cand, cost };
        }
      }
    }
    const spot = { x: best.x, z: best.z, r: c.r };
    placed.push(spot);
    out.set(c.id, spot);
  }
  return out;
}

/**
 * Clusters of dots, one per category.
 * @param {{keyOf:(r:any)=>string, defs:{id:string,short:string}[], last?:string}} by `last` names a
 *   catch-all category that is placed after the others, so it sits at the edge, not the centre.
 */
function clusters(records, basis, out, by) {
  const SPREAD = 0.56; // phyllotaxis constant: dot spacing ≈ 1 unit
  const positions = new Float32Array(records.length * 3);
  /** @type {Map<string, any[]>} */
  const members = new Map();
  for (const r of records) {
    const key = by.keyOf(r);
    if (!members.has(key)) members.set(key, []);
    members.get(key).push(r);
  }
  const short = Object.fromEntries(by.defs.map((d) => [d.id, d.short]));
  const circles = by.defs.filter((g) => members.has(g.id))
    .map((g) => ({ id: g.id, r: SPREAD * Math.sqrt(members.get(g.id).length) + 0.6 }))
    .sort((a, b) => (a.id === by.last) - (b.id === by.last) || b.r - a.r || a.id.localeCompare(b.id));
  const spots = packCircles(circles);

  // Recentre on the packed footprint.
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const s of spots.values()) {
    minX = Math.min(minX, s.x - s.r); maxX = Math.max(maxX, s.x + s.r);
    minZ = Math.min(minZ, s.z - s.r); maxZ = Math.max(maxZ, s.z + s.r);
  }
  const cx = (minX + maxX) / 2;
  const cz = (minZ + maxZ) / 2;

  const lines = [];
  /** @type {Label[]} */
  const labels = [];
  let peak = 0;
  for (const [id, spot] of spots) {
    const list = members.get(id).slice().sort((a, b) => out(a) - out(b) || b[basis.ms] - a[basis.ms] || a.i - b.i);
    const x0 = spot.x - cx;
    const z0 = spot.z - cz;
    const dome = spot.r * 0.42;
    peak = Math.max(peak, dome);
    list.forEach((r, j) => {
      const rad = SPREAD * Math.sqrt(j + 0.5);
      const a = j * GOLDEN;
      const k = rad / spot.r;
      positions[r.i * 3] = x0 + rad * Math.cos(a);
      positions[r.i * 3 + 1] = 0.4 + dome * (1 - k * k);
      positions[r.i * 3 + 2] = z0 + rad * Math.sin(a);
    });
    const SEG = 64;
    for (let s = 0; s < SEG; s++) {
      const a = (s / SEG) * TAU;
      const b = ((s + 1) / SEG) * TAU;
      lines.push(x0 + spot.r * Math.cos(a), 0, z0 + spot.r * Math.sin(a), x0 + spot.r * Math.cos(b), 0, z0 + spot.r * Math.sin(b));
    }
    labels.push({
      text: short[id],
      sub: String(list.length),
      kind: 'group',
      at: [x0, 0, z0 + spot.r + 1.1],
    });
  }

  return {
    positions,
    lines: new Float32Array(lines),
    labels,
    center: [0, peak * 0.3, 1.5],
    fit: { w: (maxX - minX) / 2 + 5, h: ((maxZ - minZ) / 2 + 5) * 0.8 + 2 },
    view: { phi: 0.74, theta: 0 },
  };
}

/**
 * @typedef {Object} LayoutSpec  how a dataset wants one arrangement built
 * @property {'spiral'|'skyline'|'clusters'} kind
 * @property {(r:any)=>number} [rank]  order inside a stack, so colour bands line up
 * @property {{id:string,label:string}[]} [lanes]  skyline rows, back first
 * @property {(r:any)=>string} [laneOf]
 * @property {(r:any)=>string} [keyOf]  cluster a record belongs to
 * @property {{id:string,short:string}[]} [defs]  the clusters, in display order
 * @property {string} [last]  catch-all cluster, placed at the edge
 */

/**
 * @param {LayoutSpec} spec
 * @param {any[]} records each with i, pub, last, pubY, lastY
 * @param {'pub'|'last'} basisId
 * @param {Uint8Array} [mask] filter result. The set of positions never changes; within each
 *   stack, column or cluster the matching records take the first seats (the base, or the
 *   centre), so a filtered view reads as a bar inside the full bar.
 * @returns {Layout}
 */
export function computeLayout(spec, records, basisId, mask) {
  const basis = BASIS_FIELDS[basisId];
  const extent = yearExtent(records);
  const out = seat(mask);
  const rank = spec.rank ?? (() => 0);
  if (spec.kind === 'skyline') return skyline(records, basis, extent, out, rank, { lanes: spec.lanes, laneOf: spec.laneOf });
  if (spec.kind === 'clusters') return clusters(records, basis, out, { keyOf: spec.keyOf, defs: spec.defs, last: spec.last });
  return spiral(records, basis, extent, out, rank);
}
