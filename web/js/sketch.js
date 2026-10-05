// Sohbetle üretilen 2B çizimler ("eskizler"): serbest varlıklar (çizgi, polyline, daire, yay, yazı)
// ve desen üreticileri (yerden ısıtma serpantini, ızgara). DXF olarak dışa aktarılır
// (AutoCAD açar; "Farklı kaydet → DWG"). Geometri çizim birimindedir; k = çizim birimi / cm.

import { pointInPoly, polyArea } from './detect.js';

// --- desenler ------------------------------------------------------------
// Yatay tarama çizgisinin çokgenle kesişim aralıkları (x0,x1 çiftleri)
function scanSpans(poly, y) {
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a[1] > y) !== (b[1] > y)) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
  }
  xs.sort((p, q) => p - q);
  const spans = [];
  for (let i = 0; i + 1 < xs.length; i += 2) spans.push([xs[i], xs[i + 1]]);
  return spans;
}
// Çokgeni içe doğru küçült (yaklaşık: merkezden ölçekleme yerine kenar dibi payı için tarama sınırlarını daraltma)
function insetSpan([x0, x1], m) { return x1 - x0 > 2 * m ? [x0 + m, x1 - m] : null; }

// Çokgen kenarlarının yönüne göre tarama açısı (uzun kenara paralel); poly döndürülerek tarama yapılır
function dominantAngle(poly) {
  let best = 0, ang = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  return ang;
}
const rot = (p, c, s) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c];

// Serpantin (yerden ısıtma / kılcal): pitch aralıklı, kenarlardan margin içeride, tek polyline.
// startNear: [x,y] verilirse serpantin o köşeden başlar (kolektör tarafı).
export function serpentine({ poly, pitchCm, marginCm = 20, k, startNear = null, angleDeg = null }) {
  const ang = angleDeg == null ? dominantAngle(poly) : (angleDeg * Math.PI) / 180;
  const c = Math.cos(-ang), s = Math.sin(-ang);
  const lp = poly.map((p) => rot(p, c, s));
  const pitch = pitchCm * k, m = marginCm * k;
  let y0 = Infinity, y1 = -Infinity;
  for (const p of lp) { y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
  const rows = [];
  for (let y = y0 + m + pitch / 2; y <= y1 - m; y += pitch) {
    const spans = scanSpans(lp, y).map((sp) => insetSpan(sp, m)).filter(Boolean);
    if (!spans.length) continue;
    // birden çok aralık (L biçimli mahal): en uzun aralığı kullan
    const sp = spans.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
    rows.push({ y, x0: sp[0], x1: sp[1] });
  }
  if (rows.length < 2) return null;
  // başlangıç köşesi
  let fromTop = false, fromRight = false;
  if (startNear) {
    const sn = rot(startNear, c, s);
    fromTop = Math.abs(sn[1] - rows[rows.length - 1].y) < Math.abs(sn[1] - rows[0].y);
    fromRight = Math.abs(sn[0] - rows[0].x1) < Math.abs(sn[0] - rows[0].x0);
  }
  if (fromTop) rows.reverse();
  const pts = [];
  rows.forEach((r, i) => {
    const leftFirst = (i % 2 === 0) !== fromRight;
    const a = leftFirst ? [r.x0, r.y] : [r.x1, r.y], b = leftFirst ? [r.x1, r.y] : [r.x0, r.y];
    pts.push(a, b);
  });
  const ci = Math.cos(ang), si = Math.sin(ang);
  const world = pts.map((p) => rot(p, ci, si));
  let L = 0; for (let i = 1; i < world.length; i++) L += Math.hypot(world[i][0] - world[i - 1][0], world[i][1] - world[i - 1][1]);
  return { pts: world, lengthCm: L / k, rows: rows.length };
}

// Izgara (ör. tavan modülü, karo, aks): aralık sp, çokgen içinde kalan çizgiler
export function gridLines({ poly, spacingCm, k, marginCm = 0 }) {
  const sp = spacingCm * k, m = marginCm * k;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of poly) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  const lines = [];
  for (let y = y0 + sp; y < y1; y += sp) for (const [a, b] of scanSpans(poly, y)) if (b - a > 2 * m) lines.push([a + m, y, b - m, y]);
  const tp = poly.map(([x, y]) => [y, x]);
  for (let x = x0 + sp; x < x1; x += sp) for (const [a, b] of scanSpans(tp, x)) if (b - a > 2 * m) lines.push([x, a + m, x, b - m]);
  return lines;
}

