// Mekanik tesisat çıkarımı: katman profilleri, borular, kanal/menfezler, cihazlar,
// uç birimler (sprinkler, vana) ve proje içindeki kot bilgisi.
import { buildFaces, simplifyPoly, polyArea, UNIT_TO_CM } from './detect.js';
import { fold } from './kb.js';

// ------------------------------------------------------------ yardımcılar
function primBox(p) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (let i = 0; i < p.length; i += 2) {
    const x = p[i], y = p[i + 1];
    if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
  }
  return [a, b, c, d];
}
function primLen(p, closed) {
  let s = 0;
  for (let i = 2; i < p.length; i += 2) s += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
  if (closed && p.length > 4) s += Math.hypot(p[0] - p[p.length - 2], p[1] - p[p.length - 1]);
  return s;
}
const inRegion = (bb, r) => !r || ((bb[0] + bb[2]) / 2 >= r[0] && (bb[0] + bb[2]) / 2 <= r[2] && (bb[1] + bb[3]) / 2 >= r[1] && (bb[1] + bb[3]) / 2 <= r[3]);
function median(a) { if (!a.length) return 0; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }
function distPointSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
  const t = L2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2)) : 0;
  return Math.hypot(ax + t * dx - px, ay + t * dy - py);
}

// ------------------------------------------------------------ katman özetleri
// Her katman için bölgedeki içerik özeti (yapay zekâya ve arayüze gider)
export function layerStats(drawing, region, units) {
  const toCm = UNIT_TO_CM[units] ?? 1;
  const st = new Map();
  const get = (l) => { let s = st.get(l); if (!s) st.set(l, (s = { l, n: 0, open: 0, closed: 0, len: 0, sizes: [], blocks: new Map(), texts: new Set() })); return s; };
  for (const pr of drawing.prims) {
    const bb = primBox(pr.pts);
    if (!inRegion(bb, region)) continue;
    const s = get(pr.l);
    s.n++;
    if (pr.closed) s.closed++; else s.open++;
    s.len += primLen(pr.pts, pr.closed);
    if (s.sizes.length < 400) s.sizes.push(Math.max(bb[2] - bb[0], bb[3] - bb[1]));
    if (pr.b >= 0) { const nm = drawing.instances[pr.b].name; s.blocks.set(nm, (s.blocks.get(nm) || 0) + 1); }
  }
  for (const t of drawing.texts) {
    if (region && (t.x < region[0] || t.x > region[2] || t.y < region[1] || t.y > region[3])) continue;
    const s = get(t.l);
    if (s.texts.size < 8 && t.s.length <= 40) s.texts.add(t.s);
  }
  const out = [];
  for (const s of st.values()) {
    out.push({
      l: s.l, name: drawing.layers[s.l].name, count: s.n, open: s.open, closed: s.closed,
      lengthM: +(s.len * toCm / 100).toFixed(1), typicalCm: Math.round(median(s.sizes) * toCm),
      blocks: [...s.blocks.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([n]) => n),
      texts: [...s.texts],
    });
  }
  return out.sort((a, b) => b.count - a.count);
}

// ------------------------------------------------------------ kot tespiti
const CEIL_RE = /(?:\bA\.?\s?T\.?(?=[\s:=+\d])|ASMA\s*TAVAN(?:\s*KOTU)?|\bC\.?\s?H\.?(?=[\s:=+\d])|CEILING(?:\s*HEIGHT|\s*LEVEL)?|\bCLG\b|TAVAN\s*(?:KOTU|YUKSEKLIGI|YUKS\.?))\s*[:=]?\s*\+?\s*(\d+(?:[.,]\d+)?)\s*(CM|M)?/;
const KOT_RE = /^[+±]\s?(\d{1,2}[.,]\d{2})\b/;

export function detectElevations(drawing, region) {
  let ceiling = null;
  const kots = new Map();
  for (const t of drawing.texts) {
    const s = fold(t.s);
    const m = s.match(CEIL_RE);
    if (m && !ceiling) {
      let v = parseFloat(m[1].replace(',', '.'));
      if (m[2] === 'M' || (!m[2] && v < 20)) v *= 100;
      if (v >= 180 && v <= 1500) ceiling = { cm: Math.round(v), text: t.s };
    }
    const k = t.s.trim().match(KOT_RE);
    if (k) {
      const v = Math.round(parseFloat(k[1].replace(',', '.')) * 100);
      if (v >= 200 && v <= 900) kots.set(v, (kots.get(v) || 0) + 1);
    }
  }
  const candidates = [...kots.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([cm, count]) => ({ cm, count }));
  return { ceiling, candidates };
}

