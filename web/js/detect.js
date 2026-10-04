// Düzlemsel çizgilerden duvar / kolon / boşluk / mahal algılama.
// Bütün eşikler santimetre cinsinden verilir, çizim birimine çevrilir.

export const UNIT_TO_CM = { 0: 1, 1: 2.54, 2: 30.48, 4: 0.1, 5: 1, 6: 100, 14: 10 };
export const UNIT_NAMES = { 0: 'Belirsiz', 1: 'inç', 2: 'feet', 4: 'mm', 5: 'cm', 6: 'm', 14: 'dm' };

export const DEFAULT_PARAMS = {
  tolCm: 1, // uç noktası birleştirme toleransı
  minThicknessCm: 5,
  maxThicknessCm: 60,
  minGapCm: 40, // daha dar boşluk kapı/pencere sayılmaz
  maxGapCm: 600,
  maxDoorCm: 260, // iç duvarda bundan geniş boşluk = kapısız geçiş
  maxWeakGapCm: 150, // duvar yan yüzüne bakan boşluk sınırı
  maxColumnCm: 200,
  minRoomM2: 1,
};

// ---------------------------------------------------------------- yardımcılar

export function polyArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
function polyPerimeter(p) {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % n];
    s += Math.hypot(x2 - x1, y2 - y1);
  }
  return s;
}
export function pointInPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function polyBBox(p) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const [x, y] of p) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
  return [a, b, c, d];
}
// İnce dikdörtgen eşdeğeri: L + t = P/2, L * t = A  =>  t
function equivThickness(A, P) {
  const h = P / 2;
  const disc = h * h - 4 * A;
  return disc <= 0 ? h / 2 : (h - Math.sqrt(disc)) / 2;
}
function segIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
  // [0,1] aralığında t,u döndürür (veya null)
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-12) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return [t, u];
}

// Ardışık doğrusal ve çok yakın köşeleri sil
export function simplifyPoly(p, tol) {
  let pts = p.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length], b = pts[i], c = pts[(i + 1) % pts.length];
      const abx = b[0] - a[0], aby = b[1] - a[1], bcx = c[0] - b[0], bcy = c[1] - b[1];
      const lab = Math.hypot(abx, aby), lbc = Math.hypot(bcx, bcy);
      if (lab < tol * 0.5) { pts.splice(i, 1); changed = true; i--; continue; }
      const cross = Math.abs(abx * bcy - aby * bcx) / Math.max(lab, lbc, 1e-9);
      const dot = abx * bcx + aby * bcy;
      if (cross < tol * 0.25 && dot > 0) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}

// ---------------------------------------------------------------- segment toplama

export function collectSegments(drawing, layerSet, region) {
  const segs = [];
  const inR = (x, y) => !region || (x >= region[0] && x <= region[2] && y >= region[1] && y <= region[3]);
  for (const pr of drawing.prims) {
    if (!layerSet.has(pr.l)) continue;
    const p = pr.pts;
    const n = p.length / 2;
    const m = pr.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      const x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1];
      if (!inR(x1, y1) || !inR(x2, y2)) continue;
      if (x1 === x2 && y1 === y2) continue;
      segs.push([x1, y1, x2, y2]);
    }
  }
  return segs;
}

// ---------------------------------------------------------------- düzlemsel yüzler

