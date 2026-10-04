// Paftayı ayrık çizim gruplarına ("adalara") böler. Asıl plan, lejant, kolon
// şeması, detaylar ve uzaktaki kalıntılar ayrı adalara düşer.

export function findIslands(drawing, { cellCm = 200, unitToCm = 1 } = {}) {
  const cell = cellCm / unitToCm;
  const occ = new Map();
  const key = (i, j) => i * 1000003 + j;
  const prims = drawing.prims;
  for (let idx = 0; idx < prims.length; idx++) {
    const p = prims[idx].pts;
    let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
    for (let i = 0; i < p.length; i += 2) {
      const x = p[i], y = p[i + 1];
      if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > e) e = y;
    }
    if (c - a > cell * 60 || e - b > cell * 60) continue; // pafta çerçevesi gibi dev çizgiler adaları birleştirmesin
    // Çizginin geçtiği bütün hücreler işaretlenir (uzun duvarlar büyük salonları bölmesin)
    const i0 = Math.floor(a / cell), i1 = Math.floor(c / cell), j0 = Math.floor(b / cell), j1 = Math.floor(e / cell);
    // 15 m'den uzun çizgiler (pafta şeritleri, çerçeveler, kesit hatları) yalnız orta hücresini
    // işaretler; yoksa ayrı çizimleri birbirine bağlarlar
    const long = Math.max(c - a, e - b) > 1500 / unitToCm || (i1 - i0 + 1) * (j1 - j0 + 1) > 64;
    const mi = Math.floor((a + c) / 2 / cell), mj = Math.floor((b + e) / 2 / cell);
    for (let i = long ? mi : i0; i <= (long ? mi : i1); i++) for (let j = long ? mj : j0; j <= (long ? mj : j1); j++) {
      const k = key(i, j);
      let o = occ.get(k);
      if (!o) occ.set(k, (o = { i, j, n: 0, a, b, c, e }));
      if (i === Math.floor((a + c) / 2 / cell) && j === Math.floor((b + e) / 2 / cell)) o.n++;
      if (a < o.a) o.a = a; if (b < o.b) o.b = b; if (c > o.c) o.c = c; if (e > o.e) o.e = e;
    }
  }
  const seen = new Set();
  const islands = [];
  for (const [k, o] of occ) {
    if (seen.has(k)) continue;
    seen.add(k);
    const st = [o];
    const g = { n: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity] };
    while (st.length) {
      const c = st.pop();
      g.n += c.n;
      g.bbox[0] = Math.min(g.bbox[0], c.a); g.bbox[1] = Math.min(g.bbox[1], c.b);
      g.bbox[2] = Math.max(g.bbox[2], c.c); g.bbox[3] = Math.max(g.bbox[3], c.e);
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
        const kk = key(c.i + di, c.j + dj);
        const nb = occ.get(kk);
        if (nb && !seen.has(kk)) { seen.add(kk); st.push(nb); }
      }
    }
    islands.push(g);
  }
  islands.sort((a, b) => b.n - a.n);
  islands.forEach((g, i) => (g.id = i + 1));
  return islands;
}

export function bboxContains(outer, inner) {
  return inner[0] >= outer[0] && inner[1] >= outer[1] && inner[2] <= outer[2] && inner[3] <= outer[3];
}

export function padBox(b, f = 0.03) {
  const m = Math.max(b[2] - b[0], b[3] - b[1]) * f;
  return [b[0] - m, b[1] - m, b[2] + m, b[3] + m];
}

// Bölümün adı: içindeki en büyük (başlık) yazı
export function labelIslands(drawing, islands, n = 15) {
  for (const isl of islands.slice(0, n)) {
    let best = null;
    const b = isl.bbox;
    for (const t of drawing.texts) {
      if (t.x < b[0] || t.x > b[2] || t.y < b[1] || t.y > b[3]) continue;
      if (t.s.length < 4 || t.s.length > 60 || !/\p{L}{3}/u.test(t.s)) continue;
      const score = t.h * (/PLAN|KESİT|KESIT|SECTION|GÖRÜNÜŞ|GORUNUS|ELEVATION|ŞEMA|SEMA|DETAY|DETAIL|LEJANT|LEGEND|KAT|FLOOR/i.test(t.s) ? 3 : 1);
      if (!best || score > best.score) best = { score, s: t.s };
    }
    isl.label = best ? best.s : '';
  }
  return islands;
}
