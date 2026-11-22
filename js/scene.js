/**
 * The WebGL stage. One draw call for every guideline (a point cloud with a
 * small custom shader), guide lines per layout, and an HTML overlay for
 * labels, the hover tooltip and the selection ring, so text stays crisp and
 * follows the page theme.
 *
 * Renders on demand: a frame is drawn only while something is changing.
 */
import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitRig } from './camera.js';

const FOV = 32;
const DOT = 0.8; // world diameter of one guideline
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const VERT = /* glsl */ `
  attribute vec3 colorA;
  attribute vec3 colorB;
  attribute vec3 colorC;
  attribute float segs;
  attribute float vis;
  attribute float emph;
  uniform float uPx;
  uniform float uMinPx;
  uniform float uMaxPx;
  varying vec3 vA; varying vec3 vB; varying vec3 vC;
  varying float vSegs; varying float vVis; varying float vSize; varying float vDepth;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    // World-sized, but clamped: zooming in spreads dots apart instead of inflating them.
    float size = clamp(${DOT.toFixed(2)} * uPx / -mv.z, uMinPx, uMaxPx);
    gl_PointSize = size * mix(0.58, 1.0, vis) * (1.0 + emph * 0.7);
    vA = colorA; vB = colorB; vC = colorC;
    vSegs = segs; vVis = vis; vSize = gl_PointSize; vDepth = -mv.z;
  }
`;

const FRAG = /* glsl */ `
  uniform vec3 uSurface;
  uniform vec3 uDim;
  uniform float uDpr;
  uniform vec2 uHaze;
  varying vec3 vA; varying vec3 vB; varying vec3 vC;
  varying float vSegs; varying float vVis; varying float vSize; varying float vDepth;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = length(p);
    float aa = 2.0 / vSize;
    float alpha = 1.0 - smoothstep(1.0 - aa, 1.0, d);
    if (alpha < 0.02) discard;

    // A guideline for more than one audience is a split disc.
    vec3 col = vA;
    if (vSegs > 1.5) {
      float t = fract(atan(p.x, -p.y) / 6.2831853 + 1.0);
      float idx = floor(t * vSegs);
      col = idx < 0.5 ? vA : (idx < 1.5 ? vB : vC);
    }
    col = mix(uDim, col, vVis);

    // Surface-coloured rim so touching dots stay separate marks.
    float rimWidth = 1.3 * uDpr * 2.0 / vSize;
    float rim = smoothstep(1.0 - rimWidth - aa, 1.0 - rimWidth, d) * smoothstep(5.0, 10.0, vSize / uDpr);
    col = mix(col, uSurface, rim * 0.9);

    // Distant dots sink slightly into the background.
    float haze = clamp((vDepth - uHaze.x) / (uHaze.y - uHaze.x), 0.0, 1.0);
    col = mix(col, uSurface, haze * 0.38 * (0.4 + 0.6 * vVis));

    gl_FragColor = vec4(col, alpha);
  }
`;