export function buildFaces(segs, tol, capRange = null) {
  if (!segs.length) return { faces: [], nodes: [] };
  // 1) Uniform ızgara ile kesişim bölme
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of segs) {
    minX = Math.min(minX, s[0], s[2]); maxX = Math.max(maxX, s[0], s[2]);
    minY = Math.min(minY, s[1], s[3]); maxY = Math.max(maxY, s[1], s[3]);
  }
  const span = Math.max(maxX - minX, maxY - minY, tol);
  const cell = Math.max(span / Math.max(8, Math.sqrt(segs.length) * 2), tol * 4);
  const grid = new Map();
  const ck = (i, j) => i * 73856093 ^ j * 19349663;
  segs.forEach((s, idx) => {
    const i0 = Math.floor((Math.min(s[0], s[2]) - tol - minX) / cell), i1 = Math.floor((Math.max(s[0], s[2]) + tol - minX) / cell);
    const j0 = Math.floor((Math.min(s[1], s[3]) - tol - minY) / cell), j1 = Math.floor((Math.max(s[1], s[3]) + tol - minY) / cell);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = ck(i, j);
      let a = grid.get(k);
      if (!a) grid.set(k, (a = []));
      a.push(idx);
    }
  });
  const cuts = segs.map(() => [0, 1]);
  const seen = new Set();
  for (const list of grid.values()) {
    for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
      const i = list[a], j = list[b];
      const key = i < j ? i * 1e7 + j : j * 1e7 + i;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = segs[i], q = segs[j];
      const li = Math.hypot(s[2] - s[0], s[3] - s[1]), lj = Math.hypot(q[2] - q[0], q[3] - q[1]);
      const r = segIntersect(s[0], s[1], s[2], s[3], q[0], q[1], q[2], q[3]);
      if (r) {
        const [t, u] = r;
        const et = tol / li, eu = tol / lj;
        if (t >= -et && t <= 1 + et && u >= -eu && u <= 1 + eu) {
          cuts[i].push(Math.min(1, Math.max(0, t)));
          cuts[j].push(Math.min(1, Math.max(0, u)));
        }
      } else {
        // paralel / çakışık: uç noktalarını karşı segmente izdüşür
        const proj = (px, py, z, L, out) => {
          const t = ((px - z[0]) * (z[2] - z[0]) + (py - z[1]) * (z[3] - z[1])) / (L * L);
          if (t <= 0 || t >= 1) return;
          const qx = z[0] + t * (z[2] - z[0]), qy = z[1] + t * (z[3] - z[1]);
          if (Math.hypot(qx - px, qy - py) <= tol) out.push(t);
        };
        proj(q[0], q[1], s, li, cuts[i]); proj(q[2], q[3], s, li, cuts[i]);
        proj(s[0], s[1], q, lj, cuts[j]); proj(s[2], s[3], q, lj, cuts[j]);
      }
    }
  }
  // 2) Düğüm birleştirme (tolerans ızgarası)
  const nodes = [];
  const nodeGrid = new Map();
  const nodeOf = (x, y) => {
    const gi = Math.floor(x / tol), gj = Math.floor(y / tol);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const a = nodeGrid.get(ck(gi + di, gj + dj));
      if (a) for (const n of a) if (Math.hypot(nodes[n][0] - x, nodes[n][1] - y) <= tol) return n;
    }
    const id = nodes.length;
    nodes.push([x, y]);
    const k = ck(gi, gj);
    let a = nodeGrid.get(k);
    if (!a) nodeGrid.set(k, (a = []));
    a.push(id);
    return id;
  };
  const adj = new Map();
  const addEdge = (a, b) => {
    if (a === b) return;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a).add(b); adj.get(b).add(a);
  };
  segs.forEach((s, i) => {
    const ts = [...new Set(cuts[i].map((t) => Math.round(t * 1e9) / 1e9))].sort((a, b) => a - b);
    let prev = null;
    for (const t of ts) {
      const n = nodeOf(s[0] + t * (s[2] - s[0]), s[1] + t * (s[3] - s[1]));
      if (prev != null) addEdge(prev, n);
      prev = n;
    }
  });
  // 3a) Açık duvar uçlarını kapat: aynı hizada biten paralel çizgi uçları
  if (capRange) {
    const [capMin, capMax] = capRange;
    const ends = [...adj.keys()].filter((n) => adj.get(n).size === 1).map((n) => {
      const m = adj.get(n).values().next().value;
      const L = Math.hypot(nodes[n][0] - nodes[m][0], nodes[n][1] - nodes[m][1]);
      return { n, vx: (nodes[n][0] - nodes[m][0]) / L, vy: (nodes[n][1] - nodes[m][1]) / L };
    });
    if (ends.length < 20000) {
      const best = new Map();
      for (const d of ends) {
        let pick = null;
        for (const e of ends) {
          if (e === d || d.vx * e.vx + d.vy * e.vy < 0.95) continue;
          const dx = nodes[e.n][0] - nodes[d.n][0], dy = nodes[e.n][1] - nodes[d.n][1];
          const dist = Math.hypot(dx, dy);
          if (dist < capMin || dist > capMax) continue;
          if (Math.abs(dx * d.vx + dy * d.vy) > tol * 3) continue;
          if (!pick || dist < pick.dist) pick = { e, dist };
        }
        if (pick) best.set(d.n, pick.e.n);
      }
      for (const [a, b] of best) if (best.get(b) === a && a < b) addEdge(a, b);
    }
  }
  // 3b) Sarkan uçları buda
  const stack = [...adj.keys()].filter((k) => adj.get(k).size < 2);
  while (stack.length) {
    const n = stack.pop();
    const nb = adj.get(n);
    if (!nb) continue;
    for (const m of nb) {
      const s = adj.get(m);
      s.delete(n);
      if (s.size < 2) stack.push(m);
    }
    adj.delete(n);
  }
  // 4) Açıya göre sıralı komşular ve yarım-kenar yüz gezinmesi
  const order = new Map();
  for (const [n, nb] of adj) {
    const [x, y] = nodes[n];
    order.set(n, [...nb].sort((a, b) => Math.atan2(nodes[a][1] - y, nodes[a][0] - x) - Math.atan2(nodes[b][1] - y, nodes[b][0] - x)));
  }
  const visited = new Set();
  const faces = [];
  for (const [u, nbs] of order) for (const v of nbs) {
    const k0 = u + ',' + v;
    if (visited.has(k0)) continue;
    const cyc = [];
    let a = u, b = v, guard = 0;
    while (guard++ < 100000) {
      const k = a + ',' + b;
      if (visited.has(k)) break;
      visited.add(k);
      cyc.push(a);
      const ob = order.get(b);
      const idx = ob.indexOf(a);
      const c = ob[(idx - 1 + ob.length) % ob.length];
      a = b; b = c;
    }
    if (cyc.length >= 3) {
      const poly = cyc.map((i) => nodes[i]);
      faces.push({ poly, area: polyArea(poly) });
    }
  }
  return { faces, nodes };
}

