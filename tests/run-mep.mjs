// Node: DWG -> otomatik kurulum -> duvar algılama + tesisat çıkarımı özeti
// node tests/run-mep.mjs dosya.dwg [dosya2.dwg ...]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Dwg_File_Type, LibreDwg } from '../web/vendor/libredwg-web/dist/libredwg-web.js';
import { flattenDwg } from '../web/js/flatten.js';
import { detect, DEFAULT_PARAMS } from '../web/js/detect.js';
import { autoSetup } from '../web/js/auto.js';
import { KnowledgeBase, SYSTEMS } from '../web/js/kb.js';
import { layerStats, extractMep, detectElevations } from '../web/js/mep.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
for (const file of process.argv.slice(2)) {
  const lib = await LibreDwg.create(path.join(root, 'web/vendor/libredwg-web/wasm/'));
  const dwg = lib.dwg_read_data(fs.readFileSync(file), Dwg_File_Type.DWG);
  const d = flattenDwg(lib.convert(dwg));
  const kb = new KnowledgeBase();
  let t0 = Date.now();
  const a = autoSetup(d, { params: DEFAULT_PARAMS, units: d.units || 5, kb });
  console.log('\n===', path.basename(file), 'auto', Date.now() - t0, 'ms; islands', a.islands.length, 'plan island', a.planIsland?.id, 'n', a.planIsland?.n, 'units', a.units, a.unitNote ? '(düzeltildi)' : '');
  console.log('roles', Object.fromEntries(Object.entries(a.roles).map(([k, s]) => [k, [...s].map((i) => d.layers[i].name)])));
  const m = detect(d, { units: a.units, wallLayers: a.roles.wall, columnLayers: a.roles.column, doorLayers: a.roles.door, windowLayers: a.roles.window, region: a.region, params: DEFAULT_PARAMS });
  console.log('arch: walls', m.walls.length, 'cols', m.columns.length, 'openings', m.openings.length, 'rooms', m.rooms.length);
  t0 = Date.now();
  const stats = layerStats(d, a.region, a.units);
  const profiles = new Map();
  const unknown = [];
  for (const s of stats) {
    const c = kb.classify(s.name);
    if (c.kind && c.kind !== 'ignore') profiles.set(s.l, c);
    if (c.unknown) unknown.push(s.name + ':' + s.count);
  }
  const mep = extractMep(d, { region: a.region, units: a.units, profiles });
  console.log('mep', Date.now() - t0, 'ms; layers used', profiles.size, '| pipes', mep.pipes.length, '(label dia', mep.pipes.filter((p) => p.diaSrc === 'label').length + ')', 'ducts', mep.ducts.length, 'boxes', mep.boxes.length, 'dropped', JSON.stringify(mep.dropped));
  const bySys = {};
  for (const p of mep.pipes) { const s = profiles.get(p.l).system; bySys[s] = (bySys[s] || 0) + p.lengthCm / 100; }
  console.log('pipe m by system', Object.fromEntries(Object.entries(bySys).map(([k, v]) => [SYSTEMS[k].label, +v.toFixed(1)])));
  const byL = {};
  for (const b of [...mep.boxes, ...mep.ducts]) { const n = d.layers[b.l].name; byL[n] = (byL[n] || 0) + 1; }
  console.log('boxes/ducts by layer', byL);
  console.log('named equipment', [...new Set(mep.boxes.filter((b) => b.name).map((b) => b.name))].slice(0, 10));
  console.log('unknown layers', unknown.slice(0, 15));
  console.log('elevations', JSON.stringify(detectElevations(d, a.region)));
  if (process.env.IFC_DIR) {
    const { buildSolids } = await import('../web/js/build3d.js');
    const { writeIfc } = await import('../web/js/ifc.js');
    const b = buildSolids(m, { mep, mepProfiles: profiles, ceilingCm: 290, layerNames: d.layers.map((x) => x.name) });
    const cnt = {}; for (const so of b.solids) cnt[so.type] = (cnt[so.type] || 0) + 1;
    const out = path.join(process.env.IFC_DIR, path.basename(file) + '.ifc');
    fs.writeFileSync(out, writeIfc(b, { fileName: path.basename(out) }));
    console.log('solids', JSON.stringify(cnt), '->', out);
  }
  if (process.env.OUT) fs.writeFileSync(process.env.OUT + '-' + path.basename(file) + '.json', JSON.stringify({ region: a.region, units: a.units, model: m, mep, profiles: [...profiles.entries()], layers: d.layers.map((l) => l.name) }));
}
// IFC_DIR verilirse son dosyanın IFC'sini (mimari + tesisat) yaz
