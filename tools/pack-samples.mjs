// Örnek DWG/RVT dosyalarını web/samples altına base64 metin olarak yazar
// (yayın platformu ikili .dwg/.rvt sunmadığı için): node tools/pack-samples.mjs
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pairs = [
  ['ornek-dosyalar/03.10.2026_TAZIYE_EVI_MEKANIK_PROJE.dwg', 'web/samples/taziye-evi.dwg.b64.txt'],
  ['ornek-dosyalar/taziye_evi_30092026.dwg.rvt', 'web/samples/taziye-evi.rvt.b64.txt'],
];
for (const [src, dst] of pairs) {
  fs.writeFileSync(path.join(root, dst), fs.readFileSync(path.join(root, src)).toString('base64'));
  console.log(dst);
}