// ---------------------------------------------------------------- açık uçları kapatma
// Duvar çizgilerinin açıkta kalan uçları için iki onarım:
// 1) Uzatma: uç, birkaç cm ötedeki bir çizgiye değmiyorsa ona kadar uzatılır.
// 2) Kapak: duvar kalınlığı mesafesindeki paralel çizgiye dik bir kapak eklenir
//    (uçlar aynı hizada bitmese de; ör. bir çizgi diğerinden uzun çizilmişse).
export function closeOpenEnds(segs, tol, capMin, capMax, extend) {
  if (!segs.length || segs.length > 50000) return segs;
  let minX = Infinity, minY = Infinity;
  for (const s of segs) { minX = Math.min(minX, s[0], s[2]); minY = Math.min(minY, s[1], s[3]); }
  const cell = Math.max(capMax * 2, extend * 2, tol * 8);
  const grid = new Map();
  const key = (i, j) => i * 92821 + j;
  segs.forEach((s, idx) => {
    const i0 = Math.floor((Math.min(s[0], s[2]) - minX) / cell), i1 = Math.floor((Math.max(s[0], s[2]) - minX) / cell);
    const j0 = Math.floor((Math.min(s[1], s[3]) - minY) / cell), j1 = Math.floor((Math.max(s[1], s[3]) - minY) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 2000) return;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = key(i, j);
      let a = grid.get(k);
      if (!a) grid.set(k, (a = []));
      a.push(idx);
    }
  });
  const near = (x, y) => {
    const i = Math.floor((x - minX) / cell), j = Math.floor((y - minY) / cell);
    const out = new Set();
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const n of grid.get(key(i + di, j + dj)) || []) out.add(n);
    return out;
  };
  const distToSeg = (x, y, s) => {
    const dx = s[2] - s[0], dy = s[3] - s[1], L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / L2)) : 0;
    return Math.hypot(s[0] + t * dx - x, s[1] + t * dy - y);
  };
  const added = [];
  for (let idx = 0; idx < segs.length; idx++) {
    const s = segs[idx];
    const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
    if (L < tol) continue;
    for (const end of [0, 1]) {
      const px = end ? s[2] : s[0], py = end ? s[3] : s[1];
      const vx = (end ? s[2] - s[0] : s[0] - s[2]) / L, vy = (end ? s[3] - s[1] : s[1] - s[3]) / L; // dışa doğru
      const cand = near(px, py);
      // uç başka bir çizgiye değiyor mu?
      let connected = false;
      for (const n of cand) if (n !== idx && distToSeg(px, py, segs[n]) <= tol) { connected = true; break; }
      if (connected) continue;
      // 1) uzatma
      let best = null;
      for (const n of cand) {
        if (n === idx) continue;
        const q = segs[n];
        const r = segIntersect(px, py, px + vx * extend, py + vy * extend, q[0], q[1], q[2], q[3]);
        if (r && r[0] > 0 && r[0] <= 1 && r[1] >= -1e-6 && r[1] <= 1 + 1e-6 && (!best || r[0] < best)) best = r[0];
      }
      if (best != null) { added.push([px, py, px + vx * extend * best, py + vy * extend * best]); continue; }
      // 2) kapak: paralel çizgi, dik mesafe kalınlık aralığında, ucun izdüşümü çizginin üstünde.
      // Her iki yandaki en yakın çizgiye ayrı kapak: çok katmanlı duvarlarda (sıva + yalıtım +
      // gövde ayrı çizgiler) bütün şeritler kapanır.
      const caps = { 1: null, '-1': null };
      for (const n of cand) {
        if (n === idx) continue;
        const q = segs[n];
        const qL = Math.hypot(q[2] - q[0], q[3] - q[1]);
        if (qL < tol) continue;
        const ux = (q[2] - q[0]) / qL, uy = (q[3] - q[1]) / qL;
        if (Math.abs(ux * vy - uy * vx) > 0.03) continue; // paralel değil
        const t = (px - q[0]) * ux + (py - q[1]) * uy;
        if (t < -tol || t > qL + tol) continue;
        const fx = q[0] + ux * Math.max(0, Math.min(qL, t)), fy = q[1] + uy * Math.max(0, Math.min(qL, t));
        const dist = Math.hypot(fx - px, fy - py);
        if (dist < capMin || dist > capMax) continue;
        const side = Math.sign((fx - px) * vy - (fy - py) * vx) || 1;
        if (!caps[side] || dist < caps[side].dist) caps[side] = { dist, fx, fy };
      }
      for (const c of [caps[1], caps['-1']]) if (c) added.push([px, py, c.fx, c.fy]);
    }
  }
  return added.length ? segs.concat(added) : segs;
}

