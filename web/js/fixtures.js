// Tefriş tanıma: klozet, lavabo, eviye, batarya, duş, küvet, pisuvar, klima iç ünitesi,
// radyatör ve mobilya. Kaynak: adlı blok örnekleri (blok adı) ve, blok patlatılmışsa,
// ıslak hacimlerdeki çizgi kümeleri (boyuta göre). Ağaç, insan, araç gibi süs çizimleri
// yok sayılır; 3B'ye ve IFC'ye geçmez.

import { UNIT_TO_CM, pointInPoly } from './detect.js';

// kind -> {label, ifc, w,h (cm, tipik), z0,z1 (cm) ...} 3B parçalar build3d'de üretilir
export const FIXTURE_KINDS = {
  wc: { label: 'Klozet', ifc: 'TOILETPAN', size: [40, 70] },
  squat: { label: 'Alaturka hela', ifc: 'TOILETPAN', size: [55, 65] },
  urinal: { label: 'Pisuvar', ifc: 'URINAL', size: [35, 35] },
  sink: { label: 'Lavabo', ifc: 'WASHHANDBASIN', size: [50, 45] },
  ksink: { label: 'Eviye', ifc: 'SINK', size: [80, 50] },
  faucet: { label: 'Batarya / musluk', ifc: 'FAUCET', size: [15, 15] },
  shower: { label: 'Duş', ifc: 'SHOWER', size: [90, 90] },
  bathtub: { label: 'Küvet', ifc: 'BATH', size: [80, 170] },
  ac: { label: 'Klima iç ünitesi', ifc: 'SPLITSYSTEM', size: [90, 25] },
  radiator: { label: 'Radyatör', ifc: 'RADIATOR', size: [80, 10] },
  drain: { label: 'Yer süzgeci', ifc: 'FLOORTRAP', size: [15, 15] },
  table: { label: 'Masa', ifc: 'TABLE', size: [120, 80] },
  desk: { label: 'Çalışma masası', ifc: 'DESK', size: [140, 70] },
  chair: { label: 'Sandalye / koltuk', ifc: 'CHAIR', size: [50, 50] },
  sofa: { label: 'Kanepe', ifc: 'SOFA', size: [180, 90] },
  bed: { label: 'Yatak', ifc: 'BED', size: [160, 200] },
  cabinet: { label: 'Dolap', ifc: 'FILECABINET', size: [90, 60] },
  counter: { label: 'Tezgâh', ifc: 'USERDEFINED', size: [200, 60] },
};
const SANITARY = new Set(['wc', 'squat', 'urinal', 'sink', 'ksink', 'shower', 'bathtub', 'drain']);
const FURNITURE = new Set(['table', 'desk', 'chair', 'sofa', 'bed', 'cabinet', 'counter']);
export const isSanitary = (k) => SANITARY.has(k);
export const isFurniture = (k) => FURNITURE.has(k);

