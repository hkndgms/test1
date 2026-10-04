// Birden çok DWG için algılama özeti: node tests/summary.mjs a.dwg b.dwg ...
import fs from 'fs';
import { Dwg_File_Type, LibreDwg } from '../web/vendor/libredwg-web/dist/libredwg-web.js';
import { flattenDwg } from '../web/js/flatten.js';
import { detect, DEFAULT_PARAMS } from '../web/js/detect.js';
import { autoSetup } from '../web/js/auto.js';
import { KnowledgeBase } from '../web/js/kb.js';
import { extractFixtures } from '../web/js/fixtures.js';
for (const f of process.argv.slice(2)) {
  const t0 = Date.now();
  const lib = await LibreDwg.create(new URL('../web/vendor/libredwg-web/wasm/', import.meta.url).pathname); // dosya başına yeni örnek
  const d = flattenDwg(lib.convert(lib.dwg_read_data(fs.readFileSync(f), Dwg_File_Type.DWG)));
  const a = autoSetup(d, { params: DEFAULT_PARAMS, units: d.units || 5, kb: new KnowledgeBase() });
  const m = detect(d, { units: a.units, wallLayers: a.roles.wall, columnLayers: a.roles.column, doorLayers: a.roles.door, windowLayers: a.roles.window, region: a.region, params: DEFAULT_PARAMS });
  const by = {};
  for (const o of m.openings) by[o.kind] = (by[o.kind] || 0) + 1;
  const fx = extractFixtures(d, { region: a.region, units: a.units, rooms: m.rooms, unitScale: m.unitScale });
  const fk = {};
  for (const x of fx.fixtures) fk[x.kind] = (fk[x.kind] || 0) + 1;
  console.log(`${f.split('/').pop()}: ${m.walls.length} duvar, ${m.columns.length} kolon, ${m.rooms.length} mahal (${m.rooms.filter((r) => r.name).length} adlı), ${m.curtains.length} cam cephe, boşluk ${JSON.stringify(by)}, tefriş ${JSON.stringify(fk)}, yok sayılan süs ${fx.ignored}, ${Date.now() - t0} ms`);
}
