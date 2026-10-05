// Algılanan 2B modeli + parametreleri, metre cinsinden 3B katılara çevirir.
// Hem 3B görünüm hem de IFC yazıcı bu listeyi kullanır.

import { polyArea, pointInPoly } from './detect.js';
import { cutWall } from './manual.js';

export const DEFAULT_BUILD = {
  projectName: '',
  storeyName: 'Zemin Kat',
  levelCm: 0,
  wallHeightCm: 300,
  slabThicknessCm: 15,
  makeFloor: true,
  makeRoof: false,
  roofThicknessCm: 20,
  doorHeightCm: 210,
  windowSillCm: 90,
  windowHeightCm: 150,
  makeSpaces: true,
};

// Element tipleri: wall, column, slab, roof, lintel, sill, door, window, curtain, fixture, space
// Her katı: {type, id, src, name, profile, z0, z1, props}; kapı, pencere, cam cephe ve tefriş
// ayrıca parts: [{profile, z0, z1, mat}] taşır (kasa, kanat, cam, seramik...). profile/z0/z1
// yine bütünün kapladığı kutudur (seçim ve sınır kutusu için).
export function buildSolids(model, params, overrides = {}) {
  const P = { ...DEFAULT_BUILD, ...params };
  const s = model.unitScale / 100; // çizim birimi -> metre
  const all = [...model.walls, ...model.columns].flatMap((w) => w.poly);
  let ox = Infinity, oy = Infinity;
  for (const [x, y] of all) { if (x < ox) ox = x; if (y < oy) oy = y; }
  if (!all.length) {
    // duvar yoksa (salt tesisat paftası) başlangıç noktası tesisattan alınır
    const m = params.mep;
    const pts = m ? [...m.pipes.flatMap((p) => p.pts), ...m.ducts.flatMap((d) => d.poly), ...m.boxes.flatMap((b) => b.poly)] : [];
    for (const f of params.fixtures || []) pts.push(...f.poly);
    for (const g of model.curtains || []) pts.push(...g.poly);
    if (!pts.length) return { solids: [], origin: [0, 0], scale: s, P };
    for (const [x, y] of pts) { if (x < ox) ox = x; if (y < oy) oy = y; }
  }
  const tr = (p) => [(p[0] - ox) * s, (p[1] - oy) * s];
  const ccw = (poly) => (polyArea(poly) < 0 ? poly.slice().reverse() : poly);
  const H = P.wallHeightCm / 100;
  const out = [];
  const ov = (id) => overrides[id] || {};
  const wallPolysM = []; // tefriş yönü için (metre)

  for (const w of model.walls) {
    const o = ov(w.id);
    if (o.deleted) continue;
    const h = (o.heightCm ?? P.wallHeightCm) / 100;
    // sohbetle açılan kapı/pencereler: duvar o aralıklarda kesilir
    const cuts = model.openings.filter((op) => op.manual && op.hostWall === w.id && !ov(op.id).deleted && (ov(op.id).kind || op.kind) !== 'solid').map((op) => op.span);
    const polys = cuts.length ? cutWall(w.poly, cuts) : [w.poly];
    polys.forEach((poly, i) => {
      const profile = ccw(poly.map(tr));
      wallPolysM.push(profile);
      out.push({
        type: 'wall', id: polys.length > 1 ? `${w.id}-p${i + 1}` : w.id, src: w.id, name: `Duvar ${Math.round(w.thickness * model.unitScale)} cm`,
        profile, z0: 0, z1: h,
        props: { exterior: !!w.exterior, thicknessCm: Math.round(w.thickness * model.unitScale), lengthM: +(w.length * s || 0).toFixed(2) },
      });
    });
  }
  for (const c of model.columns) {
    const o = ov(c.id);
    if (o.deleted) continue;
    out.push({ type: 'column', id: c.id, src: c.id, name: 'Kolon', profile: ccw(c.poly.map(tr)), z0: 0, z1: (o.heightCm ?? P.wallHeightCm) / 100, props: {} });
  }
  // bina merkezi (kapı kanatlarının açılış yönü için)
  const bc = [0, 0];
  { let n = 0; for (const pr of wallPolysM) for (const p of pr) { bc[0] += p[0]; bc[1] += p[1]; n++; } if (n) { bc[0] /= n; bc[1] /= n; } }
  // yerel çerçevede kutu: merkez (cx,cy) metre, eksenler al/ac birim vektör
  const boxAt = (cx, cy, al, ac, w, d, z0, z1, mat) => ({
    profile: ccw([
      [cx - al[0] * w / 2 - ac[0] * d / 2, cy - al[1] * w / 2 - ac[1] * d / 2],
      [cx + al[0] * w / 2 - ac[0] * d / 2, cy + al[1] * w / 2 - ac[1] * d / 2],
      [cx + al[0] * w / 2 + ac[0] * d / 2, cy + al[1] * w / 2 + ac[1] * d / 2],
      [cx - al[0] * w / 2 + ac[0] * d / 2, cy - al[1] * w / 2 + ac[1] * d / 2],
    ]), z0, z1, mat,
  });
  for (const op of model.openings) {
    const o = ov(op.id);
    if (o.deleted) continue;
    const kind = o.kind || op.kind;
    const rect = ccw(op.rect.map(tr));
    const host = ov(op.hostWall);
    const top = (host.heightCm ?? P.wallHeightCm) / 100;
    const widthCm = Math.round(op.width * model.unitScale);
    if (kind === 'empty') continue;
    if (kind === 'solid') {
      // dolu: boşluk duvarla kapatılır (taşıyıcı tarama, cam izi olmayan dar parça vb.)
      out.push({ type: 'wall', id: op.id + '-F', src: op.id, name: `Dolgu duvar ${op.id}`, profile: rect, z0: 0, z1: top, props: { exterior: !!op.exterior, thicknessCm: Math.round(op.thickness * model.unitScale), lengthM: +(op.width * s).toFixed(2) } });
      continue;
    }
    const [cx, cy] = tr(op.center);
    const al = op.along, ac = op.across;
    const W = op.width * s, T = Math.max(op.thickness * s, 0.06);
    const at = (u, v, w, d, z0, z1, mat) => boxAt(cx + al[0] * u + ac[0] * v, cy + al[1] * u + ac[1] * v, al, ac, w, d, z0, z1, mat);
    if (kind === 'door') {
      const dh = (o.heightCm ?? P.doorHeightCm) / 100;
      const j = 0.05, fd = Math.min(T, 0.12); // kasa genişliği, kasa derinliği
      const parts = [
        at(-W / 2 + j / 2, 0, j, fd, 0, dh, 'frame'), at(W / 2 - j / 2, 0, j, fd, 0, dh, 'frame'), at(0, 0, W, fd, dh - j, dh, 'frame'),
      ];
      // kanat(lar) kapalı: duvar düzleminde, kasanın içinde; kol serbest uca yakın iki yüzden çıkar
      const leaves = W >= 1.4 ? 2 : 1;
      const lw = (W - 2 * j - (leaves - 1) * 0.01) / leaves;
      for (let i = 0; i < leaves; i++) {
        const u = -W / 2 + j + lw / 2 + i * (lw + 0.01);
        parts.push(at(u, 0, lw, 0.045, 0.01, dh - j, 'leaf'));
        const hu = leaves === 1 ? W / 2 - j - 0.08 : (i === 0 ? u + lw / 2 - 0.08 : u - lw / 2 + 0.08);
        parts.push(at(hu, 0, 0.12, 0.045 + 0.1, 0.98, 1.01, 'chrome'));
      }
      out.push({ type: 'door', id: op.id, src: op.id, name: `Kapı ${widthCm}`, profile: rect, z0: 0, z1: dh, parts, props: { widthM: widthCm / 100, heightM: dh, exterior: op.exterior, leaves } });
      if (top - dh > 0.01) out.push({ type: 'lintel', id: op.id + '-L', src: op.id, name: `Lento ${op.id}`, profile: rect, z0: dh, z1: top, props: {} });
    } else {
      const full = !!op.fullHeight; // geniş dış cam: vitrin / cam cephe gibi parapetsiz, tam yükseklik
      const sill = (o.sillCm ?? (full ? 0 : P.windowSillCm)) / 100;
      const wh = (o.heightCm ?? (full ? top * 100 - 2 : P.windowHeightCm)) / 100;
      const head = Math.min(top, sill + wh);
      if (sill > 0.01) out.push({ type: 'sill', id: op.id + '-S', src: op.id, name: `Parapet ${op.id}`, profile: rect, z0: 0, z1: sill, props: {} });
      const j = 0.05, fd = Math.min(T, 0.08);
      const parts = [
        at(0, 0, W + 0.04, T + 0.04, Math.max(0, sill - 0.03), sill, 'sillstone'), // denizlik
        at(-W / 2 + j / 2, 0, j, fd, sill, head, 'wframe'), at(W / 2 - j / 2, 0, j, fd, sill, head, 'wframe'),
        at(0, 0, W, fd, head - j, head, 'wframe'), at(0, 0, W, fd, sill, sill + j, 'wframe'),
      ];
      const n = Math.max(1, Math.ceil((W - 2 * j) / 1.2)); // kanat sayısı
      const pw = (W - 2 * j) / n;
      for (let i = 1; i < n; i++) parts.push(at(-W / 2 + j + i * pw, 0, 0.04, fd, sill, head, 'wframe'));
      if (head - sill > 1.8) parts.push(at(0, 0, W, fd, sill + (head - sill) * 0.7, sill + (head - sill) * 0.7 + 0.04, 'wframe')); // kayıt
      parts.push(at(0, 0, W - 2 * j, 0.015, sill + j, head - j, 'glass'));
      out.push({ type: 'window', id: op.id, src: op.id, name: `${full ? 'Cam cephe (pencere)' : 'Pencere'} ${widthCm}x${Math.round((head - sill) * 100)}`, profile: rect, z0: sill, z1: head, parts, props: { widthM: widthCm / 100, heightM: +(head - sill).toFixed(3), sillM: sill, exterior: op.exterior, panels: n, fullHeight: full } });
      if (top - head > 0.01) out.push({ type: 'lintel', id: op.id + '-L', src: op.id, name: `Lento ${op.id}`, profile: rect, z0: head, z1: top, props: {} });
    }
  }
  // Cam giydirme cephe / cam bölme: tam yükseklik cam + dikmeler + kayıtlar
  for (const g of model.curtains || []) {
    const o = ov(g.id);
    if (o.deleted) continue;
    const h = (o.heightCm ?? P.wallHeightCm) / 100;
    const poly = ccw(g.poly.map(tr));
    const fr = longAxis(poly);
    const L = fr.L, T = Math.max(fr.T, 0.05);
    const al = fr.u, ac = fr.v, [cx, cy] = fr.c;
    const at = (u, v, w, d, z0, z1, mat) => boxAt(cx + al[0] * u + ac[0] * v, cy + al[1] * u + ac[1] * v, al, ac, w, d, z0, z1, mat);
    const parts = [at(0, 0, L, T, 0, 0.1, 'mullion'), at(0, 0, L, T, h - 0.06, h, 'mullion')];
    const n = Math.max(1, Math.round(L / 1.2));
    for (let i = 0; i <= n; i++) parts.push(at(-L / 2 + (L / n) * i, 0, 0.06, T, 0, h, 'mullion'));
    if (h > 2.4) parts.push(at(0, 0, L, T, 2.1, 2.16, 'mullion'));
    parts.push(at(0, 0, L, 0.015, 0.1, h - 0.06, 'glass'));
    out.push({ type: 'curtain', id: g.id, src: g.id, name: `Cam cephe ${(L).toFixed(1)} m`, profile: poly, z0: 0, z1: h, parts, props: { lengthM: +L.toFixed(2), heightM: h, thicknessCm: Math.round(g.thickness * model.unitScale) } });
  }
  // Tefriş: klozet, lavabo, klima vb. parametrik parçalar
  const ceilM = (params.ceilingCm ?? 280) / 100;
  for (const f of params.fixtures || []) {
    const o = ov(f.id);
    if (o.deleted) continue;
    const poly = ccw(f.poly.map(tr));
    const fr = f.facing != null ? facingFrame(poly, f.facing) : fixtureFrame(poly, wallPolysM);
    const parts = f.libParts ? libraryParts(f.libParts, fr) : fixtureParts(f.kind, fr, { H, ceilM });
    if (!parts) continue;
    const z1 = Math.max(...parts.map((p) => p.z1)), z0 = Math.min(...parts.map((p) => p.z0));
    out.push({ type: 'fixture', id: f.id, src: f.id, name: f.label + (f.name && f.source === 'block' ? ` (${f.name})` : ''), fx: f.kind, profile: poly, z0, z1, parts, props: { kind: f.kind, block: f.source === 'block' ? f.name : '', widthCm: Math.round(fr.W * 100), depthCm: Math.round(fr.D * 100) } });
  }
  const outlines = model.outlines || (model.outline ? [model.outline] : []);
  outlines.forEach((ol, i) => {
    const sfx = outlines.length > 1 ? '.' + (i + 1) : '';
    if (P.makeFloor) out.push({ type: 'slab', id: 'SLAB' + sfx, src: 'SLAB' + sfx, name: 'Zemin döşemesi', profile: ccw(ol.map(tr)), z0: -P.slabThicknessCm / 100, z1: 0, props: {} });
    if (P.makeRoof) out.push({ type: 'roof', id: 'ROOF' + sfx, src: 'ROOF' + sfx, name: 'Tavan döşemesi', profile: ccw(ol.map(tr)), z0: H, z1: H + P.roofThicknessCm / 100, props: {} });
  });
  if (P.makeSpaces) {
    for (const r of model.rooms) {
      const o = ov(r.id);
      if (o.deleted) continue;
      out.push({ type: 'space', id: r.id, src: r.id, name: o.name ?? r.name ?? '', profile: ccw(r.poly.map(tr)), z0: 0, z1: H, props: { areaM2: +(Math.abs(r.area) * s * s).toFixed(2) } });
    }
  }
  if (params.mep) {
    // aynı blok hem tesisat cihazı hem tefriş olarak tanındıysa (klima iç ünitesi) tefriş modeli kullanılır
    let mep = params.mep;
    const fx = (params.fixtures || []).filter((f) => !ov(f.id).deleted);
    if (fx.length && mep.boxes.length) {
      const inside = (b) => { let cx = 0, cy = 0; for (const p of b.poly) { cx += p[0]; cy += p[1]; } cx /= b.poly.length; cy /= b.poly.length; return fx.some((f) => pointInPoly(cx, cy, f.poly)); };
      mep = { ...mep, boxes: mep.boxes.filter((b) => !inside(b)) };
    }
    out.push(...buildMepSolids(mep, params.mepProfiles, { ceilingCm: params.ceilingCm ?? 280, origin: [ox, oy], scale: s, layerNames: params.layerNames }));
  }
  return { solids: out, origin: [ox, oy], scale: s, P };
}

