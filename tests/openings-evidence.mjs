// Her boşluğun içinde hangi katmanlardan çizim olduğunu listeler (pencere kanıtı analizi)
// node tests/openings-evidence.mjs dosya.dwg
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Dwg_File_Type, LibreDwg } from '../web/vendor/libredwg-web/dist/libredwg-web.js';
import { flattenDwg } from '../web/js/flatten.js';
import { detect, DEFAULT_PARAMS, pointInPoly } from '../web/js/detect.js';
import { autoSetup } from '../web/js/auto.js';
import { KnowledgeBase } from '../web/js/kb.js';
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lib = await LibreDwg.create(path.join(root, 'web/vendor/libredwg-web/wasm/'));
const d = flattenDwg(lib.convert(lib.dwg_read_data(fs.readFileSync(process.argv[2]), Dwg_File_Type.DWG)));
const a = autoSetup(d, { params: DEFAULT_PARAMS, units: d.units || 5, kb: new KnowledgeBase() });
const m = detect(d, { units: a.units, wallLayers: a.roles.wall, columnLayers: a.roles.column, doorLayers: a.roles.door, windowLayers: a.roles.window, region: a.region, params: DEFAULT_PARAMS });
console.log('roles', Object.fromEntries(Object.entries(a.roles).map(([k, s]) => [k, [...s].map((i) => d.layers[i].name)])));
const tally = {};
for (const o of m.openings) {
  // dikdörtgeni biraz küçült
  const c = o.center, al = o.along, ac = o.across, hw = o.width / 2 * 0.9, ht = o.thickness / 2 * 0.9;
  const rect = [[c[0] - al[0] * hw - ac[0] * ht, c[1] - al[1] * hw - ac[1] * ht], [c[0] + al[0] * hw - ac[0] * ht, c[1] + al[1] * hw - ac[1] * ht], [c[0] + al[0] * hw + ac[0] * ht, c[1] + al[1] * hw + ac[1] * ht], [c[0] - al[0] * hw + ac[0] * ht, c[1] - al[1] * hw + ac[1] * ht]];
  const L = new Map();
  for (const p of d.prims) {
    for (let i = 0; i < p.pts.length; i += 2) if (pointInPoly(p.pts[i], p.pts[i + 1], rect)) { L.set(p.l, (L.get(p.l) || 0) + 1); break; }
  }
  const names = [...L.entries()].sort((x, y) => y[1] - x[1]).map(([l, n]) => d.layers[l].name + ':' + n);
  console.log(o.id, o.kind.padEnd(6), Math.round(o.width * m.unitScale) + 'cm', o.exterior ? 'dış' : 'iç ', o.weak ? 'zayıf' : '     ', o.marker || '', '|', o.why || '', '|', names.slice(0, 6).join(', '));
  for (const [l] of L) { const n = d.layers[l].name; tally[n] = (tally[n] || 0) + 1; }
}
console.log('layers inside openings:', Object.entries(tally).sort((x, y) => y[1] - x[1]).slice(0, 20));