// ---------------------------------------------------------------- ana algılama

export function detect(drawing, opts) {
  const P = { ...DEFAULT_PARAMS, ...(opts.params || {}) };
  const k = 1 / (UNIT_TO_CM[opts.units] ?? 1); // cm -> çizim birimi
  const tol = P.tolCm * k;
  const minT = P.minThicknessCm * k, maxT = P.maxThicknessCm * k;
  const minGap = P.minGapCm * k, maxGap = P.maxGapCm * k;
  const maxCol = P.maxColumnCm * k;
  const minRoom = P.minRoomM2 * 1e4 * k * k;

  // Duvarlar
  const wallSegs = closeOpenEnds(collectSegments(drawing, opts.wallLayers, opts.region), tol, minT * 0.5, maxT, 3 * k + tol);
  const wf = buildFaces(wallSegs, tol, [minT * 0.5, maxT]);
  const walls = [];
  for (const f of wf.faces) {
    if (f.area <= tol * tol * 4) continue;
    const poly = simplifyPoly(f.poly, tol);
    if (poly.length < 3) continue;
    const A = polyArea(poly);
    const t = equivThickness(A, polyPerimeter(poly));
    if (t > maxT || t < minT * 0.5) continue;
    walls.push({ id: 'W' + (walls.length + 1), poly, thickness: t, area: A });
  }
  // İç içe tekrarları ayıkla (aynı yüzü saran ikinci kontur)
  dedupeContained(walls);

  // Kolonlar
  const colSegs = collectSegments(drawing, opts.columnLayers, opts.region);
  const cf = buildFaces(colSegs, tol);
  let columns = [];
  for (const f of cf.faces) {
    if (f.area <= tol * tol * 4) continue;
    const poly = simplifyPoly(f.poly, tol);
    const bb = polyBBox(poly);
    if (Math.max(bb[2] - bb[0], bb[3] - bb[1]) > maxCol) continue;
    columns.push({ id: '', poly, area: polyArea(poly) });
  }
  columns.sort((a, b) => b.area - a.area);
  columns = dedupeContained(columns);
  columns.forEach((c, i) => (c.id = 'C' + (i + 1)));

  // Katı kenar listesi (boşluk araması için)
  const solidEdges = [];
  const pushEdges = (owner, poly) => {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < 1e-9) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      solidEdges.push({ owner, i, a, b, L, ux, uy, nx: uy, ny: -ux }); // CCW => dış normal sağda
    }
  };
  walls.forEach((w) => pushEdges(w.id, w.poly));
  columns.forEach((c) => pushEdges(c.id, c.poly));


  // Duvar ana ekseni (en uzun kenar)
  for (const w of walls) {
    let best = null;
    for (const e of solidEdges) if (e.owner === w.id && (!best || e.L > best.L)) best = e;
    if (!best) continue;
    w.length = best.L;
    w.axis = [best.ux, best.uy];
    w.longEdge = best;
  }

  // Hedef kenar bir kolon mu, yoksa benzer kalınlıkta bir duvar ucu mu?
  const wallById = new Map(walls.map((w) => [w.id, w]));
  const targetIsEnd = (e) => {
    const w = wallById.get(e.owner);
    if (!w) return true; // kolon
    return e.L <= maxT * 1.2 && Math.abs(e.L - w.thickness) <= Math.max(tol * 3, w.thickness * 0.35);
  };

  // Boşluklar: duvar ucu kenarı -> karşısındaki katı kenar
  const openings = [];
  for (const w of walls) {
    const n = w.poly.length;
    for (let i = 0; i < n; i++) {
      const a = w.poly[i], b = w.poly[(i + 1) % n];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (L < minT * 0.5 || L > maxT * 1.2) continue;
      const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
      const p0 = w.poly[(i - 1 + n) % n], p3 = w.poly[(i + 2) % n];
      const d1 = Math.hypot(a[0] - p0[0], a[1] - p0[1]), d2 = Math.hypot(p3[0] - b[0], p3[1] - b[1]);
      if (d1 < 1e-9 || d2 < 1e-9) continue;
      const perp1 = Math.abs(((a[0] - p0[0]) * ux + (a[1] - p0[1]) * uy) / d1);
      const perp2 = Math.abs(((p3[0] - b[0]) * ux + (p3[1] - b[1]) * uy) / d2);
      if (perp1 > 0.2 || perp2 > 0.2) continue; // komşu kenarlar dik değil => uç değil
      const nx = uy, ny = -ux;
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      let best = null;
      for (const e of solidEdges) {
        if (e.owner === w.id) continue;
        if (e.nx * nx + e.ny * ny > -0.97) continue; // karşı karşıya değil
        const g = (e.a[0] - mx) * nx + (e.a[1] - my) * ny;
        if (g < minGap || g > maxGap) continue;
        const s1 = (e.a[0] - mx) * ux + (e.a[1] - my) * uy, s2 = (e.b[0] - mx) * ux + (e.b[1] - my) * uy;
        const lo = Math.max(-L / 2, Math.min(s1, s2)), hi = Math.min(L / 2, Math.max(s1, s2));
        if (hi - lo < 0.8 * L) continue;
        const tw = targetIsEnd(e);
        if (!best || g < best.g - tol || (Math.abs(g - best.g) <= tol && tw && !best.strong)) best = { g, e, strong: tw };
      }
      if (!best) continue;
      const g = best.g;
      // yol temiz mi? (ortadan ve iki kenardan)
      let blocked = false;
      for (const off of [0, -0.4, 0.4]) {
        const sx = mx + ux * L * off + nx * tol, sy = my + uy * L * off + ny * tol;
        for (const e of solidEdges) {
          if (e.owner === w.id || e === best.e) continue;
          const r = segIntersect(sx, sy, sx + nx * (g - 2 * tol), sy + ny * (g - 2 * tol), e.a[0], e.a[1], e.b[0], e.b[1]);
          if (r && r[0] >= 0 && r[0] <= 1 && r[1] >= 0 && r[1] <= 1) { blocked = true; break; }
        }
        if (blocked) break;
      }
      if (blocked) continue;
      const cx = mx + nx * g / 2, cy = my + ny * g / 2;
      if (openings.some((o) => Math.hypot(o.center[0] - cx, o.center[1] - cy) < Math.max(tol * 5, L / 2))) continue;
      const rect = [a, b, [b[0] + nx * g, b[1] + ny * g], [a[0] + nx * g, a[1] + ny * g]];
      if (!best.strong && g > P.maxWeakGapCm * k) continue; // duvar yan yüzüne bakan geniş aralık: koridor
      openings.push({
        id: '', kind: 'door', rect, center: [cx, cy], width: g, thickness: L,
        along: [nx, ny], across: [ux, uy], exterior: false, hostWall: w.id, weak: !best.strong,
      });
    }
  }
  openings.forEach((o, i) => (o.id = 'O' + (i + 1)));

  // Dış hat: duvar + kolon + bütün boşlukların kapatma çizgileri
  const closures = (list) => {
    const out = [];
    for (const o of list) {
      const [a, b, c, d] = o.rect;
      out.push([a[0], a[1], d[0], d[1]], [b[0], b[1], c[0], c[1]]);
    }
    return out;
  };
  const of = buildFaces(wallSegs.concat(colSegs, closures(openings)), tol, [minT * 0.5, maxT]);
  let outline = null;
  for (const f of of.faces) if (f.area < 0 && (!outline || f.area < outline.area)) outline = f;
  const outlinePoly = outline ? simplifyPoly(outline.poly.slice().reverse(), tol) : null;

  // Dış cephe: dış hatta yakın olan duvar ve boşluklar
  const nearOutline = (x, y, d) => outlinePoly && distToPoly(x, y, outlinePoly) <= d;
  for (const w of walls) {
    delete w.longEdge;
    // en az kalınlığın iki katı uzunlukta bir kenarı dış hat üzerindeyse dış duvar
    w.exterior = false;
    for (let i = 0; i < w.poly.length && !w.exterior; i++) {
      const a = w.poly[i], b = w.poly[(i + 1) % w.poly.length];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < w.thickness * 2) continue;
      w.exterior = !!nearOutline((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, tol * 3);
    }
  }
  for (const o of openings) {
    const [a, b, c, d] = o.rect;
    const m1 = [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2], m2 = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    o.exterior = !!(nearOutline(m1[0], m1[1], tol * 3) || nearOutline(m2[0], m2[1], tol * 3));
    const widthCm = o.width / k;
    o.kind = o.exterior ? 'window' : widthCm > P.maxDoorCm ? 'empty' : 'door';
  }

  // Boşluk türü kanıta göre belirlenir (dış cephe = pencere varsayımı yok):
  //  - içi taşıyıcı tarama / beton çizgileriyle dolu   -> dolu (duvar/kolon)
  //  - kapı işareti (açılış yayı) yakınında              -> kapı
  //  - cam/doğrama çizgisi boşluğu kesiyor ya da boşluk
  //    boyunca uzanan paralel çizgiler (cam, denizlik)  -> pencere
  //  - kanıt yok: dış cephede dar (<80 cm) -> dolu, geniş -> geçiş; içeride -> kapı / geçiş
  classifyOpenings(drawing, openings, { opts, k, tol, maxDoorCm: P.maxDoorCm });

  // Mahaller: kapı ve pencere boşlukları kapatılarak
  const rf = buildFaces(wallSegs.concat(colSegs, closures(openings.filter((o) => o.kind !== 'empty'))), tol, [minT * 0.5, maxT]);
  // Mahal adı: kullanıcı yazı katmanı seçtiyse yalnız onlar; seçmediyse tesisat,
  // ölçü vb. katmanlardaki yazılar hariç hepsi (mahal/oda katmanları öncelikli)
  const userText = opts.textLayers && opts.textLayers.size > 0;
  const layerName = (t) => drawing.layers[t.l]?.name || '';
  const textOk = (t) => (userText ? opts.textLayers.has(t.l) : !NON_ROOM_TEXT.test(layerName(t)));
  const textRank = (t) => (!userText && ROOM_TEXT.test(layerName(t)) ? 1 : 0);
  const rooms = [];
  for (const f of rf.faces) {
    if (f.area < minRoom) continue;
    const poly = simplifyPoly(f.poly, tol);
    const A = polyArea(poly);
    if (equivThickness(A, polyPerimeter(poly)) <= maxT) continue;
    if (columns.some((c) => Math.abs(polyArea(c.poly) - A) < tol * tol * 10)) continue;
    const inside = drawing.texts.filter((t) => textOk(t) && pointInPoly(t.x, t.y, poly) && isLabel(t.s));
    inside.sort((p, q) => textRank(q) - textRank(p) || q.h - p.h);
    rooms.push({ id: 'R' + (rooms.length + 1), poly, area: A, name: inside[0]?.s || '' });
  }

  return {
    walls, columns, openings, rooms,
    outline: outlinePoly,
    stats: { wallSegs: wallSegs.length, colSegs: colSegs.length, faces: wf.faces.length },
    unitScale: 1 / k,
  };
}

