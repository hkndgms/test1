// 3B önizleme (three.js). buildSolids() çıktısını çizer; tıklanan öğeyi bildirir.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SYSTEMS } from './kb.js';

const MEP_TYPES = new Set(['pipe', 'duct', 'airterminal', 'terminal', 'equipment']);

const MAT = {
  wall: { color: 0xd9d4ca }, wallExt: { color: 0xb9644a }, column: { color: 0x5d6b82 },
  lintel: { color: 0xd9d4ca }, sill: { color: 0xd9d4ca }, slab: { color: 0x9a9e98 },
  roof: { color: 0x8a8f88, transparent: true, opacity: 0.45 },
  door: { color: 0x7a5534 }, window: { color: 0x7fc6e6, transparent: true, opacity: 0.55 },
  curtain: { color: 0x7fc6e6, transparent: true, opacity: 0.45 }, fixture: { color: 0xf1f1ee },
  space: { color: 0xf2c94c, transparent: true, opacity: 0.18, depthWrite: false },
  // parça malzemeleri (build3d parts[].mat)
  frame: { color: 0x4e3b2c }, leaf: { color: 0x9a6b45 }, wframe: { color: 0xe9eaea }, mullion: { color: 0x5b6168 },
  glass: { color: 0x8fd0ea, transparent: true, opacity: 0.4, depthWrite: false }, sillstone: { color: 0xcfcfc8 },
  ceramic: { color: 0xf6f6f3 }, seat: { color: 0xe4e4e0 }, chrome: { color: 0xc4cbd1 }, metal: { color: 0xe3e6e8 },
  wood: { color: 0xb08a5e }, fabric: { color: 0x8da3bd }, water: { color: 0xa9d8ea, transparent: true, opacity: 0.7 },
};
const EDGE_MATS = new Set(['frame', 'leaf', 'wood', 'wframe', 'mullion']);