// ------------------------------------------------------------ çıkarım
// profiles: Map<layerIndex, {kind, system, sizeCm, ...}>
export function extractMep(drawing, { region, units, profiles }) {
  const toCm = UNIT_TO_CM[units] ?? 1;
  const k = 1 / toCm; // cm -> çizim birimi
  const byLayer = new Map();
  for (let i = 0; i < drawing.prims.length; i++) {
    const pr = drawing.prims[i];
    const prof = profiles.get(pr.l);
    if (!prof || !prof.kind || prof.kind === 'ignore') continue;
    const bb = primBox(pr.pts);
    if (!inRegion(bb, region)) continue;
    let a = byLayer.get(pr.l);
    if (!a) byLayer.set(pr.l, (a = []));
    a.push({ pr, bb });
  }
  const pipes = [], ducts = [], boxes = [];
  const dropped = { coverage: 0, tiny: 0, oversize: 0, duplicate: 0 };
  let nid = 0;
  const id = (p) => p + (++nid);

  for (const [l, items] of byLayer) {
    const prof = profiles.get(l);
    if (prof.kind === 'pipe') extractPipes(l, items);
    else if (prof.kind === 'air') extractAir(l, items);
    else extractBoxes(l, items, prof.kind);
  }

  function extractPipes(l, items) {
    const seen = new Set();
    for (const { pr } of items) {
      if (pr.closed) { dropped.tiny++; continue; } // kapalı şekiller boru değil (sembol)
      const len = primLen(pr.pts, false);
      if (len < 15 * k) { dropped.tiny++; continue; }
      const key = pr.pts.map((v) => Math.round(v / (2 * k))).join(',');
      const rkey = [];
      for (let i = pr.pts.length - 2; i >= 0; i -= 2) rkey.push(Math.round(pr.pts[i] / (2 * k)), Math.round(pr.pts[i + 1] / (2 * k)));
      if (seen.has(key) || seen.has(rkey.join(','))) { dropped.duplicate++; continue; }
      seen.add(key);
      const pts = [];
      for (let i = 0; i < pr.pts.length; i += 2) pts.push([pr.pts[i], pr.pts[i + 1]]);
      pipes.push({ id: id('P'), l, pts, lengthCm: len * toCm, diaCm: null, diaSrc: 'default' });
    }
  }

  function extractAir(l, items) {
    const segs = [];
    for (const { pr } of items) {
      const p = pr.pts, n = p.length / 2;
      const m = pr.closed ? n : n - 1;
      for (let i = 0; i < m; i++) {
        const j = (i + 1) % n;
        if (p[2 * i] !== p[2 * j] || p[2 * i + 1] !== p[2 * j + 1]) segs.push([p[2 * i], p[2 * i + 1], p[2 * j], p[2 * j + 1]]);
      }
    }
    if (!segs.length || segs.length > 60000) return;
    const f = buildFaces(segs, 1 * k, [3 * k, 160 * k]);
    const got = [];
    for (const face of f.faces) {
      if (face.area <= 4 * k * k) continue;
      const poly = simplifyPoly(face.poly, 1 * k);
      const A = Math.abs(polyArea(poly));
      let per = 0;
      for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; per += Math.hypot(b[0] - a[0], b[1] - a[1]); }
      const h = per / 2, disc = h * h - 4 * A;
      const t = disc <= 0 ? h / 2 : (h - Math.sqrt(disc)) / 2; // eşdeğer genişlik
      const L = t > 0 ? A / t : 0;
      const bb = primBox(poly.flat());
      const maxDim = Math.max(bb[2] - bb[0], bb[3] - bb[1]);
      if (t * toCm >= 5 && t * toCm <= 160 && L >= 2.5 * t) got.push({ type: 'duct', poly, widthCm: t * toCm, A });
      else if (maxDim * toCm <= 250 && maxDim * toCm >= 8) got.push({ type: 'terminal', poly, A });
      else dropped.oversize++;
    }
    // iç içe şekillerden yalnız dıştakini tut
    got.sort((a, b) => b.A - a.A);
    const kept = [];
    for (const g of got) {
      const c = g.poly.reduce((s, p) => [s[0] + p[0] / g.poly.length, s[1] + p[1] / g.poly.length], [0, 0]);
      if (kept.some((q) => pointIn(c, q.poly))) continue;
      kept.push(g);
    }
    for (const g of kept) {
      if (g.type === 'duct') ducts.push({ id: id('D'), l, poly: g.poly, widthCm: g.widthCm, heightCm: null });
      else boxes.push({ id: id('T'), l, poly: g.poly, kind: 'terminal', name: '' });
    }
  }

  function extractBoxes(l, items, kind) {
    const maxCm = kind === 'terminal' ? 120 : 800;
    const minCm = 3;
    // 1) adlı blok örnekleri: her örnek bir cihaz
    const groups = new Map();
    const loose = [];
    for (const it of items) {
      const sizeCm = Math.max(it.bb[2] - it.bb[0], it.bb[3] - it.bb[1]) * toCm;
      // büyük daireler/kapalı halkalar: sprinkler etki alanı vb.
      if (kind === 'terminal' && it.pr.closed && sizeCm > 60 && Math.abs((it.bb[2] - it.bb[0]) - (it.bb[3] - it.bb[1])) < 0.1 * (it.bb[2] - it.bb[0])) { dropped.coverage++; continue; }
      // cihaz katmanındaki uzun açık hatlar bağlantı çizgisidir; kümeleri birleştirmesin
      if (it.pr.b < 0 && !it.pr.closed && primLen(it.pr.pts, false) * toCm > (kind === 'terminal' ? 60 : 120)) { dropped.lines = (dropped.lines || 0) + 1; continue; }
      if (it.pr.b >= 0) {
        let g = groups.get(it.pr.b);
        if (!g) groups.set(it.pr.b, (g = []));
        g.push(it);
      } else loose.push(it);
    }
    for (const [inst, g] of groups) {
      const info = drawing.instances[inst];
      const box = orientedBox(g.map((x) => x.pr.pts), info.rot);
      const dim = Math.max(box.w, box.h) * toCm;
      if (dim < minCm) { dropped.tiny++; continue; }
      // cihazdan büyük blok: bütün bir tesisat yerleşimi blok yapılmış; parçalarına ayır
      if (dim > maxCm) { loose.push(...g); continue; }
      boxes.push({ id: id(kind === 'terminal' ? 'T' : 'E'), l, poly: box.poly, kind, name: info.name });
    }
    // 2) bloksuz çizgiler: yakınlık kümelemesi
    const gap = (kind === 'terminal' ? 2 : 5) * k;
    for (const cl of clusterBoxes(loose, gap)) {
      const w = cl[2] - cl[0], h = cl[3] - cl[1];
      const dim = Math.max(w, h) * toCm;
      if (dim < minCm) { dropped.tiny++; continue; }
      if (dim > maxCm) { dropped.oversize++; continue; }
      boxes.push({ id: id(kind === 'terminal' ? 'T' : 'E'), l, poly: [[cl[0], cl[1]], [cl[2], cl[1]], [cl[2], cl[3]], [cl[0], cl[3]]], kind, name: '' });
    }
  }

  // Çap ve kesit yazıları
  const labelRe = /(?:Ø|ø|⌀|%%C|DN)\s*(\d{1,3}(?:[.,]\d)?)/i;
  const sizeRe = /(\d{2,4})\s*[xX×]\s*(\d{2,4})/;
  const reach = 80 * k;
  for (const t of drawing.texts) {
    if (region && (t.x < region[0] || t.x > region[2] || t.y < region[1] || t.y > region[3])) continue;
    const m = t.s.match(labelRe);
    if (m && pipes.length) {
      const mm = parseFloat(m[1].replace(',', '.'));
      if (mm >= 6 && mm <= 600) {
        let best = null, bd = reach;
        for (const p of pipes) {
          for (let i = 1; i < p.pts.length; i++) {
            const d = distPointSeg(t.x, t.y, p.pts[i - 1][0], p.pts[i - 1][1], p.pts[i][0], p.pts[i][1]);
            if (d < bd) { bd = d; best = p; }
          }
        }
        if (best && (best.diaSrc !== 'label' || bd < best._ld)) { best.diaCm = mm / 10; best.diaSrc = 'label'; best.diaText = t.s; best._ld = bd; }
      }
    }
    const s = t.s.match(sizeRe);
    if (s && ducts.length) {
      const wmm = +s[1], hmm = +s[2];
      if (wmm >= 80 && wmm <= 3000 && hmm >= 50 && hmm <= 2000) {
        let best = null, bd = 150 * k;
        for (const d of ducts) {
          for (let i = 0; i < d.poly.length; i++) {
            const a = d.poly[i], b = d.poly[(i + 1) % d.poly.length];
            const dd = distPointSeg(t.x, t.y, a[0], a[1], b[0], b[1]);
            if (dd < bd) { bd = dd; best = d; }
          }
        }
        if (best) { best.heightCm = hmm / 10; best.sizeText = t.s; }
      }
    }
  }
  for (const p of pipes) delete p._ld;

  // Kanal yüksekliği: etiketli kanaldan (600x300) birbirine değen etiketsiz parçalara (dirsek, redüksiyon,
  // branşman) yayılır; böylece aynı hattaki parçalar aynı yükseklik/üst kotta durur. Redüksiyonda iki
  // komşu farklı yükseklikteyse büyük olan alınır (üst kot sabit, alt yüz eğimli varsayılır).
  if (ducts.length > 1 && ducts.some((d) => d.heightCm)) {
    const bb = ducts.map((d) => { let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity; for (const [x, y] of d.poly) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); e = Math.max(e, y); } return [a, b, c, e]; });
    const tol = 3 * k;
    const touch = (i, j) => bb[i][0] <= bb[j][2] + tol && bb[j][0] <= bb[i][2] + tol && bb[i][1] <= bb[j][3] + tol && bb[j][1] <= bb[i][3] + tol
      && ducts[i].poly.some((p) => ducts[j].poly.some((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) <= tol) || pointIn(p, ducts[j].poly));
    let changed = true, guard = 0;
    while (changed && guard++ < 20) {
      changed = false;
      for (let i = 0; i < ducts.length; i++) {
        if (ducts[i].heightCm) continue;
        let best = 0;
        for (let j = 0; j < ducts.length; j++) if (j !== i && ducts[j].heightCm && touch(i, j)) best = Math.max(best, ducts[j].heightCm);
        if (best) { ducts[i].heightCm = best; ducts[i].heightSrc = 'komşu'; changed = true; }
      }
    }
  }

  return { pipes, ducts, boxes, dropped };
}

