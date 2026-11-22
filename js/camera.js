/**
 * Orbit camera rig: drag to orbit, right-drag / shift-drag / two fingers to pan,
 * wheel or pinch to zoom. Every change is a goal the camera eases toward, so
 * programmatic moves (fly-to, layout changes) and direct manipulation share
 * one code path and never fight.
 */

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const PHI_MIN = 0.08;
const PHI_MAX = 1.5;

export class OrbitRig {
  /**
   * @param {any} THREE
   * @param {any} camera THREE.PerspectiveCamera
   * @param {HTMLElement} el element that receives pointer input
   * @param {{onChange:()=>void, onTap:(x:number,y:number,type:string)=>void, onUserMove?:()=>void}} hooks
   */
  constructor(THREE, camera, el, hooks) {
    this.camera = camera;
    this.el = el;
    this.hooks = hooks;
    this.cur = { x: 0, y: 0, z: 0, dist: 120, phi: 0.9, theta: 0 };
    this.goal = { ...this.cur };
    this.limits = { min: 8, max: 600 };
    /** Allowed angles. A layout may narrow them, e.g. keep a timeline's time axis left to right. */
    this.angles = { theta: null, phi: [PHI_MIN, PHI_MAX] };
    this.stiffness = 7;
    this.userMoved = false;
    this.dragging = false;
    this._v = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._ray = new THREE.Vector3();
    /** @type {Map<number,{x:number,y:number}>} */
    this._pointers = new Map();
    this._travel = 0;
    this._downAt = 0;
    this._pinch = 0;
    this._bind();
    this.apply();
  }

  /** Keep the goal inside the allowed angles. */
  _clampAngles() {
    this.goal.phi = clamp(this.goal.phi, this.angles.phi[0], this.angles.phi[1]);
    if (this.angles.theta) this.goal.theta = clamp(this.goal.theta, this.angles.theta[0], this.angles.theta[1]);
  }

  /** Narrow (or, with no argument, restore) the angles the camera may orbit through. */
  setAngles({ theta = null, phi = [PHI_MIN, PHI_MAX] } = {}) {
    this.angles = { theta, phi };
    this._clampAngles();
  }

  /** Ease toward a pose. Pass `immediate` to jump. */
  flyTo(pose, { immediate = false, stiffness = 4.2 } = {}) {
    Object.assign(this.goal, pose);
    this._clampAngles();
    this.goal.dist = clamp(this.goal.dist, this.limits.min, this.limits.max);
    // Take the short way round.
    const turn = Math.PI * 2;
    this.cur.theta = this.goal.theta + ((((this.cur.theta - this.goal.theta) % turn) + turn * 1.5) % turn) - Math.PI;
    this.stiffness = stiffness;
    if (immediate) Object.assign(this.cur, this.goal);
    this.hooks.onChange();
  }

  /** Nudge from the keyboard. */
  nudge({ theta = 0, phi = 0, zoom = 1 }) {
    this._touch();
    this.goal.theta += theta;
    this.goal.phi += phi;
    this._clampAngles();
    this.goal.dist = clamp(this.goal.dist * zoom, this.limits.min, this.limits.max);
    this.hooks.onChange();
  }

  /** Advance the easing. Returns true while the camera is still moving. */
  update(dt) {
    const k = 1 - Math.exp(-dt * this.stiffness);
    let moving = false;
    for (const key of ['x', 'y', 'z', 'dist', 'phi', 'theta']) {
      const d = this.goal[key] - this.cur[key];
      if (Math.abs(d) > 1e-4) {
        this.cur[key] += d * k;
        moving = true;
      } else this.cur[key] = this.goal[key];
    }
    this.apply();
    return moving;
  }

  apply() {
    const { x, y, z, dist, phi, theta } = this.cur;
    const s = Math.sin(phi);
    this.camera.position.set(x + dist * s * Math.sin(theta), y + dist * Math.cos(phi), z + dist * s * Math.cos(theta));
    this.camera.lookAt(x, y, z);
    this.camera.updateMatrixWorld();
  }

  _touch() {
    this.stiffness = 9;
    if (!this.userMoved) {
      this.userMoved = true;
      this.hooks.onUserMove?.();
    }
  }

  _pan(dx, dy) {
    const perPx = (2 * this.cur.dist * Math.tan((this.camera.fov * Math.PI) / 360)) / this.el.clientHeight;
    this._right.setFromMatrixColumn(this.camera.matrixWorld, 0);
    this._up.setFromMatrixColumn(this.camera.matrixWorld, 1);
    this._v.copy(this._right).multiplyScalar(-dx * perPx).addScaledVector(this._up, dy * perPx);
    this.goal.x += this._v.x;
    this.goal.y = clamp(this.goal.y + this._v.y, -10, 60);
    this.goal.z += this._v.z;
  }

  /** Where the ray through a client position meets the ground plane the camera is looking at. */
  _ground(clientX, clientY) {
    const rect = this.el.getBoundingClientRect();
    const origin = this.camera.position;
    this._ray
      .set(((clientX - rect.left) / rect.width) * 2 - 1, 1 - ((clientY - rect.top) / rect.height) * 2, 0.5)
      .unproject(this.camera)
      .sub(origin)
      .normalize();
    if (this._ray.y > -0.05) return null; // looking at or above the horizon
    const t = (this.goal.y - origin.y) / this._ray.y;
    if (t <= 0 || t > this.cur.dist * 4) return null;
    return { x: origin.x + this._ray.x * t, z: origin.z + this._ray.z * t };
  }

  _bind() {
    const el = this.el;
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 1) {
        this._travel = 0;
        this._downAt = performance.now();
      }
      this._pinch = 0;
    });

    el.addEventListener('pointermove', (e) => {
      const p = this._pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this._travel += Math.abs(dx) + Math.abs(dy);
      if (this._travel < 5) return;
      this.dragging = true;
      this._touch();
      if (this._pointers.size >= 2) {
        const [a, b] = [...this._pointers.values()];
        const span = Math.hypot(a.x - b.x, a.y - b.y);
        if (this._pinch) this.goal.dist = clamp((this.goal.dist * this._pinch) / span, this.limits.min, this.limits.max);
        this._pinch = span;
        this._pan(dx / 2, dy / 2);
      } else if (e.buttons & 2 || e.shiftKey) {
        this._pan(dx, dy);
      } else {
        this.goal.theta -= dx * 0.0052;
        this.goal.phi -= dy * 0.0052;
        this._clampAngles();
      }
      this.hooks.onChange();
    });

    const release = (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      this._pointers.delete(e.pointerId);
      this._pinch = 0;
      if (this._pointers.size) return;
      const tap = this._travel < 5 && performance.now() - this._downAt < 600 && e.type === 'pointerup';
      this.dragging = false;
      if (tap) this.hooks.onTap(e.clientX, e.clientY, e.pointerType);
    };
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this._touch();
        const unit = e.deltaMode === 1 ? 16 : 1;
        const speed = e.ctrlKey ? 0.012 : 0.0014; // ctrl+wheel is a trackpad pinch
        const before = this.goal.dist;
        this.goal.dist = clamp(before * Math.exp(e.deltaY * unit * speed), this.limits.min, this.limits.max);
        // Zoom about the point under the cursor, not the centre of the view.
        const anchor = this._ground(e.clientX, e.clientY);
        if (anchor) {
          const k = this.goal.dist / before;
          this.goal.x = anchor.x + (this.goal.x - anchor.x) * k;
          this.goal.z = anchor.z + (this.goal.z - anchor.z) * k;
        }
        this.hooks.onChange();
      },
      { passive: false },
    );
  }
}