/** "#2a78d6" → [r,g,b] in 0–1, as authored (sRGB). */
function rgb(hex) {
  const h = hex.trim().replace('#', '');
  const v = h.length === 3 ? h.replace(/./g, (c) => c + c) : h;
  const n = parseInt(v, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * @param {Object} opts
 * @param {HTMLCanvasElement} opts.canvas
 * @param {HTMLElement} opts.overlay   positioned container above the canvas
 * @param {number} opts.count          number of guidelines
 * @param {(i:number)=>{title:string, meta:string}} opts.describe  tooltip content
 * @param {(i:number|null)=>void} opts.onHover
 * @param {(i:number|null)=>void} opts.onSelect
 * @param {()=>void} [opts.onUserMove]
 */
export function createScene({ canvas, overlay, count, describe, onHover, onSelect, onUserMove }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 8000);
  let fov = FOV; // a layout may ask for a longer lens (see setLayout)

  let width = 1;
  let height = 1;
  let dpr = 1;
  let dirty = true;
  let raf = 0;
  let lastTime = 0;
  let insetGoal = 0; // px of the stage covered on the right by the detail panel
  let shift = 0; // horizontal view offset in px, eased toward shiftGoal()
  const leftPad = () => layout?.fit.left ?? 0; // px kept clear on the left for row labels
  const shiftGoal = () => (insetGoal - leftPad()) / 2;
  let pad = { top: 0, bottom: 0 }; // px kept clear for the controls above and the legend below

  /* ---------- points ---------- */
  const positions = new Float32Array(count * 3);
  const from = new Float32Array(count * 3);
  const to = new Float32Array(count * 3);
  const delay = new Float32Array(count);
  const vis = new Float32Array(count).fill(1);
  const visGoal = new Float32Array(count).fill(1);
  const emph = new Float32Array(count);
  const screen = new Float32Array(count * 3); // x, y in CSS px, depth (≤0 when behind the camera)

  const geometry = new THREE.BufferGeometry();
  const attr = (name, array, size) => {
    const a = new THREE.BufferAttribute(array, size);
    a.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute(name, a);
    return a;
  };
  const aPos = attr('position', positions, 3);
  const aColA = attr('colorA', new Float32Array(count * 3), 3);
  const aColB = attr('colorB', new Float32Array(count * 3), 3);
  const aColC = attr('colorC', new Float32Array(count * 3), 3);
  const aSegs = attr('segs', new Float32Array(count).fill(1), 1);
  const aVis = attr('vis', vis, 1);
  const aEmph = attr('emph', emph, 1);
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4); // never cull

  const uniforms = {
    uPx: { value: 1 },
    uMinPx: { value: 3 },
    uMaxPx: { value: 20 },
    uDpr: { value: 1 },
    uSurface: { value: new THREE.Vector3(1, 1, 1) },
    uDim: { value: new THREE.Vector3(0.8, 0.8, 0.8) },
    uHaze: { value: new THREE.Vector2(50, 300) },
  };
  const material = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, alphaToCoverage: true });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  /* ---------- guide lines (one object per layout, cross-faded) ---------- */
  const lineMaterial = () =>
    new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0, depthWrite: false });
  /** @type {{obj:any, goal:number}[]} */
  let guides = [];
  let lineColor = new THREE.Color(0x888888);
  let lineOpacity = 0.5;

  /* ---------- link arcs: the selected record's connections ---------- */
  const ARC_STEPS = 14;
  const makeArcs = () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    const obj = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0x888888, transparent: true, opacity: 0.75, depthWrite: false }));
    obj.frustumCulled = false;
    obj.visible = false;
    scene.add(obj);
    return obj;
  };
  const arcsIn = makeArcs(); // records that point at the selected one
  const arcsOut = makeArcs(); // records the selected one points at
  let links = null; // { from, incoming:[], outgoing:[] }
  let linksDirty = false;

  /** One shallow arc per connection, rebuilt whenever the dots move. */
  function drawArcs(obj, from, others) {
    obj.visible = others.length > 0;
    if (!others.length) return;
    const need = others.length * ARC_STEPS * 6;
    let attr = obj.geometry.getAttribute('position');
    if (attr.array.length !== need) {
      obj.geometry.dispose();
      obj.geometry = new THREE.BufferGeometry();
      attr = new THREE.BufferAttribute(new Float32Array(need), 3);
      attr.setUsage(THREE.DynamicDrawUsage);
      obj.geometry.setAttribute('position', attr);
    }
    const out = attr.array;
    const ax = positions[from * 3], ay = positions[from * 3 + 1], az = positions[from * 3 + 2];
    let o = 0;
    for (const i of others) {
      const bx = positions[i * 3], by = positions[i * 3 + 1], bz = positions[i * 3 + 2];
      const lift = Math.min(14, Math.hypot(bx - ax, by - ay, bz - az) * 0.22);
      let px = ax, py = ay, pz = az;
      for (let s = 1; s <= ARC_STEPS; s++) {
        const t = s / ARC_STEPS;
        const x = ax + (bx - ax) * t, y = ay + (by - ay) * t + lift * 4 * t * (1 - t), z = az + (bz - az) * t;
        out[o++] = px; out[o++] = py; out[o++] = pz;
        out[o++] = x; out[o++] = y; out[o++] = z;
        px = x; py = y; pz = z;
      }
    }
    attr.needsUpdate = true;
  }

  /* ---------- overlay: labels, rings, tooltip ---------- */
  const labelLayer = el('div', 'stage-labels');
  const hoverRing = el('div', 'ring ring--hover');
  const selectRing = el('div', 'ring ring--selected');
  const tip = el('div', 'tip');
  tip.setAttribute('role', 'tooltip');
  const tipTitle = el('div', 'tip__title');
  const tipMeta = el('div', 'tip__meta');
  tip.append(tipTitle, tipMeta);
  overlay.append(labelLayer, hoverRing, selectRing, tip);
  /** @type {{node:HTMLElement, at:number[], kind:string}[]} */
  let labels = [];

  function el(tag, cls) {
    const n = document.createElement(tag);
    n.className = cls;
    return n;
  }

  /* ---------- camera ---------- */
  let layout = null;
  let hovered = -1;
  let selected = -1;
  let morph = null; // {start, duration}
  let pointer = null; // last pointer position inside the stage, CSS px
  let tipWanted = false; // the tooltip is for pointing at the map, not at the list

  const rig = new OrbitRig(THREE, camera, canvas, {
    onChange: invalidate,
    onUserMove,
    onTap(x, y, type) {
      const rect = canvas.getBoundingClientRect();
      const i = pick(x - rect.left, y - rect.top, type === 'mouse' ? 10 : 22);
      onSelect(i < 0 ? null : i);
    },
  });

  function homePose() {
    const tan = Math.tan((fov * Math.PI) / 360);
    const clear = Math.max(0.4, 1 - (pad.top + pad.bottom) / height);
    const usable = Math.max(0.35, (width - insetGoal - leftPad()) / height);
    const dist = Math.max(layout.fit.h / (tan * clear), layout.fit.w / (tan * usable)) * 1.03;
    const [x, y, z] = layout.center;
    return { x, y, z, dist, phi: layout.view.phi, theta: layout.view.theta };
  }

  /* ---------- picking ---------- */
  const m = new THREE.Matrix4();
  function project() {
    m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const e = m.elements;
    for (let i = 0; i < count; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 0) {
        screen[i * 3 + 2] = -1;
        continue;
      }
      screen[i * 3] = ((e[0] * x + e[4] * y + e[8] * z + e[12]) / w * 0.5 + 0.5) * width;
      screen[i * 3 + 1] = (0.5 - (e[1] * x + e[5] * y + e[9] * z + e[13]) / w * 0.5) * height;
      screen[i * 3 + 2] = w;
    }
  }

  /** Radius in CSS px of dot `i` as drawn. */
  function radiusPx(i) {
    const w = screen[i * 3 + 2];
    if (w <= 0) return 0;
    const base = Math.min(uniforms.uMaxPx.value, Math.max(uniforms.uMinPx.value, (DOT * uniforms.uPx.value) / w));
    return (base * (1 + emph[i] * 0.7)) / dpr / 2;
  }

  /** Nearest visible guideline to a stage position; the front-most wins among overlaps. */
  function pick(px, py, slop) {
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < count; i++) {
      if (visGoal[i] < 0.5 || screen[i * 3 + 2] <= 0) continue;
      const d = Math.hypot(screen[i * 3] - px, screen[i * 3 + 1] - py);
      const r = radiusPx(i);
      if (d > r + slop) continue;
      // Inside a dot: depth decides. Outside every dot: distance decides.
      const score = d <= r ? screen[i * 3 + 2] - 1e6 : d;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    return best;
  }

  function setHover(i, fromPointer = false) {
    if (i === hovered) return;
    if (hovered >= 0 && hovered !== selected) emph[hovered] = 0;
    hovered = i;
    tipWanted = fromPointer;
    if (i >= 0 && i !== selected) emph[i] = 0.55;
    aEmph.needsUpdate = true;
    canvas.style.cursor = i >= 0 ? 'pointer' : '';
    if (i >= 0) {
      const d = describe(i);
      tipTitle.textContent = d.title;
      tipMeta.textContent = d.meta;
    }
    invalidate();
    if (fromPointer) onHover(i < 0 ? null : i);
  }

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (rig.dragging) return setHover(-1, true);
    setHover(pick(pointer.x, pointer.y, 8), true);
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
    setHover(-1, true);
  });

  canvas.addEventListener('keydown', (e) => {
    const step = 0.12;
    const moves = {
      ArrowLeft: { theta: -step }, ArrowRight: { theta: step }, ArrowUp: { phi: -step }, ArrowDown: { phi: step },
      '+': { zoom: 0.85 }, '=': { zoom: 0.85 }, '-': { zoom: 1.18 }, _: { zoom: 1.18 },
    };
    if (moves[e.key]) {
      rig.nudge(moves[e.key]);
      e.preventDefault();
    } else if (e.key === '0' || e.key === 'Home') {
      api.resetView();
      e.preventDefault();
    }
  });

  /* ---------- overlay placement ---------- */
  function place(node, i, withRadius) {
    const w = i >= 0 ? screen[i * 3 + 2] : -1;
    if (w <= 0) {
      node.style.opacity = '0';
      return false;
    }
    const x = screen[i * 3], y = screen[i * 3 + 1];
    if (withRadius) {
      const size = Math.max(18, radiusPx(i) * 2 + 10);
      node.style.width = node.style.height = `${size}px`;
    }
    node.style.opacity = '1';
    node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    return true;
  }

  function placeOverlay() {
    place(selectRing, selected, true);
    place(hoverRing, hovered !== selected ? hovered : -1, true);
    if (tipWanted && hovered >= 0 && screen[hovered * 3 + 2] > 0) {
      const x = screen[hovered * 3], y = screen[hovered * 3 + 1];
      const flipX = x > width - 300;
      const flipY = y < 110;
      tip.dataset.show = 'true';
      tip.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px) translate(${flipX ? 'calc(-100% - 16px)' : '16px'}, ${flipY ? '16px' : 'calc(-100% - 12px)'})`;
    } else tip.dataset.show = 'false';

    // Labels arrive in priority order; an axis label that would touch an earlier one is dropped.
    const v = new THREE.Vector3();
    const kept = [];
    for (const l of labels) {
      v.set(l.at[0], l.at[1], l.at[2]).project(camera);
      const x = (v.x * 0.5 + 0.5) * width;
      const y = (0.5 - v.y * 0.5) * height;
      let hide = v.z > 1 || v.z < -1;
      if (!hide && l.kind === 'axis') {
        hide = kept.some((k) => Math.abs(k[0] - x) < 40 && Math.abs(k[1] - y) < 15);
        if (!hide) kept.push([x, y]);
      }
      l.node.style.visibility = hide ? 'hidden' : 'visible';
      l.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  }

  /* ---------- frame loop ---------- */
  function invalidate() {
    dirty = true;
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    const dt = Math.min(0.05, lastTime ? (now - lastTime) / 1000 : 0.016);
    lastTime = now;
    let active = false;

    if (morph) {
      const t = (now - morph.start) / morph.duration;
      const spread = morph.stagger;
      for (let i = 0; i < count; i++) {
        let k = Math.min(1, Math.max(0, (t - delay[i] * spread) / (1 - spread)));
        k = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
        const j = i * 3;
        positions[j] = from[j] + (to[j] - from[j]) * k;
        positions[j + 1] = from[j + 1] + (to[j + 1] - from[j + 1]) * k;
        positions[j + 2] = from[j + 2] + (to[j + 2] - from[j + 2]) * k;
      }
      aPos.needsUpdate = true;
      if (t >= 1) morph = null;
      linksDirty = true;
      active = true;
    }

    if (linksDirty) {
      linksDirty = false;
      drawArcs(arcsIn, links?.from ?? 0, links?.incoming ?? []);
      drawArcs(arcsOut, links?.from ?? 0, links?.outgoing ?? []);
    }

    let fading = false;
    const kv = 1 - Math.exp(-dt * 12);
    for (let i = 0; i < count; i++) {
      const d = visGoal[i] - vis[i];
      if (d === 0) continue;
      vis[i] = Math.abs(d) < 0.01 ? visGoal[i] : vis[i] + d * kv;
      fading = true;
    }
    if (fading) {
      aVis.needsUpdate = true;
      active = true;
    }

    for (const g of guides) {
      const mat = g.obj.material;
      const d = g.goal * lineOpacity - mat.opacity;
      if (Math.abs(d) > 0.004) {
        mat.opacity += d * (1 - Math.exp(-dt * 6));
        active = true;
      } else mat.opacity = g.goal * lineOpacity;
    }
    guides = guides.filter((g) => {
      if (g.goal === 0 && g.obj.material.opacity < 0.01) {
        scene.remove(g.obj);
        g.obj.geometry.dispose();
        g.obj.material.dispose();
        return false;
      }
      return true;
    });

    if (Math.abs(shiftGoal() - shift) > 0.5) {
      shift += (shiftGoal() - shift) * (1 - Math.exp(-dt * 8));
      active = true;
    } else shift = shiftGoal();
    const lift = (pad.bottom - pad.top) / 2;
    if (Math.abs(shift) > 0.5 || lift) camera.setViewOffset(width, height, shift, lift, width, height);
    else camera.clearViewOffset();

    if (rig.update(dt)) active = true;
    uniforms.uHaze.value.set(rig.cur.dist * 0.72, rig.cur.dist * 1.45);

    project();
    if (pointer && !rig.dragging && active) setHover(pick(pointer.x, pointer.y, 8), true);
    renderer.render(scene, camera);
    placeOverlay();

    dirty = false;
    if (active) raf = requestAnimationFrame(frame);
    else lastTime = 0;
  }

  /* ---------- public API ---------- */
  const api = {
    rig,

    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      dpr = Math.min(2, window.devicePixelRatio || 1);
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      uniforms.uPx.value = (height * dpr) / (2 * Math.tan((fov * Math.PI) / 360));
      uniforms.uMinPx.value = 3.4 * dpr;
      uniforms.uMaxPx.value = 19 * dpr;
      uniforms.uDpr.value = dpr;
      if (layout && !rig.userMoved) rig.flyTo(homePose(), { immediate: true });
      invalidate();
    },

    /** Read colours from the page theme. Call again when the theme changes. */
    setTheme({ surface, dim, line, lineStrength, accent, muted }) {
      arcsIn.material.color.set(accent);
      arcsOut.material.color.set(muted);
      renderer.setClearColor(new THREE.Color(surface), 1);
      uniforms.uSurface.value.set(...rgb(surface));
      uniforms.uDim.value.set(...rgb(dim));
      lineColor = new THREE.Color(line);
      lineOpacity = lineStrength;
      for (const g of guides) g.obj.material.color.copy(lineColor);
      invalidate();
    },

    /**
     * @param {(i:number)=>string[]} colorsOf one to three hex colours per guideline
     */
    setColors(colorsOf) {
      for (let i = 0; i < count; i++) {
        const cols = colorsOf(i);
        aSegs.array[i] = cols.length;
        aColA.array.set(rgb(cols[0]), i * 3);
        aColB.array.set(rgb(cols[1] ?? cols[0]), i * 3);
        aColC.array.set(rgb(cols[2] ?? cols[0]), i * 3);
      }
      aColA.needsUpdate = aColB.needsUpdate = aColC.needsUpdate = aSegs.needsUpdate = true;
      invalidate();
    },

    /**
     * Move every dot to a new layout.
     * @param {import('./layouts.js').Layout} next
     * @param {{order?:Float32Array, animate?:boolean, intro?:boolean}} [o]
     *   order: 0–1 per guideline; dots with a lower value set off first
     */
    setLayout(next, { order, animate = true, intro = false } = {}) {
      const first = !layout;
      layout = next;
      // A layout that is read for lengths (a timeline) asks for a long, nearly orthographic lens, so
      // equal lengths look equal anywhere on screen. Swap lenses without a visible jump: move the
      // camera back or forward by the same factor, so the picture is unchanged before it flies home.
      const wantFov = next.fov ?? FOV;
      if (wantFov !== fov) {
        const k = Math.tan((fov * Math.PI) / 360) / Math.tan((wantFov * Math.PI) / 360);
        fov = wantFov;
        rig.cur.dist *= k;
        rig.goal.dist *= k;
        rig.limits = { min: 8 * (FOV / fov), max: 600 * (FOV / fov) };
        camera.fov = fov;
        camera.updateProjectionMatrix();
        uniforms.uPx.value = (height * dpr) / (2 * Math.tan((fov * Math.PI) / 360));
      }
      to.set(next.positions);
      if (order) delay.set(order);

      if (first || !animate || reducedMotion()) {
        positions.set(to);
        aPos.needsUpdate = true;
        morph = null;
      } else {
        from.set(positions);
        morph = { start: performance.now(), duration: 1500, stagger: 0.38 };
      }
      if (first && intro && !reducedMotion()) {
        // Opening move: the archive unrolls from its own centre, oldest first.
        for (let i = 0; i < count; i++) {
          from[i * 3] = to[i * 3] * 0.04;
          from[i * 3 + 1] = 0;
          from[i * 3 + 2] = to[i * 3 + 2] * 0.04;
        }
        positions.set(from);
        morph = { start: performance.now() + 150, duration: 2100, stagger: 0.6 };
      }

      for (const g of guides) g.goal = 0;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(next.lines, 3));
      const obj = new THREE.LineSegments(geo, lineMaterial());
      obj.material.color.copy(lineColor);
      obj.frustumCulled = false;
      obj.renderOrder = -1;
      scene.add(obj);
      guides.push({ obj, goal: 1 });

      for (const l of labels) {
        l.node.dataset.state = 'out';
        const node = l.node;
        setTimeout(() => node.remove(), 450);
      }
      labels = next.labels.map((l) => {
        const node = el('div', `lbl lbl--${l.kind}`);
        const inner = el('span', 'lbl__text');
        if (l.short && l.short !== l.text) {
          // Both forms go in; the stylesheet shows the short one on narrow screens.
          const long = el('span', 'lbl__long');
          long.textContent = l.text;
          const short = el('span', 'lbl__short');
          short.textContent = l.short;
          inner.append(long, short);
        } else inner.textContent = l.text;
        node.append(inner);
        if (l.sub) {
          const sub = el('span', 'lbl__sub');
          sub.textContent = l.sub;
          node.append(sub);
        }
        node.dataset.state = 'out';
        labelLayer.append(node);
        requestAnimationFrame(() => (node.dataset.state = 'in'));
        return { node, at: l.at, kind: l.kind };
      });

      rig.userMoved = false;
      rig.flyTo(homePose(), { immediate: first, stiffness: 3.4 });
      invalidate();
    },

    /**
     * Re-seat the dots inside the current layout (after a filter change) without
     * touching the camera, guides or labels.
     * @param {Float32Array} next
     */
    setPositions(next) {
      if (!layout) return;
      layout.positions = next;
      to.set(next);
      if (reducedMotion()) {
        positions.set(to);
        aPos.needsUpdate = true;
        morph = null;
      } else {
        from.set(positions);
        morph = { start: performance.now(), duration: 800, stagger: 0.25 };
      }
      invalidate();
    },

    /** @param {Uint8Array} mask 1 = shown at full strength */
    setVisible(mask) {
      for (let i = 0; i < count; i++) visGoal[i] = mask[i] ? 1 : 0;
      if (reducedMotion()) vis.set(visGoal), (aVis.needsUpdate = true);
      invalidate();
    },

    /** Highlight from outside the stage (hovering a list row, say). */
    setHover: (i) => setHover(i ?? -1),

    /**
     * Draw arcs between record `from` and the records connected with it.
     * @param {{from:number, incoming:number[], outgoing:number[]}|null} next
     */
    setLinks(next) {
      links = next;
      linksDirty = true;
      invalidate();
    },

    setSelected(i) {
      const next = i ?? -1;
      if (selected >= 0) emph[selected] = selected === hovered ? 0.55 : 0;
      selected = next;
      if (selected >= 0) emph[selected] = 1;
      aEmph.needsUpdate = true;
      selectRing.dataset.pulse = 'false';
      requestAnimationFrame(() => (selectRing.dataset.pulse = 'true'));
      invalidate();
    },

    /**
     * Bring a guideline to the centre; optionally move closer. With
     * `onlyIfCovered`, leave the camera alone unless the dot would sit under
     * the panel on the right or outside the stage.
     */
    focusOn(i, { closer = false, onlyIfCovered = false } = {}) {
      const home = homePose();
      const j = i * 3;
      if (onlyIfCovered) {
        const x = screen[j] - (shiftGoal() - shift);
        const y = screen[j + 1];
        const inView = screen[j + 2] > 0 && x > 24 && x < width - insetGoal - 24 && y > 24 && y < height - 24;
        if (inView) return;
      }
      const pose = { x: to[j], y: Math.min(to[j + 1], 30) * 0.6, z: to[j + 2] };
      if (closer && rig.goal.dist > home.dist * 0.75) pose.dist = home.dist * 0.6;
      rig.flyTo(pose);
    },

    resetView() {
      if (!layout) return;
      rig.userMoved = false;
      rig.flyTo(homePose());
    },

    zoom: (factor) => rig.nudge({ zoom: factor }),

    /** Pixels of the stage hidden behind a panel on the right. */
    setRightInset(px) {
      if (px === insetGoal) return;
      insetGoal = px;
      if (layout && !rig.userMoved) rig.flyTo(homePose());
      invalidate();
    },

    /** Pixels at the top and bottom of the stage that the composition should avoid. */
    setPadding(next) {
      if (next.top === pad.top && next.bottom === pad.bottom) return;
      pad = next;
      if (layout && !rig.userMoved) rig.flyTo(homePose(), { immediate: true });
      invalidate();
    },

    invalidate,

    /** Stop drawing and give the GPU context back. The stage cannot be used afterwards. */
    dispose() {
      cancelAnimationFrame(raf);
      raf = -1; // nothing may schedule another frame
      for (const g of guides) {
        g.obj.geometry.dispose();
        g.obj.material.dispose();
      }
      for (const arcs of [arcsIn, arcsOut]) {
        arcs.geometry.dispose();
        arcs.material.dispose();
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };

  canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());
  canvas.addEventListener('webglcontextrestored', invalidate);
  return api;
}
