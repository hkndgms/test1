// 2B plan görüntüleyici: canvas üzerinde DWG çizgileri + algılanan model.
import { aciToHex } from './aci.js';
import { pointInPoly } from './detect.js';
import { SYSTEMS } from './kb.js';

const KIND_COLOR = { window: 'win', door: 'door', empty: 'empty', solid: 'wall' };

export class Plan2D {
  constructor(canvas, { onSelect, onRegion, onWall, colors }) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelect = onSelect;
    this.onRegion = onRegion;
    this.onWall = onWall;
    this.colors = colors; // () => token renkleri
    this.view = { cx: 0, cy: 0, scale: 1 };
    this.drawing = null;
    this.paths = []; // {layer, color, path}
    this.layerVisible = [];
    this.model = null;
    this.overrides = {};
    this.selected = null;
    this.region = null;
    this.regionMode = false;
    this.dimDrawing = true;
    this.showTexts = true;
    this._pointers = new Map();
    this._raf = 0;
    this._bind();
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }

  setDrawing(d) {
    this.drawing = d;
    this.layerVisible = d.layers.map((l) => !l.off);
    const groups = new Map();
    for (const p of d.prims) {
      const key = p.l + '|' + p.c;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { layer: p.l, ci: p.c, path: new Path2D() }));
      const a = p.pts;
      g.path.moveTo(a[0], a[1]);
      for (let i = 2; i < a.length; i += 2) g.path.lineTo(a[i], a[i + 1]);
      if (p.closed) g.path.closePath();
    }
    this.paths = [...groups.values()].map((g) => ({ ...g, color: g.ci === -1 || g.ci == null ? d.layers[g.layer].color : aciToHex(g.ci) }));
    this.fit(d.bbox);
  }

  setFixtures(list) { this.fixtures = list || []; this.draw(); }
  setModel(model, overrides) {
    this.model = model;
    this.overrides = overrides || {};
    this.draw();
  }

  setSelected(id) { this.selected = id; this.draw(); }

  // Tesisat katmanı: mep = extractMep çıktısı, profiles = Map<layer, profil>
  setMep(mep, profiles, { visible = true, systems = null } = {}) {
    this.mep = mep;
    this.mepProfiles = profiles;
    this.mepVisible = visible;
    this.mepSystems = systems;
    this.draw();
  }

  _mepOn(l) {
    const p = this.mepProfiles?.get(l);
    if (!p || p.kind === 'ignore' || p.hidden) return null;
    if (this.mepSystems && !this.mepSystems.has(p.system)) return null;
    return p;
  }

  _drawMep(ctx, scale, world) {
    const m = this.mep;
    world();
    const unitScale = this.mepUnitScale || 1; // çizim birimi -> cm
    const poly = (p) => { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath(); };
    for (const d of [...m.ducts, ...m.boxes]) {
      const p = this._mepOn(d.l);
      if (!p) continue;
      const col = (SYSTEMS[p.system] || SYSTEMS.other).color;
      poly(d.poly);
      ctx.globalAlpha = d.id === this.selected ? 0.75 : 0.35;
      ctx.fillStyle = col;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = (d.id === this.selected ? 3 : 1) / scale;
      ctx.strokeStyle = col;
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    for (const pp of m.pipes) {
      const p = this._mepOn(pp.l);
      if (!p) continue;
      const diaCm = pp.diaSrc === 'label' && pp.diaCm ? pp.diaCm : p.sizeCm || 2.5;
      ctx.lineWidth = Math.max(diaCm / unitScale, (pp.id === this.selected ? 5 : 2) / scale);
      ctx.strokeStyle = pp.id === this.selected ? this.colors().accent : (SYSTEMS[p.system] || SYSTEMS.other).color;
      ctx.beginPath();
      ctx.moveTo(pp.pts[0][0], pp.pts[0][1]);
      for (let i = 1; i < pp.pts.length; i++) ctx.lineTo(pp.pts[i][0], pp.pts[i][1]);
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
  }

  _hitMep(x, y) {
    const m = this.mep;
    if (!m || !this.mepVisible) return null;
    const tol = 6 / this.view.scale;
    for (const pp of m.pipes) {
      if (!this._mepOn(pp.l)) continue;
      for (let i = 1; i < pp.pts.length; i++) {
        const [ax, ay] = pp.pts[i - 1], [bx, by] = pp.pts[i];
        const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
        const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
        if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= tol) return pp.id;
      }
    }
    for (const b of m.boxes) if (this._mepOn(b.l) && pointInPoly(x, y, b.poly)) return b.id;
    for (const d of m.ducts) if (this._mepOn(d.l) && pointInPoly(x, y, d.poly)) return d.id;
    return null;
  }

  fit(bb) {
    if (!bb || !isFinite(bb[0])) return;
    const r = this.cv.getBoundingClientRect();
    const w = Math.max(1, bb[2] - bb[0]), h = Math.max(1, bb[3] - bb[1]);
    this.view.cx = (bb[0] + bb[2]) / 2;
    this.view.cy = (bb[1] + bb[3]) / 2;
    this.view.scale = Math.min(r.width / w, r.height / h) * 0.9;
    this.draw();
  }

  fitModel() {
    const m = this.model;
    if (!m || !m.walls.length) return this.fit(this.drawing?.bbox);
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
    for (const w of [...m.walls, ...m.columns]) for (const [x, y] of w.poly) {
      if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y;
    }
    this.fit([a, b, c, d]);
  }

  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.cv.width = Math.max(1, Math.round(r.width * dpr));
    this.cv.height = Math.max(1, Math.round(r.height * dpr));
    this.cv.style.width = r.width + 'px';
    this.cv.style.height = r.height + 'px';
    this.draw();
  }

  toWorld(sx, sy) {
    const r = this.cv.getBoundingClientRect();
    const { cx, cy, scale } = this.view;
    return [(sx - r.width / 2) / scale + cx, (r.height / 2 - sy) / scale + cy];
  }

  draw() {
    cancelAnimationFrame(this._raf);
    this._raf = requestAnimationFrame(() => this._draw());
  }

  _draw() {
    const ctx = this.ctx, cv = this.cv;
    const dpr = window.devicePixelRatio || 1;
    const W = cv.width / dpr, H = cv.height / dpr;
    const C = this.colors();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.canvas;
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (!this.drawing) return;
    const { cx, cy, scale } = this.view;
    const world = () => ctx.setTransform(scale * dpr, 0, 0, -scale * dpr, (W / 2 - cx * scale) * dpr, (H / 2 + cy * scale) * dpr);
    world();
    ctx.lineWidth = 1 / scale;
    ctx.lineJoin = 'round';
    ctx.globalAlpha = this.model && this.dimDrawing ? 0.35 : 1;
    for (const g of this.paths) {
      if (!this.layerVisible[g.layer]) continue;
      ctx.strokeStyle = C.dark ? g.color : darken(g.color);
      ctx.stroke(g.path);
    }
    // yazılar
    if (this.showTexts) {
      const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(W, H);
      ctx.fillStyle = C.ink;
      let n = 0;
      for (const t of this.drawing.texts) {
        if (!this.layerVisible[t.l]) continue;
        const px = t.h * scale;
        if (px < 5 || t.x < x0 - 1000 / scale || t.x > x1 || t.y < y0 || t.y > y1 + 1000 / scale) continue;
        if (++n > 1500) break;
        ctx.save();
        ctx.translate(t.x, t.y);
        ctx.rotate(t.rot);
        ctx.scale(1, -1);
        ctx.font = `${t.h}px ${C.fontUi}`;
        ctx.fillText(t.s, 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 1;
    if (this.model && this.archVisible !== false) this._drawModel(ctx, C, scale, world);
    if (this.mep && this.mepVisible) this._drawMep(ctx, scale, world);
    if (this.partRegions && this.partRegions.length) {
      world();
      ctx.setLineDash([14 / scale, 8 / scale]);
      ctx.lineWidth = 1.2 / scale;
      ctx.strokeStyle = C.muted;
      for (const r of this.partRegions) if (r) ctx.strokeRect(r[0], r[1], r[2] - r[0], r[3] - r[1]);
      ctx.setLineDash([]);
    }
    if (this.wallMode && this._wallStart && this._hover) {
      world();
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 3 / scale;
      ctx.beginPath(); ctx.moveTo(...this._wallStart); ctx.lineTo(...this._hover); ctx.stroke();
    }
    if (this.region) {
      world();
      const [a, b, c, d] = this.region;
      ctx.setLineDash([8 / scale, 6 / scale]);
      ctx.lineWidth = 1.5 / scale;
      ctx.strokeStyle = C.accent;
      ctx.strokeRect(a, b, c - a, d - b);
      ctx.setLineDash([]);
    }
    if (this._drag && this._drag.region) {
      world();
      const { x0, y0, x1, y1 } = this._drag;
      ctx.fillStyle = C.accentSoft;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }

  _drawModel(ctx, C, scale, world) {
    const m = this.model, ov = this.overrides;
    const poly = (p) => { ctx.beginPath(); ctx.moveTo(p[0][0], p[0][1]); for (let i = 1; i < p.length; i++) ctx.lineTo(p[i][0], p[i][1]); ctx.closePath(); };
    world();
    for (const r of m.rooms) {
      if (ov[r.id]?.deleted) continue;
      poly(r.poly);
      ctx.fillStyle = r.id === this.selected ? C.roomSel : C.room;
      ctx.fill();
    }
    ctx.lineWidth = 1 / scale;
    for (const w of m.walls) {
      if (ov[w.id]?.deleted) continue;
      poly(w.poly);
      ctx.fillStyle = w.exterior ? C.wallExt : C.wall;
      ctx.fill();
      ctx.strokeStyle = C.wallEdge;
      ctx.stroke();
    }
    for (const c of m.columns) {
      if (ov[c.id]?.deleted) continue;
      poly(c.poly);
      ctx.fillStyle = C.column;
      ctx.fill();
    }
    for (const o of m.openings) {
      if (ov[o.id]?.deleted) continue;
      const kind = ov[o.id]?.kind || o.kind;
      poly(o.rect);
      ctx.fillStyle = C[KIND_COLOR[kind]];
      ctx.fill();
    }
    // cam cephe / cam bölme: pencere renginde şerit
    for (const g of m.curtains || []) {
      if (ov[g.id]?.deleted) continue;
      poly(g.poly);
      ctx.fillStyle = C.win;
      ctx.fill();
      ctx.strokeStyle = C.wallEdge;
      ctx.stroke();
    }
    // tefriş: açık dolgu + kenar
    for (const f of this.fixtures || []) {
      if (ov[f.id]?.deleted) continue;
      poly(f.poly);
      ctx.fillStyle = C.fixture;
      ctx.fill();
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 1 / scale;
      ctx.stroke();
    }
    if (m.outline) {
      poly(m.outline);
      ctx.setLineDash([10 / scale, 6 / scale]);
      ctx.strokeStyle = C.outline;
      ctx.lineWidth = 1.5 / scale;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // seçili
    const sel = this.selected && (findById(m, this.selected) || (this.fixtures || []).find((f) => f.id === this.selected));
    if (sel) {
      poly(sel.rect || sel.poly);
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 3 / scale;
      ctx.stroke();
    }
    // mahal etiketleri (ekran ölçeğinde)
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textAlign = 'center';
    const r0 = this.cv.getBoundingClientRect();
    for (const r of m.rooms) {
      if (ov[r.id]?.deleted) continue;
      const areaM2 = (Math.abs(r.area) * m.unitScale ** 2) / 1e4;
      const ppm = scale * (100 / m.unitScale); // piksel / metre
      if (Math.sqrt(areaM2) * ppm < 60) continue;
      const [x, y] = labelPoint(r.poly);
      const sx = (x - this.view.cx) * scale + r0.width / 2, sy = r0.height / 2 - (y - this.view.cy) * scale;
      const name = ov[r.id]?.name ?? r.name;
      ctx.fillStyle = C.ink;
      ctx.font = `600 12px ${C.fontUi}`;
      if (name) ctx.fillText(name, sx, sy - 2);
      ctx.font = `11px ${C.fontMono}`;
      ctx.fillStyle = C.muted;
      ctx.fillText(`${areaM2.toFixed(1)} m²`, sx, sy + 12);
    }
    ctx.textAlign = 'start';
  }

  hitTest(x, y) {
    const hm = this._hitMep(x, y);
    if (hm) return hm;
    const m = this.model;
    if (!m) return null;
    const ov = this.overrides;
    for (const o of m.openings) if (!ov[o.id]?.deleted && pointInPoly(x, y, o.rect)) return o.id;
    for (const f of this.fixtures || []) if (!ov[f.id]?.deleted && pointInPoly(x, y, f.poly)) return f.id;
    for (const g of m.curtains || []) if (!ov[g.id]?.deleted && pointInPoly(x, y, g.poly)) return g.id;
    for (const c of m.columns) if (!ov[c.id]?.deleted && pointInPoly(x, y, c.poly)) return c.id;
    for (const w of m.walls) if (!ov[w.id]?.deleted && pointInPoly(x, y, w.poly)) return w.id;
    // ince elemanlar için küçük tolerans: 6 piksel çevresini dene
    const t = 6 / this.view.scale;
    for (const [dx, dy] of [[t, 0], [-t, 0], [0, t], [0, -t]]) {
      for (const o of m.openings) if (!ov[o.id]?.deleted && pointInPoly(x + dx, y + dy, o.rect)) return o.id;
      for (const g of m.curtains || []) if (!ov[g.id]?.deleted && pointInPoly(x + dx, y + dy, g.poly)) return g.id;
      for (const w of m.walls) if (!ov[w.id]?.deleted && pointInPoly(x + dx, y + dy, w.poly)) return w.id;
    }
    for (const r of m.rooms) if (!ov[r.id]?.deleted && pointInPoly(x, y, r.poly)) return r.id;
    return null;
  }

  _bind() {
    const cv = this.cv;
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      const f = Math.exp(-e.deltaY * 0.0015);
      this.view.scale *= f;
      this.view.cx = wx - (wx - this.view.cx) / f;
      this.view.cy = wy - (wy - this.view.cy) / f;
      this.draw();
    }, { passive: false });
    cv.addEventListener('pointerdown', (e) => {
      cv.setPointerCapture(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const r = cv.getBoundingClientRect();
      const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      this._drag = { sx: e.clientX, sy: e.clientY, moved: false, region: this.regionMode, x0: wx, y0: wy, x1: wx, y1: wy };
      if (this._pointers.size === 2) this._pinch = this._pinchState();
    });
    cv.addEventListener('pointermove', (e) => {
      if (this.wallMode && this._wallStart) { const r = cv.getBoundingClientRect(); this._hover = this.toWorld(e.clientX - r.left, e.clientY - r.top); this.draw(); }
      if (!this._pointers.has(e.pointerId)) return;
      const prev = this._pointers.get(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._pointers.size === 2 && this._pinch) {
        const now = this._pinchState();
        const f = now.d / this._pinch.d;
        const r = cv.getBoundingClientRect();
        const [wx, wy] = this.toWorld(now.x - r.left, now.y - r.top);
        this.view.scale *= f;
        this.view.cx = wx - (wx - this.view.cx) / f;
        this.view.cy = wy - (wy - this.view.cy) / f;
        this._pinch = now;
        if (this._drag) this._drag.moved = true;
        this.draw();
        return;
      }
      const d = this._drag;
      if (!d) return;
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true;
      if (d.region) {
        const r = cv.getBoundingClientRect();
        [d.x1, d.y1] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
      } else {
        this.view.cx -= (e.clientX - prev.x) / this.view.scale;
        this.view.cy += (e.clientY - prev.y) / this.view.scale;
      }
      this.draw();
    });
    const up = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = null;
      const d = this._drag;
      if (!d || this._pointers.size) return;
      this._drag = null;
      if (this.wallMode && !d.moved) {
        // duvar çizimi: iki tıklama (yatay/dikeye yakınsa hizalanır)
        const r = cv.getBoundingClientRect();
        let [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        if (!this._wallStart) { this._wallStart = [wx, wy]; this.draw(); return; }
        const [sx, sy] = this._wallStart;
        if (Math.abs(wx - sx) > Math.abs(wy - sy) * 6) wy = sy; else if (Math.abs(wy - sy) > Math.abs(wx - sx) * 6) wx = sx;
        this._wallStart = null;
        this.onWall?.([sx, sy], [wx, wy]);
        this.draw();
        return;
      }
      if (d.region && d.moved) {
        this.regionMode = false;
        this.region = [Math.min(d.x0, d.x1), Math.min(d.y0, d.y1), Math.max(d.x0, d.x1), Math.max(d.y0, d.y1)];
        this.onRegion?.(this.region);
      } else if (!d.moved) {
        const r = cv.getBoundingClientRect();
        const [wx, wy] = this.toWorld(e.clientX - r.left, e.clientY - r.top);
        this.onSelect?.(this.hitTest(wx, wy));
      }
      this.draw();
    };
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
  }

  _pinchState() {
    const [a, b] = [...this._pointers.values()];
    return { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
}

export function findMepById(mep, id) {
  if (!mep || !id) return null;
  return mep.pipes.find((p) => p.id === id) || mep.ducts.find((d) => d.id === id) || mep.boxes.find((b) => b.id === id) || null;
}

export function findById(m, id) {
  if (!m || !id) return null;
  return m.openings.find((o) => o.id === id) || m.walls.find((w) => w.id === id)
    || m.columns.find((c) => c.id === id) || m.rooms.find((r) => r.id === id)
    || (m.curtains || []).find((g) => g.id === id) || null;
}

function labelPoint(poly) {
  // ağırlık merkezi; içeride değilse en uzun yatay kesitin ortası
  let a = 0, x = 0, y = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    const f = x1 * y2 - x2 * y1;
    a += f; x += (x1 + x2) * f; y += (y1 + y2) * f;
  }
  if (Math.abs(a) > 1e-9) { x /= 3 * a; y /= 3 * a; if (pointInPoly(x, y, poly)) return [x, y]; }
  const ys = poly.map((p) => p[1]).sort((p, q) => p - q);
  const yc = (ys[0] + ys[ys.length - 1]) / 2;
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    if ((y1 > yc) !== (y2 > yc)) xs.push(x1 + ((yc - y1) * (x2 - x1)) / (y2 - y1));
  }
  xs.sort((p, q) => p - q);
  let best = [poly[0][0], poly[0][1]], bw = -1;
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > bw) { bw = xs[i + 1] - xs[i]; best = [(xs[i] + xs[i + 1]) / 2, yc]; }
  return best;
}

// Açık temada çok açık (beyaz/sarı) DWG renklerini okunur hale getir
function darken(hex) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  if (lum > 150) { const f = 150 / lum; r *= f; g *= f; b *= f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}
