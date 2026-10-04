// 3B önizleme (three.js). buildSolids() çıktısını çizer; tıklanan öğeyi bildirir.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const MAT = {
  wall: { color: 0xd9d4ca }, wallExt: { color: 0xb9644a }, column: { color: 0x5d6b82 },
  lintel: { color: 0xd9d4ca }, sill: { color: 0xd9d4ca }, slab: { color: 0x9a9e98 },
  roof: { color: 0x8a8f88, transparent: true, opacity: 0.45 },
  door: { color: 0x7a5534 }, window: { color: 0x7fc6e6, transparent: true, opacity: 0.55 },
  space: { color: 0xf2c94c, transparent: true, opacity: 0.18, depthWrite: false },
};

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
    const loop = () => { this.controls.update(); this.renderer.render(this.scene, this.camera); this._raf = requestAnimationFrame(loop); };
    loop();
  }

  setBackground(css) { this.scene.background = new THREE.Color(css); }

  setSolids(solids, { keepCamera = false } = {}) {
    for (const m of this.meshes) { m.geometry.dispose(); }
    this.group.clear();
    this.meshes = [];
    const box = new THREE.Box3();
    for (const so of solids) {
      if (so.profile.length < 3) continue;
      const shape = new THREE.Shape(so.profile.map(([x, y]) => new THREE.Vector2(x, y)));
      const depth = so.z1 - so.z0;
      if (depth <= 1e-4) continue;
      const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
      geo.translate(0, 0, so.z0);
      const key = so.type === 'wall' && so.props.exterior ? 'wallExt' : so.type;
      const mesh = new THREE.Mesh(geo, this.mats[key] || this.mats.wall);
      mesh.userData = { id: so.src, type: so.type, baseMat: mesh.material };
      if (so.type === 'space') { mesh.visible = this.showSpaces; mesh.renderOrder = 2; }
      if (so.type === 'roof') mesh.visible = this.showRoof;
      if (so.type !== 'space' && so.type !== 'window') {
        const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 30), this.edgeMat);
        mesh.add(edges);
      }
      this.group.add(mesh);
      this.meshes.push(mesh);
      if (so.type !== 'space') box.expandByObject(mesh);
    }
    this._applySelection();
    if (!keepCamera && !box.isEmpty()) this.frame(box);
  }

  frame(box = new THREE.Box3().setFromObject(this.group)) {
    const c = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3()).length();
    this.controls.target.copy(c);
    this.camera.position.set(c.x - size * 0.45, c.y - size * 0.75, c.z + size * 0.55);
    this.camera.near = size / 500;
    this.camera.far = size * 20;
    this.camera.updateProjectionMatrix();
  }

  setSelected(id) { this.selected = id; this._applySelection(); }
  setShowSpaces(v) { this.showSpaces = v; for (const m of this.meshes) if (m.userData.type === 'space') m.visible = v; }
  setShowRoof(v) { this.showRoof = v; for (const m of this.meshes) if (m.userData.type === 'roof') m.visible = v; }

  _applySelection() {
    for (const m of this.meshes) m.material = m.userData.id === this.selected && m.userData.type !== 'space' ? this.selMat : m.userData.baseMat;
  }

  resize() {
    const r = this.el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    this.renderer.setSize(r.width, r.height);
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
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
      this.onSelect?.(hit ? hit.object.userData.id : null);
    });
  }
}