// --- DXF yazıcı (R12 ASCII; AutoCAD, BricsCAD, LibreCAD, QCAD açar) ----------------------
// entities: [{type:'line', pts:[x1,y1,x2,y2]}, {type:'polyline', pts:[[x,y],...], closed}, {type:'circle', center, r},
//            {type:'arc', center, r, a0, a1 (derece)}, {type:'text', at:[x,y], text, h, rot}] her birinde layer
export function writeDxf(entities, { layers = [], unitCode = 5 } = {}) {
  const f = (v) => (Math.round(v * 1000) / 1000).toString();
  const out = [];
  const w = (code, val) => { out.push(String(code), String(val)); };
  w(0, 'SECTION'); w(2, 'HEADER'); w(9, '$INSUNITS'); w(70, unitCode); w(9, '$ACADVER'); w(1, 'AC1009'); w(0, 'ENDSEC');
  const names = [...new Set(['0', ...layers.map((l) => l.name), ...entities.map((e) => e.layer || '0')])];
  w(0, 'SECTION'); w(2, 'TABLES'); w(0, 'TABLE'); w(2, 'LAYER'); w(70, names.length);
  for (const n of names) { const l = layers.find((x) => x.name === n); w(0, 'LAYER'); w(2, n); w(70, 0); w(62, l?.color ?? 7); w(6, 'CONTINUOUS'); }
  w(0, 'ENDTAB'); w(0, 'ENDSEC');
  w(0, 'SECTION'); w(2, 'ENTITIES');
  for (const e of entities) {
    const L = e.layer || '0';
    if (e.type === 'line') { w(0, 'LINE'); w(8, L); w(10, f(e.pts[0])); w(20, f(e.pts[1])); w(30, 0); w(11, f(e.pts[2])); w(21, f(e.pts[3])); w(31, 0); }
    else if (e.type === 'polyline') {
      w(0, 'POLYLINE'); w(8, L); w(66, 1); w(70, e.closed ? 1 : 0); if (e.width) { w(40, f(e.width)); w(41, f(e.width)); }
      for (const p of e.pts) { w(0, 'VERTEX'); w(8, L); w(10, f(p[0])); w(20, f(p[1])); w(30, 0); }
      w(0, 'SEQEND'); w(8, L);
    } else if (e.type === 'circle') { w(0, 'CIRCLE'); w(8, L); w(10, f(e.center[0])); w(20, f(e.center[1])); w(30, 0); w(40, f(e.r)); }
    else if (e.type === 'arc') { w(0, 'ARC'); w(8, L); w(10, f(e.center[0])); w(20, f(e.center[1])); w(30, 0); w(40, f(e.r)); w(50, f(e.a0)); w(51, f(e.a1)); }
    else if (e.type === 'text') { w(0, 'TEXT'); w(8, L); w(10, f(e.at[0])); w(20, f(e.at[1])); w(30, 0); w(40, f(e.h || 10)); w(1, String(e.text).replace(/[\r\n]+/g, ' ')); if (e.rot) w(50, f(e.rot)); }
  }
  w(0, 'ENDSEC'); w(0, 'EOF');
  return out.join('\r\n') + '\r\n';
}

// Algılanan modeli DXF varlıklarına çevir (orijinal plan koordinatlarında; eskizle birlikte referans için)
export function modelEntities(model, overrides = {}) {
  const out = [];
  const ok = (id) => !overrides[id]?.deleted;
  for (const w of model.walls) if (ok(w.id)) out.push({ type: 'polyline', layer: 'BIM-DUVAR', pts: w.poly, closed: true });
  for (const c of model.columns) if (ok(c.id)) out.push({ type: 'polyline', layer: 'BIM-KOLON', pts: c.poly, closed: true });
  for (const g of model.curtains || []) if (ok(g.id)) out.push({ type: 'polyline', layer: 'BIM-CAM-CEPHE', pts: g.poly, closed: true });
  for (const o of model.openings) { const kind = overrides[o.id]?.kind || o.kind; if (ok(o.id) && kind !== 'empty') out.push({ type: 'polyline', layer: kind === 'door' ? 'BIM-KAPI' : kind === 'window' ? 'BIM-PENCERE' : 'BIM-DOLGU', pts: o.rect, closed: true }); }
  for (const r of model.rooms) if (ok(r.id)) { out.push({ type: 'polyline', layer: 'BIM-MAHAL', pts: r.poly, closed: true }); const c = centroidOf(r.poly); const nm = overrides[r.id]?.name ?? r.name; if (nm) out.push({ type: 'text', layer: 'BIM-MAHAL', at: c, text: nm, h: 25 / (model.unitScale || 1) }); }
  return out;
}
function centroidOf(p) { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; }

export function fixtureEntities(fixtures, overrides = {}) {
  return fixtures.filter((f) => !overrides[f.id]?.deleted).map((f) => ({ type: 'polyline', layer: 'BIM-TEFRIS', pts: f.poly, closed: true }));
}

// eskiz varlıklarını doğrula / normalize et (Claude'dan gelen ham girdi)
export function normalizeEntities(list, layer = 'ESKIZ') {
  const out = [];
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e !== 'object') continue;
    const L = String(e.layer || layer).slice(0, 40);
    const t = String(e.type || '').toLowerCase();
    const num = (v) => (Number.isFinite(+v) ? +v : null);
    if (t === 'line' && Array.isArray(e.pts) && e.pts.length === 4 && e.pts.every((v) => num(v) != null)) out.push({ type: 'line', layer: L, pts: e.pts.map(Number) });
    else if (t === 'polyline' && Array.isArray(e.pts) && e.pts.length >= 2) { const pts = e.pts.map((p) => (Array.isArray(p) && p.length >= 2 ? [+p[0], +p[1]] : null)).filter((p) => p && p.every(Number.isFinite)); if (pts.length >= 2) out.push({ type: 'polyline', layer: L, pts, closed: !!e.closed, width: num(e.width) || 0 }); }
    else if (t === 'circle' && Array.isArray(e.center) && num(e.r) > 0) out.push({ type: 'circle', layer: L, center: [+e.center[0], +e.center[1]], r: +e.r });
    else if (t === 'arc' && Array.isArray(e.center) && num(e.r) > 0) out.push({ type: 'arc', layer: L, center: [+e.center[0], +e.center[1]], r: +e.r, a0: num(e.a0) || 0, a1: num(e.a1) ?? 90 });
    else if (t === 'text' && Array.isArray(e.at) && e.text) out.push({ type: 'text', layer: L, at: [+e.at[0], +e.at[1]], text: String(e.text).slice(0, 200), h: num(e.h) || 10, rot: num(e.rot) || 0 });
  }
  return out;
}

export const polyAreaAbs = (p) => Math.abs(polyArea(p));
export const inside = (x, y, p) => pointInPoly(x, y, p);