function pointIn([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Blok dönüklüğüne göre yönlendirilmiş sınır kutusu
function orientedBox(ptsList, rot) {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  let a = Infinity, b = Infinity, cc = -Infinity, d = -Infinity;
  for (const p of ptsList) for (let i = 0; i < p.length; i += 2) {
    const x = p[i] * c - p[i + 1] * s, y = p[i] * s + p[i + 1] * c;
    if (x < a) a = x; if (x > cc) cc = x; if (y < b) b = y; if (y > d) d = y;
  }
  const back = (x, y) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
  return { poly: [back(a, b), back(cc, b), back(cc, d), back(a, d)], w: cc - a, h: d - b };
}

// Sınır kutularını, aralarındaki boşluk <= gap olacak şekilde birleştirir
function clusterBoxes(items, gap) {
  if (!items.length) return [];
  const n = items.length;
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  let cell = 0;
  for (const it of items) cell = Math.max(cell, Math.min(it.bb[2] - it.bb[0], it.bb[3] - it.bb[1]));
  cell = Math.max(gap * 4, cell, 1e-6);
  const grid = new Map();
  const ck = (i, j) => i * 73856093 ^ j * 19349663;
  items.forEach((it, idx) => {
    const i0 = Math.floor((it.bb[0] - gap) / cell), i1 = Math.floor((it.bb[2] + gap) / cell);
    const j0 = Math.floor((it.bb[1] - gap) / cell), j1 = Math.floor((it.bb[3] + gap) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return; // aşırı büyük öğe: kümelemeye katılmaz
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = ck(i, j);
      const list = grid.get(key);
      if (list) {
        for (const o of list) {
          const b = items[o].bb, a = it.bb;
          if (a[0] - gap <= b[2] && b[0] - gap <= a[2] && a[1] - gap <= b[3] && b[1] - gap <= a[3]) {
            const ra = find(idx), rb = find(o);
            if (ra !== rb) parent[ra] = rb;
          }
        }
        list.push(idx);
      } else grid.set(key, [idx]);
    }
  });
  const out = new Map();
  items.forEach((it, idx) => {
    const r = find(idx);
    const b = out.get(r);
    if (!b) out.set(r, it.bb.slice());
    else { b[0] = Math.min(b[0], it.bb[0]); b[1] = Math.min(b[1], it.bb[1]); b[2] = Math.max(b[2], it.bb[2]); b[3] = Math.max(b[3], it.bb[3]); }
  });
  return [...out.values()];
}
