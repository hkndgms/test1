// Açılış demosu: program tarafından üretilen örnek bir kat planı. Gerçek bir DWG gibi
// düz çizgi listesi (flatten.js çıktısı biçiminde) üretilir ve aynı algılama hattından
// geçer: duvar, kolon, kapı (açılış yayı), pencere (doğrama), cam giydirme cephe,
// mahal yazıları, ıslak hacim tefrişi (blok), klima iç üniteleri ve tesisat boruları.
// Birim: cm (INSUNITS 5).

const LAYERS = [
  'DUVAR', 'KOLON', 'KAPI', 'PENCERE', 'MAHAL', 'TEFRIS', 'PAFTA',
  'M-SOGUK SU', 'M-SICAK SU', 'M-PIS SU', 'M-VRF BORU', 'M-VRF DRENAJ', 'M-KLIMA', 'M-UFLEME MENFEZ',
];
const L = Object.fromEntries(LAYERS.map((n, i) => [n, i]));

export function makeDemoDrawing() {
  const layers = LAYERS.map((name) => ({ name, color: '#888888', off: false, count: 0 }));
  const prims = [], texts = [], instances = [], inserts = [];
  let curInst = -1;
  const add = (l, pts, closed = false) => { prims.push({ l, c: null, closed, pts, b: curInst }); layers[l].count++; };
  const line = (l, x1, y1, x2, y2) => add(l, [x1, y1, x2, y2]);
  const rect = (l, x1, y1, x2, y2) => add(l, [x1, y1, x2, y1, x2, y2, x1, y2], true);
  const text = (l, x, y, s, h = 18) => { texts.push({ l, x, y, h, rot: 0, s, c: null }); layers[l].count++; };
  const arc = (l, cx, cy, r, a0, a1) => { const pts = []; const n = 12; for (let i = 0; i <= n; i++) { const t = a0 + ((a1 - a0) * i) / n; pts.push(cx + r * Math.cos(t), cy + r * Math.sin(t)); } add(l, pts); };

  // ---------------- duvarlar: iki paralel çizgi (dış 25 cm, iç 10 cm); boşluklar atlanır
  // seg: [x1,y1,x2,y2,t, gaps:[[from,to],...]] (gap: eksen boyunca mesafe)
  const wall = (x1, y1, x2, y2, t, gaps = []) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy, ny = ux;
    const spans = [];
    let a = 0;
    for (const [g0, g1] of gaps.sort((p, q) => p[0] - q[0])) { if (g0 > a) spans.push([a, g0]); a = g1; }
    if (a < len) spans.push([a, len]);
    for (const [s0, s1] of spans) {
      for (const side of [-1, 1]) line(L.DUVAR, x1 + ux * s0 + nx * side * t / 2, y1 + uy * s0 + ny * side * t / 2, x1 + ux * s1 + nx * side * t / 2, y1 + uy * s1 + ny * side * t / 2);
      // uç kapakları
      for (const s of [s0, s1]) line(L.DUVAR, x1 + ux * s - nx * t / 2, y1 + uy * s - ny * t / 2, x1 + ux * s + nx * t / 2, y1 + uy * s + ny * t / 2);
    }
    return { ux, uy, nx, ny, x1, y1, t };
  };
  // kapı: kasa çizgileri + açılış yayı (kanat genişliği w, menteşe gap başında)
  const door = (W, at, w, dir = 1, double = false) => {
    const hx = W.x1 + W.ux * at, hy = W.y1 + W.uy * at;
    if (double) {
      arc(L.KAPI, hx, hy, w / 2, Math.atan2(W.uy, W.ux), Math.atan2(W.uy, W.ux) + (dir * Math.PI) / 2);
      const ex = hx + W.ux * w, ey = hy + W.uy * w;
      arc(L.KAPI, ex, ey, w / 2, Math.atan2(W.uy, W.ux) + Math.PI, Math.atan2(W.uy, W.ux) + Math.PI - (dir * Math.PI) / 2);
      line(L.KAPI, hx, hy, hx + W.nx * dir * w / 2, hy + W.ny * dir * w / 2);
      line(L.KAPI, ex, ey, ex + W.nx * dir * w / 2, ey + W.ny * dir * w / 2);
    } else {
      arc(L.KAPI, hx, hy, w, Math.atan2(W.uy, W.ux), Math.atan2(W.uy, W.ux) + (dir * Math.PI) / 2);
      line(L.KAPI, hx, hy, hx + W.nx * dir * w, hy + W.ny * dir * w); // açık kanat
    }
  };
  // pencere: boşluk boyunca iki cam çizgisi + denizlik
  const win = (W, at, w) => {
    const ax = W.x1 + W.ux * at, ay = W.y1 + W.uy * at, bx = ax + W.ux * w, by = ay + W.uy * w;
    for (const o of [-2, 2]) line(L.PENCERE, ax + W.nx * o, ay + W.ny * o, bx + W.nx * o, by + W.ny * o);
    for (const o of [-W.t / 2, W.t / 2]) line(L.PENCERE, ax + W.nx * o, ay + W.ny * o, bx + W.nx * o, by + W.ny * o);
    line(L.PENCERE, ax, ay, ax + W.nx * W.t / 2, ay + W.ny * W.t / 2); line(L.PENCERE, bx, by, bx + W.nx * W.t / 2, by + W.ny * W.t / 2);
  };
  // cam giydirme cephe: iki ince çizgi + dikme kareleri; ortada çift kanatlı kapı
  const curtain = (x1, y1, x2, y2, doorAt, doorW) => {
    const len = Math.hypot(x2 - x1, y2 - y1), ux = (x2 - x1) / len, uy = (y2 - y1) / len, nx = -uy, ny = ux;
    const spans = [[0, doorAt], [doorAt + doorW, len]];
    for (const [s0, s1] of spans) for (const o of [-2, 2]) line(L.PENCERE, x1 + ux * s0 + nx * o, y1 + uy * s0 + ny * o, x1 + ux * s1 + nx * o, y1 + uy * s1 + ny * o);
    const n = Math.round(len / 120);
    for (let i = 0; i <= n; i++) {
      const s = (len / n) * i;
      if (s > doorAt - 1 && s < doorAt + doorW + 1) continue;
      rect(L.PENCERE, x1 + ux * (s - 4) - nx * 6, y1 + uy * (s - 4) - ny * 6, x1 + ux * (s + 4) + nx * 6, y1 + uy * (s + 4) + ny * 6);
    }
    for (const s of [doorAt, doorAt + doorW]) rect(L.PENCERE, x1 + ux * (s - 4) - nx * 6, y1 + uy * (s - 4) - ny * 6, x1 + ux * (s + 4) + nx * 6, y1 + uy * (s + 4) + ny * 6);
    const W = { x1, y1, ux, uy, nx, ny, t: 4 };
    door(W, doorAt + 4, doorW - 8, 1, true);
  };

  // ---------------- plan: 1800 x 1100 cm, (0,0) sol alt
  // dış duvarlar (25 cm): güney cephede 60..860 cam cephe (duvar yok)
  const S = wall(0, 0, 1800, 0, 25, [[60, 860], [1000, 1150], [1450, 1600]]); // güney
  const E = wall(1800, 0, 1800, 1100, 25, [[300, 420], [700, 820]]); // doğu
  const N = wall(1800, 1100, 0, 1100, 25, [[200, 350], [930, 1080], [1090, 1240], [1500, 1650]]); // kuzey (sağdan sola)
  const Wt = wall(0, 1100, 0, 0, 25, [[300, 420], [700, 820]]); // batı (yukarıdan aşağı)
  curtain(60, 0, 860, 0, 330, 140);
  // güney pencereler (mutfak + toplantı)
  for (const [a, w] of [[1000, 150], [1450, 150]]) win(S, a, w);
  for (const [a, w] of [[300, 120], [700, 120]]) { win(E, a, w); win(Wt, a, w); }
  for (const [a, w] of [[200, 150], [930, 150], [1090, 150], [1500, 150]]) win(N, a, w);

  // iç duvarlar (10 cm)
  // yatay koridor duvarı y=500 (giriş holü / ofisler ayrımı) ve y=600 koridor üst sınırı
  const H1 = wall(0, 500, 1800, 500, 10, [[380, 480], [1000, 1100], [1500, 1600]]); // hol/toplantı/mutfak -> koridor kapıları
  door(H1, 380, 100, 1); door(H1, 1000, 100, 1); door(H1, 1500, 100, 1);
  const H2 = wall(0, 600, 1800, 600, 10, [[120, 210], [620, 710], [1120, 1210], [1560, 1650]]); // koridor -> ofisler, wc, teknik
  door(H2, 120, 90, 1); door(H2, 620, 90, 1); door(H2, 1120, 90, 1); door(H2, 1560, 90, 1);
  // güney bölüm dikey duvarlar: hol 0..900, toplantı 900..1350, mutfak 1350..1800
  const V1 = wall(900, 0, 900, 500, 10, [[200, 300]]); door(V1, 200, 100, -1);
  wall(1350, 0, 1350, 500, 10, [[220, 310]]); door({ x1: 1350, y1: 0, ux: 0, uy: 1, nx: -1, ny: 0, t: 10 }, 220, 90, 1);
  // kuzey bölüm dikey duvarlar: ofis1 0..500, ofis2 500..1000, wc 1000..1350 (iki kabin), teknik 1350..1800
  wall(500, 600, 500, 1100, 10); wall(1000, 600, 1000, 1100, 10); wall(1350, 600, 1350, 1100, 10);
  const WC = wall(1000, 850, 1350, 850, 10, [[70, 150], [230, 310]]); // wc ön hacim / kabinler
  door(WC, 70, 80, 1); door(WC, 230, 80, 1);
  wall(1175, 850, 1175, 1100, 10);

  // kolonlar 40x40: giriş holünde cam cephenin gerisinde ve kuzey duvar önünde
  for (const [x, y] of [[300, 45], [650, 45], [250, 1055], [750, 1055]]) rect(L.KOLON, x - 20, y - 20, x + 20, y + 20);

  // mahal adları
  text(L.MAHAL, 450, 260, 'GİRİŞ HOLÜ', 22);
  text(L.MAHAL, 1125, 260, 'TOPLANTI', 20);
  text(L.MAHAL, 1575, 260, 'MUTFAK', 20);
  text(L.MAHAL, 900, 550, 'KORİDOR', 14);
  text(L.MAHAL, 250, 860, 'OFİS 1', 20);
  text(L.MAHAL, 750, 860, 'OFİS 2', 20);
  text(L.MAHAL, 1175, 720, 'WC ÖN', 14);
  text(L.MAHAL, 1085, 980, 'WC', 14); text(L.MAHAL, 1262, 980, 'WC', 14);
  text(L.MAHAL, 1575, 860, 'TEKNİK', 20);
  text(L.PAFTA, 900, -120, 'ZEMİN KAT PLANI  1/50', 40);
  text(L.PAFTA, 900, -180, 'DWG2BIM DEMO BİNASI · A.T. +280', 24);

  // ---------------- tefriş blokları
  const block = (name, layer, x, y, w, d, rot, draw) => {
    curInst = instances.length;
    instances.push({ name, rot, layer });
    inserts.push({ name, layer: LAYERS[layer], x, y });
    const c = Math.cos(rot), s = Math.sin(rot);
    const T = (px, py) => [x + px * c - py * s, y + px * s + py * c];
    const R = (x1, y1, x2, y2) => { const p = [T(x1, y1), T(x2, y1), T(x2, y2), T(x1, y2)].flat(); add(layer, p, true); };
    draw(R, w, d);
    curInst = -1;
  };
  const box = (R, w, d) => R(-w / 2, 0, w / 2, d);
  const wcDraw = (R, w, d) => { R(-w / 2, 0, w / 2, 18); R(-w / 2 + 4, 18, w / 2 - 4, d); };
  // wc kabinleri (duvar y=1100 arkada): klozet, yer süzgeci; ön hacim: lavabo x2, pisuvar
  block('klozet', L.TEFRIS, 1085, 1087, 40, 68, Math.PI, wcDraw);
  block('klozet', L.TEFRIS, 1262, 1087, 40, 68, Math.PI, wcDraw);
  block('yer suzgeci', L.TEFRIS, 1060, 900, 12, 12, 0, box);
  block('lavabo', L.TEFRIS, 1060, 613, 50, 42, 0, box);
  block('lavabo', L.TEFRIS, 1130, 613, 50, 42, 0, box);
  block('pisuvar', L.TEFRIS, 1300, 613, 35, 32, 0, box);
  // mutfak: tezgâh + eviye + masa + sandalyeler
  block('tezgah', L.TEFRIS, 1575, 487, 400, 60, Math.PI, box);
  block('eviye', L.TEFRIS, 1500, 487, 80, 50, Math.PI, box);
  block('masa', L.TEFRIS, 1575, 200, 140, 80, 0, box);
  for (const [x, y, r] of [[1500, 160, 0], [1650, 160, 0], [1500, 320, Math.PI], [1650, 320, Math.PI]]) block('sandalye', L.TEFRIS, x, y, 45, 45, r, box);
  // toplantı: büyük masa + sandalyeler
  block('masa', L.TEFRIS, 1125, 230, 320, 110, 0, box);
  for (let i = 0; i < 4; i++) { block('sandalye', L.TEFRIS, 1010 + i * 78, 170, 45, 45, 0, box); block('sandalye', L.TEFRIS, 1010 + i * 78, 405, 45, 45, Math.PI, box); }
  // ofisler: çalışma masaları, sandalye, dolap
  for (const ox of [0, 500]) {
    block('calisma masasi', L.TEFRIS, ox + 380, 1087, 160, 70, Math.PI, box);
    block('sandalye', L.TEFRIS, ox + 380, 980, 50, 50, 0, box);
    block('dolap', L.TEFRIS, ox + 12, 850, 120, 45, Math.PI / 2, box);
    block('calisma masasi', L.TEFRIS, ox + 160, 700, 160, 70, 0, box);
    block('sandalye', L.TEFRIS, ox + 160, 800, 50, 50, Math.PI, box);
  }
  // hol: kanepe, sehpa; teknik: su deposu / hidrofor kutusu (M-KLIMA değil, tefriş değil)
  block('kanepe', L.TEFRIS, 300, 420, 200, 85, Math.PI, box);
  block('sehpa masa', L.TEFRIS, 300, 300, 90, 50, 0, box);
  block('kanepe', L.TEFRIS, 650, 420, 200, 85, Math.PI, box);
  block('banko reception', L.TEFRIS, 150, 150, 220, 70, 0, box);
  // klima iç üniteleri (duvar tipi) ve kaset
  block('duvar tipi ic unite', L['M-KLIMA'], 250, 1072, 90, 25, Math.PI, box);
  block('duvar tipi ic unite', L['M-KLIMA'], 750, 1072, 90, 25, Math.PI, box);
  block('kaset tipi ic unite', L['M-KLIMA'], 1125, 300, 84, 84, 0, box);
  block('kaset tipi ic unite', L['M-KLIMA'], 450, 300, 84, 84, 0, box);
  block('duvar tipi ic unite', L['M-KLIMA'], 1772, 250, 90, 25, -Math.PI / 2, box);
  block('radyator', L.TEFRIS, 1575, 1072, 100, 10, Math.PI, box);

  // ---------------- tesisat: borular (tek çizgi polyline), menfezler
  const poly = (l, pts) => add(l, pts.flat());
  // soğuk su: teknik odadan koridor tavanı boyunca wc ve mutfağa
  poly(L['M-SOGUK SU'], [[1575, 900], [1575, 560], [1060, 560], [1060, 613]]);
  poly(L['M-SOGUK SU'], [[1130, 560], [1130, 613]]);
  poly(L['M-SOGUK SU'], [[1300, 560], [1300, 613]]);
  poly(L['M-SOGUK SU'], [[1575, 560], [1575, 487]]);
  poly(L['M-SICAK SU'], [[1560, 900], [1560, 570], [1140, 570], [1140, 613]]);
  poly(L['M-SICAK SU'], [[1560, 570], [1560, 487]]);
  text(L['M-SOGUK SU'], 1320, 575, 'Ø32', 10);
  text(L['M-SICAK SU'], 1320, 590, 'Ø25', 10);
  // pis su: klozetlerden ve lavabolardan doğu cepheye
  poly(L['M-PIS SU'], [[1085, 1060], [1085, 620], [1060, 620]]);
  poly(L['M-PIS SU'], [[1262, 1060], [1262, 620], [1130, 620], [1300, 620], [1800, 620]]);
  poly(L['M-PIS SU'], [[1500, 487], [1500, 620]]);
  text(L['M-PIS SU'], 1600, 630, 'Ø110', 10);
  // VRF: teknik odadaki dağıtıcıdan iç ünitelere
  poly(L['M-VRF BORU'], [[1575, 1000], [1575, 640], [900, 640], [900, 1060], [750, 1060]]);
  poly(L['M-VRF BORU'], [[900, 640], [400, 640], [400, 1060], [250, 1060]]);
  poly(L['M-VRF BORU'], [[1575, 640], [1575, 300], [1125, 300]]);
  poly(L['M-VRF BORU'], [[1125, 300], [450, 300]]);
  poly(L['M-VRF BORU'], [[1575, 300], [1575, 250], [1760, 250]]);
  poly(L['M-VRF DRENAJ'], [[250, 1065], [250, 1080], [1800, 1080]]);
  // üfleme menfezleri (kapalı dikdörtgen)
  for (const [x, y] of [[300, 700], [300, 1000], [800, 700], [800, 1000], [1125, 150], [1125, 400]]) rect(L['M-UFLEME MENFEZ'], x - 30, y - 15, x + 30, y + 15);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of prims) for (let i = 0; i < p.pts.length; i += 2) { minX = Math.min(minX, p.pts[i]); maxX = Math.max(maxX, p.pts[i]); minY = Math.min(minY, p.pts[i + 1]); maxY = Math.max(maxY, p.pts[i + 1]); }
  return { units: 5, layers, prims, texts, inserts, instances, bbox: [minX, minY, maxX, maxY], stats: { prims: prims.length, texts: texts.length, points: prims.reduce((a, p) => a + p.pts.length / 2, 0), truncated: false } };
}

