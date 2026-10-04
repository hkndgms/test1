// Node'da örnek DWG'yi okuyup algılamayı çalıştırır: node tests/run-sample.mjs [dosya.dwg]
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Dwg_File_Type, LibreDwg } from '../web/vendor/libredwg-web/dist/libredwg-web.js';
import { flattenDwg } from '../web/js/flatten.js';
import { detect } from '../web/js/detect.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const file = process.argv[2] || path.join(root, 'ornek-dosyalar/03.10.2026_TAZIYE_EVI_MEKANIK_PROJE.dwg');
const lib = await LibreDwg.create(path.join(root, 'web/vendor/libredwg-web/wasm/'));
const dwg = lib.dwg_read_data(fs.readFileSync(file), Dwg_File_Type.DWG);
const db = lib.convert(dwg);
lib.dwg_free(dwg);
const d = flattenDwg(db);
console.log('units', d.units, 'stats', d.stats, 'layers', d.layers.length);
const L = (names) => new Set(d.layers.map((l, i) => (names.includes(l.name) ? i : -1)).filter((i) => i >= 0));
const t0 = Date.now();
const m = detect(d, { units: d.units, wallLayers: L(['00_BORDA_DUVAR']), columnLayers: L(['00_BORDA_BETONARME']) });
console.log('detect ms', Date.now() - t0, m.stats);
console.log('walls', m.walls.length, 'ext', m.walls.filter((w) => w.exterior).length, 'columns', m.columns.length);
const th = {};
for (const w of m.walls) { const k = Math.round(w.thickness); th[k] = (th[k] || 0) + 1; }
console.log('wall thickness histogram', th);
const kinds = {};
for (const o of m.openings) kinds[o.kind] = (kinds[o.kind] || 0) + 1;
console.log('openings', m.openings.length, kinds, m.openings.map((o) => Math.round(o.width)).join(','));
console.log('rooms', m.rooms.map((r) => `${r.name || '?'} ${(r.area / 1e4).toFixed(1)}m²`).join(' | '));
console.log('outline pts', m.outline?.length);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ drawing: { bbox: d.bbox, units: d.units }, model: m }));

// IFC üret ve kaydet
const { buildSolids } = await import('../web/js/build3d.js');
const { writeIfc } = await import('../web/js/ifc.js');
const b = buildSolids(m, { makeRoof: true });
const kindsS = {};
for (const so of b.solids) kindsS[so.type] = (kindsS[so.type] || 0) + 1;
console.log('solids', kindsS);
const ifc = writeIfc(b, { fileName: 'taziye.ifc' });
if (process.env.IFC) { fs.writeFileSync(process.env.IFC, ifc); console.log('ifc bytes', ifc.length); }
