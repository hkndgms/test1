// Duvar algılama kapsama analizi: duvar katmanındaki çizgilerden hangilerinin
// hiçbir duvar / kolon / boşluğa dönüşmediğini bulur ve SVG'ye çizer.
// node tests/coverage.mjs dosya.dwg cikti.svg
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Dwg_File_Type, LibreDwg } from '../web/vendor/libredwg-web/dist/libredwg-web.js';
import { flattenDwg } from '../web/js/flatten.js';
import { detect, DEFAULT_PARAMS, collectSegments, pointInPoly, UNIT_TO_CM } from '../web/js/detect.js';
import { autoSetup } from '../web/js/auto.js';
import { KnowledgeBase } from '../web/js/kb.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [file, outSvg] = process.argv.slice(2);
const lib = await LibreDwg.create(path.join(root, 'web/vendor/libredwg-web/wasm/'));
const d = flattenDwg(lib.convert(lib.dwg_read_data(fs.readFileSync(file), Dwg_File_Type.DWG)));
const a = autoSetup(d, { params: DEFAULT_PARAMS, units: d.units || 5, kb: new KnowledgeBase() });
const m = detect(d, { units: a.units, wallLayers: a.roles.wall, columnLayers: a.roles.column, doorLayers: a.roles.door, windowLayers: a.roles.window, region: a.region, params: DEFAULT_PARAMS });
const k = 1 / (UNIT_TO_CM[a.units] ?? 1);
const segs = collectSegments(d, a.roles.wall, a.region);
const solids = [...m.walls.map((w) => w.poly), ...m.columns.map((c) => c.poly), ...m.openings.map((o) => o.rect)];
const near = (x, y) => {
  for (const p of solids) {
    if (pointInPoly(x, y, p)) return true;
    for (let i = 0; i < p.length; i++) {
      const [ax, ay] = p[i], [bx, by] = p[(i + 1) % p.length];
      const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
      const t = L2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0;
      if (Math.hypot(ax + t * dx - x, ay + t * dy - y) <= 2 * k) return true;
    }
  }
  return false;
};
let tot = 0, miss = 0;
const missSegs = [];
for (const s of segs) {
  const L = Math.hypot(s[2] - s[0], s[3] - s[1]);
  tot += L;
  // 3 noktadan örnekle
  const ok = [0.25, 0.5, 0.75].filter((t) => near(s[0] + t * (s[2] - s[0]), s[1] + t * (s[3] - s[1]))).length;
  if (ok < 2) { miss += L; missSegs.push(s); }
}
const th = {};
for (const w of m.walls) { const t = Math.round(w.thickness * m.unitScale); th[t] = (th[t] || 0) + 1; }
console.log(path.basename(file), '| walls', m.walls.length, 'cols', m.columns.length, 'open', m.openings.length, 'rooms', m.rooms.length,
  '| wall-layer segs', segs.length, 'uncovered', missSegs.length, `(${(100 * miss / tot).toFixed(1)}% of length)`, '| thickness', JSON.stringify(th));
if (outSvg) {
  const xs = segs.flatMap((s) => [s[0], s[2]]), ys = segs.flatMap((s) => [s[1], s[3]]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sw = (x1 - x0) / 1500;
  const P = (poly) => poly.map((p) => `${p[0].toFixed(1)},${(-p[1]).toFixed(1)}`).join(' ');
  const o = [];
  for (const w of m.walls) o.push(`<polygon points="${P(w.poly)}" fill="#d9d2c3" stroke="none"/>`);
  for (const c of m.columns) o.push(`<polygon points="${P(c.poly)}" fill="#55607a"/>`);
  for (const op of m.openings) o.push(`<polygon points="${P(op.rect)}" fill="${op.kind === 'window' ? '#43b6e0' : op.kind === 'door' ? '#3ca24f' : '#bbb'}" fill-opacity=".8"/>`);
  for (const s of segs) o.push(`<line x1="${s[0]}" y1="${-s[1]}" x2="${s[2]}" y2="${-s[3]}" stroke="#333" stroke-width="${sw}"/>`);
  for (const s of missSegs) o.push(`<line x1="${s[0]}" y1="${-s[1]}" x2="${s[2]}" y2="${-s[3]}" stroke="#e00" stroke-width="${sw * 4}"/>`);
  fs.writeFileSync(outSvg, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - 50 * k} ${-y1 - 50 * k} ${x1 - x0 + 100 * k} ${y1 - y0 + 100 * k}" width="1800" style="background:#fff">${o.join('')}</svg>`);
}
