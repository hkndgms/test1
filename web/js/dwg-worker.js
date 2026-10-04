// DWG dosyasını ayrı bir iş parçacığında okur (arayüz donmasın diye).
import { Dwg_File_Type, LibreDwg } from '../vendor/libredwg-web/dist/libredwg-web.js';
import { flattenDwg } from './flatten.js';

let lib = null;

self.onmessage = async (ev) => {
  const { buf, isDxf } = ev.data;
  try {
    if (!lib) {
      self.postMessage({ progress: 'Okuyucu yükleniyor (WebAssembly, ~9 MB)…' });
      lib = await LibreDwg.create(new URL('../vendor/libredwg-web/wasm/', import.meta.url).href);
    }
    self.postMessage({ progress: 'Dosya çözümleniyor…' });
    const dwg = lib.dwg_read_data(new Uint8Array(buf), isDxf ? Dwg_File_Type.DXF : Dwg_File_Type.DWG);
    if (!dwg) throw new Error('Dosya okunamadı. DWG sürümü desteklenmiyor olabilir.');
    const db = lib.convert(dwg);
    lib.dwg_free(dwg);
    self.postMessage({ progress: 'Bloklar açılıyor…' });
    const drawing = flattenDwg(db);
    // küçük önizleme resmi (varsa)
    self.postMessage({ ok: true, drawing });
  } catch (e) {
    self.postMessage({ ok: false, error: String(e && e.message ? e.message : e) });
  }
};
