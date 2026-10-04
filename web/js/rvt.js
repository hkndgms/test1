// RVT (Revit) dosyasından Revit olmadan okunabilen bilgiler: dosya bilgisi,
// önizleme resmi, dış bağlantılar ve sıkıştırılmış bölümlerdeki tip adları.
// RVT bir OLE/CFB kapsayıcısıdır; burada küçük bir CFB okuyucu var.

function readCfb(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== 0xe011cfd0) throw new Error('Bu bir RVT/OLE dosyası değil.');
  const secSize = 1 << dv.getUint16(30, true);
  const miniSize = 1 << dv.getUint16(32, true);
  const nFat = dv.getUint32(44, true);
  const dirStart = dv.getUint32(48, true);
  const miniCutoff = dv.getUint32(56, true);
  const miniFatStart = dv.getUint32(60, true);
  let difStart = dv.getUint32(68, true);
  const secOff = (s) => (s + 1) * secSize;
  // FAT sektör listesi (DIFAT)
  const fatSecs = [];
  for (let i = 0; i < 109 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(76 + i * 4, true));
  while (fatSecs.length < nFat && difStart < 0xfffffffa) {
    const o = secOff(difStart);
    for (let i = 0; i < secSize / 4 - 1 && fatSecs.length < nFat; i++) fatSecs.push(dv.getUint32(o + i * 4, true));
    difStart = dv.getUint32(o + secSize - 4, true);
  }
  const fat = new Uint32Array(fatSecs.length * secSize / 4);
  fatSecs.forEach((s, i) => { for (let j = 0; j < secSize / 4; j++) fat[i * secSize / 4 + j] = dv.getUint32(secOff(s) + j * 4, true); });
  const chain = (start) => { const out = []; let s = start; let g = 0; while (s < 0xfffffffa && g++ < 1e7) { out.push(s); s = fat[s]; } return out; };
  const readChain = (start, size) => {
    const secs = chain(start);
    const out = new Uint8Array(secs.length * secSize);
    secs.forEach((s, i) => out.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize));
    return size != null ? out.subarray(0, size) : out;
  };
  const dir = readChain(dirStart);
  const ddv = new DataView(dir.buffer, dir.byteOffset, dir.byteLength);
  const entries = [];
  for (let o = 0; o + 128 <= dir.length; o += 128) {
    const nl = ddv.getUint16(o + 64, true);
    let name = '';
    for (let i = 0; i < Math.max(0, nl / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({
      name, type: dir[o + 66], left: ddv.getUint32(o + 68, true), right: ddv.getUint32(o + 72, true),
      child: ddv.getUint32(o + 76, true), start: ddv.getUint32(o + 116, true), size: ddv.getUint32(o + 120, true),
    });
  }
  const root = entries[0];
  const miniStream = readChain(root.start, root.size);
  const miniFat = miniFatStart < 0xfffffffa ? new DataView(readChain(miniFatStart).buffer) : null;
  const readEntry = (e) => {
    if (e.size >= miniCutoff) return readChain(e.start, e.size);
    const out = new Uint8Array(e.size);
    let s = e.start, pos = 0, g = 0;
    while (s < 0xfffffffa && pos < e.size && g++ < 1e7) {
      const n = Math.min(miniSize, e.size - pos);
      out.set(miniStream.subarray(s * miniSize, s * miniSize + n), pos);
      pos += n;
      s = miniFat.getUint32(s * 4, true);
    }
    return out;
  };
  // yol adlarıyla akış haritası
  const streams = new Map();
  const walk = (idx, prefix) => {
    if (idx >= 0xfffffffa || idx >= entries.length) return;
    const e = entries[idx];
    walk(e.left, prefix); walk(e.right, prefix);
    const path = prefix ? prefix + '/' + e.name : e.name;
    if (e.type === 2) streams.set(path, e);
    else if (e.type === 1) walk(e.child, path);
  };
  walk(root.child, '');
  return { streams, read: (p) => (streams.has(p) ? readEntry(streams.get(p)) : null) };
}

const utf16 = (u8) => new TextDecoder('utf-16le').decode(u8);

async function gunzipAll(u8) {
  // Bölümler ardışık gzip parçalarından oluşur; her başlıktan dene
  const out = [];
  let total = 0;
  for (let i = 0; i < u8.length - 3 && total < 40e6; i++) {
    if (u8[i] !== 0x1f || u8[i + 1] !== 0x8b || u8[i + 2] !== 0x08) continue;
    try {
      const ds = new DecompressionStream('gzip');
      const stream = new Blob([u8.subarray(i)]).stream().pipeThrough(ds);
      const reader = stream.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        out.push(value); total += value.length;
      }
      break; // akış zinciri tek seferde açıldıysa yeter
    } catch {
      // bozuk/sonu belirsiz parça: kalan kısım yine de alınmış olabilir
    }
  }
  const buf = new Uint8Array(total);
  let p = 0;
  for (const c of out) { buf.set(c, p); p += c.length; }
  return buf;
}

