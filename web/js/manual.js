// Sohbetle (Claude) ya da elle eklenen, çizimde olmayan öğeler: mahale yerleştirilen tefriş,
// duvara açılan kapı/pencere, kolon. Geometri çizim birimindedir; k = çizim birimi / cm.

import { pointInPoly, polyArea } from './detect.js';
import { FIXTURE_KINDS } from './fixtures.js';

// Hazır takımlar: ana parça + çevresindeki parçalar (cm, yerel: x sağa, y ileri)
export const SETS = {
  table_set: { label: 'Masa + 4 sandalye', main: ['table', 120, 80], around: [['chair', 45, 45, 0, -65], ['chair', 45, 45, 0, 65], ['chair', 45, 45, -85, 0], ['chair', 45, 45, 85, 0]] },
  meeting_set: { label: 'Toplantı masası + 8 sandalye', main: ['table', 300, 110], around: [[-100, -80], [0, -80], [100, -80], [-100, 80], [0, 80], [100, 80], [-175, 0], [175, 0]].map(([x, y]) => ['chair', 45, 45, x, y]) },
  desk_set: { label: 'Çalışma masası + sandalye', main: ['desk', 140, 70], around: [['chair', 50, 50, 0, -65]] },
  sofa_set: { label: 'Kanepe + sehpa', main: ['sofa', 200, 85], around: [['table', 90, 50, 0, -90]] },
  bed_set: { label: 'Yatak + 2 komodin', main: ['bed', 160, 200], around: [['cabinet', 45, 40, -105, 80], ['cabinet', 45, 40, 105, 80]] },
  wc_set: { label: 'Klozet + lavabo', main: ['wc', 40, 70], around: [['sink', 50, 45, 80, 10]] },
};

const rectPoly = (cx, cy, w, d, rot) => {
  const c = Math.cos(rot), s = Math.sin(rot);
  const T = (x, y) => [cx + x * c - y * s, cy + x * s + y * c];
  return [T(-w / 2, -d / 2), T(w / 2, -d / 2), T(w / 2, d / 2), T(-w / 2, d / 2)];
};
const centroid = (p) => { let x = 0, y = 0; for (const q of p) { x += q[0]; y += q[1]; } return [x / p.length, y / p.length]; };

// Bir dikdörtgen mahalin içinde mi ve engellerle (duvar, kolon, tefriş) çakışıyor mu?
function fits(poly, room, obstacles) {
  const c = centroid(poly);
  if (!pointInPoly(c[0], c[1], room)) return false;
  for (const p of poly) if (!pointInPoly(p[0], p[1], room)) return false;
  for (const o of obstacles) {
    const oc = centroid(o);
    if (pointInPoly(oc[0], oc[1], poly) || pointInPoly(c[0], c[1], o)) return false;
    for (const p of poly) if (pointInPoly(p[0], p[1], o)) return false;
    for (const p of o) if (pointInPoly(p[0], p[1], poly)) return false;
  }
  return true;
}

// Mahalin baskın kenar yönü (uzun duvara paralel yerleşim için)
function roomAxis(room) {
  let best = 0, ang = 0;
  for (let i = 0; i < room.length; i++) {
    const a = room[i], b = room[(i + 1) % room.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; ang = Math.atan2(b[1] - a[1], b[0] - a[0]); }
  }
  return ang;
}

// Bir öğe tanımı (tek tür ya da takım) için yer kaplama: [w, d] cm ve parçalar
function spec(kind, sizeCm, lib = null) {
  const li = lib?.get?.(kind);
  if (li && li.kind !== 'ignore') {
    const [w, d] = sizeCm && sizeCm.length === 2 ? sizeCm : li.sizeCm;
    return { w, d, parts: [[li.kind, w, d, 0, 0, li.name]], label: li.label };
  }
  const set = SETS[kind];
  if (set) {
    const [mk, mw, md] = set.main;
    let minX = -mw / 2, maxX = mw / 2, minY = -md / 2, maxY = md / 2;
    for (const [, w, d, x, y] of set.around) { minX = Math.min(minX, x - w / 2); maxX = Math.max(maxX, x + w / 2); minY = Math.min(minY, y - d / 2); maxY = Math.max(maxY, y + d / 2); }
    return { w: maxX - minX, d: maxY - minY, parts: [[mk, mw, md, 0, 0], ...set.around], label: set.label };
  }
  const fk = FIXTURE_KINDS[kind];
  if (!fk) return null;
  const [w, d] = sizeCm && sizeCm.length === 2 ? sizeCm : fk.size;
  return { w, d, parts: [[kind, w, d, 0, 0]], label: fk.label };
}