// Blok adı / katman adı -> tür (sıra önemli: özel olan önce)
const NAME_RULES = [
  ['squat', /alaturka|hela\s*ta[sş]|squat/i],
  ['urinal', /pisuvar|pisuar|urinal/i],
  ['wc', /klozet|closet|\bwc\b|toilet|tuvalet|throne|water\s*closet|\bw\.?c\b/i],
  ['ksink', /eviye|kitchen\s*sink|bula[sş][ıi]k|bul\.?m\b/i],
  ['sink', /lavabo|lvbo|lvb\b|basin|washbasin|vanity|sink/i],
  ['faucet', /musluk|batarya|faucet|tap\b|vola\b|mixer/i],
  ['bathtub', /k[uü]vet|bathtub|\bbath\b|\btub\b/i],
  ['shower', /du[sş]|shower/i],
  ['drain', /s[uü]zge[cç]|yer\s*s[uü]zge|floor\s*drain|\brög\b|r[öo]gar/i],
  ['ac', /i[cç]\s*[uü]nite|indoor\s*unit|klima|split|kaset|cassette|fxaq|fxfq|fxsq|pefy|plfy|pkfy|pmfy|\bvrf\b.*(unit|[uü]nite)|fan\s*coil|fancoil|\bfcu\b/i],
  ['radiator', /radyat[oö]r|radiator|petek|havlupan|towel/i],
  ['bed', /yatak|\bbed\b|sunbed|[sş]ezlong|lounger/i],
  ['sofa', /kanepe|koltuk|sofa|couch|armchair|berjer|booth/i],
  ['chair', /sandalye|chair|tabure|stool|seat/i],
  ['desk', /\bdesk\b|[cç]al[ıi][sş]ma\s*masa|reception|bank[oa]\b/i],
  ['table', /masa|table/i],
  ['counter', /tezg[aâ]h|counter|worktop/i],
  ['cabinet', /dolap|cabinet|wardrobe|locker|storage|shelf|raf\b|kitaplık|closet/i],
];
// Süs: hiç gösterilmez
export const DECOR_RE = /a[gğ]a[cç]|\btree\b|palm|agave|frangipani|bitki|plant|[cç]i[cç]ek|flower|peyzaj|landscape|\bgrass\b|[cç]im\b|insan|people|person|human|figure|silhouette|ara[cç]|\bcar\b|vehicle|otomobil|bisiklet|bike|\bbus\b|kamyon|truck|ku[sş]\b|bird|logo|kuzey|north\s*arrow|magoo/i;
// Tefriş katmanı adları (patlatılmış çizgiler için)
const FURN_LAYER_RE = /tefri|furn|mobilya|vitrifiye|sanitary|banyo|bath|fixture|\bwc\b|mutfak|kitchen|equipment|cihaz/i;
const WET_ROOM_RE = /\bwc\b|tuvalet|banyo|lavabo|du[sş]|hela|abdest|bath|toilet|restroom|shower|[ıi]slak/i;

// Plausible boyut aralıkları (cm): [minShort, maxShort, minLong, maxLong]
const SIZE_OK = {
  wc: [30, 60, 45, 90], squat: [40, 80, 50, 140], urinal: [25, 50, 25, 60], sink: [30, 70, 35, 90], ksink: [40, 70, 50, 140],
  faucet: [3, 25, 5, 30], shower: [60, 130, 60, 160], bathtub: [60, 100, 120, 200], ac: [20, 110, 50, 130], radiator: [5, 30, 40, 250],
  drain: [8, 40, 8, 40], table: [40, 160, 50, 320], desk: [50, 110, 90, 320], chair: [35, 100, 35, 100], sofa: [60, 120, 100, 360],
  bed: [60, 220, 150, 260], cabinet: [25, 120, 30, 400], counter: [40, 120, 60, 600],
};

function classifyName(name) {
  if (!name || DECOR_RE.test(name)) return DECOR_RE.test(name) ? 'decor' : null;
  for (const [kind, re] of NAME_RULES) if (re.test(name)) return kind;
  return null;
}
function sizeOk(kind, w, h) {
  const r = SIZE_OK[kind];
  if (!r) return true;
  const a = Math.min(w, h), b = Math.max(w, h);
  return a >= r[0] && a <= r[1] && b >= r[2] && b <= r[3];
}

// Blok dönüklüğüne göre yönlendirilmiş sınır kutusu
function orientedBox(ptsList, rot) {
  const c = Math.cos(-rot), s = Math.sin(-rot);
  let a = Infinity, b = Infinity, cc = -Infinity, d = -Infinity;
  for (const p of ptsList) for (let i = 0; i < p.length; i += 2) {
    const x = p[i] * c - p[i + 1] * s, y = p[i] * s + p[i + 1] * c;
    if (x < a) a = x; if (x > cc) cc = x; if (y < b) b = y; if (y > d) d = y;
  }
  const back = (x, y) => [x * Math.cos(rot) - y * Math.sin(rot), x * Math.sin(rot) + y * Math.cos(rot)];
  const [cx, cy] = back((a + cc) / 2, (b + d) / 2); // merkez dünya koordinatında
  return { poly: [back(a, b), back(cc, b), back(cc, d), back(a, d)], w: cc - a, h: d - b, cx, cy };
}