export async function readRvt(file) {
  const buf = await file.arrayBuffer();
  const cfb = readCfb(buf);
  const info = { fileName: file.name, sizeMB: +(buf.byteLength / 1048576).toFixed(1), streams: [...cfb.streams.keys()] };
  const bfi = cfb.read('BasicFileInfo');
  if (bfi) {
    const t = utf16(bfi).replace(/[^\p{L}\p{N}\s:\\/._()\-]+/gu, ' ');
    info.version = (t.match(/\b(20\d\d)\b/) || [])[1] || '';
    info.build = (t.match(/(\d{8}_\d{4}\(x64\))/) || [])[1] || '';
    info.path = (t.match(/[A-Z]:\\[^\n]*?\.(rvt|rfa|rte)/i) || [])[0] || '';
  }
  const prev = cfb.read('RevitPreview4.0');
  if (prev) {
    for (let i = 0; i < prev.length - 8; i++) {
      if (prev[i] === 0x89 && prev[i + 1] === 0x50 && prev[i + 2] === 0x4e && prev[i + 3] === 0x47) {
        info.previewUrl = URL.createObjectURL(new Blob([prev.subarray(i)], { type: 'image/png' }));
        break;
      }
    }
  }
  const tr = cfb.read('TransmissionData');
  if (tr) {
    const xml = utf16(tr);
    info.links = [...xml.matchAll(/<ExternalFileReferenceType>(.*?)<\/ExternalFileReferenceType><LastSavedPath>(.*?)<\/LastSavedPath>/g)].map((m) => ({ type: m[1], path: m[2] }));
  }
  // Ana bölümden ad/tip metinleri (Revit sürümleri arasında düzen değişir; yaklaşık)
  const names = new Map();
  for (const [p] of cfb.streams) {
    if (!p.startsWith('Partitions/')) continue;
    const raw = await gunzipAll(cfb.read(p));
    const txt = utf16(raw.subarray(0, raw.length - (raw.length % 2)));
    for (const m of txt.matchAll(/[\p{L}][\p{L}\p{N} _\-.()x]{4,48}/gu)) {
      const s = m[0].trim();
      names.set(s, (names.get(s) || 0) + 1);
    }
  }
  const pick = (re) => [...names.entries()].filter(([s]) => re.test(s)).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([s]) => s);
  info.groups = {
    'Kat / seviye': pick(/^(Level|Kat|Ground|Zemin|Ref\. Level)/i),
    Duvar: pick(/^(wall|duvar)[\s\-_]/i),
    'Kapı': pick(/door|kap[ıi]/i).filter((s) => !/Rear|Leading|Tolerance|Vis /.test(s)),
    Pencere: pick(/window|pencere|glaz/i),
    'Bağlı DWG': pick(/\.dwg/i),
  };
  return info;
}