// Mahale yerleşim: layout grid (satır-sütun), row (tek sıra), perimeter (duvar dibi).
// Döndürür: [{kind, poly, center, rot, wCm, hCm}] (çizim biriminde)
export function layoutInRoom({ room, kind, count = 0, sizeCm = null, layout = 'grid', spacingCm = 60, marginCm = 50, rotDeg = null, obstacles = [], k, lib = null }) {
  const sp = spec(kind, sizeCm, lib);
  if (!sp) throw new Error('bilinmeyen tür: ' + kind);
  const rot = rotDeg == null ? roomAxis(room.poly) : (rotDeg * Math.PI) / 180;
  const W = sp.w * k, D = sp.d * k, gap = spacingCm * k, margin = marginCm * k;
  const c = Math.cos(rot), s = Math.sin(rot);
  // mahali yerel eksene çevir
  const toLocal = (p) => [(p[0]) * c + (p[1]) * s, -(p[0]) * s + (p[1]) * c];
  const toWorld = (x, y) => [x * c - y * s, x * s + y * c];
  const lp = room.poly.map(toLocal);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of lp) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const want = count > 0 ? Math.min(count, 200) : 200;
  const out = [];
  const place = (lx, ly) => {
    const [wx, wy] = toWorld(lx, ly);
    const poly = rectPoly(wx, wy, W, D, rot);
    if (!fits(poly, room.poly, obstacles.concat(out.map((o) => o.foot)))) return false;
    const items = sp.parts.map(([pk, pw, pd, px, py, ln]) => {
      const [ox, oy] = toWorld(lx + px * k, ly + py * k);
      return { kind: pk, poly: rectPoly(ox, oy, pw * k, pd * k, rot), center: [ox, oy], rot, wCm: pw, hCm: pd, lib: ln };
    });
    out.push({ foot: poly, items });
    return true;
  };
  if (layout === 'perimeter') {
    // duvar dibi: kenar boyunca, içe doğru D/2 + margin
    for (let i = 0; i < room.poly.length && out.length < want; i++) {
      const a = room.poly[i], b = room.poly[(i + 1) % room.poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < W + 2 * margin) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const inward = polyArea(room.poly) > 0 ? [-uy, ux] : [uy, -ux];
      const n = Math.floor((L - 2 * margin + gap) / (W + gap));
      const start = margin + ((L - 2 * margin) - (n * (W + gap) - gap)) / 2;
      const r = Math.atan2(uy, ux);
      for (let j = 0; j < n && out.length < want; j++) {
        const t = start + j * (W + gap) + W / 2;
        const cx = a[0] + ux * t + inward[0] * (D / 2 + margin * 0.3), cy = a[1] + uy * t + inward[1] * (D / 2 + margin * 0.3);
        const poly = rectPoly(cx, cy, W, D, r);
        if (!fits(poly, room.poly, obstacles.concat(out.map((o) => o.foot)))) continue;
        const items = sp.parts.map(([pk, pw, pd, px, py, ln]) => {
          const ox = cx + Math.cos(r) * px * k - Math.sin(r) * py * k, oy = cy + Math.sin(r) * px * k + Math.cos(r) * py * k;
          return { kind: pk, poly: rectPoly(ox, oy, pw * k, pd * k, r), center: [ox, oy], rot: r, wCm: pw, hCm: pd, lib: ln };
        });
        out.push({ foot: poly, items });
      }
    }
  } else {
    const cols = Math.max(1, Math.floor((x1 - x0 - 2 * margin + gap) / (W + gap)));
    const rows = layout === 'row' ? 1 : Math.max(1, Math.floor((y1 - y0 - 2 * margin + gap) / (D + gap)));
    const gw = cols * (W + gap) - gap, gh = rows * (D + gap) - gap;
    const sx = (x0 + x1) / 2 - gw / 2 + W / 2, sy = (y0 + y1) / 2 - gh / 2 + D / 2;
    for (let r = 0; r < rows && out.length < want; r++) for (let q = 0; q < cols && out.length < want; q++) place(sx + q * (W + gap), sy + r * (D + gap));
    // düzenli ızgara sığmadıysa (dolu / düzensiz mahal): ince adımlarla tarayarak açgözlü yerleştir
    if (!out.length || out.length < want) {
      const stepX = Math.max((W + gap) / 2, 10 * k), stepY = Math.max((D + gap) / 2, 10 * k);
      for (let ly = y0 + margin / 2 + D / 2; ly <= y1 - margin / 2 - D / 2 && out.length < want; ly += stepY) {
        for (let lx = x0 + margin / 2 + W / 2; lx <= x1 - margin / 2 - W / 2 && out.length < want; lx += stepX) place(lx, ly);
        if (layout === 'row' && out.length) break;
      }
    }
  }
  return { label: sp.label, groups: out.length, items: out.flatMap((o) => o.items) };
}

// Tek öğe: belirli noktaya
export function fixtureAt({ kind, x, y, sizeCm = null, rotDeg = 0, k, lib = null }) {
  const sp = spec(kind, sizeCm, lib);
  if (!sp) throw new Error('bilinmeyen tür: ' + kind);
  const rot = (rotDeg * Math.PI) / 180;
  return { label: sp.label, groups: 1, items: sp.parts.map(([pk, pw, pd, px, py, ln]) => {
    const ox = x + Math.cos(rot) * px * k - Math.sin(rot) * py * k, oy = y + Math.sin(rot) * px * k + Math.cos(rot) * py * k;
    return { kind: pk, poly: rectPoly(ox, oy, pw * k, pd * k, rot), center: [ox, oy], rot, wCm: pw, hCm: pd, lib: ln };
  }) };
}