// ------------------------------------------------------------ yerel çerçeveler
// İnce dikdörtgenimsi çokgenin uzun ekseni: {c, u (uzun), v (dik), L, T}
function longAxis(poly) {
  let best = null;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (!best || L > best.L) best = { L, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L] };
  }
  const u = best.u, v = [-u[1], u[0]];
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (const p of poly) {
    const a = (p[0] - cx) * u[0] + (p[1] - cy) * u[1], b = (p[0] - cx) * v[0] + (p[1] - cy) * v[1];
    lo = Math.min(lo, a); hi = Math.max(hi, a); lo2 = Math.min(lo2, b); hi2 = Math.max(hi2, b);
  }
  return { c: [cx + u[0] * (lo + hi) / 2 + v[0] * (lo2 + hi2) / 2, cy + u[1] * (lo + hi) / 2 + v[1] * (lo2 + hi2) / 2], u, v, L: hi - lo, T: hi2 - lo2 };
}
function distPtSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / L2));
  return Math.hypot(a[0] + dx * t - px, a[1] + dy * t - py);
}
// Tefriş kutusu (4 köşe) için yerel çerçeve: "arka" kenar duvara en yakın kenardır.
// u: arka kenar boyunca, v: arkadan öne (odaya doğru). W: genişlik (u), D: derinlik (v)
function fixtureFrame(poly, walls) {
  const n = poly.length;
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= n; cy /= n;
  let back = 0, bestD = Infinity;
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    let d = Infinity;
    for (const w of walls) {
      if (Math.abs(w[0][0] - mx) > 6 && Math.abs(w[0][1] - my) > 6) continue;
      for (let j = 0; j < w.length; j++) d = Math.min(d, distPtSeg(mx, my, w[j], w[(j + 1) % w.length]));
      if (d < 1e-3) break;
    }
    if (d < bestD) { bestD = d; back = i; }
  }
  const a = poly[back], b = poly[(back + 1) % n];
  const W = Math.hypot(b[0] - a[0], b[1] - a[1]) || 0.01;
  const u = [(b[0] - a[0]) / W, (b[1] - a[1]) / W];
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  let v = [-u[1], u[0]];
  if ((cx - mx) * v[0] + (cy - my) * v[1] < 0) v = [-v[0], -v[1]];
  const D = Math.abs((cx - mx) * v[0] + (cy - my) * v[1]) * 2 || 0.01;
  return { back: [mx, my], u, v, W, D, nearWall: bestD < 0.25 };
}

