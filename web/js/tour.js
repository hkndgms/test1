// Otomatik gezi rotası: mahalleri kapı/geçişlerden geçerek dolaşan göz hizası rota.
// Yapay zekâ bir oda sırası verdiyse (tour.order) o sıra izlenir; yoksa program
// girişten başlayıp en yakın gezilmemiş mahale giderek rotayı kendisi kurar.
import { pointInPoly, polyArea } from './detect.js';

export function labelPoint(poly) {
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

// Dönüş: [{x, y, room?, name?, note?, spin?, jump?}] (çizim biriminde)
export function planTour(model, overrides = {}, { order = null, notes = {}, minRoomM2 = 3 } = {}) {
  const s2 = model.unitScale ** 2 / 1e4;
  const cm = 1 / model.unitScale; // 1 cm, çizim biriminde
  const nameOf = (r) => overrides[r.id]?.name ?? r.name ?? '';
  const rooms = model.rooms.filter((r) => !overrides[r.id]?.deleted && Math.abs(r.area) * s2 >= minRoomM2);
  if (!rooms.length) return [];
  const center = new Map(rooms.map((r) => [r.id, labelPoint(r.poly)]));
  const roomAt = (x, y) => rooms.find((r) => pointInPoly(x, y, r.poly)) || null;
  // kapı ve geçişlerden mahaller arası bağlantılar
  const links = [];
  for (const o of model.openings) {
    if (overrides[o.id]?.deleted) continue;
    const kind = overrides[o.id]?.kind || o.kind;
    if (kind !== 'door' && kind !== 'empty') continue;
    const off = o.thickness / 2 + 45 * cm;
    const pa = [o.center[0] + o.across[0] * off, o.center[1] + o.across[1] * off];
    const pb = [o.center[0] - o.across[0] * off, o.center[1] - o.across[1] * off];
    const ra = roomAt(...pa), rb = roomAt(...pb);
    if (ra === rb) continue;
    links.push({ o, a: ra?.id || 'OUT', b: rb?.id || 'OUT', pa, pb });
  }
  const adj = new Map();
  const addAdj = (u, v, l) => { if (!adj.has(u)) adj.set(u, []); adj.get(u).push({ v, l }); };
  for (const l of links) { addAdj(l.a, l.b, l); addAdj(l.b, l.a, l); }
  const bfs = (from, to) => {
    const prev = new Map([[from, null]]);
    const q = [from];
    while (q.length) {
      const u = q.shift();
      if (u === to) break;
      for (const { v, l } of adj.get(u) || []) if (!prev.has(v) && (v !== 'OUT' || to === 'OUT')) { prev.set(v, { u, l }); q.push(v); }
    }
    if (!prev.has(to)) return null;
    const steps = [];
    for (let v = to; prev.get(v); v = prev.get(v).u) steps.unshift({ from: prev.get(v).u, to: v, l: prev.get(v).l });
    return steps;
  };
  // ziyaret sırası
  const ids = rooms.map((r) => r.id);
  let seq = Array.isArray(order) ? order.filter((id) => ids.includes(id)) : [];
  const entrance = links.find((l) => l.a === 'OUT' || l.b === 'OUT');
  if (!seq.length) {
    const start = entrance ? (entrance.a === 'OUT' ? entrance.b : entrance.a) : rooms.slice().sort((a, b) => Math.abs(b.area) - Math.abs(a.area))[0].id;
    seq = [start];
  }
  // sırada olmayan mahaller: en az kapı adımıyla ulaşılan en yakına git
  const remaining = new Set(ids.filter((id) => !seq.includes(id)));
  const greedy = [];
  let cur = seq[seq.length - 1];
  while (remaining.size) {
    let best = null;
    for (const id of remaining) {
      const p = bfs(cur, id);
      const [cx, cy] = center.get(cur), [tx, ty] = center.get(id);
      const cost = (p ? p.length * 1e6 : 1e12) + Math.hypot(tx - cx, ty - cy);
      if (!best || cost < best.cost) best = { id, cost };
    }
    greedy.push(best.id);
    remaining.delete(best.id);
    cur = best.id;
  }
  seq = seq.concat(greedy);
  // yol noktaları
  const byId = new Map(rooms.map((r) => [r.id, r]));
  const wps = [];
  const visit = (id) => { const r = byId.get(id); const [x, y] = center.get(id); wps.push({ x, y, room: id, name: nameOf(r), note: notes[id] || '', spin: true }); };
  if (entrance) {
    const outside = entrance.a === 'OUT' ? entrance.pa : entrance.pb;
    const inside = entrance.a === 'OUT' ? entrance.pb : entrance.pa;
    const dx = outside[0] - inside[0], dy = outside[1] - inside[1], L = Math.hypot(dx, dy) || 1;
    wps.push({ x: outside[0] + (dx / L) * 300 * cm, y: outside[1] + (dy / L) * 300 * cm, name: 'Giriş' });
    wps.push({ x: outside[0], y: outside[1] }, { x: inside[0], y: inside[1] });
    const first = entrance.a === 'OUT' ? entrance.b : entrance.a;
    if (seq[0] !== first) seq.unshift(first);
  }
  visit(seq[0]);
  for (let i = 1; i < seq.length; i++) {
    const p = bfs(seq[i - 1], seq[i]);
    if (!p) { const [x, y] = center.get(seq[i]); wps.push({ x, y, jump: true }); visit(seq[i]); continue; }
    for (const st of p) {
      const fromSide = st.l.a === st.from ? st.l.pa : st.l.pb;
      const toSide = st.l.a === st.from ? st.l.pb : st.l.pa;
      wps.push({ x: fromSide[0], y: fromSide[1] }, { x: toSide[0], y: toSide[1] });
      if (st.to !== seq[i] && byId.has(st.to)) { const [x, y] = center.get(st.to); wps.push({ x, y }); }
    }
    visit(seq[i]);
  }
  return wps;
}

export { polyArea };