// Yakınlık kümeleme (basit ızgara)
function clusterBoxes(items, gap) {
  const n = items.length;
  if (!n) return [];
  const parent = new Int32Array(n).map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const cell = gap * 8;
  const grid = new Map();
  const ck = (i, j) => i * 73856093 ^ j * 19349663;
  items.forEach((it, idx) => {
    const i0 = Math.floor((it.bb[0] - gap) / cell), i1 = Math.floor((it.bb[2] + gap) / cell);
    const j0 = Math.floor((it.bb[1] - gap) / cell), j1 = Math.floor((it.bb[3] + gap) / cell);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 100) return;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const key = ck(i, j);
      let list = grid.get(key);
      if (list) for (const o of list) {
        const b = items[o].bb, a = it.bb;
        if (a[0] - gap <= b[2] && b[0] - gap <= a[2] && a[1] - gap <= b[3] && b[1] - gap <= a[3]) { const ra = find(idx), rb = find(o); if (ra !== rb) parent[ra] = rb; }
      } else grid.set(key, (list = []));
      list.push(idx);
    }
  });
  const groups = new Map();
  items.forEach((it, i) => { const r = find(i); let g = groups.get(r); if (!g) groups.set(r, (g = [])); g.push(it); });
  return [...groups.values()];
}