// Kütüphane öğesi: kullanıcı/Claude tanımlı kutular (cm, yerel: x merkezden sağa, y arkadan öne)
function libraryParts(defs, fr) {
  const { back, u, v } = fr;
  const world = (x, y) => [back[0] + u[0] * x + v[0] * y, back[1] + u[1] * x + v[1] * y];
  const P = [];
  for (const p of defs) {
    const x = p.x / 100, y = p.y / 100, w = p.w / 100, d = p.d / 100;
    if (p.shape === 'oval') { const pr = []; for (let i = 0; i < 16; i++) { const t = (i / 16) * Math.PI * 2; pr.push(world(x + Math.cos(t) * w / 2, y + d / 2 + Math.sin(t) * d / 2)); } P.push({ profile: pr, z0: p.z0 / 100, z1: p.z1 / 100, mat: p.mat }); }
    else P.push({ profile: [world(x - w / 2, y), world(x + w / 2, y), world(x + w / 2, y + d), world(x - w / 2, y + d)], z0: p.z0 / 100, z1: p.z1 / 100, mat: p.mat });
  }
  return P.length ? P : null;
}

// Yönü verilmiş öğe (sohbetle yerleştirilen): facing = ön yüzün baktığı açı (rad); arka kenar ters taraftadır
function facingFrame(poly, facing) {
  const v = [Math.cos(facing), Math.sin(facing)], u = [v[1], -v[0]]; // u: arka kenar boyunca (sağa)
  let cx = 0, cy = 0;
  for (const p of poly) { cx += p[0]; cy += p[1]; }
  cx /= poly.length; cy /= poly.length;
  let lo = Infinity, hi = -Infinity, lo2 = Infinity, hi2 = -Infinity;
  for (const p of poly) { const a = (p[0] - cx) * u[0] + (p[1] - cy) * u[1], b = (p[0] - cx) * v[0] + (p[1] - cy) * v[1]; lo = Math.min(lo, a); hi = Math.max(hi, a); lo2 = Math.min(lo2, b); hi2 = Math.max(hi2, b); }
  const W = hi - lo || 0.01, D = hi2 - lo2 || 0.01;
  return { back: [cx + v[0] * lo2, cy + v[1] * lo2], u, v, W, D, nearWall: false };
}