const NON_ROOM_TEXT = /^m[-_ ]|hvac|vrf|klima|yang[ıi]n|fire|spr|sprink|elektr|electr|tesisat|sıhhi|sihhi|plumb|daikin|vana|valve|boru|pipe|ölçü|olcu|dim|kot|detail|detay|ata |walky|tefri|mobilya|furn/i;
const ROOM_TEXT = /mahal|room|space|oda|yaz[ıi]|text|txt|anno/i;


// ---------------------------------------------------------------- boşluk sınıflandırma
const STRUCT_RE = /strukt|struct|beton|concrete|kolon|column|perde|\btrm\b|-trm|tarama|hatch|solid|betonarme/i;
const NON_ARCH_RE = /^m[-_ ]|hvac|vrf|klima|sprink|\bspr\b|yang[ıi]n|fire|elektr|electr|priz|tefri|mobilya|furn|olcu|ölçü|\bdim|aks|axis|yaz[ıi]|text|txt|\bkot\b|tavan|ceiling|asma|rezerv|agac|ağaç|insan|people|peyzaj/i;

export function classifyOpenings(drawing, openings, { opts, k, tol, maxDoorCm }) {
  if (!openings.length) return;
  const region = opts.region;
  const wallSet = opts.wallLayers || new Set();
  const colSet = opts.columnLayers || new Set();
  const doorSet = opts.doorLayers || new Set();
  const winSet = opts.windowLayers || new Set();
  // bölgedeki aday segmentler (ızgara ile)
  let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
  for (const o of openings) for (const p of o.rect) { bx0 = Math.min(bx0, p[0]); by0 = Math.min(by0, p[1]); bx1 = Math.max(bx1, p[0]); by1 = Math.max(by1, p[1]); }
  const pad = 400 * k;
  bx0 -= pad; by0 -= pad; bx1 += pad; by1 += pad;
  const cell = 200 * k;
  const grid = new Map();
  const key = (i, j) => i * 92821 + j;
  const cls = new Map();
  const layerClass = (l) => {
    let c = cls.get(l);
    if (c) return c;
    const n = drawing.layers[l].name;
    c = doorSet.has(l) ? 'door' : winSet.has(l) ? 'win' : wallSet.has(l) ? 'wall' : colSet.has(l) ? 'struct' : STRUCT_RE.test(n) ? 'struct' : NON_ARCH_RE.test(n) ? 'skip' : 'arch';
    cls.set(l, c);
    return c;
  };
  const segs = [];
  for (const pr of drawing.prims) {
    const c = layerClass(pr.l);
    if (c === 'skip' || c === 'wall') continue;
    const p = pr.pts, n = p.length / 2;
    const m = pr.closed ? n : n - 1;
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % n;
      const x1 = p[2 * i], y1 = p[2 * i + 1], x2 = p[2 * j], y2 = p[2 * j + 1];
      if (Math.max(x1, x2) < bx0 || Math.min(x1, x2) > bx1 || Math.max(y1, y2) < by0 || Math.min(y1, y2) > by1) continue;
      if (region && (Math.max(x1, x2) < region[0] || Math.min(x1, x2) > region[2] || Math.max(y1, y2) < region[1] || Math.min(y1, y2) > region[3])) continue;
      const idx = segs.length;
      segs.push([x1, y1, x2, y2, c]);
      const i0 = Math.floor((Math.min(x1, x2) - bx0) / cell), i1 = Math.floor((Math.max(x1, x2) - bx0) / cell);
      const j0 = Math.floor((Math.min(y1, y2) - by0) / cell), j1 = Math.floor((Math.max(y1, y2) - by0) / cell);
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) continue;
      for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) { const kk = key(a, b); let l = grid.get(kk); if (!l) grid.set(kk, (l = [])); l.push(idx); }
    }
  }
  const around = (o, reach) => {
    const xs = o.rect.map((p) => p[0]), ys = o.rect.map((p) => p[1]);
    const i0 = Math.floor((Math.min(...xs) - reach - bx0) / cell), i1 = Math.floor((Math.max(...xs) + reach - bx0) / cell);
    const j0 = Math.floor((Math.min(...ys) - reach - by0) / cell), j1 = Math.floor((Math.max(...ys) + reach - by0) / cell);
    const out = new Set();
    for (let a = i0; a <= i1; a++) for (let b = j0; b <= j1; b++) for (const n of grid.get(key(a, b)) || []) out.add(n);
    return out;
  };
  for (const o of openings) {
    const [cx, cy] = o.center, al = o.along, ac = o.across;
    const hw = o.width / 2, ht = o.thickness / 2;
    // yerel koordinat: a = duvar ekseni boyunca, c = duvara dik
    const loc = (x, y) => [(x - cx) * al[0] + (y - cy) * al[1], (x - cx) * ac[0] + (y - cy) * ac[1]];
    // segmentin [a0,a1]x[c0,c1] kutusu içinde kalan parçasının boyu (Liang-Barsky)
    const clipLen = (s, a0, a1, c0, c1) => {
      const [pa, pc] = loc(s[0], s[1]), [qa, qc] = loc(s[2], s[3]);
      let t0 = 0, t1 = 1;
      const da = qa - pa, dc = qc - pc;
      for (const [p, q] of [[-da, pa - a0], [da, a1 - pa], [-dc, pc - c0], [dc, c1 - pc]]) {
        if (Math.abs(p) < 1e-12) { if (q < 0) return 0; continue; }
        const r = q / p;
        if (p < 0) { if (r > t1) return 0; if (r > t0) t0 = r; } else { if (r < t0) return 0; if (r < t1) t1 = r; }
      }
      return Math.hypot(da, dc) * Math.max(0, t1 - t0);
    };
    let structLen = 0, winHit = false, doorHit = false, glazing = 0, glazingLong = 0;
    for (const n of around(o, Math.max(o.width, 60 * k))) {
      const s = segs[n], c = s[4];
      if (c === 'door') { if (clipLen(s, -hw - 5 * k, hw + 5 * k, -ht - Math.max(o.width, 30 * k), ht + Math.max(o.width, 30 * k)) > 0) doorHit = true; continue; }
      const inside = clipLen(s, -hw * 0.9, hw * 0.9, -ht * 0.9, ht * 0.9);
      if (c === 'struct') { structLen += inside; continue; }
      if (c === 'win') { if (clipLen(s, -hw, hw, -ht - 20 * k, ht + 20 * k) > 0) winHit = true; continue; }
      // genel mimari çizgi: boşluk boyunca uzanan paralel çizgi (cam / denizlik)
      const [pa, pc] = loc(s[0], s[1]), [qa, qc] = loc(s[2], s[3]);
      const L = Math.hypot(qa - pa, qc - pc);
      if (L < 1e-9 || Math.abs(qc - pc) / L > 0.05) continue;
      if (Math.abs((pc + qc) / 2) > ht + 2 * k) continue;
      const lo = Math.max(-hw, Math.min(pa, qa)), hi = Math.min(hw, Math.max(pa, qa));
      if (hi - lo < 0.6 * o.width) continue;
      // boşlukla sınırlı (pervazlarda biten) çizgi güçlü cam kanıtıdır; cephe boyunca
      // kesintisiz giden kaplama/görünüş çizgisi değildir
      if (L <= o.width + 2 * o.thickness + 40 * k) glazing++; else glazingLong++;
    }
    const widthCm = o.width / k;
    const area = o.width * o.thickness;
    let kind, why;
    if (structLen > Math.max(o.thickness * 3, Math.sqrt(area) * 2)) { kind = 'solid'; why = 'İçi taşıyıcı tarama / beton çizgileriyle dolu'; }
    else if (doorHit) { kind = 'door'; why = 'Kapı işareti (açılış yayı) var'; }
    else if (winHit) { kind = 'window'; why = 'Cam / doğrama çizgisi boşluğu kesiyor'; }
    else if (o.exterior && glazing >= 1) { kind = 'window'; why = `Boşlukla sınırlı ${glazing} paralel çizgi (cam/denizlik) var`; }
    else if (o.exterior && glazingLong >= 2 && widthCm >= 80) { kind = 'window'; why = `Boşluktan geçen ${glazingLong} paralel çizgi var (cam olabilir)`; }
    else if (o.exterior) { kind = widthCm < 80 ? 'solid' : 'empty'; why = widthCm < 80 ? 'Dış cephede dar boşluk, cam izi yok' : 'Dış cephede cam izi yok (açıklık sayıldı)'; }
    else if (!o.weak && widthCm <= maxDoorCm) { kind = 'door'; why = 'İç duvarda kapı genişliğinde boşluk'; }
    else if (o.weak && widthCm <= 150) { kind = 'door'; why = 'İç boşluk (duvar yan yüzüne bakıyor)'; }
    else { kind = 'empty'; why = 'Geniş iç açıklık'; }
    o.kind = kind;
    o.why = why;
    o.marker = doorHit ? 'door' : winHit ? 'window' : undefined;
  }
}