// Duvar çokgeninin uzun ekseni (merkez, u, v, yerel aralık, kalınlık)
export function wallFrame(poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || L > best.L) best = { L, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
  }
  const u = best.u, v = [-u[1], u[0]];
  const c = centroid(poly);
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (const p of poly) {
    const a = (p[0] - c[0]) * u[0] + (p[1] - c[1]) * u[1], b = (p[0] - c[0]) * v[0] + (p[1] - c[1]) * v[1];
    lo = Math.min(lo, a); hi = Math.max(hi, a); lo2 = Math.min(lo2, b); hi2 = Math.max(hi2, b);
  }
  return { c: [c[0] + v[0] * (lo2 + hi2) / 2, c[1] + v[1] * (lo2 + hi2) / 2], u, v, lo, hi, L: hi - lo, T: hi2 - lo2 };
}

// Duvara kapı / pencere: atCm duvarın başından (düşük u ucundan) mesafe; null ise ortaya
export function openingOnWall({ wall, kind = 'door', widthCm = 90, atCm = null, k }) {
  const f = wallFrame(wall.poly);
  const w = widthCm * k;
  if (w >= f.L - 10 * k) throw new Error(`duvar ${(f.L / k).toFixed(0)} cm; ${widthCm} cm boşluk sığmaz`);
  let a0 = atCm == null ? f.lo + (f.L - w) / 2 : f.lo + atCm * k;
  a0 = Math.max(f.lo + 5 * k, Math.min(f.hi - 5 * k - w, a0));
  const p0 = [f.c[0] + f.u[0] * a0, f.c[1] + f.u[1] * a0];
  const A = [p0[0] - f.v[0] * f.T / 2, p0[1] - f.v[1] * f.T / 2], B = [p0[0] + f.v[0] * f.T / 2, p0[1] + f.v[1] * f.T / 2];
  const rect = [A, B, [B[0] + f.u[0] * w, B[1] + f.u[1] * w], [A[0] + f.u[0] * w, A[1] + f.u[1] * w]];
  const mid = a0 + w / 2;
  return {
    kind, rect, center: [f.c[0] + f.u[0] * mid, f.c[1] + f.u[1] * mid], width: w, thickness: f.T,
    along: f.u, across: f.v, exterior: !!wall.exterior, hostWall: wall.id, weak: false, manual: true,
    why: 'Sohbetle eklendi (çizimde yok)', marker: kind, span: [a0 - f.lo, a0 - f.lo + w],
  };
}

// Duvarı, üzerindeki elle açılmış boşluklara göre parçalara böler (yerel eksen boyunca aralıklar)
export function cutWall(poly, spans) {
  const f = wallFrame(poly);
  const cuts = spans.map(([a, b]) => [f.lo + a, f.lo + b]).sort((p, q) => p[0] - q[0]);
  const pieces = [];
  let s = f.lo;
  for (const [a, b] of cuts) { if (a - s > 1e-9) pieces.push([s, a]); s = Math.max(s, b); }
  if (f.hi - s > 1e-9) pieces.push([s, f.hi]);
  const P = (a) => [f.c[0] + f.u[0] * a, f.c[1] + f.u[1] * a];
  return pieces.map(([a, b]) => {
    const pa = P(a), pb = P(b);
    return [[pa[0] - f.v[0] * f.T / 2, pa[1] - f.v[1] * f.T / 2], [pb[0] - f.v[0] * f.T / 2, pb[1] - f.v[1] * f.T / 2], [pb[0] + f.v[0] * f.T / 2, pb[1] + f.v[1] * f.T / 2], [pa[0] + f.v[0] * f.T / 2, pa[1] + f.v[1] * f.T / 2]];
  });
}

export function columnAt({ x, y, sizeCm = [40, 40], rotDeg = 0, k }) {
  return { poly: rectPoly(x, y, sizeCm[0] * k, (sizeCm[1] || sizeCm[0]) * k, (rotDeg * Math.PI) / 180), manual: true };
}

// Mevcut (algılanmış) boşluğu başka konuma taşımak: eski yer dolu sayılır, yeni yer duvara açılır.
// Yeni merkez = eski merkez + along * shiftCm; duvar çerçevesine izdüşürülüp sınırlanır.
export function shiftedOpening({ opening, wall, shiftCm, widthCm, k }) {
  const f = wallFrame(wall.poly);
  const w = (widthCm || opening.width / k) * k;
  const cx = opening.center[0] + opening.along[0] * shiftCm * k, cy = opening.center[1] + opening.along[1] * shiftCm * k;
  const a = (cx - f.c[0]) * f.u[0] + (cy - f.c[1]) * f.u[1];
  return openingOnWall({ wall, kind: opening.kind, widthCm: w / k, atCm: (a - w / 2 - f.lo) / k, k });
}