// Parça üreticileri: yerel koordinat (x: arka kenar boyunca, merkez 0; y: arkadan öne 0..D)
function fixtureParts(kind, fr, { H, ceilM }) {
  const { back, u, v, W, D } = fr;
  const P = [];
  const world = (x, y) => [back[0] + u[0] * x + v[0] * y, back[1] + u[1] * x + v[1] * y];
  const box = (x, y, w, d, z0, z1, mat) => P.push({ profile: [world(x - w / 2, y), world(x + w / 2, y), world(x + w / 2, y + d), world(x - w / 2, y + d)], z0, z1, mat });
  const oval = (x, y, w, d, z0, z1, mat, n = 16) => { const pr = []; for (let i = 0; i < n; i++) { const t = (i / n) * Math.PI * 2; pr.push(world(x + Math.cos(t) * w / 2, y + d / 2 + Math.sin(t) * d / 2)); } P.push({ profile: pr, z0, z1, mat }); };
  const rbox = (x, y, w, d, z0, z1, mat, r = 0.05) => { // köşeleri yuvarlatılmış kutu
    const pr = [];
    const rr = Math.min(r, w / 2, d / 2);
    const corners = [[x + w / 2 - rr, y + d - rr, 0], [x - w / 2 + rr, y + d - rr, Math.PI / 2], [x - w / 2 + rr, y + rr, Math.PI], [x + w / 2 - rr, y + rr, -Math.PI / 2]];
    for (const [cx, cy, a0] of corners) for (let i = 0; i <= 4; i++) { const t = a0 + (i / 4) * Math.PI / 2; pr.push(world(cx + Math.cos(t) * rr, cy + Math.sin(t) * rr)); }
    P.push({ profile: pr, z0, z1, mat });
  };
  const w = W, d = D;
  switch (kind) {
    case 'wc': {
      const tw = Math.min(w, 0.42), td = Math.min(0.18, d * 0.3);
      box(0, 0, tw, td, 0.38, 0.80, 'ceramic'); // rezervuar
      oval(0, td, Math.min(w, 0.38), d - td, 0, 0.40, 'ceramic', 18); // gövde + oturak
      oval(0, td + 0.01, Math.min(w, 0.36), d - td - 0.02, 0.40, 0.425, 'seat', 18);
      break;
    }
    case 'squat':
      rbox(0, 0, w, d, 0, 0.04, 'ceramic', 0.04);
      oval(0, d * 0.3, Math.min(w, 0.22), d * 0.45, 0.04, 0.045, 'metal', 12);
      break;
    case 'urinal':
      box(0, 0, Math.min(w, 0.36), 0.05, 0.55, 1.05, 'ceramic');
      rbox(0, 0.05, Math.min(w, 0.34), Math.min(d, 0.32) - 0.05, 0.55, 0.9, 'ceramic', 0.08);
      break;
    case 'sink':
      box(0, 0, 0.18, Math.min(0.26, d * 0.6), 0, 0.78, 'ceramic'); // ayak
      rbox(0, 0, w, d, 0.78, 0.86, 'ceramic', 0.08);
      box(0, 0.03, 0.03, 0.03, 0.86, 1.02, 'chrome'); box(0, 0.03, 0.03, 0.12, 0.99, 1.02, 'chrome'); // batarya
      break;
    case 'ksink':
      box(0, 0, w, d, 0, 0.86, 'wood'); box(0, -0.01, w + 0.02, d + 0.02, 0.86, 0.90, 'metal');
      rbox(0, d * 0.2, Math.min(w - 0.1, 0.5), Math.min(d - 0.12, 0.4), 0.88, 0.905, 'chrome', 0.05);
      box(0, 0.04, 0.03, 0.03, 0.90, 1.12, 'chrome'); box(0, 0.04, 0.03, 0.18, 1.09, 1.12, 'chrome');
      break;
    case 'faucet':
      box(0, 0, 0.04, 0.04, 0.9, 1.08, 'chrome'); box(0, 0, 0.03, 0.15, 1.05, 1.08, 'chrome');
      break;
    case 'shower':
      rbox(0, 0, w, d, 0, 0.06, 'ceramic', 0.03);
      box(-w / 2 + 0.06, 0.02, 0.025, 0.025, 0.06, 2.05, 'chrome');
      oval(-w / 2 + 0.06, 0.08, 0.2, 0.2, 2.03, 2.05, 'chrome', 12);
      if (!fr.nearWall || w > 1.0) box(w / 2 - 0.005, 0, 0.01, d, 0.06, 1.9, 'glass'); // cam bölme
      break;
    case 'bathtub':
      rbox(0, 0, w, d, 0, 0.55, 'ceramic', 0.06);
      rbox(0, 0.07, w - 0.14, d - 0.14, 0.53, 0.545, 'water', 0.1);
      box(0, 0.05, 0.03, 0.03, 0.55, 0.75, 'chrome');
      break;
    case 'ac': {
      if (Math.min(w, d) < 0.45) { // duvar tipi split
        const z1 = Math.min(ceilM - 0.1, H - 0.1, 2.4), z0 = z1 - 0.3;
        rbox(0, 0, Math.max(w, 0.7), Math.max(Math.min(d, 0.3), 0.2), z0, z1, 'metal', 0.04);
      } else { // kaset tipi: tavana gömülü, görünen panel
        const z1 = Math.min(ceilM, H), z0 = z1 - 0.25;
        box(0, 0, w, d, z0, z1 - 0.03, 'metal'); box(0, -0.03, w + 0.06, d + 0.06, z1 - 0.03, z1, 'metal');
      }
      break;
    }
    case 'radiator':
      box(0, 0.03, w, Math.max(Math.min(d, 0.12), 0.06), 0.15, 0.75, 'metal');
      break;
    case 'drain':
      box(0, 0, Math.min(w, 0.15), Math.min(d, 0.15), 0, 0.008, 'chrome');
      break;
    case 'table': case 'desk': {
      const h = kind === 'desk' ? 0.75 : 0.74;
      rbox(0, 0, w, d, h - 0.04, h, 'wood', 0.03);
      const i = Math.min(0.05, w / 6, d / 6);
      for (const [x, y] of [[-w / 2 + i + 0.02, i], [w / 2 - i - 0.02, i], [-w / 2 + i + 0.02, d - i - 0.04], [w / 2 - i - 0.02, d - i - 0.04]]) box(x, y, 0.04, 0.04, 0, h - 0.04, 'wood');
      break;
    }
    case 'chair':
      box(0, 0.02, w, d - 0.02, 0.42, 0.47, 'fabric');
      box(0, 0, w, 0.05, 0.47, 0.9, 'fabric');
      for (const [x, y] of [[-w / 2 + 0.04, 0.04], [w / 2 - 0.04, 0.04], [-w / 2 + 0.04, d - 0.06], [w / 2 - 0.04, d - 0.06]]) box(x, y, 0.03, 0.03, 0, 0.42, 'metal');
      break;
    case 'sofa':
      rbox(0, 0, w, d, 0.08, 0.42, 'fabric', 0.04); box(0, 0, w, 0.22, 0.42, 0.85, 'fabric');
      box(-w / 2 + 0.08, 0, 0.16, d, 0.42, 0.62, 'fabric'); box(w / 2 - 0.08, 0, 0.16, d, 0.42, 0.62, 'fabric');
      break;
    case 'bed':
      box(0, 0, w, d, 0, 0.3, 'wood'); rbox(0, 0.03, w - 0.06, d - 0.06, 0.3, 0.5, 'fabric', 0.06);
      box(0, 0, w, 0.06, 0.5, 1.0, 'wood');
      break;
    case 'cabinet':
      box(0, 0, w, d, 0, Math.min(w, d) <= 0.7 && Math.max(w, d) >= 0.6 ? 2.0 : 0.9, 'wood');
      break;
    case 'counter':
      box(0, 0, w, d, 0, 0.88, 'wood'); box(0, -0.01, w + 0.02, d + 0.02, 0.88, 0.92, 'metal');
      break;
    case 'stair': {
      // basamaklar uzun eksen boyunca yükselir (arka = alt basamak); rıht 17 cm, kat yüksekliğine kadar
      const rise = 0.17, run = Math.max(0.25, Math.min(0.32, d / Math.max(1, Math.round(H / rise))));
      const n = Math.max(2, Math.min(Math.round(H / rise), Math.floor(d / run)));
      for (let i = 0; i < n; i++) box(0, i * run, w, d - i * run, 0, Math.min(H, (i + 1) * rise), 'metal');
      box(-w / 2 + 0.02, 0, 0.04, d, 0, Math.min(H, n * rise) + 0.9, 'frame'); box(w / 2 - 0.02, 0, 0.04, d, 0, Math.min(H, n * rise) + 0.9, 'frame'); // korkuluk dikmeleri (basit)
      break;
    }
    case 'outlet': box(0, 0, 0.08, Math.min(d, 0.05), 0.38, 0.46, 'metal'); break;
    case 'switch': box(0, 0, 0.08, Math.min(d, 0.05), 1.08, 1.16, 'metal'); break;
    case 'light': { const z1 = Math.min(ceilM, H); rbox(0, 0, w, d, z1 - 0.04, z1, 'metal', 0.02); rbox(0, 0.005, w - 0.01, d - 0.01, z1 - 0.045, z1 - 0.04, 'water', 0.02); break; }
    case 'panel': box(0, 0, w, Math.max(Math.min(d, 0.25), 0.12), 1.2, 1.2 + Math.max(0.6, Math.min(1.2, w)), 'metal'); break;
    default:
      return null;
  }
  return P;
}