function distToPoly(x, y, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + t * dx - x, a[1] + t * dy - y));
  }
  return best;
}

function isLabel(s) {
  if (!s || s.length > 40) return false;
  if (/^[\s\d.,+\-=±:%/()]+$/.test(s)) return false; // kot, ölçü vb.
  if (/^(A|S|H|Alan|ALAN)\s*[=:]/.test(s)) return false;
  if (/m²|m2\b/i.test(s) && /\d/.test(s)) return false;
  return /\p{L}{2,}/u.test(s);
}

// En uzun kenarın ortasından içeri doğru küçük bir adım (CCW => iç taraf solda)
export function interiorPoint(poly) {
  let best = 0, bi = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L > best) { best = L; bi = i; }
  }
  const a = poly[bi], b = poly[(bi + 1) % poly.length];
  const ux = (b[0] - a[0]) / best, uy = (b[1] - a[1]) / best;
  const sgn = polyArea(poly) >= 0 ? 1 : -1;
  const off = Math.min(best, Math.abs(polyArea(poly)) / best) * 0.25;
  return [(a[0] + b[0]) / 2 - uy * off * sgn, (a[1] + b[1]) / 2 + ux * off * sgn];
}

function dedupeContained(items) {
  // alanı büyükten küçüğe; merkezi kabul edilmiş bir öğenin içinde kalanı at
  items.sort((a, b) => b.area - a.area);
  const kept = [];
  for (const it of items) {
    const probe = interiorPoint(it.poly);
    if (kept.some((k) => pointInPoly(probe[0], probe[1], k.poly) && Math.abs(polyArea(k.poly)) >= Math.abs(it.area))) continue;
    kept.push(it);
  }
  items.length = 0;
  items.push(...kept);
  items.forEach((w, i) => { if (w.id && w.id[0] === 'W') w.id = 'W' + (i + 1); });
  return kept;
}
