// Otomatik kurulum: asıl planın bulunduğu çizim grubu (ada), duvar/kolon/kapı/
// pencere katmanları ve çizim birimi. Lejant, kolon şeması, detay ve uzak
// kalıntılar ayrı adalarda kaldığı için yok sayılır.
import { detect, collectSegments, UNIT_NAMES, UNIT_TO_CM } from './detect.js';
import { findIslands, labelIslands, padBox } from './islands.js';

export const WALL_RE = /duvar|wall|perde/i;
export const COL_RE = /beton|kolon|column|colm|struct|strukt|tasiyici|taşıyıcı/i;
export const DOOR_RE = /kap[ıi]|door|\bdr\b/i;
export const WIN_RE = /pencere|window|wndw|glaz|do[gğ]rama|\bcam\b|-cam\b|glass|curtain|giydirme/i;
const SKIP_MARK_RE = /^m[-_]|hvac|vrf|yazi|yazı|text|tag|etiket/i;
export const SKIP_RE = /^m[-_]|hvac|vrf|tesisat|walky|tefri|tarama|hatch|olcu|ölçü|dim|yazi|yazı|text|[-_ ]trm[-_ ]|^trm|superpoze/i;

export function modelScore(m) {
  if (m.walls.length < 3) return 0;
  const s2 = m.unitScale ** 2 / 1e4;
  const rooms = m.rooms.filter((r) => { const a = Math.abs(r.area) * s2; return a >= 1 && a <= 1000; });
  return 0.5 * m.walls.length + 2 * m.walls.filter((w) => w.exterior).length + 5 * rooms.length + 5 * rooms.filter((r) => r.name).length;
}

function layerBBox(d, set, within) {
  let a = Infinity, b = Infinity, c = -Infinity, e = -Infinity;
  for (const p of d.prims) {
    if (!set.has(p.l)) continue;
    for (let i = 0; i < p.pts.length; i += 2) {
      const x = p.pts[i], y = p.pts[i + 1];
      if (within && (x < within[0] || x > within[2] || y < within[1] || y > within[3])) continue;
      if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > e) e = y;
    }
  }
  return isFinite(a) ? padBox([a, b, c, e], 0.05) : null;
}