// ------------------------------------------------------------ mekanik tesisat
// profiles: Map<layer, {kind, system, elevRef, elevOffsetCm, sizeCm}>
// Kot: (asma tavan veya döşeme) + fark. Boru: eksen kotu. Cihaz: tavana asılıysa
// üst yüzü, döşemedeyse alt yüzü bu kota oturur.
export function buildMepSolids(mep, profiles, { ceilingCm, origin, scale, layerNames = [] }) {
  if (!mep) return [];
  const [ox, oy] = origin;
  const s = scale;
  const tr = (p) => [(p[0] - ox) * s, (p[1] - oy) * s];
  const ccw = (poly) => (polyArea(poly) < 0 ? poly.slice().reverse() : poly);
  const elev = (prof) => ((prof.elevRef === 'floor' ? 0 : ceilingCm) + (prof.elevOffsetCm || 0)) / 100;
  const out = [];
  for (const p of mep.pipes) {
    const prof = profiles.get(p.l);
    if (!prof || prof.kind !== 'pipe' || prof.hidden) continue;
    const dia = (p.diaSrc === 'label' && p.diaCm ? p.diaCm : prof.sizeCm || 2.5) / 100;
    const z = elev(prof);
    out.push({
      type: 'pipe', id: p.id, src: p.id, l: p.l, system: prof.system, name: `${layerNames[p.l] || ''} Ø${Math.round(dia * 1000)}`,
      path: p.pts.map((q) => [...tr(q), z]), r: Math.max(dia / 2, 0.004),
      props: { diaMm: Math.round(dia * 1000), diaSrc: p.diaSrc, lengthM: +(p.lengthCm / 100).toFixed(2), layer: layerNames[p.l] || '' },
    });
  }
  for (const d of mep.ducts) {
    const prof = profiles.get(d.l);
    if (!prof || prof.kind !== 'air' || prof.hidden) continue;
    const h = (d.heightCm || Math.min(d.widthCm, prof.sizeCm || 30)) / 100;
    const e = elev(prof);
    const [z0, z1] = prof.elevRef === 'floor' ? [e, e + h] : [e - h, e];
    out.push({
      type: 'duct', id: d.id, src: d.id, l: d.l, system: prof.system, name: `Kanal ${Math.round(d.widthCm)}x${Math.round(h * 100)}`,
      profile: ccw(d.poly.map(tr)), z0, z1, props: { widthCm: Math.round(d.widthCm), heightCm: Math.round(h * 100), layer: layerNames[d.l] || '' },
    });
  }
  for (const b of mep.boxes) {
    const prof = profiles.get(b.l);
    if (!prof || prof.kind === 'ignore' || prof.kind === 'pipe' || prof.hidden) continue;
    const airTerm = prof.kind === 'air';
    const h = (airTerm ? 5 : prof.sizeCm || 30) / 100;
    const e = elev(prof);
    const [z0, z1] = prof.elevRef === 'floor' ? [e, e + h] : [e - h, e];
    out.push({
      type: airTerm ? 'airterminal' : prof.kind === 'terminal' ? 'terminal' : 'equipment',
      id: b.id, src: b.id, l: b.l, system: prof.system, name: b.name || layerNames[b.l] || '',
      profile: ccw(b.poly.map(tr)), z0, z1, props: { layer: layerNames[b.l] || '', block: b.name || '' },
    });
  }
  return out;
}