export class View3D {
  constructor(container, { onSelect }) {
    this.el = container;
    this.onSelect = onSelect;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8d8a80, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-30, -50, 80);
    this.scene.add(sun);
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.mats = Object.fromEntries(Object.entries(MAT).map(([k, v]) => [k, new THREE.MeshLambertMaterial({ ...v, side: THREE.DoubleSide })]));
    this.selMat = new THREE.MeshLambertMaterial({ color: 0x2f6fdb, emissive: 0x16357a });
    this.edgeMat = new THREE.LineBasicMaterial({ color: 0x2a2a2a, transparent: true, opacity: 0.35 });
    this.meshes = [];
    this.selected = null;
    this.showSpaces = false;
    this.showRoof = true;
    this._bindPick();
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    // Yalnız kamera ya da sahne değişince çiz (pil ve işlemci dostu)
    this._dirty = true;
    this.controls.addEventListener('change', () => { this._dirty = true; });
    let last = performance.now();
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (this.tour) { this._tourStep(dt); this._dirty = true; }
      else if (this.controls.update()) this._dirty = true;
      if (this._dirty && this.el.offsetParent !== null) { this.renderer.render(this.scene, this.camera); this._dirty = false; }
      this._raf = requestAnimationFrame(loop);
    };
    loop();
  }

  setBackground(css) { this.scene.background = new THREE.Color(css); this._dirty = true; }

  sysMat(system, type) {
    const key = system + '|' + (type === 'airterminal' ? 'a' : 'm');
    if (!this._sysMats) this._sysMats = new Map();
    let m = this._sysMats.get(key);
    if (!m) {
      const col = (SYSTEMS[system] || SYSTEMS.other).color;
      m = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide, transparent: type === 'airterminal', opacity: type === 'airterminal' ? 0.85 : 1 });
      this._sysMats.set(key, m);
    }
    return m;
  }

  setSolids(solids, { keepCamera = false } = {}) {
    this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    this.group.clear();
    this._dirty = true;
    this.meshes = [];
    const box = new THREE.Box3();
    // Borular: sistem başına tek bir InstancedMesh (binlerce segment için hızlı)
    const pipeSegs = new Map();
    for (const so of solids) {
      if (so.type !== 'pipe') continue;
      let a = pipeSegs.get(so.system);
      if (!a) pipeSegs.set(so.system, (a = []));
      for (let i = 1; i < so.path.length; i++) a.push({ a: so.path[i - 1], b: so.path[i], r: so.r, id: so.src });
    }
    const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1, false);
    const up = new THREE.Vector3(0, 1, 0), va = new THREE.Vector3(), vb = new THREE.Vector3(), dir = new THREE.Vector3();
    const q = new THREE.Quaternion(), mtx = new THREE.Matrix4(), sc = new THREE.Vector3();
    for (const [system, segs] of pipeSegs) {
      const inst = new THREE.InstancedMesh(unitCyl, this.sysMat(system, 'pipe'), segs.length);
      segs.forEach((g, i) => {
        va.set(...g.a); vb.set(...g.b);
        dir.subVectors(vb, va);
        const L = dir.length() || 1e-6;
        q.setFromUnitVectors(up, dir.normalize());
        sc.set(g.r, L, g.r);
        mtx.compose(va.clone().add(vb).multiplyScalar(0.5), q, sc);
        inst.setMatrixAt(i, mtx);
      });
      const white = new THREE.Color(0xffffff);
      for (let i = 0; i < segs.length; i++) inst.setColorAt(i, white); // seçim vurgusu için renk tamponu
      inst.instanceMatrix.needsUpdate = true;
      inst.computeBoundingSphere();
      inst.userData = { type: 'pipe', system, ids: segs.map((g) => g.id), mep: true, baseMat: inst.material };
      this.group.add(inst);
      this.meshes.push(inst);
    }
    for (const so of solids) {
      if (so.type === 'pipe' || !so.profile || so.profile.length < 3) continue;
      // parçalı katı (kapı, pencere, cam cephe, tefriş): her parça kendi malzemesiyle ayrı örgü
      if (so.parts && so.parts.length) {
        for (const pt of so.parts) {
          if (!pt.profile || pt.profile.length < 3 || pt.z1 - pt.z0 <= 1e-4) continue;
          const shp = new THREE.Shape(pt.profile.map(([x, y]) => new THREE.Vector2(x, y)));
          const g = new THREE.ExtrudeGeometry(shp, { depth: pt.z1 - pt.z0, bevelEnabled: false });
          g.translate(0, 0, pt.z0);
          const mesh = new THREE.Mesh(g, this.mats[pt.mat] || this.mats[so.type] || this.mats.wall);
          mesh.userData = { id: so.src, type: so.type, mep: false, baseMat: mesh.material, part: pt.mat };
          if (pt.mat === 'glass' || pt.mat === 'water') mesh.renderOrder = 1;
          if (EDGE_MATS.has(pt.mat)) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), this.edgeMat));
          this.group.add(mesh);
          this.meshes.push(mesh);
          box.expandByObject(mesh);
        }
        continue;
      }
      const shape = new THREE.Shape(so.profile.map(([x, y]) => new THREE.Vector2(x, y)));
      const depth = so.z1 - so.z0;
      if (depth <= 1e-4) continue;
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.translate(0, 0, so.z0);
      const isMep = MEP_TYPES.has(so.type);
      const key = so.type === 'wall' && so.props.exterior ? 'wallExt' : so.type;
      const mesh = new THREE.Mesh(geo, isMep ? this.sysMat(so.system, so.type) : this.mats[key] || this.mats.wall);
      mesh.userData = { id: so.src, type: so.type, system: so.system, mep: isMep, baseMat: mesh.material };
      if (so.type === 'space') { mesh.visible = this.showSpaces; mesh.renderOrder = 2; }
      if (so.type === 'roof') mesh.visible = this.showRoof;
      if (so.type !== 'space' && so.type !== 'window' && !isMep) {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), this.edgeMat);
        mesh.add(edges);
      }
      this.group.add(mesh);
      this.meshes.push(mesh);
      if (so.type !== 'space') box.expandByObject(mesh);
    }
    this._applyVisibility();
    this._applySelection();
    if (box.isEmpty()) for (const m of this.meshes) if (m.userData.mep) box.expandByObject(m);
    if (!keepCamera && !box.isEmpty()) this.frame(box);
  }

  // ------------------------------------------------------------ otomatik gezi
  // wps: [{x, y, name?, note?, spin?, jump?}] metre cinsinden (yerel koordinat)
  startTour(wps, { eye = 1.6, speed = 1.3, onStop, onPoint } = {}) {
    if (!wps || wps.length < 2) return false;
    this.stopTour(true);
    this._saved = { pos: this.camera.position.clone(), target: this.controls.target.clone(), near: this.camera.near, fov: this.camera.fov };
    this.controls.enabled = false;
    this.camera.near = 0.05;
    this.camera.fov = 70; // iç mekânda geniş görüş
    this.camera.updateProjectionMatrix();
    const p0 = wps[0], p1 = wps[1];
    this.tour = { wps, i: 0, t: 0, eye, speed, rate: 1, paused: false, spin: 0, yaw: Math.atan2(p1.y - p0.y, p1.x - p0.x), onStop, onPoint };
    this.camera.position.set(p0.x, p0.y, eye);
    onPoint?.(p0, 0);
    return true;
  }

  pauseTour(v) { if (this.tour) this.tour.paused = v; }
  setTourRate(r) { if (this.tour) this.tour.rate = r; }

  stopTour(silent = false) {
    if (!this.tour) return;
    const cb = this.tour.onStop;
    this.tour = null;
    this.controls.enabled = true;
    if (this._saved) {
      this.camera.near = this._saved.near;
      this.camera.fov = this._saved.fov;
      this.camera.position.copy(this._saved.pos);
      this.controls.target.copy(this._saved.target);
      this.camera.updateProjectionMatrix();
    }
    this._dirty = true;
    if (!silent) cb?.();
  }

  _tourStep(dt) {
    const T = this.tour;
    if (T.paused) return this._tourLook(T);
    dt *= T.rate;
    const a = T.wps[T.i], b = T.wps[T.i + 1];
    if (!b) { this.stopTour(); return; }
    if (T.spin > 0) {
      // mahal merkezinde yavaş bir çevre bakışı
      const d = Math.min(T.spin, dt * 1.4);
      T.yaw += d;
      T.spin -= d;
      return this._tourLook(T);
    }
    if (b.jump) {
      T.i++;
      this.camera.position.set(b.x, b.y, T.eye);
      T.onPoint?.(b, T.i);
      return this._tourLook(T);
    }
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    T.t += (dt * T.speed) / Math.max(L, 1e-6);
    const want = Math.atan2(b.y - a.y, b.x - a.x);
    let dy = want - T.yaw;
    while (dy > Math.PI) dy -= 2 * Math.PI;
    while (dy < -Math.PI) dy += 2 * Math.PI;
    T.yaw += dy * Math.min(1, dt * 3);
    if (T.t >= 1) {
      T.t = 0;
      T.i++;
      T.onPoint?.(b, T.i);
      if (b.spin) T.spin = Math.PI * 2;
      this.camera.position.set(b.x, b.y, T.eye);
    } else {
      this.camera.position.set(a.x + (b.x - a.x) * T.t, a.y + (b.y - a.y) * T.t, T.eye);
    }
    this._tourLook(T);
  }

  _tourLook(T) {
    const p = this.camera.position;
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(p.x + Math.cos(T.yaw), p.y + Math.sin(T.yaw), T.eye - 0.08);
  }

  // Mimari ve tesisat sistemleri için görünürlük
  setVisibility({ arch = true, systems = null } = {}) {
    this.archVisible = arch;
    this.visibleSystems = systems; // null: hepsi
    this._applyVisibility();
  }

  _applyVisibility() {
    this._dirty = true;
    const arch = this.archVisible !== false;
    for (const m of this.meshes) {
      const u = m.userData;
      if (u.mep) m.visible = !this.visibleSystems || this.visibleSystems.has(u.system);
      else if (u.type === 'space') m.visible = arch && this.showSpaces;
      else if (u.type === 'roof') m.visible = arch && this.showRoof;
      else m.visible = arch;
    }
  }

  frame(box = new THREE.Box3().setFromObject(this.group)) {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    this.camera.position.set(c.x - size * 0.45, c.y - size * 0.75, c.z + size * 0.55);
    this.camera.near = size / 500;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
    this._dirty = true;
  }

  setSelected(id) { this.selected = id; this._applySelection(); }
  setShowSpaces(v) { this.showSpaces = v; this._applyVisibility(); }
  setShowRoof(v) { this.showRoof = v; this._applyVisibility(); }

  _applySelection() {
    this._dirty = true;
    for (const m of this.meshes) {
      if (m.isInstancedMesh) {
        // seçili boru: ilgili segmentleri vurgulamak yerine bütün sistem örgüsü aynı kalır;
        // seçimi renk örneğiyle göster
        const ids = m.userData.ids;
        let any = false;
        for (let i = 0; i < ids.length; i++) {
          const on = ids[i] === this.selected;
          if (on || m._hl) { m.setColorAt(i, on ? new THREE.Color(0x2f6fdb) : new THREE.Color(0xffffff)); any = true; }
        }
        if (any) { m.instanceColor.needsUpdate = true; m._hl = ids.includes(this.selected); }
        continue;
      }
      m.material = m.userData.id === this.selected && m.userData.type !== 'space' ? this.selMat : m.userData.baseMat;
    }
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this._dirty = true;
  }

  _bindPick() {
    const dom = this.renderer.domElement;
    let down = null;
    dom.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    dom.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4) return;
      const r = dom.getBoundingClientRect();
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
      const hit = ray.intersectObjects(this.meshes.filter((m) => m.visible && m.userData.type !== 'space' && m.userData.type !== 'slab' && m.userData.type !== 'roof'), false)[0];
      if (!hit) return this.onSelect?.(null);
      const u = hit.object.userData;
      this.onSelect?.(hit.object.isInstancedMesh ? u.ids[hit.instanceId] : u.id);
    });
  }
}