export function autoSetup(d, { params, units: declared, kb, islands: given, onlyIslands }) {
  const islands = given || labelIslands(d, findIslands(d, { unitToCm: UNIT_TO_CM[declared] ?? 1 }));
  let top = onlyIslands ? onlyIslands : islands.slice(0, 8);
  // Çizimde tesisat varsa yalnız anlamlı miktarda tesisat içeren adaları değerlendir
  // (ağaçlı vaziyet planı gibi mimari kopyalar elenir; şema/lejant adaları duvar
  // içermediği için zaten skor alamaz)
  if (kb) {
    const cls = new Map();
    const isMep = (l) => { let c = cls.get(l); if (c === undefined) cls.set(l, (c = !!kb.classify(d.layers[l].name).kind && kb.classify(d.layers[l].name).kind !== 'ignore')); return c; };
    for (const isl of top) isl.mep = 0;
    for (const p of d.prims) {
      if (!isMep(p.l)) continue;
      const x = p.pts[0], y = p.pts[1];
      for (const isl of top) if (x >= isl.bbox[0] && x <= isl.bbox[2] && y >= isl.bbox[1] && y <= isl.bbox[3]) { isl.mep++; break; }
    }
    const maxMep = Math.max(0, ...top.map((i) => i.mep));
    if (maxMep >= 200 && !onlyIslands) top = top.filter((i) => i.mep >= 0.2 * maxMep);
  }
  const unitsTry = [declared, ...[4, 5, 6].filter((u) => u !== declared)];
  const wallCands = d.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.count > 0 && WALL_RE.test(l.name) && !SKIP_RE.test(l.name));
  let best = null;
  for (const isl of top) {
    const region = padBox(isl.bbox, 0.02);
    let cands = wallCands;
    if (!cands.length) {
      // adında duvar geçen katman yoksa adadaki en kalabalık (tesisat/yazı olmayan) katmanları dene
      const cnt = new Map();
      for (const p of d.prims) {
        const x = p.pts[0], y = p.pts[1];
        if (x < region[0] || x > region[2] || y < region[1] || y > region[3]) continue;
        cnt.set(p.l, (cnt.get(p.l) || 0) + 1);
      }
      cands = [...cnt.entries()].filter(([l]) => !SKIP_RE.test(d.layers[l].name) && !/^(0|defpoints)$/i.test(d.layers[l].name))
        .sort((a, b) => b[1] - a[1]).slice(0, 8).map(([i]) => ({ l: d.layers[i], i }));
    }
    for (const c of cands) {
      const set = new Set([c.i]);
      const nseg = collectSegments(d, set, region).length;
      if (nseg < 8 || nseg > 20000) continue;
      const r = layerBBox(d, set, region);
      for (const u of unitsTry) {
        const m = detect(d, { units: u, wallLayers: set, columnLayers: new Set(), region: r, params });
        const score = modelScore(m) * (u === declared ? 1.15 : 1);
        if (score > 0 && (!best || score > best.score)) best = { i: c.i, u, score, island: isl, region: r };
      }
    }
  }
  const out = {
    islands, units: declared, unitNote: '', region: null, planIsland: null,
    roles: { wall: new Set(), column: new Set(), text: new Set(), door: new Set(), window: new Set() },
  };
  if (!best) {
    // duvar bulunamadı: en çok tesisat içeren adayı seç (salt tesisat paftası olabilir)
    if (kb && top.length) {
      let bi = null;
      for (const isl of top) {
        let n = 0;
        const cls = new Map();
        for (const p of d.prims) {
          const x = p.pts[0], y = p.pts[1];
          if (x < isl.bbox[0] || x > isl.bbox[2] || y < isl.bbox[1] || y > isl.bbox[3]) continue;
          let c = cls.get(p.l);
          if (c === undefined) cls.set(p.l, (c = kb.classify(d.layers[p.l].name).kind));
          if (c && c !== 'ignore') n++;
        }
        if (!bi || n > bi.n) bi = { isl, n };
      }
      if (bi && bi.n) { out.planIsland = bi.isl; out.region = padBox(bi.isl.bbox, 0.02); }
    }
    return out;
  }
  out.planIsland = best.island;
  // İşlenen alan: asıl planın bulunduğu bölümün tamamı (tesisat duvarların dışına taşabilir).
  // Bölüm duvar sınırına göre aşırı büyükse (paftada birbirine değen çizimler) duvar sınırı + pay.
  const ib = best.island.bbox, wb = best.region;
  const ratio = ((ib[2] - ib[0]) * (ib[3] - ib[1])) / Math.max(1e-9, (wb[2] - wb[0]) * (wb[3] - wb[1]));
  out.region = ratio > 12 ? padBox(wb, 0.15) : padBox(ib, 0.02);
  if (best.u !== declared) {
    out.unitNote = `Dosyada birim "${UNIT_NAMES[declared] || '?'}" yazıyor ama ölçüler ${UNIT_NAMES[best.u]} ile tutarlı; ${UNIT_NAMES[best.u]} kullanıldı. Gerekirse Ölçüler › Çizim birimi'nden değiştirin.`;
    out.units = best.u;
  }
  out.roles.wall.add(best.i);
  // kolon katmanı
  let bc = null;
  for (const [i, l] of d.layers.entries()) {
    if (!l.count || !COL_RE.test(l.name) || /tarama|hatch|[-_ ]trm[-_ ]/i.test(l.name)) continue;
    const set = new Set([i]);
    if (collectSegments(d, set, out.region).length > 20000) continue;
    const m = detect(d, { units: out.units, wallLayers: new Set(), columnLayers: set, region: out.region, params });
    if (!bc || m.columns.length > bc.n) bc = { i, n: m.columns.length };
  }
  if (bc && bc.n > 0) out.roles.column.add(bc.i);
  // kapı / pencere işaret katmanları
  d.layers.forEach((l, i) => {
    if (!l.count || out.roles.wall.has(i) || SKIP_MARK_RE.test(l.name)) return;
    // kapı + pencere ortak katmanları (DOOR WINDOW, KAPI-PENCERE, doğrama) cam/pencere rolüne
    // girer; kapılar bu katmanda açılış yaylarından ayrıca tanınır
    if (WIN_RE.test(l.name)) out.roles.window.add(i);
    else if (DOOR_RE.test(l.name)) out.roles.door.add(i);
  });
  return out;
}