// drawing, {region, units, rooms, unitScale, skipLayers}
// -> { fixtures: [{id, kind, label, name, poly, center, rot, wCm, hCm, l, source}], ignored }
export function extractFixtures(drawing, { region, units, rooms = [], unitScale, skipLayers = new Set(), lib = null } = {}) {
  const unknown = new Map(); // tanınmayan bloklar: ad -> {count, wCm, hCm}
  const k = 1 / (unitScale || UNIT_TO_CM[units] || 1); // çizim birimi / cm
  const toCm = 1 / k;
  const inR = (x, y) => !region || (x >= region[0] && x <= region[2] && y >= region[1] && y <= region[3]);
  const layerName = (l) => drawing.layers[l]?.name || '';
  const decorLayer = drawing.layers.map((l) => DECOR_RE.test(l.name));
  const furnLayer = drawing.layers.map((l) => FURN_LAYER_RE.test(l.name));
  const fixtures = [];
  let ignored = 0;
  const bb = (pts) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (let i = 0; i < pts.length; i += 2) { if (pts[i] < a) a = pts[i]; if (pts[i] > c) c = pts[i]; if (pts[i + 1] < b) b = pts[i + 1]; if (pts[i + 1] > d) d = pts[i + 1]; } return [a, b, c, d]; };

  // 1) blok örnekleri
  const groups = new Map();
  const loose = [];
  for (const pr of drawing.prims) {
    if (pr.b >= 0) { let g = groups.get(pr.b); if (!g) groups.set(pr.b, (g = [])); g.push(pr); continue; }
    if (furnLayer[pr.l] && !decorLayer[pr.l] && !skipLayers.has(pr.l)) loose.push(pr);
  }
  const instKind = new Map();
  for (const [inst, g] of groups) {
    const info = drawing.instances[inst];
    if (!info) continue;
    const short = info.name.replace(/^.*\$0\$/, ''); // dış referans öneki
    // önce kalıcı kütüphane (kullanıcı / Claude tanımları), sonra yerleşik ad kuralları
    const libItem = lib?.matchBlock(short);
    let kind = libItem ? (libItem.kind === 'ignore' ? 'decor' : libItem.kind) : classifyName(short);
    if (!kind && decorLayer[info.layer]) kind = 'decor';
    if (!kind) {
      const bx = orientedBox(g.map((p) => p.pts), info.rot);
      if (inR(bx.cx, bx.cy)) {
        const w = bx.w * toCm, h = bx.h * toCm;
        if (Math.max(w, h) >= 8 && Math.max(w, h) <= 600 && g.length >= 2) { const u = unknown.get(short) || { count: 0, wCm: w, hCm: h, layer: layerName(info.layer) }; u.count++; unknown.set(short, u); }
      }
    }
    if (!kind && furnLayer[info.layer]) kind = classifyName(layerName(info.layer));
    instKind.set(inst, kind);
    if (!kind) continue;
    if (kind === 'decor') { ignored++; continue; }
    if (skipLayers.has(info.layer) || skipLayers.has(g[0].l)) continue;
    const box = orientedBox(g.map((p) => p.pts), info.rot);
    if (!inR(box.cx, box.cy)) continue;
    const w = box.w * toCm, h = box.h * toCm;
    if (!libItem && !sizeOk(kind, w, h)) {
      // adı uyan ama ölçüsü uymayan blok: bütün bir yerleşim bloğu olabilir; parçalarını kümeye bırak
      if (Math.max(w, h) > 300) loose.push(...g.filter((p) => furnLayer[p.l] || furnLayer[info.layer]));
      continue;
    }
    fixtures.push({ kind, name: short, poly: box.poly, center: [box.cx, box.cy], rot: info.rot, wCm: w, hCm: h, l: info.layer, source: 'block', lib: libItem ? libItem.name : undefined });
  }

  // 2) patlatılmış tefriş: ıslak hacimlerdeki çizgi kümeleri, boyuta göre
  const wet = rooms.filter((r) => WET_ROOM_RE.test(r.name || ''));
  if (loose.length && loose.length < 60000) {
    const items = loose.map((pr) => ({ pr, bb: bb(pr.pts) })).filter((it) => inR((it.bb[0] + it.bb[2]) / 2, (it.bb[1] + it.bb[3]) / 2));
    for (const cl of clusterBoxes(items, 3 * k)) {
      let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
      for (const it of cl) { a = Math.min(a, it.bb[0]); b = Math.min(b, it.bb[1]); c = Math.max(c, it.bb[2]); d = Math.max(d, it.bb[3]); }
      const w = (c - a) * toCm, h = (d - b) * toCm, cx = (a + c) / 2, cy = (b + d) / 2;
      if (Math.max(w, h) < 8 || Math.max(w, h) > 250) continue;
      const room = wet.find((r) => pointInPoly(cx, cy, r.poly));
      const lname = layerName(cl[0].pr.l);
      let kind = classifyName(lname);
      if (kind === 'decor' || (!kind && !room)) continue;
      if (!kind || kind === 'cabinet' || kind === 'table') {
        // ıslak hacimde boyuta göre tahmin
        const s = Math.min(w, h), L = Math.max(w, h), closed = cl.some((it) => it.pr.closed || it.pr.pts.length >= 10);
        if (!closed) continue;
        if (s >= 32 && s <= 55 && L >= 55 && L <= 85 && L / s >= 1.3) kind = 'wc';
        else if (s >= 35 && s <= 65 && L >= 40 && L <= 80 && L / s < 1.6) kind = 'sink';
        else if (s >= 70 && s <= 110 && L <= 120 && L / s < 1.3) kind = 'shower';
        else if (s >= 65 && s <= 95 && L >= 140 && L <= 190) kind = 'bathtub';
        else if (s <= 25 && L <= 25 && s >= 8) kind = 'drain';
        else continue;
      } else if (!sizeOk(kind, w, h)) continue;
      const poly = [[a, b], [c, b], [c, d], [a, d]];
      fixtures.push({ kind, name: lname, poly, center: [cx, cy], rot: 0, wCm: w, hCm: h, l: cl[0].pr.l, source: 'cluster' });
    }
  }
  // aynı yerde iki kayıt (blok + küme): bloğu tut
  fixtures.sort((p, q) => (p.source === 'block' ? 0 : 1) - (q.source === 'block' ? 0 : 1));
  const kept = [];
  for (const f of fixtures) {
    if (kept.some((g) => pointInPoly(f.center[0], f.center[1], g.poly) && (g.kind === f.kind || f.source === 'cluster'))) continue;
    kept.push(f);
  }
  kept.forEach((f, i) => { f.id = 'F' + (i + 1); f.label = FIXTURE_KINDS[f.kind]?.label || f.kind; });
  return { fixtures: kept, ignored, unknown: [...unknown].map(([name, u]) => ({ name, ...u })).sort((a, b) => b.count - a.count).slice(0, 60) };
}