// Demo için önceden hazırlanmış "yapay zekâ cevabı": kot, gezi sırası ve kısa rapor
export const DEMO_ANSWER = {
  ceilingCm: 280,
  ceilingReason: 'Pafta başlığındaki A.T. +280',
  params: { wallHeightCm: 320, doorHeightCm: 210, windowSillCm: 90, windowHeightCm: 150 },
  report: 'Tek katlı örnek ofis binası: giriş holü (cam giydirme cephe), toplantı odası, mutfak, iki ofis, WC grubu ve teknik hacim. Soğuk/sıcak su, pis su, VRF ve yoğuşma hatları ile üfleme menfezleri tanındı.',
  issues: [
    { severity: 'low', title: 'Koridor', detail: 'Koridor kapıları iç duvarlarda; dış cephe boşluklarının tümü cam izinden pencere sayıldı.', fixed: true },
    { severity: 'low', title: 'Klima kotu', detail: 'Duvar tipi iç üniteler 2,3 m, kasetler asma tavan kotunda gösterildi.', fixed: true },
  ],
  tour: { notes: { 'GİRİŞ HOLÜ': 'Cam giydirme cepheli giriş holü; çift kanatlı kapı ve danışma bankosu.', 'TOPLANTI': 'Kaset tipi klima ve üfleme menfezleri tavanda.', 'MUTFAK': 'Tezgâh, eviye ve boru bağlantıları.', 'WC ÖN': 'Lavabolar ve pisuvar; pis su hattı doğu cepheye çıkar.', 'TEKNİK': 'Boru ve VRF hatlarının çıkış noktası.' } },
};
