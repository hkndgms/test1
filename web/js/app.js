// DWG2BIM ana uygulama: dosya okuma, katman rolleri, algılama, düzenleme,
// 3B önizleme, IFC dışa aktarma, yapay zekâ asistanı ve RVT inceleme.
import { detect, DEFAULT_PARAMS, UNIT_NAMES, UNIT_TO_CM, pointInPoly } from './detect.js';
import { autoSetup } from './auto.js';
import { padBox } from './islands.js';
import { KnowledgeBase, SYSTEMS, KINDS, fold } from './kb.js';
import { layerStats, extractMep, detectElevations } from './mep.js';
import { buildSolids, DEFAULT_BUILD } from './build3d.js';
import { writeIfc } from './ifc.js';
import { makeZip } from './zip.js';
import { Plan2D, findById, findMepById } from './view2d.js';
import { buildPrompt, buildSnapshot, parseAnswer } from './ai-prompt.js';
import { makeTools, runAgent, REVIEW_TASK, errorText } from './agent.js';
import { layoutInRoom, fixtureAt, openingOnWall, columnAt, SETS, shiftedOpening } from './manual.js';
import { Library } from './lib.js';
import { serpentine, gridLines, writeDxf, modelEntities, fixtureEntities, normalizeEntities } from './sketch.js';
import { readRvt } from './rvt.js';
import { diagnose, SEV_LABEL } from './diagnose.js';
import { planTour } from './tour.js';
import { extractFixtures, FIXTURE_KINDS } from './fixtures.js';
import { makeDemoDrawing, DEMO_ANSWER } from './demo.js';

const $ = (id) => document.getElementById(id);

const state = {
  drawing: null,
  fileName: '',
  units: 5,
  roles: { wall: new Set(), column: new Set(), text: new Set(), door: new Set(), window: new Set() },
  region: null,
  autoRegion: null,
  params: { ...DEFAULT_PARAMS },
  build: { ...DEFAULT_BUILD },
  model: null,
  overrides: {},
  selected: null,
  tab: 'plan',
  view3d: null,
  kb: new KnowledgeBase(),
  lib: new Library(), // kalıcı öğe kütüphanesi (tefriş / semboller)
  unknownBlocks: [],
  marks: [], // kullanıcı işaretleri: {id:'M1', type:'point'|'rect', x, y, bbox}
  sketches: [], // sohbetle çizilen 2B varlıklar: {id:'S1', type, layer, system, color, ...}
  planIsland: null,
  islands: [],
  mep: null, // tesisat çıkarımı
  mepStats: [], // bölgedeki katman özetleri
  mepProfiles: new Map(), // katman -> etkin profil
  mepOverrides: {}, // katman -> kullanıcı / yapay zekâ düzeltmesi (bu proje)
  mepVisible: true,
  systemsOff: new Set(),
  archVisible: true,
  ceiling: { cm: 280, source: 'default', text: '' },
  ceilingAsked: false,
  elevations: null,
  aiReport: null, // {report, issues}
  parts: [], // seçili pafta bölümleri (ada kimlikleri)
  partRegions: null,
  fixtures: [], // tanınan tefriş (klozet, lavabo, klima...)
  decorIgnored: 0,
  chat: [], // Claude ajan sohbeti (sayfa tutar; Claude hafızasız)
  manualFixtures: [], manualOpenings: [], manualColumns: [], // sohbetle eklenen, çizimde olmayan öğeler
  showLegacy: false, // ayrıntılı (eski) paneller
};

// ------------------------------------------------------------ yardımcılar
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function themeColors() {
  return {
    canvas: css('--canvas'), ink: css('--ink'), muted: css('--muted'), accent: css('--accent'),
    accentSoft: css('--accent-soft'), wall: css('--wall'), wallExt: css('--wall-ext'), wallEdge: css('--wall-edge'),
    column: css('--column'), win: css('--win'), door: css('--door'), empty: css('--empty'),
    room: css('--room'), roomSel: css('--room-sel'), outline: css('--outline'), fixture: css('--fixture'),
    fontUi: css('--font-ui'), fontMono: css('--font-mono'),
    dark: matchMedia('(prefers-color-scheme: dark)').matches ? document.documentElement.dataset.theme !== 'light' : document.documentElement.dataset.theme === 'dark',
  };
}
function setStatus(el, msg, kind = '') { el.textContent = msg; el.className = 'status' + (kind ? ' ' + kind : ''); }
const status = (m, k) => setStatus($('status'), m, k);
const cm = (v) => (state.model ? Math.round(v * state.model.unitScale) : 0);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function overlay(msg, title = 'Çizim yükleniyor') {
  const o = $('overlay');
  if (!msg) { o.hidden = true; return; }
  o.hidden = false;
  o.querySelector('b').textContent = title;
  $('overlayMsg').textContent = msg;
}

// ------------------------------------------------------------ görünümler
const plan = new Plan2D($('plan'), {
  colors: themeColors,
  onSelect: (id) => select(id),
  onWall: (a, b) => addManualWall(a, b),
  onMark: (m) => addMark(m),
  onRegion: (r) => { state.region = r; $('btnRegion').classList.remove('on'); status('Bölge seçildi, yeniden algılanıyor…'); runDetect(); },
});

async function ensure3d() {
  if (state.view3d) return state.view3d;
  try {
    const { View3D } = await import('./view3d.js');
    state.view3d = new View3D($('view3dWrap'), { onSelect: (id) => select(id) });
    state.view3d.setBackground(css('--canvas'));
    rebuild3d(false);
  } catch (e) {
    status('3B görünüm yüklenemedi: ' + e.message, 'err');
  }
  return state.view3d;
}

function showTab(t) {
  if (t !== '3d') stopTour();
  state.tab = t;
  $('tabPlan').classList.toggle('on', t === 'plan');
  $('tab3d').classList.toggle('on', t === '3d');
  $('tabPlan').setAttribute('aria-selected', t === 'plan');
  $('tab3d').setAttribute('aria-selected', t === '3d');
  $('planWrap').hidden = t !== 'plan';
  $('view3dWrap').hidden = t !== '3d';
  $('legend2d').style.visibility = t === 'plan' ? 'visible' : 'hidden';
  if (t === '3d') ensure3d().then((v) => v && v.resize());
  else plan.resize();
}
$('tabPlan').onclick = () => showTab('plan');
$('tab3d').onclick = () => showTab('3d');

const themeChanged = () => { plan.draw(); state.view3d?.setBackground(css('--canvas')); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeChanged);
new MutationObserver(themeChanged).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ------------------------------------------------------------ dosya okuma
// Her dosya için yeni bir işçi (ve yeni bir WebAssembly örneği) başlatılır:
// libredwg-web aynı örnekte ikinci bir dosyayı okurken (ör. 2007 sonrası 2010+)
// "function signature mismatch" ile çöküyor. .wasm tarayıcı önbelleğinden gelir.
let worker = null;
function getWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL('./dwg-worker.js', import.meta.url), { type: 'module' });
  return worker;
}

function loadBuffer(buf, name, { sample = false } = {}) {
  const isDxf = /\.dxf$/i.test(name);
  state.isSample = sample;
  state.fileName = name;
  stopTour();
  $('demoBar').hidden = true;
  $('welcome').hidden = true;
  $('fileChip').textContent = name;
  overlay('Okuyucu hazırlanıyor…');
  status('Dosya okunuyor…');
  const t0 = performance.now();
  const w = getWorker();
  w.onmessage = (ev) => {
    const m = ev.data;
    if (m.progress) { overlay(m.progress); status(m.progress); return; }
    if (!m.ok) {
      overlay(m.error + ' DXF olarak kaydedip tekrar deneyebilirsiniz (AutoCAD veya ücretsiz ODA File Converter ile).', 'Dosya açılamadı');
      status(m.error, 'err');
      return;
    }
    onDrawing(m.drawing, ((performance.now() - t0) / 1000).toFixed(1));
  };
  w.onerror = (e) => { overlay('Okuyucu başlatılamadı: ' + (e.message || 'bilinmeyen hata'), 'Hata'); status('Okuyucu başlatılamadı', 'err'); };
  w.postMessage({ buf, isDxf }, [buf]);
}

// Demo: program tarafından üretilen örnek bina (dışarıdan dosya indirilmez)
function loadDemo() {
  stopTour();
  $('welcome').hidden = true;
  state.isSample = true;
  state.demoDone = false;
  state.fileName = 'DEMO · Örnek ofis binası (program üretimi)';
  $('fileChip').textContent = 'Demo binası';
  $('demoBar').hidden = true;
  const t0 = performance.now();
  overlay('Demo binası hazırlanıyor…');
  setTimeout(() => onDrawing(makeDemoDrawing(), ((performance.now() - t0) / 1000).toFixed(1)), 30);
}

function onDrawing(d, secs) {
  state.drawing = d;
  state.units = UNIT_TO_CM[d.units] != null && d.units !== 0 ? d.units : 5;
  state.region = null;
  state.mepOverrides = {};
  state.manualWalls = [];
  state.manualFixtures = []; state.manualOpenings = []; state.manualColumns = []; state.overlays = [];
  state.marks = []; state.sketches = []; plan.marks = []; plan.sketches = []; renderMarkHint();
  state.systemsOff = new Set();
  state.elevations = null;
  state.ceiling = { cm: 280, source: 'default', text: '' };
  state.ceilingAsked = false;
  state.aiReport = null;
  state.aiTour = null;
  // kendi dosyası: model gösterilmeden önce analiz + yapay zekâ ekranı
  state.wizardActive = false; // analiz ekranı kaldırıldı: Claude dosyayı açılışta elden geçirir
  renderReport();
  $('ceilDlg').hidden = true;
  plan.setDrawing(d);
  autoRoles();
  renderLayers();
  renderFacts(secs);
  ['btnDetect', 'btnPrompt', 'btnAsk'].forEach((id) => ($(id).disabled = false));
  agentUi.onDrawing();
  runDetect();
  plan.fitModel();
  overlay(null);
  if (state.model?.walls.length || mepCount()) {
    const ign = state.islands?.length > 1 ? ` ${state.islands.length - 1} ayrık çizim grubu yok sayıldı.` : '';
    status(`Okundu (${secs} sn) ve algılandı.${ign} ${state.unitNote || 'Plandaki öğelere tıklayarak düzenleyebilirsiniz.'}`, 'ok');
  }
  renderSide();
  if (state.isSample && !state.demoDone) runDemo();
  else agentUi.autoReview();
}

// Duvar silindikten sonra: overrides korunarak model yeniden kurulur (mahal grafiği silinen duvarsız hesaplanır)
function runDetectKeep() {
  const ov = state.overrides, manual = { f: state.manualFixtures, o: state.manualOpenings, c: state.manualColumns };
  const deletedWalls = new Set(Object.entries(ov).filter(([id, o]) => o.deleted && id[0] === 'W').map(([id]) => id));
  runDetect();
  state.overrides = ov;
  // yeni modelde aynı kimlikler korunur (algılama deterministik); silinen duvarlar mahal grafiğinden düşürülür
  if (deletedWalls.size && state.model) {
    const kept = state.model.walls.filter((w) => !deletedWalls.has(w.id));
    if (kept.length !== state.model.walls.length) {
      const m = detect(state.drawing, { units: state.units, wallLayers: state.roles.wall, columnLayers: state.roles.column, textLayers: state.roles.text, doorLayers: state.roles.door, windowLayers: state.roles.window, region: currentRegions()[0], params: state.params, extraWalls: state.manualWalls, dropWalls: deletedWalls });
      if (m) { state.model = { ...state.model, rooms: m.rooms, outline: m.outline, outlines: m.outline ? [m.outline] : [] }; }
    }
  }
  state.manualFixtures = manual.f; state.manualOpenings = manual.o; state.manualColumns = manual.c;
  plan.setModel(state.model, state.overrides); plan.setFixtures(liveFixtures()); renderStats(); rebuild3d(); renderSel();
}

// Sol üst: dosya adı + tek satır özet
function renderSide() {
  $('sideFile').textContent = state.drawing ? (state.isSample ? 'Demo binası' : state.fileName) : 'Proje yok';
  const m = state.model;
  if (!m) { $('sideSum').textContent = ''; return; }
  const ov = state.overrides;
  const live = (arr) => arr.filter((x) => !ov[x.id]?.deleted);
  const ops = live(m.openings);
  const parts = [`${live(m.walls).length} duvar`, `${live(m.rooms).length} mahal`, `${ops.filter((o) => effKind(o) === 'door').length} kapı`, `${ops.filter((o) => effKind(o) === 'window').length} pencere`];
  if (m.curtains?.length) parts.push(`${live(m.curtains).length} cam cephe`);
  if (state.fixtures.length) parts.push(`${state.fixtures.filter((f) => !ov[f.id]?.deleted).length} tefriş`);
  if (mepCount()) parts.push(`${mepCount()} tesisat öğesi`);
  $('sideSum').textContent = parts.join(' · ');
}

// ------------------------------------------------------------ açılış demosu
// Örnek bina + hazır yapay zekâ cevabı; gezi yalnız düğmeyle başlar
function runDemo() {
  state.demoDone = true;
  try {
    applyAnswer(DEMO_ANSWER);
    aiStatus('Demo: hazır yapay zekâ cevabı uygulandı.', 'ok');
  } catch (e) {
    console.warn('demo cevabı uygulanamadı', e);
  }
  showTab('3d');
  agentUi.intro('Bu bir demo binası: cam giydirme cepheli giriş holü, toplantı, mutfak, ofisler, WC grubu, teknik hacim; tefriş, klima ve borular. Üstteki Plan/3B ile görünümü değiştirin, "Otomatik gezi" ile içeride dolaşın, "IFC indir" ile alın. Kendi dosyanızı açınca projeyi önce ben elden geçiririm; sonra buradan yazarak her şeyi değiştirebilirsiniz.');
}
$('demoClose').onclick = () => { $('demoBar').hidden = true; };
$('btnDemo').onclick = loadDemo;
$('welcomeDemo').onclick = loadDemo;


// ------------------------------------------------------------ analiz + yapay zekâ ekranı
function openWizard() {
  const m = state.model;
  const ops = m.openings.filter((o) => !state.overrides[o.id]?.deleted);
  const k = (x) => ops.filter((o) => (state.overrides[o.id]?.kind || o.kind) === x).length;
  const sum = mepSummary();
  const mepTxt = [...sum.entries()].map(([s, v]) => `${(SYSTEMS[s] || SYSTEMS.other).label}${v.pipeM ? ' ' + v.pipeM.toFixed(0) + ' m' : ''}${v.n ? ' ' + v.n + ' ad.' : ''}`).join(', ');
  $('wizSummary').textContent = `${state.fileName}: ${m.walls.length} duvar, ${m.columns.length} kolon, ${k('door')} kapı, ${k('window')} pencere, ${m.rooms.length} mahal` + (mepTxt ? `; tesisat: ${mepTxt}` : '') + '. Program aşağıdaki noktalardan emin değil:';
  const diag = diagnose(state);
  $('wizDiag').innerHTML = diag.slice(0, 7).map((x) => `<li class="sev-${x.severity}"><i>${SEV_LABEL[x.severity]}</i> ${esc(x.text)}</li>`).join('') || '<li>Belirgin bir sorun bulunmadı; yine de yapay zekâ gezi rotası ve kontrol için kullanılabilir.</li>';
  $('wizAnswer').value = '';
  setStatus($('wizStatus'), '');
  $('wizSkipHint').textContent = 'Cevap olmadan da gösterebilirsiniz.';
  $('wiz').hidden = false;
}
function closeWizard() {
  $('wiz').hidden = true;
  state.wizardActive = false;
  if (mepCount() && state.ceiling.source === 'default' && !state.ceilingAsked) askCeiling();
}
$('wizCopy').onclick = () => {
  const t = $('promptOut');
  t.value = currentPrompt();
  $('btnCopy').disabled = false;
  navigator.clipboard.writeText(t.value).then(
    () => setStatus($('wizStatus'), 'Komut kopyalandı. Bir yapay zekâ sohbetine yapıştırın, cevabı aşağıya yapıştırın.', 'ok'),
    () => { $('wizAnswer').value = ''; setStatus($('wizStatus'), 'Otomatik kopyalanamadı. Asistan sekmesindeki "Komutun içeriğini göster" bölümünden kopyalayın.', 'err'); },
  );
};
$('wizAnswer').addEventListener('paste', () => setTimeout(() => {
  const txt = $('wizAnswer').value;
  if (!/\{[\s\S]*\}/.test(txt)) return;
  $('answerIn').value = txt;
  applyAnswer();
  setStatus($('wizStatus'), $('aiStatus').textContent, $('aiStatus').className.includes('err') ? 'err' : 'ok');
  $('wizSkipHint').textContent = 'Düzeltmeler uygulandı; modeli gösterebilirsiniz.';
}, 0));
$('wizShow3d').onclick = () => { closeWizard(); showTab('3d'); };
$('wizShow2d').onclick = () => { closeWizard(); showTab('plan'); plan.fitModel(); };

// ------------------------------------------------------------ otomatik gezi
async function startTour() {
  if (!state.model) return;
  const v = await ensure3d();
  if (!v) return;
  const wps = planTour(state.model, state.overrides, state.aiTour || {});
  if (wps.length < 2) { status('Otomatik gezi için yeterli mahal bulunamadı.', 'err'); return; }
  const b = buildAll();
  const [ox, oy] = b.origin;
  const sc = b.scale;
  const m = wps.map((p) => ({ ...p, x: (p.x - ox) * sc, y: (p.y - oy) * sc }));
  v.setShowRoof(false);
  $('btnRoof').classList.remove('on');
  const ok = v.startTour(m, {
    onPoint: (p) => { if (p.name) { $('tourName').textContent = p.name; $('tourNote').textContent = p.note || ''; } },
    onStop: () => { $('tourBar').hidden = true; document.querySelector('.stage').classList.remove('touring'); },
  });
  if (!ok) return;
  $('tourName').textContent = m[0].name || 'Gezi başlıyor';
  $('tourNote').textContent = state.aiTour ? 'Rota yapay zekânın önerdiği sırayla.' : 'Rota program tarafından mahaller ve kapılar üzerinden hesaplandı.';
  $('tourPause').textContent = 'Duraklat';
  $('tourSpeed').textContent = '1×';
  $('tourBar').hidden = false;
  document.querySelector('.stage').classList.add('touring');
}
function stopTour() { state.view3d?.stopTour(true); $('tourBar').hidden = true; document.querySelector('.stage').classList.remove('touring'); }
$('btnTour').onclick = () => startTour();
$('tourStop').onclick = () => stopTour();
$('tourPause').onclick = () => {
  const v = state.view3d;
  if (!v?.tour) return;
  const p = !v.tour.paused;
  v.pauseTour(p);
  $('tourPause').textContent = p ? 'Devam' : 'Duraklat';
};
$('tourSpeed').onclick = () => {
  const v = state.view3d;
  if (!v?.tour) return;
  const r = v.tour.rate >= 4 ? 1 : v.tour.rate * 2;
  v.setTourRate(r);
  $('tourSpeed').textContent = r + '×';
};

function renderFacts(secs) {
  const d = state.drawing;
  const f = $('facts');
  f.innerHTML = `
    <dt>Birim</dt><dd>${esc(UNIT_NAMES[d.units] || '?')} (INSUNITS ${d.units})</dd>
    <dt>Katman</dt><dd>${d.layers.filter((l) => l.count).length} dolu / ${d.layers.length}</dd>
    <dt>Nesne</dt><dd>${d.stats.prims.toLocaleString('tr')} çizgi · ${d.stats.texts.toLocaleString('tr')} yazı</dd>
    <dt>Bloklar</dt><dd>${esc([...new Set(d.inserts.map((i) => i.name))].filter((n) => !n.startsWith('*') && !/^[AG]\$/.test(n)).slice(0, 6).join(', ') || '-')}</dd>
    <dt>Süre</dt><dd>${secs} sn</dd>`;
}

const fileInput = $('fileInput');
fileInput.onchange = async () => {
  const f = fileInput.files[0];
  if (f) loadBuffer(await f.arrayBuffer(), f.name);
  fileInput.value = '';
};
const drop = $('drop');
['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', async (e) => {
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (/\.rvt$/i.test(f.name)) return inspectRvt(f);
  loadBuffer(await f.arrayBuffer(), f.name);
});

// ------------------------------------------------------------ katman rolleri
function layerBBox(set) {
  const within = state.planIsland?.bbox;
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of state.drawing.prims) {
    if (!set.has(p.l)) continue;
    for (let i = 0; i < p.pts.length; i += 2) {
      const x = p.pts[i], y = p.pts[i + 1];
      if (within && (x < within[0] || x > within[2] || y < within[1] || y > within[3])) continue;
      if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
    }
  }
  if (!isFinite(a)) return null;
  const m = Math.max(c - a, d - b) * 0.12;
  return [a - m, b - m, c + m, d + m];
}

// Asıl planın bulunduğu çizim grubunu, katman rollerini ve birimi tahmin eder
// (ayrıntı: auto.js). Lejant, şema, detay ve uzak kalıntılar yok sayılır.
function autoRoles() {
  const d = state.drawing;
  const a = autoSetup(d, { params: state.params, units: state.units, kb: state.kb });
  state.unitNote = a.unitNote;
  if (a.units !== state.units) { state.units = a.units; fillParams(); }
  state.roles = a.roles;
  state.autoRegion = a.region;
  state.planIsland = a.planIsland;
  state.islands = a.islands;
  state.parts = a.planIsland ? [a.planIsland.id] : [];
  state.partRegions = null;
}

// ------------------------------------------------------------ pafta bölümleri
// Her bölüm için kaba içerik sayımı (duvar adaylı / tesisat katmanları)
function partStats() {
  const d = state.drawing;
  const list = (state.islands || []).filter((i) => i.n >= 100).slice(0, 14);
  const cls = new Map();
  const isMep = (l) => { let c = cls.get(l); if (c === undefined) { const k = state.kb.classify(d.layers[l].name).kind; cls.set(l, (c = !!k && k !== 'ignore')); } return c; };
  const wallRe = /duvar|wall/i;
  for (const isl of list) { isl._w = 0; isl._m = 0; }
  const byArea = list.slice().sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]));
  for (const isl of list) { isl._kot = 0; isl._txt = 0; isl._wb = null; }
  for (const p of d.prims) {
    const x = p.pts[0], y = p.pts[1];
    const isl = byArea.find((i) => x >= i.bbox[0] && x <= i.bbox[2] && y >= i.bbox[1] && y <= i.bbox[3]);
    if (!isl) continue;
    if (wallRe.test(d.layers[p.l].name)) {
      isl._w++;
      const b = isl._wb || (isl._wb = [Infinity, Infinity, -Infinity, -Infinity]);
      for (let q = 0; q < p.pts.length; q += 2) { b[0] = Math.min(b[0], p.pts[q]); b[1] = Math.min(b[1], p.pts[q + 1]); b[2] = Math.max(b[2], p.pts[q]); b[3] = Math.max(b[3], p.pts[q + 1]); }
    }
    if (isMep(p.l)) isl._m++;
  }
  for (const t of d.texts) {
    const isl = byArea.find((i) => t.x >= i.bbox[0] && t.x <= i.bbox[2] && t.y >= i.bbox[1] && t.y <= i.bbox[3]);
    if (!isl) continue;
    isl._txt++;
    if (/^[+±-]\s?\d{1,2}[.,]\d{2}\b/.test(t.s.trim())) isl._kot++;
  }
  // tür tahmini: başlık + içerik
  const toCm = UNIT_TO_CM[state.units] ?? 1;
  for (const isl of list) {
    const L = fold(isl.label || '');
    const w = (isl.bbox[2] - isl.bbox[0]) * toCm / 100, h = (isl.bbox[3] - isl.bbox[1]) * toCm / 100;
    let t = 'bilinmiyor';
    const big = isl._w > 400 || isl._m > 400; // içerik ağır basar: başlık yanıltıcı olabilir (birleşik pafta)
    if (!big && (/KESIT|SECTION|GORUNUS|ELEVATION|CEPHE|FACADE/.test(L) || (isl._kot >= 3 && isl._w < 50))) t = 'kesit/görünüş';
    else if (!big && (/LEJANT|LEGEND|SEMBOL|ANTET|NOTLAR|MAHAL LISTESI/.test(L) || (isl._txt > isl.n * 0.5 && isl._w === 0))) t = 'lejant/tablo';
    else if (!big && /SEMA|SCHEMA|DIAGRAM|KOLON SEMASI|RISER|ISOMETR/.test(L)) t = 'şema';
    else if (!big && (/DETAY|DETAIL/.test(L) || (Math.max(w, h) < 3 && isl._w > 0))) t = 'detay';
    else if (/VAZIYET|SITE PLAN/.test(L) || (Math.max(w, h) > 150 && isl._w < 20)) t = 'vaziyet planı';
    else if (!big && /TAVAN|CEILING|RCP/.test(L)) t = 'tavan planı';
    else if (!big && /TEFRIS|FURNITURE|MOBILYA/.test(L)) t = 'tefriş planı';
    else if (/PLAN|KAT\b/.test(L) || isl._w > 50 || isl._m > 50) t = big && Math.max(w, h) > 60 ? 'kat planı (+detay/şema karışık; gerekirse bölge seç)' : 'kat planı';
    isl._type = t;
  }
  // aynı alanın başka çizimi olabilecek benzer boyutlu bölümler (duvar kutusu ya da bölüm kutusu %8 içinde)
  for (const a of list) {
    a._similar = [];
    const ab = a._wb || a.bbox, aw = ab[2] - ab[0], ah = ab[3] - ab[1];
    for (const b of list) {
      if (a === b) continue;
      const bb = b._wb || b.bbox, bw = bb[2] - bb[0], bh = bb[3] - bb[1];
      if (aw > 0 && bw > 0 && Math.abs(aw - bw) / Math.max(aw, bw) < 0.08 && Math.abs(ah - bh) / Math.max(ah, bh) < 0.08) a._similar.push(b.id);
    }
  }
  return list;
}

// Bir bölümü başka bir bölümün üstüne bindirir (aynı alanın tavan/tefriş/tesisat planı gibi):
// duvar kutuları (yoksa bölüm kutuları) merkezden hizalanır; çizim nesneleri kaydırılır (geri alınabilir)
function overlayIsland(baseId, otherId) {
  const d = state.drawing;
  const list = partStats();
  const A = list.find((i) => i.id === baseId), B = list.find((i) => i.id === otherId);
  if (!A || !B) throw new Error('bölüm bulunamadı');
  const ab = A._wb || A.bbox, bb = B._wb || B.bbox;
  const dx = (ab[0] + ab[2]) / 2 - (bb[0] + bb[2]) / 2, dy = (ab[1] + ab[3]) / 2 - (bb[1] + bb[3]) / 2;
  const inB = (x, y) => x >= B.bbox[0] && x <= B.bbox[2] && y >= B.bbox[1] && y <= B.bbox[3];
  let n = 0;
  for (const p of d.prims) { if (!inB(p.pts[0], p.pts[1])) continue; for (let q = 0; q < p.pts.length; q += 2) { p.pts[q] += dx; p.pts[q + 1] += dy; } n++; }
  for (const t of d.texts) if (inB(t.x, t.y)) { t.x += dx; t.y += dy; }
  for (const it of d.inserts || []) if (inB(it.x, it.y)) { it.x += dx; it.y += dy; }
  state.overlays = state.overlays || [];
  state.overlays.push({ base: baseId, other: otherId, dx, dy, n });
  B.bbox = [B.bbox[0] + dx, B.bbox[1] + dy, B.bbox[2] + dx, B.bbox[3] + dy];
  const isl = state.islands.find((i) => i.id === otherId); if (isl) isl.bbox = B.bbox;
  A.bbox = [Math.min(A.bbox[0], B.bbox[0]), Math.min(A.bbox[1], B.bbox[1]), Math.max(A.bbox[2], B.bbox[2]), Math.max(A.bbox[3], B.bbox[3])];
  const ia = state.islands.find((i) => i.id === baseId); if (ia) ia.bbox = A.bbox;
  state._partList = null;
  return { dx, dy, n };
}

function renderParts() {
  const box = $('partsBox');
  const d = state.drawing;
  if (!d || (state.islands || []).filter((i) => i.n >= 100).length < 2) { box.hidden = true; return; }
  box.hidden = false;
  if (!state._partList || state._partListFor !== d) { state._partList = partStats(); state._partListFor = d; }
  const toCm = UNIT_TO_CM[state.units] ?? 1;
  const sel = new Set(state.parts);
  $('partsList').innerHTML = state._partList.map((i) => {
    const w = ((i.bbox[2] - i.bbox[0]) * toCm / 100).toFixed(0), h = ((i.bbox[3] - i.bbox[1]) * toCm / 100).toFixed(0);
    const tags = [i._w ? `duvar ${i._w}` : '', i._m ? `tesisat ${i._m}` : ''].filter(Boolean).join(' · ') || 'yalnız çizim/yazı';
    return `<li class="${sel.has(i.id) ? 'on' : ''}"><label><input type="checkbox" data-part="${i.id}" ${sel.has(i.id) ? 'checked' : ''}>
      <span class="pl"><b>${esc(i.label || 'Bölüm ' + i.id)}</b><span class="hint">${w}×${h} m · ${i.n.toLocaleString('tr')} nesne · ${tags}</span></span></label>
      <button class="btn small" data-zoom="${i.id}">Göster</button></li>`;
  }).join('');
  const n = state._partList.filter((i) => sel.has(i.id)).reduce((s, i) => s + i.n, 0);
  $('partsNote').textContent = n > 300000 ? `Seçili bölümlerde ${n.toLocaleString('tr')} nesne var; işlem birkaç saniye sürebilir.` : '';
  renderPartsMenu();
}

// Plan/3B yanındaki "Bölümler" menüsü: aynı liste, tik atınca hemen işlenir
function renderPartsMenu() {
  const menu = $('partsMenu');
  const list = state._partList || [];
  if (!state.drawing || list.length < 2) { menu.hidden = true; return; }
  menu.hidden = false;
  const toCm = UNIT_TO_CM[state.units] ?? 1;
  const cur = new Set(state.parts.length ? state.parts : state.planIsland ? [state.planIsland.id] : []);
  $('partsBtn').textContent = `Bölümler ${cur.size}/${list.length} ▾`;
  $('partsPop').innerHTML = list.map((i) => {
    const w = ((i.bbox[2] - i.bbox[0]) * toCm / 100).toFixed(0), h = ((i.bbox[3] - i.bbox[1]) * toCm / 100).toFixed(0);
    const tags = [i._w ? `duvar ${i._w}` : '', i._m ? `tesisat ${i._m}` : ''].filter(Boolean).join(' · ') || 'yalnız çizim/yazı';
    return `<label><input type="checkbox" data-mpart="${i.id}" ${cur.has(i.id) ? 'checked' : ''}><span><b>${esc(i.label || 'Bölüm ' + i.id)}</b><span class="hint">${w}×${h} m · ${i.n.toLocaleString('tr')} nesne · ${tags}</span></span></label>`;
  }).join('') + '<div class="foot">Claude açılışta asıl planı seçer; burada elle değiştirebilirsiniz.</div>';
}
$('partsBtn').onclick = () => { const p = $('partsPop'); p.hidden = !p.hidden; $('partsBtn').setAttribute('aria-expanded', String(!p.hidden)); };
document.addEventListener('click', (e) => { if (!$('partsMenu').contains(e.target)) { $('partsPop').hidden = true; $('partsBtn').setAttribute('aria-expanded', 'false'); } });
$('partsPop').addEventListener('change', (e) => {
  const id = +e.target.dataset.mpart;
  if (!id) return;
  const cur = new Set(state.parts.length ? state.parts : state.planIsland ? [state.planIsland.id] : []);
  if (e.target.checked) cur.add(id); else cur.delete(id);
  if (!cur.size) { e.target.checked = true; return; }
  state.parts = [...cur];
  renderParts();
  processParts(state.parts);
});
$('partsList').addEventListener('click', (e) => {
  const z = +e.target.dataset.zoom;
  if (z) { const isl = state.islands.find((i) => i.id === z); if (isl) { showTab('plan'); plan.fit(isl.bbox); } }
});
$('partsList').addEventListener('change', (e) => {
  const id = +e.target.dataset.part;
  if (!id) return;
  const set = new Set(state.parts);
  if (e.target.checked) set.add(id); else set.delete(id);
  state.parts = [...set];
  $('btnParts').disabled = !state.parts.length;
  e.target.closest('li').classList.toggle('on', e.target.checked);
});
// Seçili bölümleri işle: her bölüm kendi katmanları ve birimiyle kurulur, sonuçlar birleşir
$('btnParts').onclick = () => processParts(state.parts);
function processParts(ids) {
  const d = state.drawing;
  const isls = ids.map((id) => state.islands.find((i) => i.id === id)).filter(Boolean);
  if (!d || !isls.length) return;
  status(`${isls.length} bölüm işleniyor…`);
  overlay(`${isls.length} bölüm işleniyor…`, 'İşleniyor');
  setTimeout(() => {
    const roles = { wall: new Set(), column: new Set(), text: new Set(), door: new Set(), window: new Set() };
    const regions = [];
    for (const isl of isls) {
      const a = autoSetup(d, { params: state.params, units: state.units, kb: state.kb, islands: state.islands, onlyIslands: [isl] });
      for (const k of Object.keys(roles)) for (const l of a.roles[k] || []) roles[k].add(l);
      regions.push(a.region || padBox(isl.bbox, 0.02));
    }
    state.roles = roles;
    state.region = null;
    state.partRegions = regions;
    state.autoRegion = regions[0];
    state.planIsland = isls[0];
    renderLayers();
    runDetect();
    const all = regions.reduce((b, r) => [Math.min(b[0], r[0]), Math.min(b[1], r[1]), Math.max(b[2], r[2]), Math.max(b[3], r[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    plan.fit(all);
    overlay(null);
  }, 30);
}

function roleOf(i) {
  for (const r of ['wall', 'column', 'door', 'window', 'text']) if (state.roles[r].has(i)) return r;
  return '';
}

function renderLayers() {
  const d = state.drawing;
  const rows = d.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.count > 0)
    .sort((a, b) => (roleOf(b.i) ? 1 : 0) - (roleOf(a.i) ? 1 : 0) || b.l.count - a.l.count);
  $('layerRows').innerHTML = rows.map(({ l, i }) => `
    <tr data-i="${i}" data-name="${esc(l.name.toLowerCase())}" class="${roleOf(i) ? 'role-' + roleOf(i) : ''}">
      <td><input type="checkbox" class="vis" ${plan.layerVisible[i] ? 'checked' : ''} aria-label="${esc(l.name)} görünür"></td>
      <td><span class="sw" style="background:${l.color}"></span></td>
      <td class="nm" title="${esc(l.name)}">${esc(l.name)}</td>
      <td class="ct">${l.count}</td>
      <td><select class="role" aria-label="${esc(l.name)} rolü">
        <option value="">—</option>
        <option value="wall" ${roleOf(i) === 'wall' ? 'selected' : ''}>Duvar</option>
        <option value="column" ${roleOf(i) === 'column' ? 'selected' : ''}>Kolon</option>
        <option value="door" ${roleOf(i) === 'door' ? 'selected' : ''}>Kapı işareti</option>
        <option value="window" ${roleOf(i) === 'window' ? 'selected' : ''}>Pencere işareti</option>
        <option value="text" ${roleOf(i) === 'text' ? 'selected' : ''}>Mahal adı</option>
      </select></td>
    </tr>`).join('');
  applyLayerFilter();
}
$('layerRows').addEventListener('change', (e) => {
  const tr = e.target.closest('tr');
  if (!tr) return;
  const i = +tr.dataset.i;
  if (e.target.classList.contains('vis')) { plan.layerVisible[i] = e.target.checked; plan.draw(); return; }
  if (e.target.classList.contains('role')) {
    for (const s of Object.values(state.roles)) s.delete(i);
    if (e.target.value) state.roles[e.target.value].add(i);
    tr.className = e.target.value ? 'role-' + e.target.value : '';
    if (e.target.value === 'wall' && state.roles.wall.size) state.autoRegion = layerBBox(state.roles.wall);
    runDetect();
  }
});
function applyLayerFilter() {
  const q = $('layerFilter').value.trim().toLowerCase();
  const only = $('onlyAssigned').checked && !q;
  for (const tr of $('layerRows').querySelectorAll('tr[data-i]')) tr.hidden = (q && !tr.dataset.name.includes(q)) || (only && !tr.className.includes('role-'));
}
$('layerFilter').oninput = applyLayerFilter;
$('onlyAssigned').onchange = applyLayerFilter;
$('btnAuto').onclick = () => { if (!state.drawing) return; state.units = UNIT_TO_CM[state.drawing.units] != null && state.drawing.units !== 0 ? state.drawing.units : 5; autoRoles(); state.region = null; renderLayers(); runDetect(); plan.fitModel(); };
$('btnRegion').onclick = () => {
  if (!state.drawing) return;
  plan.regionMode = !plan.regionMode;
  $('btnRegion').classList.toggle('on', plan.regionMode);
  status(plan.regionMode ? 'Planda algılanacak alanın çevresine bir dikdörtgen çizin.' : '');
};
$('btnRegionReset').onclick = () => { state.region = null; runDetect(); };

// ------------------------------------------------------------ elle duvar çizme
function addManualWall(a, b) {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (L < 1e-6) return;
  const t = (parseFloat($('manualWallCm').value) || 20) / (UNIT_TO_CM[state.units] ?? 1);
  const nx = -(b[1] - a[1]) / L * t / 2, ny = (b[0] - a[0]) / L * t / 2;
  state.manualWalls.push([[a[0] + nx, a[1] + ny], [b[0] + nx, b[1] + ny], [b[0] - nx, b[1] - ny], [a[0] - nx, a[1] - ny]]);
  runDetect();
  status(`Duvar eklendi (${state.manualWalls.length} elle çizilmiş duvar). Mahaller yeniden hesaplandı.`, 'ok');
}
$('btnWallDraw').onclick = () => {
  plan.wallMode = !plan.wallMode;
  plan._wallStart = null;
  $('btnWallDraw').classList.toggle('on', plan.wallMode);
  if (plan.wallMode) { showTab('plan'); status('Duvarın başlangıç ve bitiş noktasına tıklayın. Bitirmek için "Duvar çiz" düğmesine tekrar basın.'); }
};
$('btnWallClear').onclick = () => { if (!state.manualWalls?.length) return; state.manualWalls = []; runDetect(); status('Elle çizilen duvarlar silindi.', 'ok'); };

// ------------------------------------------------------------ parametreler
const DETECT_KEYS = ['minThicknessCm', 'maxThicknessCm', 'minGapCm', 'maxGapCm', 'maxDoorCm', 'tolCm'];
const BUILD_NUM = ['wallHeightCm', 'doorHeightCm', 'windowSillCm', 'windowHeightCm', 'slabThicknessCm'];
const BUILD_TXT = ['projectName', 'storeyName'];
const BUILD_CHK = ['makeFloor', 'makeRoof', 'makeSpaces'];

function fillParams() {
  $('pUnits').innerHTML = Object.entries(UNIT_NAMES).filter(([k]) => k !== '0').map(([k, v]) => `<option value="${k}" ${+k === state.units ? 'selected' : ''}>${v}</option>`).join('');
  for (const k of DETECT_KEYS) $(k).value = state.params[k];
  for (const k of BUILD_NUM) $(k).value = state.build[k];
  for (const k of BUILD_TXT) $(k).value = state.build[k];
  for (const k of BUILD_CHK) $(k).checked = !!state.build[k];
}
fillParams();
$('pUnits').onchange = () => { state.units = +$('pUnits').value; runDetect(); };
for (const k of DETECT_KEYS) $(k).onchange = () => { const v = parseFloat($(k).value); if (v > 0) { state.params[k] = v; runDetect(); } };
for (const k of BUILD_NUM) $(k).onchange = () => { const v = parseFloat($(k).value); if (v >= 0) { state.build[k] = v; rebuild3d(); } };
for (const k of BUILD_TXT) $(k).onchange = () => { state.build[k] = $(k).value; };
for (const k of BUILD_CHK) $(k).onchange = () => { state.build[k] = $(k).checked; rebuild3d(); };
$('btnDetect').onclick = () => runDetect();

// ------------------------------------------------------------ algılama
const emptyModel = () => ({ walls: [], columns: [], openings: [], rooms: [], curtains: [], outline: null, unitScale: UNIT_TO_CM[state.units] ?? 1, stats: {} });

// İşlenecek alanlar: elle çizilen bölge > seçilen pafta bölümleri > otomatik bölge
function currentRegions() {
  if (state.region) return [state.region];
  if (state.partRegions?.length) return state.partRegions;
  return [state.autoRegion || null];
}
// Birden çok bölümün sonuçlarını birleştir; kimliklere ".bölüm" eki (tür harfi başta kalır)
function suffixIds(list, i, multi) {
  if (!multi) return list;
  return list.map((x) => ({ ...x, id: x.id + '.' + (i + 1), ...(x.hostWall ? { hostWall: x.hostWall + '.' + (i + 1) } : {}) }));
}
function mergeModels(models) {
  if (models.length === 1) return { ...models[0], outlines: models[0].outline ? [models[0].outline] : [] };
  const multi = models.length > 1;
  const out = { walls: [], columns: [], openings: [], rooms: [], curtains: [], outlines: [], outline: null, unitScale: models[0].unitScale, stats: {} };
  models.forEach((m, i) => {
    out.walls.push(...suffixIds(m.walls, i, multi));
    out.curtains.push(...suffixIds(m.curtains || [], i, multi));
    out.columns.push(...suffixIds(m.columns, i, multi));
    out.openings.push(...suffixIds(m.openings, i, multi));
    out.rooms.push(...suffixIds(m.rooms, i, multi));
    if (m.outline) out.outlines.push(m.outline);
  });
  out.outline = out.outlines[0] || null;
  return out;
}

function runDetect() {
  if (!state.drawing) return;
  const t0 = performance.now();
  const regions = currentRegions();
  plan.region = state.region;
  plan.partRegions = state.region ? null : state.partRegions;
  state.model = state.roles.wall.size ? mergeModels(regions.map((region) => detect(state.drawing, {
    units: state.units, wallLayers: state.roles.wall, columnLayers: state.roles.column,
    textLayers: state.roles.text, doorLayers: state.roles.door, windowLayers: state.roles.window, region, params: state.params,
    extraWalls: state.manualWalls,
  }))) : emptyModel();
  // sohbetle eklenen kolon ve boşluklar (duvar kimliği hâlâ varsa) modele katılır
  state.model.columns.push(...state.manualColumns);
  state.model.openings.push(...state.manualOpenings.filter((o) => state.model.walls.some((w) => w.id === o.hostWall)));
  state.overrides = {};
  state.selected = null;
  plan.setModel(state.model, state.overrides);
  runMep(false);
  runFixtures();
  renderStats();
  renderSel();
  rebuild3d(false);
  const hasAny = state.model.walls.length || mepCount() > 0;
  ['btnExport', 'btnExportTop'].forEach((id) => ($(id).disabled = !hasAny));
  const ms = Math.round(performance.now() - t0);
  if (!state.roles.wall.size && !mepCount()) status('Duvar katmanı seçilmedi ve tesisat bulunamadı. Katman listesinden en az bir katmanı "Duvar" yapın.', 'err');
  else if (!state.model.walls.length && !mepCount()) status('Seçilen katmanlarda duvar bulunamadı. Başka bir katman deneyin veya "En kalın duvar" ayarını artırın.', 'err');
  else status(`Algılandı (${ms} ms${regions.length > 1 ? `, ${regions.length} bölüm` : ''}). Plandaki öğelere tıklayarak düzenleyebilirsiniz.`, 'ok');
  renderParts();
}

// ------------------------------------------------------------ tefriş
// Blok adlarından ve ıslak hacimlerdeki kümelerden; tesisat katmanları atlanır
function runFixtures() {
  const d = state.drawing;
  if (!d || !state.model) { state.fixtures = []; return; }
  const skip = new Set();
  for (const [l, p] of state.mepProfiles) if (p.kind && p.kind !== 'ignore' && p.kind !== 'equipment') skip.add(l);
  const regions = currentRegions();
  const multi = regions.length > 1;
  const all = [];
  let ignored = 0;
  const unknown = new Map();
  regions.forEach((region, i) => {
    const r = extractFixtures(d, { region, units: state.units, rooms: state.model.rooms, unitScale: state.model.unitScale, skipLayers: skip, lib: state.lib });
    all.push(...suffixIds(r.fixtures, i, multi));
    ignored += r.ignored;
    for (const u of r.unknown || []) { const c = unknown.get(u.name); if (c) c.count += u.count; else unknown.set(u.name, { ...u }); }
  });
  state.unknownBlocks = [...unknown.values()].sort((a, b) => b.count - a.count);
  state.fixtures = all.concat(state.manualFixtures);
  state.decorIgnored = ignored;
  plan.setFixtures(liveFixtures());
}
const liveFixtures = () => state.fixtures.map((f) => {
  const o = state.overrides[f.id];
  let g = o?.kind ? { ...f, kind: o.kind, label: FIXTURE_KINDS[o.kind]?.label || o.kind } : f;
  if (g.lib && !o?.kind) { const li = state.lib.get(g.lib); if (li?.parts) g = { ...g, libParts: li.parts, label: li.label }; }
  return g;
});

// ------------------------------------------------------------ tesisat
const mepCount = () => (state.mep ? state.mep.pipes.length + state.mep.ducts.length + state.mep.boxes.length : 0);

// Katmanın etkin profili: bilgi bankası kararı + bu projedeki düzeltmeler
function profileFor(l) {
  const name = state.drawing.layers[l].name;
  const base = state.kb.classify(name);
  const ov = state.mepOverrides[l];
  return ov ? { ...base, ...ov, source: ov.source || 'user' } : base;
}

function runMep(rebuild = true) {
  const d = state.drawing;
  if (!d) return;
  const regions = currentRegions();
  const region = regions[0];
  const arch = new Set([...state.roles.wall, ...state.roles.column, ...state.roles.door, ...state.roles.window, ...state.roles.text]);
  // katman özetleri: bölümlerin toplamı
  const byL = new Map();
  for (const r of regions) for (const st of layerStats(d, r, state.units)) {
    if (arch.has(st.l)) continue;
    const cur = byL.get(st.l);
    if (!cur) { byL.set(st.l, { ...st }); continue; }
    cur.count += st.count; cur.open += st.open; cur.closed += st.closed; cur.lengthM = +(cur.lengthM + st.lengthM).toFixed(1);
    cur.blocks = [...new Set([...cur.blocks, ...st.blocks])].slice(0, 4);
    cur.texts = [...new Set([...cur.texts, ...st.texts])].slice(0, 8);
  }
  state.mepStats = [...byL.values()].sort((a, b) => b.count - a.count);
  state.mepProfiles = new Map();
  for (const st of state.mepStats) state.mepProfiles.set(st.l, profileFor(st.l));
  const parts = regions.map((r) => extractMep(d, { region: r, units: state.units, profiles: state.mepProfiles }));
  const multi = parts.length > 1;
  state.mep = {
    pipes: parts.flatMap((m, i) => suffixIds(m.pipes, i, multi)),
    ducts: parts.flatMap((m, i) => suffixIds(m.ducts, i, multi)),
    boxes: parts.flatMap((m, i) => suffixIds(m.boxes, i, multi)),
    dropped: parts.reduce((acc, m) => { for (const [k, v] of Object.entries(m.dropped)) acc[k] = (acc[k] || 0) + v; return acc; }, {}),
  };
  plan.mepUnitScale = UNIT_TO_CM[state.units] ?? 1;
  plan.setMep(state.mep, state.mepProfiles, { visible: state.mepVisible, systems: visibleSystems() });
  // kot: projede varsa oradan, yoksa kullanıcıya sor
  if (!state.elevations) {
    state.elevations = detectElevations(d, region);
    if (state.elevations.ceiling) state.ceiling = { cm: state.elevations.ceiling.cm, source: 'project', text: state.elevations.ceiling.text };
  }
  renderMepPanel();
  renderTodo();
  renderReport();
  if (mepCount() && state.ceiling.source === 'default' && !state.ceilingAsked && !state.wizardActive && !(state.isSample && !state.demoDone)) askCeiling();
  if (rebuild) rebuild3d();
}

function visibleSystems() {
  if (!state.systemsOff.size) return null;
  return new Set(Object.keys(SYSTEMS).filter((k) => !state.systemsOff.has(k)));
}

function effKind(o) { return state.overrides[o.id]?.kind || o.kind; }
function renderStats() {
  const m = state.model, ov = state.overrides;
  const live = (arr) => (m ? arr.filter((x) => !ov[x.id]?.deleted) : []);
  const ops = m ? live(m.openings) : [];
  const walls = m ? live(m.walls) : [];
  $('sWalls').textContent = m ? walls.length : '–';
  $('sCols').textContent = m ? live(m.columns).length : '–';
  $('sRooms').textContent = m ? live(m.rooms).length : '–';
  $('sWin').textContent = m ? ops.filter((o) => effKind(o) === 'window').length : '–';
  $('sDoor').textContent = m ? ops.filter((o) => effKind(o) === 'door').length : '–';
  $('sEmpty').textContent = m ? ops.filter((o) => effKind(o) === 'empty').length : '–';
  if (m) {
    const area = live(m.rooms).reduce((s, r) => s + Math.abs(r.area), 0) * m.unitScale ** 2 / 1e4;
    const ext = walls.filter((w) => w.exterior).length;
    const extra = [];
    if (m.curtains?.length) extra.push(`${live(m.curtains).length} cam cephe şeridi`);
    if (state.fixtures.length) extra.push(`${state.fixtures.filter((f) => !ov[f.id]?.deleted).length} tefriş`);
    if (state.decorIgnored) extra.push(`${state.decorIgnored} süs çizimi yok sayıldı`);
    $('resultNote').textContent = m.walls.length ? `${ext} dış, ${walls.length - ext} iç duvar · mahaller toplam ${area.toFixed(1)} m²${extra.length ? ' · ' + extra.join(' · ') : ''}` : 'Mimari bulunamadı (yalnız tesisat).';
  }
  if ($('sideFile')) renderSide();
}

function buildAll() {
  return buildSolids(state.model, {
    ...state.build, mep: state.mepVisible ? state.mep : null, mepProfiles: state.mepProfiles, fixtures: state.archVisible ? liveFixtures() : [],
    ceilingCm: state.ceiling.cm, layerNames: state.drawing.layers.map((l) => l.name),
  }, state.overrides);
}

function rebuild3d(keepCamera = true) {
  if (!state.view3d || !state.model) return;
  const b = buildAll();
  state.view3d.setSolids(b.solids.concat(sketchSolids(b.origin, b.scale)), { keepCamera });
  state.view3d.setVisibility({ arch: state.archVisible, systems: visibleSystems() });
  state.view3d.setSelected(state.selected);
}

// ------------------------------------------------------------ seçim ve düzenleme
function select(id) {
  state.selected = id;
  plan.setSelected(id);
  state.view3d?.setSelected(id);
  renderSel();
}

function setOv(id, patch) {
  state.overrides[id] = { ...(state.overrides[id] || {}), ...patch };
  plan.setModel(state.model, state.overrides);
  if (id[0] === 'F') plan.setFixtures(liveFixtures());
  renderStats();
  renderTodo();
  rebuild3d();
  renderSel();
}

function numField(id, label, value, unit = 'cm') {
  return `<div class="field"><label for="${id}">${label}</label><div class="unit" data-u="${unit}"><input type="number" id="${id}" value="${value}" step="5"></div></div>`;
}

function renderSel() {
  renderSelInner();
  const has = !!state.selected && $('selPanel').innerHTML.trim() !== '';
  $('selCard').hidden = !has;
  $('hintBar').hidden = has;
}
$('selClose').onclick = () => select(null);

function renderSelInner() {
  const box = $('selPanel');
  const me = findMepById(state.mep, state.selected);
  if (me) return renderMepSel(box, me);
  const el = findById(state.model, state.selected) || state.fixtures.find((f) => f.id === state.selected);
  if (!el) { box.innerHTML = ''; return; }
  const id = el.id, ov = state.overrides[id] || {}, B = state.build;
  let html = '';
  if (id[0] === 'F') {
    const kind = ov.kind || el.kind;
    const opts = Object.entries(FIXTURE_KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
    html = `<div class="row"><b>${esc(FIXTURE_KINDS[kind]?.label || kind)} ${id}</b><span class="hint">${Math.round(el.wCm)}×${Math.round(el.hCm)} cm · ${el.source === 'block' ? 'blok: ' + esc(el.name) : 'çizgi kümesi (' + esc(el.name) + ')'}</span></div>
      <div class="field"><label for="selFx">Tür</label><select id="selFx">${opts}</select></div>
      <div class="row"><button class="btn small" id="selDel">Öğeyi kaldır</button></div>`;
  } else if (id[0] === 'G') {
    html = `<div class="row"><b>Cam cephe ${id}</b><span class="hint">${(cm(el.length) / 100).toFixed(2)} m · ${cm(el.thickness)} cm doğrama</span></div>
      <div class="grid2">${numField('selH', 'Yükseklik', ov.heightCm ?? B.wallHeightCm)}</div>
      <p class="hint">Cam giydirme cephe / cam bölme: tam yükseklik cam, dikme ve kayıtlarla. IFC'de IfcCurtainWall.</p>
      <div class="row"><button class="btn small" id="selDel">Cam cepheyi sil</button></div>`;
  } else if (id[0] === 'O') {
    const kind = ov.kind || el.kind;
    html = `<div class="row"><b>Boşluk ${id}</b><span class="hint">${cm(el.width)} cm genişlik · ${cm(el.thickness)} cm duvar · ${el.exterior ? 'dış cephe' : 'iç'}</span></div>
      <div class="seg" role="group" aria-label="Boşluk türü">
        <button data-kind="window" class="${kind === 'window' ? 'on' : ''}">Pencere</button>
        <button data-kind="door" class="${kind === 'door' ? 'on' : ''}">Kapı</button>
        <button data-kind="empty" class="${kind === 'empty' ? 'on' : ''}">Geçiş</button>
        <button data-kind="solid" class="${kind === 'solid' ? 'on' : ''}">Dolu</button>
      </div>
      ${el.why ? `<p class="hint">Program kararı: ${esc(el.why)}</p>` : ''}
      <div class="grid2">
        ${kind === 'window' ? numField('selSill', 'Parapet', ov.sillCm ?? B.windowSillCm) + numField('selH', 'Pencere yüksekliği', ov.heightCm ?? B.windowHeightCm) : ''}
        ${kind === 'door' ? numField('selH', 'Kapı yüksekliği', ov.heightCm ?? B.doorHeightCm) : ''}
      </div>
      ${kind === 'empty' ? '<p class="hint">Geçiş: kapı, pencere ve lento oluşturulmaz.</p>' : ''}
      ${kind === 'solid' ? '<p class="hint">Dolu: boşluk tam yükseklikte duvarla kapatılır.</p>' : ''}
      <div class="row"><button class="btn small" id="selDel">Boşluğu sil</button></div>`;
  } else if (id[0] === 'W') {
    html = `<div class="row"><b>Duvar ${id}</b><span class="hint">${cm(el.thickness)} cm kalınlık · ${(cm(el.length || 0) / 100).toFixed(2)} m · ${el.exterior ? 'dış' : 'iç'}</span></div>
      <div class="grid2">${numField('selH', 'Yükseklik', ov.heightCm ?? B.wallHeightCm)}</div>
      <div class="row"><button class="btn small" id="selDel">Duvarı sil</button></div>`;
  } else if (id[0] === 'C') {
    html = `<div class="row"><b>Kolon ${id}</b></div>
      <div class="grid2">${numField('selH', 'Yükseklik', ov.heightCm ?? B.wallHeightCm)}</div>
      <div class="row"><button class="btn small" id="selDel">Kolonu sil</button></div>`;
  } else if (id[0] === 'R') {
    html = `<div class="row"><b>Mahal ${id}</b><span class="hint">${(Math.abs(el.area) * state.model.unitScale ** 2 / 1e4).toFixed(2)} m²</span></div>
      <div class="field"><label for="selName">Mahal adı</label><input type="text" id="selName" value="${esc(ov.name ?? el.name)}"></div>
      <div class="row"><button class="btn small" id="selDel">Mahali sil</button></div>`;
  }
  box.innerHTML = `<div class="sel">${html}</div>`;
  box.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => setOv(id, { kind: b.dataset.kind })));
  const h = $('selH'); if (h) h.onchange = () => setOv(id, { heightCm: parseFloat(h.value) });
  const s = $('selSill'); if (s) s.onchange = () => setOv(id, { sillCm: parseFloat(s.value) });
  const n = $('selName'); if (n) n.onchange = () => setOv(id, { name: n.value });
  const fx = $('selFx'); if (fx) fx.onchange = () => { setOv(id, { kind: fx.value }); plan.setFixtures(liveFixtures()); };
  const del = $('selDel'); if (del) del.onclick = () => { setOv(id, { deleted: true }); select(null); };
}

// ------------------------------------------------------------ tesisat paneli
const SRC_LABEL = { builtin: 'Yerleşik', ai: 'Öğrenildi (YZ)', user: 'Kullanıcı', unknown: 'Bilinmiyor' };
const reEsc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sysOptions = (cur) => Object.entries(SYSTEMS).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
const kindOptions = (cur) => `<option value="" ${!cur ? 'selected' : ''}>— seçin —</option>` + Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');

function mepSummary() {
  const sum = new Map();
  if (!state.mep) return sum;
  const get = (l) => { const p = state.mepProfiles.get(l); if (!p || !p.kind || p.kind === 'ignore') return null; let o = sum.get(p.system); if (!o) sum.set(p.system, (o = { pipeM: 0, n: 0 })); return o; };
  for (const p of state.mep.pipes) { const o = get(p.l); if (o) o.pipeM += p.lengthCm / 100; }
  for (const x of [...state.mep.ducts, ...state.mep.boxes]) { const o = get(x.l); if (o) o.n++; }
  return sum;
}

function renderMepPanel() {
  const sum = mepSummary();
  $('sysChips').innerHTML = [...sum.entries()].map(([k, v]) => {
    const sys = SYSTEMS[k] || SYSTEMS.other;
    const off = state.systemsOff.has(k);
    return `<label class="syschip ${off ? 'off' : ''}"><input type="checkbox" data-sys="${k}" ${off ? '' : 'checked'}><i class="dot" style="background:${sys.color}"></i>${esc(sys.label)} <b>${v.pipeM ? v.pipeM.toFixed(0) + ' m' : ''}${v.pipeM && v.n ? ' · ' : ''}${v.n ? v.n + ' adet' : ''}</b></label>`;
  }).join('') || '<span class="hint">Bu bölgede tesisat bulunamadı.</span>';
  // kot
  const c = state.ceiling;
  $('ceilCm').value = c.cm;
  $('ceilBox').classList.toggle('warn', c.source === 'default');
  $('ceilSrc').textContent = c.source === 'project' ? `Projeden okundu: "${c.text}"` : c.source === 'user' ? 'Sizin girdiğiniz değer' : c.source === 'ai' ? `Yapay zekâ önerisi${c.text ? ': ' + c.text : ''}` : 'Projede bulunamadı, lütfen girin (şu an varsayılan 280 cm kullanılıyor).';
  $('ceilCands').innerHTML = (state.elevations?.candidates || []).map((k) => `<button data-cm="${k.cm}" title="Çizimde ${k.count} kez geçiyor">+${(k.cm / 100).toFixed(2)} (${k.count})</button>`).join('');
  // katmanlar
  const rows = state.mepStats.map((st) => ({ st, p: state.mepProfiles.get(st.l) }))
    .filter(({ st, p }) => p && ((p.kind && p.kind !== 'ignore') || p.unknown || (p.kind === 'ignore' && (p.wouldBe || /^M[-_ ]/.test(fold(st.name)) || state.mepOverrides[st.l]))));
  const rank = (r) => (r.p.unknown && !r.p.kind ? 0 : r.p.kind === 'ignore' ? 2 : 1);
  rows.sort((a, b) => rank(a) - rank(b) || b.st.count - a.st.count);
  const unknownN = rows.filter((r) => r.p.unknown && !r.p.kind).length;
  $('mepNote').textContent = `${rows.filter((r) => r.p.kind && r.p.kind !== 'ignore').length} tesisat katmanı kullanılıyor` + (unknownN ? `, ${unknownN} bilinmeyen katman var: yapay zekâ asistanına sorun veya elle seçin.` : '.') +
    (state.islands?.length > 1 ? ` Paftadaki ${state.islands.length - 1} ayrık çizim grubu (lejant, şema, detay, kalıntı) yok sayıldı.` : '') +
    (state.mep?.dropped?.coverage ? ` ${state.mep.dropped.coverage} sprinkler etki dairesi atlandı.` : '');
  $('mepLayers').innerHTML = rows.map(({ st, p }) => {
    const sys = SYSTEMS[p.system] || SYSTEMS.other;
    const base = p.elevRef === 'floor' ? 0 : state.ceiling.cm;
    const abs = Math.round(base + (p.elevOffsetCm || 0));
    const src = p.unknown && !p.kind ? 'unknown' : p.source || 'builtin';
    const cls = p.unknown && !p.kind ? 'unknown' : p.kind === 'ignore' ? 'ignored' : '';
    return `<div class="ml ${cls}" data-l="${st.l}">
      <div class="h"><i class="dot" style="background:${p.kind && p.kind !== 'ignore' ? sys.color : 'var(--line)'}"></i><span class="nm" title="${esc(st.name)}${p.note ? ' — ' + esc(p.note) : ''}">${esc(st.name)}</span><span class="ct">${st.count}</span><span class="badge ${src}">${SRC_LABEL[src] || src}</span></div>
      <div class="c"><select class="mk" aria-label="Tür">${kindOptions(p.kind)}</select>${p.kind && p.kind !== 'ignore' ? `<select class="ms" aria-label="Sistem">${sysOptions(p.system)}</select>` : ''}</div>
      ${p.kind && p.kind !== 'ignore' ? `<div class="c"><select class="mr" aria-label="Kot referansı"><option value="ceiling" ${p.elevRef !== 'floor' ? 'selected' : ''}>Tavandan</option><option value="floor" ${p.elevRef === 'floor' ? 'selected' : ''}>Döşemeden</option></select>
        <label>kot <input type="number" class="mz" value="${abs}" step="5" aria-label="Kot (cm)"></label>
        <label>${p.kind === 'pipe' ? 'çap' : p.kind === 'air' ? 'kanal yük.' : 'yük.'} <input type="number" class="msz" value="${p.sizeCm ?? ''}" step="0.5" aria-label="Ölçü (cm)"></label>
        <button class="btn small teach" title="Bu katmanın ayarını bilgi bankasına kural olarak kaydet">Öğret</button></div>` : `<div class="c hint">${esc(p.note || '')}${p.unknown && st.texts.length ? ' · yazılar: ' + esc(st.texts.slice(0, 3).join(', ')) : ''}</div>`}
    </div>`;
  }).join('') || '<div class="ml hint">Bölgede tesisat katmanı yok.</div>';
}

function readRow(row) {
  const l = +row.dataset.l;
  const cur = state.mepProfiles.get(l) || {};
  const kind = row.querySelector('.mk')?.value || null;
  const system = row.querySelector('.ms')?.value || cur.system || 'other';
  const elevRef = row.querySelector('.mr')?.value || cur.elevRef || 'ceiling';
  const mz = row.querySelector('.mz');
  const base = elevRef === 'floor' ? 0 : state.ceiling.cm;
  const elevOffsetCm = mz ? parseFloat(mz.value) - base : cur.elevOffsetCm || 0;
  const sz = parseFloat(row.querySelector('.msz')?.value);
  return { l, kind, system, elevRef, elevOffsetCm: Number.isFinite(elevOffsetCm) ? elevOffsetCm : 0, sizeCm: Number.isFinite(sz) && sz > 0 ? sz : cur.sizeCm };
}

$('mepLayers').addEventListener('change', (e) => {
  const row = e.target.closest('.ml[data-l]');
  if (!row) return;
  const r = readRow(row);
  // tür değişince varsayılan kot/ölçüyü bilgi bankasındaki benzer kuraldan al
  if (e.target.classList.contains('mk') && r.kind && r.kind !== 'ignore' && !row.querySelector('.mr')) {
    Object.assign(r, { system: 'other', elevRef: r.kind === 'equipment' ? 'floor' : 'ceiling', elevOffsetCm: r.kind === 'pipe' ? -20 : 0, sizeCm: r.kind === 'pipe' ? 2.5 : 30 });
  }
  state.mepOverrides[r.l] = { kind: r.kind, system: r.system, elevRef: r.elevRef, elevOffsetCm: r.elevOffsetCm, sizeCm: r.sizeCm, source: 'user', unknown: false };
  runMep();
});
$('mepLayers').addEventListener('click', (e) => {
  if (!e.target.classList.contains('teach')) return;
  const row = e.target.closest('.ml[data-l]');
  const r = readRow(row);
  const name = state.drawing.layers[r.l].name;
  const base = name.includes('$0$') ? name.slice(name.lastIndexOf('$0$') + 3) : name;
  state.kb.addRule({ pattern: '^' + reEsc(fold(base)) + '$', kind: r.kind, system: r.system, elevRef: r.elevRef, elevOffsetCm: r.elevOffsetCm, sizeCm: r.sizeCm, note: 'Kullanıcı öğretti: ' + base }, 'user');
  state.kb.save();
  renderKb();
  e.target.textContent = 'Öğrenildi';
  e.target.disabled = true;
});
$('sysChips').addEventListener('change', (e) => {
  const k = e.target.dataset.sys;
  if (!k) return;
  if (e.target.checked) state.systemsOff.delete(k); else state.systemsOff.add(k);
  e.target.closest('.syschip').classList.toggle('off', !e.target.checked);
  plan.setMep(state.mep, state.mepProfiles, { visible: state.mepVisible, systems: visibleSystems() });
  state.view3d?.setVisibility({ arch: state.archVisible, systems: visibleSystems() });
});
$('mepOn').onchange = () => setMepVisible($('mepOn').checked);
$('archOn').onchange = () => setArchVisible($('archOn').checked);
function setCeiling(cm, source, text = '') {
  if (!(cm >= 150 && cm <= 2000)) return;
  state.ceiling = { cm: Math.round(cm), source, text };
  renderMepPanel();
  renderTodo();
  rebuild3d();
}
$('ceilCm').onchange = () => setCeiling(parseFloat($('ceilCm').value), 'user');
$('ceilCands').addEventListener('click', (e) => { const v = +e.target.dataset.cm; if (v) setCeiling(v, 'user'); });

// Projede kot yoksa kullanıcıya sor
function askCeiling() {
  if (!state.showLegacy) return; // sade arayüz: kot sorusu yok, Claude ya da sohbet belirler
  state.ceilingAsked = true;
  const c = state.elevations?.candidates || [];
  $('ceilDlgCm').value = state.ceiling.cm;
  $('ceilDlgCandHint').hidden = !c.length;
  $('ceilDlgCands').innerHTML = c.map((k) => `<button data-cm="${k.cm}" title="Çizimde ${k.count} kez geçiyor">+${(k.cm / 100).toFixed(2)} (${k.count})</button>`).join('');
  $('ceilDlg').hidden = false;
}
$('ceilDlgCands').addEventListener('click', (e) => { const v = +e.target.dataset.cm; if (v) $('ceilDlgCm').value = v; });
$('ceilDlgOk').onclick = () => { $('ceilDlg').hidden = true; setCeiling(parseFloat($('ceilDlgCm').value), 'user'); };
$('ceilDlgLater').onclick = () => { $('ceilDlg').hidden = true; };

// Seçili tesisat elemanı
function renderMepSel(box, el) {
  const p = state.mepProfiles.get(el.l) || {};
  const sys = SYSTEMS[p.system] || SYSTEMS.other;
  const name = state.drawing.layers[el.l].name;
  const type = el.id[0] === 'P' ? 'Boru' : el.id[0] === 'D' ? 'Kanal' : p.kind === 'air' ? 'Menfez' : p.kind === 'terminal' ? 'Uç birim' : 'Cihaz';
  const size = el.id[0] === 'P' ? `Ø${Math.round((el.diaSrc === 'label' ? el.diaCm : p.sizeCm || 2.5) * 10)} mm (${el.diaSrc === 'label' ? 'çizimdeki "' + esc(el.diaText) + '" yazısından' : 'katman varsayılanı'}) · ${(el.lengthCm / 100).toFixed(2)} m`
    : el.id[0] === 'D' ? `${Math.round(el.widthCm)} cm genişlik${el.sizeText ? ' · "' + esc(el.sizeText) + '"' : ''}` : esc(el.name || '');
  box.innerHTML = `<div class="sel"><div class="row"><b>${type} ${el.id}</b><span class="hint">${esc(sys.label)}</span></div>
    <span class="hint">Katman: ${esc(name)}<br>${size}</span>
    <div class="row"><select id="selSys" aria-label="Sistem">${sysOptions(p.system)}</select><button class="btn small" id="selIgnore">Bu katmanı yok say</button></div>
    <p class="hint">Sistem ve yok sayma bütün katmana uygulanır; kot ve ölçü için Mekanik tesisat listesini kullanın.</p></div>`;
  $('selSys').onchange = () => { state.mepOverrides[el.l] = { ...p, system: $('selSys').value, source: 'user', unknown: false }; runMep(); renderSel(); };
  $('selIgnore').onclick = () => { state.mepOverrides[el.l] = { ...p, kind: 'ignore', source: 'user', unknown: false }; select(null); runMep(); };
}

// ------------------------------------------------------------ bilgi bankası
function renderKb() {
  const st = state.kb.stats();
  $('kbStats').textContent = `${st.builtin} yerleşik kural · ${st.learned} öğrenilmiş kural · ${st.ignore} öğrenilmiş temizlik kuralı`;
  const items = [
    ...state.kb.learned.map((r) => `${esc(r.pattern)} → ${esc(KINDS[r.kind] || r.kind)}${r.kind !== 'ignore' ? ' / ' + esc(SYSTEMS[r.system]?.label || r.system) : ''} <i>(${r.source === 'user' ? 'kullanıcı' : 'YZ'})</i>`),
    ...state.kb.ignore.map((r) => `${esc(r.pattern)} → yok say: ${esc(r.reason)} <i>(${r.source === 'user' ? 'kullanıcı' : 'YZ'})</i>`),
  ];
  $('kbList').innerHTML = items.slice(0, 40).map((t) => `<li>${t}</li>`).join('') || '<li>Henüz öğrenilmiş kural yok. Yapay zekâ asistanı veya "Öğret" düğmesiyle eklenir.</li>';
}
renderKb();
$('btnKbExport').onclick = async () => {
  const data = JSON.stringify(state.kb.toJSON(), null, 2);
  const dl = await capDownloads;
  try {
    if (dl) await dl.save({ filename: 'dwg2bim-bilgi-bankasi.json', data });
    else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
      a.download = 'dwg2bim-bilgi-bankasi.json';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    }
    aiStatus('Bilgi bankası dışa aktarıldı.', 'ok');
  } catch (e) { if (e?.code !== 'declined') aiStatus('Dışa aktarılamadı: ' + (e?.message || e?.code), 'err'); }
};
$('kbInput').onchange = async () => {
  const f = $('kbInput').files[0];
  $('kbInput').value = '';
  if (!f) return;
  try {
    const n = state.kb.importJSON(JSON.parse(await f.text()));
    renderKb();
    if (state.drawing) runMep();
    aiStatus(`${n} kural içe aktarıldı.`, 'ok');
  } catch (e) { aiStatus('İçe aktarılamadı: ' + e.message, 'err'); }
};
let kbResetArmed = false;
$('btnKbReset').onclick = () => {
  if (!kbResetArmed) { kbResetArmed = true; $('btnKbReset').textContent = 'Emin misiniz? Tekrar basın'; setTimeout(() => { kbResetArmed = false; $('btnKbReset').textContent = 'Öğrenilenleri sil'; }, 4000); return; }
  kbResetArmed = false;
  $('btnKbReset').textContent = 'Öğrenilenleri sil';
  state.kb.reset();
  renderKb();
  if (state.drawing) runMep();
  aiStatus('Öğrenilmiş kurallar silindi; yerleşik kurallar duruyor.', 'ok');
};

// ------------------------------------------------------------ yapay zekâ analiz raporu
function renderReport() {
  const box = $('aiReport');
  const diag = state.drawing ? diagnose(state) : [];
  const r = state.aiReport;
  let html = '';
  if (r) {
    html += `<div class="report"><b>Yapay zekâ analizi</b>${r.report ? `<p>${esc(r.report)}</p>` : ''}${r.issues.length ? '<ul>' + r.issues.map((x) => `<li class="sev-${esc(x.severity)}"><b>${esc(x.title)}</b>${x.detail ? ' — ' + esc(x.detail) : ''} <i>${x.fixed ? 'düzeltildi' : 'sizde'}</i></li>`).join('') + '</ul>' : ''}</div>`;
  }
  if (diag.length) html += `<details class="fold" ${r ? '' : 'open'}><summary>Programın tespitleri (${diag.length})</summary><ul class="diag">${diag.map((x) => `<li class="sev-${x.severity}"><i>${SEV_LABEL[x.severity]}</i> ${esc(x.text)}</li>`).join('')}</ul></details>`;
  box.innerHTML = html;
}

// ------------------------------------------------------------ yan panel sekmeleri
function showPanel(id) {
  for (const b of document.querySelectorAll('.stab')) { const on = b.dataset.panel === id; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); }
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== id;
  document.querySelector('aside').scrollTop = 0;
}
for (const b of document.querySelectorAll('.stab')) b.onclick = () => showPanel(b.dataset.panel);

// ------------------------------------------------------------ yapılacaklar
function renderTodo() {
  const items = [];
  const d = state.drawing;
  if (!d) items.push(['info', 'Bir DWG veya DXF dosyası açın.']);
  else {
    const diag = diagnose(state);
    const open = diag.filter((x) => x.severity !== 'low').length;
    if (diag.length && !state.aiReport) items.push(['warn', `Programın emin olmadığı ${diag.length} nokta var${open ? ` (${open} önemli/orta)` : ''}. Yapay zekâya bütün projeyi analiz ettirin.`, 'Analiz ettir', () => { showPanel('pAi'); $('btnPrompt').click(); }]);
    for (const it of (state.aiReport?.issues || []).filter((x) => !x.fixed).slice(0, 5)) items.push([it.severity === 'low' ? 'info' : 'warn', `YZ: ${it.title}${it.detail ? ' — ' + it.detail : ''}`]);
    const unknown = state.mepStats.filter((st) => { const p = state.mepProfiles.get(st.l); return p?.unknown && !p.kind; }).length;
    if (!state.model?.walls.length && !mepCount()) items.push(['warn', 'Duvar veya tesisat bulunamadı. Duvar katmanını seçin.', 'Katmanlar', () => { showPanel('pArch'); $('onlyAssigned').checked = false; applyLayerFilter(); }]);
    if (mepCount() && state.ceiling.source === 'default') items.push(['warn', 'Asma tavan kotu projede yok; tesisat 280 cm varsayımıyla duruyor.', 'Kotu gir', () => askCeiling()]);
    if (unknown) items.push(['warn', `${unknown} tesisat katmanı tanınmadı.`, 'Asistana sor', () => showPanel('pAi')]);
    if (state.unitNote) items.push(['info', state.unitNote]);
    const ext = state.model?.openings.filter((o) => o.exterior && (state.overrides[o.id]?.kind || o.kind) === 'window').length || 0;
    if (ext && !state.model.openings.some((o) => o.exterior && (state.overrides[o.id]?.kind || o.kind) === 'door')) items.push(['info', 'Dış cephedeki boşlukların hepsi pencere sayıldı. Giriş kapılarını planda tıklayıp "Kapı" yapın.']);
    if (state.islands?.length > 1) items.push(['ok', `Paftadaki ${state.islands.length - 1} ilgisiz çizim grubu (lejant, şema, detay, kalıntı) ayıklandı.`]);
    if (state.model?.walls.length || mepCount()) items.push(['ok', 'Model hazır; IFC olarak indirebilirsiniz.', 'IFC indir', () => exportIfc()]);
  }
  const ul = $('todo');
  ul.innerHTML = items.map(([k, t, b], i) => `<li class="t-${k}"><span>${esc(t)}</span>${b ? `<button class="btn small" data-i="${i}">${esc(b)}</button>` : ''}</li>`).join('');
  ul.querySelectorAll('button[data-i]').forEach((btn) => (btn.onclick = items[+btn.dataset.i][3]));
  // tesisat sekmesinde dikkat noktası
  $('mepDot').hidden = !items.some((x) => x[0] === 'warn' && /tesisat|kot/i.test(x[1]));
  // özet: sistem başına tesisat miktarı
  const sum = mepSummary();
  $('mepSum').innerHTML = [...sum.entries()].map(([k, v]) => `<span><i class="dot" style="background:${(SYSTEMS[k] || SYSTEMS.other).color}"></i>${esc((SYSTEMS[k] || SYSTEMS.other).label)} ${v.pipeM ? v.pipeM.toFixed(0) + ' m' : ''}${v.pipeM && v.n ? ' · ' : ''}${v.n ? v.n + ' ad.' : ''}</span>`).join('');
}

// Üst çubuktaki Mimari / Tesisat düğmeleri, Tesisat sekmesindeki kutularla eş
function setArchVisible(v) {
  state.archVisible = v;
  $('archOn').checked = v;
  $('tglArch').classList.toggle('on', v);
  plan.archVisible = v;
  plan.draw();
  state.view3d?.setVisibility({ arch: v, systems: visibleSystems() });
}
function setMepVisible(v) {
  state.mepVisible = v;
  $('mepOn').checked = v;
  $('tglMep').classList.toggle('on', v);
  plan.setMep(state.mep, state.mepProfiles, { visible: v, systems: visibleSystems() });
  rebuild3d();
}
$('tglArch').onclick = () => setArchVisible(!state.archVisible);
$('tglMep').onclick = () => setMepVisible(!state.mepVisible);

// ------------------------------------------------------------ görünüm düğmeleri
$('btnFit').onclick = () => plan.fitModel();
$('btnFitAll').onclick = () => plan.fit(state.drawing?.bbox);
$('btnDim').onclick = () => { plan.dimDrawing = !plan.dimDrawing; $('btnDim').classList.toggle('on', plan.dimDrawing); plan.draw(); };
$('btnTexts').onclick = () => { plan.showTexts = !plan.showTexts; $('btnTexts').classList.toggle('on', plan.showTexts); plan.draw(); };
$('btnFrame3d').onclick = () => state.view3d?.frame();
$('btnSpaces').onclick = () => { const v = !state.view3d?.showSpaces; state.view3d?.setShowSpaces(v); $('btnSpaces').classList.toggle('on', v); };
$('btnRoof').onclick = () => { const v = !state.view3d?.showRoof; state.view3d?.setShowRoof(v); $('btnRoof').classList.toggle('on', v); };

// ------------------------------------------------------------ dışa aktarma
const capDownloads = window.claude?.use ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
const capSample = window.claude?.use ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);

function baseName() {
  if (!state.build.projectName && state.isSample) return 'DWG2BIM_demo';
  return (state.build.projectName || state.fileName.replace(/^ÖRNEK · /, '').replace(/\.(dwg|dxf)$/i, '') || 'model')
    .normalize('NFKD').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'model';
}

async function exportIfc() {
  if (!state.model) return;
  const name = baseName();
  const ifc = writeIfc(buildAll(), { fileName: name + '.ifc' });
  const dl = await capDownloads;
  try {
    if (dl) {
      const zip = makeZip([{ name: name + '.ifc', data: ifc }]);
      await dl.save({ filename: name + '.zip', data: zip });
      status('İndirildi: ' + name + '.zip (içinde ' + name + '.ifc)', 'ok');
    } else {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([ifc], { type: 'application/x-step' }));
      a.download = name + '.ifc';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      status('İndirildi: ' + name + '.ifc', 'ok');
    }
  } catch (e) {
    if (e?.code === 'declined') status('İndirme iptal edildi.');
    else status('İndirilemedi: ' + (e?.message || e?.code || e), 'err');
  }
}
$('btnExport').onclick = exportIfc;
$('btnExportTop').onclick = exportIfc;

// ------------------------------------------------------------ yapay zekâ asistanı
const aiStatus = (m, k) => setStatus($('aiStatus'), m, k);
function currentPrompt() {
  // tefriş özeti komuta eklenir (fixtures)
  return buildPrompt({
    drawing: state.drawing, roles: state.roles, params: state.params, buildParams: state.build, model: state.model, fileName: state.fileName,
    mepStats: state.mepStats, mepProfiles: state.mepProfiles, elevations: state.elevations, ceiling: state.ceiling, islands: state.islands,
    diagnostics: diagnose(state), mep: state.mep, fixtures: liveFixtures(),
  });
}
$('btnPrompt').onclick = () => {
  if (!state.drawing) return;
  const t = $('promptOut');
  t.value = currentPrompt();
  $('btnCopy').disabled = false;
  navigator.clipboard.writeText(t.value).then(
    () => aiStatus(`Komut kopyalandı (${t.value.length.toLocaleString('tr')} karakter). Şimdi bir yapay zekâ sohbetine yapıştırın, cevabı aşağıdaki kutuya yapıştırın.`, 'ok'),
    () => { t.closest('details').open = true; t.focus(); t.select(); aiStatus('Otomatik kopyalanamadı; komut seçildi, Ctrl+C ile kopyalayın.'); },
  );
};
$('btnCopy').onclick = () => {
  const t = $('promptOut');
  navigator.clipboard.writeText(t.value).then(
    () => aiStatus('Kopyalandı.', 'ok'),
    () => { t.focus(); t.select(); aiStatus('Otomatik kopyalanamadı; metin seçildi, Ctrl+C ile kopyalayın.'); },
  );
};
$('answerIn').oninput = () => ($('btnApply').disabled = !$('answerIn').value.trim() || !state.drawing);
// Cevap yapıştırılınca kendiliğinden uygula
$('answerIn').addEventListener('paste', () => setTimeout(() => {
  $('answerIn').oninput();
  if (state.drawing && /\{[\s\S]*\}/.test($('answerIn').value)) applyAnswer();
}, 0));
// ------------------------------------------------------------ işaretler ve eskizler
function roomAt(x, y) { return state.model?.rooms.find((r) => !state.overrides[r.id]?.deleted && pointInPoly(x, y, r.poly)) || null; }
function addMark(m) {
  const id = 'M' + (state.marks.length + 1);
  const mk = { id, ...m };
  state.marks.push(mk);
  plan.marks = state.marks; plan.draw();
  renderMarkHint();
  const c = m.type === 'rect' ? [(m.bbox[0] + m.bbox[2]) / 2, (m.bbox[1] + m.bbox[3]) / 2] : [m.x, m.y];
  const r = roomAt(c[0], c[1]);
  const inp = $('chatIn');
  inp.value = (inp.value ? inp.value.trimEnd() + ' ' : '') + `[${id}${r ? ' · ' + (state.overrides[r.id]?.name ?? r.name ?? r.id) : ''}] `;
  inp.focus();
  ['btnMarkPoint', 'btnMarkRect'].forEach((b) => $(b).classList.remove('on'));
}
function renderMarkHint() {
  $('btnMarkClear').hidden = !state.marks.length;
  $('markHint').textContent = state.marks.length ? state.marks.map((m) => `${m.id}: ${m.type === 'rect' ? 'alan' : 'nokta'}${(() => { const c = m.type === 'rect' ? [(m.bbox[0] + m.bbox[2]) / 2, (m.bbox[1] + m.bbox[3]) / 2] : [m.x, m.y]; const r = roomAt(c[0], c[1]); return r ? ' · ' + (state.overrides[r.id]?.name ?? r.name ?? r.id) : ''; })()}`).join(' · ') : '';
}
$('btnMarkPoint').onclick = () => { showTab('plan'); plan.markMode = plan.markMode === 'point' ? null : 'point'; plan.regionMode = false; $('btnMarkPoint').classList.toggle('on', plan.markMode === 'point'); $('btnMarkRect').classList.remove('on'); status(plan.markMode ? 'Planda bir noktaya tıklayın; işaret sohbete eklenir.' : ''); };
$('btnMarkRect').onclick = () => { showTab('plan'); plan.markMode = plan.markMode === 'rect' ? null : 'rect'; plan.regionMode = false; $('btnMarkRect').classList.toggle('on', plan.markMode === 'rect'); $('btnMarkPoint').classList.remove('on'); status(plan.markMode ? 'Planda sürükleyerek bir alan seçin; işaret sohbete eklenir.' : ''); };
$('btnMarkClear').onclick = () => { state.marks = []; plan.marks = []; plan.draw(); renderMarkHint(); };
const SYS_COLOR = (sys) => (SYSTEMS[sys] || null)?.color;
function addSketches(list, { layer, system, widthCm, label }) {
  const n0 = state.sketches.length;
  const color = SYS_COLOR(system) || '#c2185b';
  const added = list.map((e, i) => ({ ...e, id: 'S' + (n0 + i + 1), layer: e.layer || layer || 'ESKIZ', system: system || null, color, width: widthCm ? widthCm / state.model.unitScale : 0, label: label || '' }));
  state.sketches.push(...added);
  plan.sketches = state.sketches; plan.draw();
  rebuild3d();
  return added;
}
// Eskiz geometrisini metre cinsinden 3B boru yoluna çevirir (system verilmişse)
function sketchSolids(origin, scale) {
  const out = [];
  const tr = (p) => [(p[0] - origin[0]) * scale, (p[1] - origin[1]) * scale];
  for (const e of state.sketches) {
    if (!e.system || e.hidden) continue;
    const z = 0.03;
    const r = Math.max((e.width || 0) * scale / 2, 0.008);
    if (e.type === 'polyline') out.push({ type: 'pipe', id: e.id, src: e.id, system: e.system, name: e.label || e.layer, path: e.pts.map((p) => [...tr(p), z]), r, props: { layer: e.layer, lengthM: 0 } });
    else if (e.type === 'line') out.push({ type: 'pipe', id: e.id, src: e.id, system: e.system, name: e.label || e.layer, path: [[...tr([e.pts[0], e.pts[1]]), z], [...tr([e.pts[2], e.pts[3]]), z]], r, props: { layer: e.layer } });
  }
  return out;
}

// ------------------------------------------------------------ Claude ajan modu (abonelik, anahtarsız)
// Sayfanın araçlara açtığı fonksiyonlar: küçük düz metin / veri döndürür
const fmtRoom = (r) => `${r.id}\t${(Math.abs(r.area) * state.model.unitScale ** 2 / 1e4).toFixed(1)} m²\t${state.overrides[r.id]?.name ?? r.name ?? ''}`;
const agentApi = {
  snapshot: () => buildSnapshot({
    drawing: state.drawing, roles: state.roles, params: state.params, buildParams: state.build, model: state.model, fileName: state.fileName,
    mepStats: state.mepStats, mepProfiles: state.mepProfiles, elevations: state.elevations, ceiling: state.ceiling, islands: state.islands,
    diagnostics: diagnose(state), mep: state.mep, fixtures: liveFixtures(),
  }),
  listLayers: (filter) => {
    const f = filter.toLocaleLowerCase('tr');
    const rows = state.drawing.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.count && (!f || l.name.toLocaleLowerCase('tr').includes(f)))
      .sort((a, b) => b.l.count - a.l.count).slice(0, 200)
      .map(({ l, i }) => { const p = state.mepProfiles.get(i); return `${l.name}\t${l.count}\t${roleOf(i) || '-'}\t${p?.kind ? `${p.kind}/${p.system}${p.unknown ? ' (BİLİNMİYOR)' : ''}` : ''}`; });
    return 'ad\tnesne\trol\ttesisat profili\n' + (rows.join('\n') || '(yok)');
  },
  listOpenings: (kind) => {
    const m = state.model;
    const rows = m.openings.filter((o) => !state.overrides[o.id]?.deleted && (!kind || effKind(o) === kind)).map((o) => {
      const ov = state.overrides[o.id];
      return `${o.id}\t${effKind(o)}\t${cm(o.width)} cm\t${o.exterior ? 'dış' : 'iç'}\t${o.why || ''}${ov?.kind && ov.kind !== o.kind ? `\t(değiştirildi: ${o.kind} → ${ov.kind})` : ''}`;
    });
    return 'id\ttür\tgenişlik\tkonum\tgerekçe\n' + (rows.join('\n') || '(yok)');
  },
  listRooms: () => {
    const fx = liveFixtures();
    return 'id\talan\tad\ttefriş\n' + state.model.rooms.filter((r) => !state.overrides[r.id]?.deleted).map((r) => {
      const inside = fx.filter((f) => !state.overrides[f.id]?.deleted && pointInPoly(f.center[0], f.center[1], r.poly)).map((f) => f.label);
      return fmtRoom(r) + '\t' + [...new Set(inside)].join(', ');
    }).join('\n');
  },
  listWalls: () => {
    const m = state.model, s = m.unitScale;
    const bb = (poly) => { let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; for (const [x, y] of poly) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); } return `[${a.toFixed(0)}, ${b.toFixed(0)}, ${c.toFixed(0)}, ${d.toFixed(0)}]`; };
    const rows = [
      ...m.walls.map((w) => `${w.id}\tduvar\t${Math.round(w.thickness * s)} cm\t${((w.length || 0) * s / 100).toFixed(2)} m\t${w.exterior ? 'dış' : 'iç'}\t${bb(w.poly)}`),
      ...m.columns.map((c) => `${c.id}\tkolon\t\t\t\t${bb(c.poly)}`),
      ...(m.curtains || []).map((g) => `${g.id}\tcam cephe\t${Math.round(g.thickness * s)} cm\t${(g.length * s / 100).toFixed(2)} m\t\t${bb(g.poly)}`),
    ].filter((r) => !state.overrides[r.split('\t')[0]]?.deleted);
    return `çizim birimi: ${UNIT_NAMES[state.units] || state.units} (1 birim = ${s} cm); elle çizilen duvar: ${state.manualWalls?.length || 0}\nid\ttür\tkalınlık\tuzunluk\tkonum\tsınır kutusu [x1,y1,x2,y2]\n` + rows.slice(0, 400).join('\n');
  },
  listFixtures: () => {
    const rooms = state.model.rooms;
    return 'id\ttür\tölçü\tkaynak\tmahal\n' + (liveFixtures().filter((f) => !state.overrides[f.id]?.deleted).map((f) => {
      const r = rooms.find((r) => pointInPoly(f.center[0], f.center[1], r.poly));
      return `${f.id}\t${f.kind} (${f.label})\t${Math.round(f.wCm)}×${Math.round(f.hCm)} cm\t${f.source === 'block' ? 'blok: ' + f.name : 'küme: ' + f.name}\t${r ? r.id + ' ' + (state.overrides[r.id]?.name ?? r.name ?? '') : '-'}`;
    }).join('\n') || '(tefriş bulunamadı)') + `\nyok sayılan süs çizimi: ${state.decorIgnored}`;
  },
  listMep: () => {
    const rows = state.mepStats.map((st) => ({ st, p: state.mepProfiles.get(st.l) || {} }))
      .filter(({ st, p }) => (p.kind && p.kind !== 'ignore') || p.unknown || st.count >= 100)
      .sort((a, b) => (a.p.unknown ? 0 : 1) - (b.p.unknown ? 0 : 1) || b.st.count - a.st.count).slice(0, 80)
      .map(({ st, p }) => `${st.name}\t${st.count} nesne (açık ${st.open}, kapalı ${st.closed}), ${st.lengthM} m, tipik ${st.typicalCm} cm\t→ ${p.unknown && !p.kind ? 'BİLİNMİYOR' : `${p.kind}/${p.system}/${p.elevRef}${p.elevOffsetCm >= 0 ? '+' : ''}${p.elevOffsetCm ?? 0}cm/${p.sizeCm ?? '-'}cm [${p.source}]`}${st.blocks?.length ? '\tbloklar: ' + st.blocks.join(', ') : ''}`);
    const sum = mepSummary();
    return `çıkarılan: ${state.mep?.pipes.length || 0} boru, ${state.mep?.ducts.length || 0} kanal, ${state.mep?.boxes.length || 0} cihaz/uç birim; asma tavan ${state.ceiling.cm} cm (${state.ceiling.source})\nsistemler: ${[...sum.entries()].map(([k, v]) => `${(SYSTEMS[k] || SYSTEMS.other).label}${v.pipeM ? ' ' + v.pipeM.toFixed(0) + ' m' : ''}${v.n ? ' ' + v.n + ' ad.' : ''}`).join(', ') || '-'}\nkatman\tiçerik\tprofil\n` + (rows.join('\n') || '(tesisat katmanı yok)');
  },
  listTexts: (filter, layer) => {
    const d = state.drawing, f = filter.toLocaleLowerCase('tr'), lf = layer.toLocaleLowerCase('tr');
    const inR = (t) => !state.autoRegion || state.region || (t.x >= (state.autoRegion[0]) && t.x <= state.autoRegion[2] && t.y >= state.autoRegion[1] && t.y <= state.autoRegion[3]);
    const rows = d.texts.filter((t) => t.s && (!f || t.s.toLocaleLowerCase('tr').includes(f)) && (!lf || (d.layers[t.l]?.name || '').toLocaleLowerCase('tr').includes(lf)))
      .sort((a, b) => Number(inR(b)) - Number(inR(a)) || b.h - a.h).slice(0, 200)
      .map((t) => `${t.s.slice(0, 80)}\t${d.layers[t.l]?.name || ''}\t(${t.x.toFixed(0)}, ${t.y.toFixed(0)})${inR(t) ? '' : '\t[plan bölgesi dışında]'}`);
    return `toplam ${d.texts.length} yazı; gösterilen ${rows.length}\nyazı\tkatman\tkonum\n` + (rows.join('\n') || '(yok)');
  },
  listBlocks: (filter) => {
    const d = state.drawing, f = filter.toLocaleLowerCase('tr');
    const cnt = new Map();
    for (const it of d.instances || []) { const n = it.name.replace(/^.*\$0\$/, ''); if (!f || n.toLocaleLowerCase('tr').includes(f)) cnt.set(n, (cnt.get(n) || 0) + 1); }
    const rows = [...cnt].sort((a, b) => b[1] - a[1]).slice(0, 150).map(([n, c]) => `${n}\t${c}`);
    return 'blok adı\tadet\n' + (rows.join('\n') || '(blok yok)');
  },
  diagnostics: () => diagnose(state).map((x, i) => `${i + 1}. [${x.severity}] ${x.text}${x.data?.length && x.data.length <= 40 ? ' (' + x.data.join(', ') + ')' : ''}`).join('\n') || 'Belirgin sorun yok.',
  apply: (changes) => applyAnswer(changes),
  deleteElements: (ids) => {
    const ok = [], bad = [];
    for (const id of ids) {
      const sk = state.sketches.find((e) => e.id === id);
      if (sk) { sk.hidden = true; ok.push(id); plan.draw(); continue; }
      if (findById(state.model, id) || state.fixtures.some((f) => f.id === id)) { state.overrides[id] = { ...(state.overrides[id] || {}), deleted: true }; ok.push(id); } else bad.push(id);
    }
    plan.setModel(state.model, state.overrides); plan.setFixtures(liveFixtures()); renderStats(); renderTodo(); rebuild3d(); renderSel();
    return `kaldırıldı: ${ok.join(', ') || '-'}${bad.length ? '; bulunamadı: ' + bad.join(', ') : ''}`;
  },
  setFixture: (id, kind) => {
    if (!state.fixtures.some((f) => f.id === id)) throw new Error(id + ' bulunamadı');
    if (!FIXTURE_KINDS[kind]) throw new Error('bilinmeyen tür: ' + kind);
    setOv(id, { kind }); plan.setFixtures(liveFixtures());
    return `${id} → ${FIXTURE_KINDS[kind].label}`;
  },
  addWall: (x1, y1, x2, y2, tCm) => {
    if (![x1, y1, x2, y2].every(Number.isFinite)) throw new Error('koordinatlar sayı olmalı');
    const before = state.model.rooms.length;
    $('manualWallCm').value = String(tCm);
    addManualWall([x1, y1], [x2, y2]);
    return `duvar eklendi; mahal sayısı ${before} → ${state.model.rooms.length}`;
  },
  setParts: (ids) => {
    const list = partStats().map((i) => `${i.id}\t${i.label || 'Bölüm ' + i.id}\t${i._type}\t${Math.round((i.bbox[2] - i.bbox[0]) * (UNIT_TO_CM[state.units] ?? 1) / 100)}×${Math.round((i.bbox[3] - i.bbox[1]) * (UNIT_TO_CM[state.units] ?? 1) / 100)} m\t${i.n} nesne\tduvar çizgisi ${i._w}, tesisat ${i._m}, kot yazısı ${i._kot}${i._similar.length ? '\tbenzer boyut: ' + i._similar.join(',') + ' (aynı alanın başka çizimi olabilir → overlay_parts)' : ''}${state.parts?.includes(i.id) || state.planIsland?.id === i.id ? '\t(seçili)' : ''}`);
    if (ids && ids.length) {
      const valid = ids.map(Number).filter((id) => state.islands.some((i) => i.id === id));
      if (!valid.length) throw new Error('geçerli bölüm kimliği yok');
      state.parts = valid; processParts(valid);
      return `${valid.length} bölüm işleniyor: ${valid.join(', ')} (algılama yenilendi; listeleri tekrar oku)`;
    }
    return 'id\tad\ttür tahmini\tboyut\tnesne\tiçerik\n' + (list.join('\n') || '(tek bölüm)');
  },
  readPart: (id) => {
    const d = state.drawing;
    const isl = partStats().find((i) => i.id === Number(id));
    if (!isl) throw new Error('bölüm bulunamadı: ' + id);
    const inB = (x, y) => x >= isl.bbox[0] && x <= isl.bbox[2] && y >= isl.bbox[1] && y <= isl.bbox[3];
    const texts = d.texts.filter((t) => inB(t.x, t.y));
    const kots = [...new Set(texts.map((t) => t.s.trim().match(/^([+±-])\s?(\d{1,2})[.,](\d{2})\b/)).filter(Boolean).map((m) => (m[1] === '-' ? -1 : 1) * (+m[2] + +m[3] / 100)))].sort((a, b) => a - b);
    const diffs = []; for (let i = 1; i < kots.length; i++) diffs.push(`${kots[i - 1].toFixed(2)}→${kots[i].toFixed(2)} = ${Math.round((kots[i] - kots[i - 1]) * 100)} cm`);
    const nums = texts.map((t) => t.s.trim()).filter((x) => /^\d{2,4}$/.test(x)).map(Number).filter((v) => v >= 20 && v <= 600);
    const numFreq = [...nums.reduce((m, v) => m.set(v, (m.get(v) || 0) + 1), new Map())].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([v, c]) => `${v}(${c})`);
    const layers = new Map();
    for (const p of d.prims) if (inB(p.pts[0], p.pts[1])) layers.set(p.l, (layers.get(p.l) || 0) + 1);
    const lrows = [...layers].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([l, c]) => `${d.layers[l].name} ${c}`);
    const words = [...new Set(texts.filter((t) => /\p{L}{3}/u.test(t.s)).sort((a, b) => b.h - a.h).map((t) => t.s.trim().slice(0, 50)))].slice(0, 60);
    const toCm = UNIT_TO_CM[state.units] ?? 1;
    return `BÖLÜM ${isl.id}: ${isl.label || '-'} · tür tahmini: ${isl._type} · ${Math.round((isl.bbox[2] - isl.bbox[0]) * toCm / 100)}×${Math.round((isl.bbox[3] - isl.bbox[1]) * toCm / 100)} m · ${isl.n} nesne · duvar çizgisi ${isl._w}, tesisat ${isl._m}
Kot yazıları (m): ${kots.map((v) => v.toFixed(2)).join(', ') || '-'}
Kot farkları: ${diffs.join('; ') || '-'}   (kesit/görünüşte kat yüksekliği, parapet, kapı/pencere üstü buradan okunur)
Sık geçen sayılar (ölçü yazıları, cm?): ${numFreq.join(' ') || '-'}
Yazılar: ${words.join(' | ') || '-'}
Katmanlar: ${lrows.join(', ')}
Benzer boyutlu bölümler: ${isl._similar.join(', ') || '-'}`;
  },
  overlayParts: (base, others) => {
    const res = [];
    for (const o of others) { const r = overlayIsland(Number(base), Number(o)); res.push(`${o} → ${base}: ${r.n} nesne kaydırıldı (dx ${r.dx.toFixed(1)}, dy ${r.dy.toFixed(1)})`); }
    state.parts = [Number(base)];
    processParts(state.parts);
    return res.join('\n') + '\n(bölüm ' + base + ' yeniden işleniyor; listeleri tekrar oku. Tesisat/tavan/tefriş çizimi artık plana bindirildi.)';
  },
  exportIfc: async () => { await exportIfc(); return $('status').textContent || 'IFC hazırlandı'; },
  marks: (clear) => {
    if (clear) { state.marks = []; plan.marks = []; plan.draw(); renderMarkHint(); return 'işaretler temizlendi'; }
    if (!state.marks.length) return 'işaret yok (kullanıcı 📍 Nokta / ▭ Alan düğmeleriyle koyar)';
    return 'id\ttür\tkonum (çizim koordinatı)\tmahal\n' + state.marks.map((m) => { const c = m.type === 'rect' ? [(m.bbox[0] + m.bbox[2]) / 2, (m.bbox[1] + m.bbox[3]) / 2] : [m.x, m.y]; const r = roomAt(c[0], c[1]); return `${m.id}\t${m.type === 'rect' ? 'alan' : 'nokta'}\t${m.type === 'rect' ? '[' + m.bbox.map((v) => v.toFixed(0)).join(', ') + ']' : '(' + m.x.toFixed(0) + ', ' + m.y.toFixed(0) + ')'}\t${r ? r.id + ' ' + (state.overrides[r.id]?.name ?? r.name ?? '') : '-'}`; }).join('\n');
  },
  listSketches: () => (state.sketches.length ? 'id\ttür\tkatman\tsistem\tözet\n' + state.sketches.map((e) => `${e.id}\t${e.type}\t${e.layer}\t${e.system || '-'}\t${e.type === 'polyline' ? e.pts.length + ' nokta' : e.type === 'text' ? e.text : ''}${e.label ? ' · ' + e.label : ''}`).join('\n') : '(eskiz yok)'),
  // M1 / [x,y] -> nokta; mahal: R.. ya da alan işareti
  _point: (v) => { if (Array.isArray(v) && v.length === 2) return [+v[0], +v[1]]; const m = state.marks.find((m) => m.id === String(v)); if (!m) return null; return m.type === 'rect' ? [(m.bbox[0] + m.bbox[2]) / 2, (m.bbox[1] + m.bbox[3]) / 2] : [m.x, m.y]; },
  _area: (room, mark) => {
    if (mark) { const m = state.marks.find((m) => m.id === String(mark)); if (!m) throw new Error('işaret bulunamadı: ' + mark); if (m.type === 'rect') return { poly: [[m.bbox[0], m.bbox[1]], [m.bbox[2], m.bbox[1]], [m.bbox[2], m.bbox[3]], [m.bbox[0], m.bbox[3]]], name: m.id }; const r = roomAt(m.x, m.y); if (!r) throw new Error(m.id + ' bir mahalin içinde değil'); return { poly: r.poly, name: r.id }; }
    const r = state.model.rooms.find((r) => r.id === String(room)) || (room && state.model.rooms.find((r) => (state.overrides[r.id]?.name ?? r.name ?? '').toLocaleLowerCase('tr') === String(room).toLocaleLowerCase('tr')));
    if (!r) throw new Error('mahal bulunamadı: ' + room);
    return { poly: r.poly, name: r.id };
  },
  draw: ({ entities, pattern, room, mark, pitchCm, spacingCm, marginCm, startAt, layer, system, widthCm, label }) => {
    const k = 1 / state.model.unitScale;
    if (pattern) {
      const area = agentApi._area(room, mark);
      const L = layer || (pattern === 'serpentine' ? 'M-YERDEN ISITMA' : 'ESKIZ');
      if (pattern === 'serpentine') {
        const sp = serpentine({ poly: area.poly, pitchCm: +pitchCm || 15, marginCm: marginCm == null ? 25 : +marginCm, k, startNear: startAt ? agentApi._point(startAt) : null });
        if (!sp) throw new Error('alan serpantin için çok küçük');
        const added = addSketches([{ type: 'polyline', pts: sp.pts, closed: false, layer: L }], { layer: L, system: system || 'heating', widthCm: widthCm || 1.6, label: label || `Serpantin ${area.name}` });
        return `${added[0].id}: ${area.name} içinde serpantin, ${sp.rows} sıra, boru boyu ≈ ${(sp.lengthCm / 100).toFixed(1)} m, aralık ${+pitchCm || 15} cm, katman ${L}`;
      }
      if (pattern === 'grid') {
        const lines = gridLines({ poly: area.poly, spacingCm: +spacingCm || 60, k, marginCm: +marginCm || 0 });
        const added = addSketches(lines.map((pts) => ({ type: 'line', pts, layer: L })), { layer: L, system: system || null, widthCm, label });
        return `${added.length} ızgara çizgisi (${+spacingCm || 60} cm) ${area.name} içinde, katman ${L}`;
      }
      throw new Error('pattern serpentine | grid olmalı');
    }
    const list = normalizeEntities(entities, layer || 'ESKIZ');
    if (!list.length) throw new Error('geçerli varlık yok (type line/polyline/circle/arc/text ve koordinatlar)');
    const added = addSketches(list, { layer, system, widthCm, label });
    return `${added.length} varlık çizildi (${added[0].id}…${added[added.length - 1].id}), katman ${layer || 'ESKIZ'}${system ? ', 3B boru: ' + system : ''}`;
  },
  exportDxf: async (include) => {
    const ents = state.sketches.filter((e) => !e.hidden).map(({ id, system, color, width, label, hidden, ...e }) => ({ ...e, width }));
    if (include === 'model' || include === 'all') { ents.push(...modelEntities(state.model, state.overrides)); ents.push(...fixtureEntities(liveFixtures(), state.overrides)); }
    if (!ents.length) throw new Error('çizilecek bir şey yok (önce draw ile çizin ya da include model)');
    const layers = [...new Set(ents.map((e) => e.layer))].map((name, i) => ({ name, color: [1, 3, 5, 2, 4, 6, 30, 7][i % 8] }));
    const dxf = writeDxf(ents, { layers, unitCode: state.units || 5 });
    const name = baseName() + '-cizim';
    const dl = await capDownloads;
    if (dl) { const zip = makeZip([{ name: name + '.dxf', data: new TextEncoder().encode(dxf) }]); await dl.save({ filename: name + '.zip', data: zip }); return `${name}.zip indirildi (içinde ${name}.dxf; AutoCAD'de açıp DWG olarak kaydedin). ${ents.length} varlık, ${layers.length} katman.`; }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([dxf], { type: 'application/dxf' })); a.download = name + '.dxf'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return `${name}.dxf indirildi (${ents.length} varlık, ${layers.length} katman)`;
  },
  listUnknown: () => {
    const ub = state.unknownBlocks.map((u) => `${u.name}\t${u.count} adet\t${Math.round(u.wCm)}×${Math.round(u.hCm)} cm\tkatman: ${u.layer}`);
    const ul = state.mepStats.filter((st) => { const p = state.mepProfiles.get(st.l); return p?.unknown && !p.kind; }).map((st) => `${st.name}\t${st.count} nesne, ${st.lengthM} m, tipik ${st.typicalCm} cm${st.blocks?.length ? '\tbloklar: ' + st.blocks.join(', ') : ''}`);
    const lib = state.lib.list().map((i) => `${i.name}\t${i.label}\t${i.kind}\t${i.sizeCm.join('×')} cm\t${(i.aliases || []).join(' | ') || '-'}`);
    return `TANINMAYAN BLOKLAR (ad, adet, ölçü, katman)\n${ub.join('\n') || '(yok)'}\n\nPROFİLİ BİLİNMEYEN TESİSAT KATMANLARI\n${ul.join('\n') || '(yok)'}\n\nKÜTÜPHANE (ad, etiket, tür, ölçü, takma adlar)\n${lib.join('\n') || '(boş)'}`;
  },
  libraryAdd: (def) => {
    const rec = state.lib.add(def, 'ai');
    if (!rec) throw new Error('geçersiz tanım: name ve geçerli bir kind gerekli (tefriş türü, ignore, note [text], recipe [text])');
    if (rec.kind === 'note' || rec.kind === 'recipe') return `belleğe kaydedildi: ${rec.name} (${rec.kind}, ${rec.text.length} karakter${rec.tags.length ? ', etiketler: ' + rec.tags.join(', ') : ''})`;
    runFixtures(); renderStats(); rebuild3d();
    return `kütüphaneye eklendi: ${rec.name} (${rec.label}, ${rec.kind}, ${rec.sizeCm.join('×')} cm${rec.aliases.length ? ', takma ad ' + rec.aliases.length : ''}${rec.parts ? ', ' + rec.parts.length + ' parça' : ''}); projede yeniden tarandı: ${state.fixtures.length} tefriş`;
  },
  library: (remove, filter = '') => {
    if (remove) { const ok = state.lib.remove(remove); if (ok) { runFixtures(); renderStats(); rebuild3d(); } return ok ? remove + ' silindi' : remove + ' bulunamadı'; }
    const f = filter.toLowerCase();
    const fx = state.lib.fixtures().filter((i) => !f || (i.name + ' ' + i.label + ' ' + (i.aliases || []).join(' ')).toLowerCase().includes(f));
    const notes = state.lib.notes(filter);
    const st = state.lib.stats();
    return `KÜTÜPHANE (${st.items} kayıt${st.shared ? ', paylaşımlı depo açık' : ', yalnız bu tarayıcı'})\nTEFRİŞ / SEMBOL (ad, etiket, tür, ölçü, takma adlar, not)\n` + (fx.map((i) => `${i.name}\t${i.label}\t${i.kind}\t${i.sizeCm.join('×')}\t${(i.aliases || []).join(' | ') || '-'}\t${i.note || ''}`).join('\n') || '(yok)') + '\n\nNOTLAR / TARİFLER (ad, etiket, etiketler, metin)\n' + (notes.map((i) => `${i.name}\t${i.label}\t[${(i.tags || []).join(', ')}]\t${i.text.slice(0, 400)}${i.params ? '\tparams: ' + JSON.stringify(i.params).slice(0, 200) : ''}`).join('\n') || '(yok)');
  },
  edit: (inp) => {
    const id = String(inp.id || '');
    if (id[0] === 'O') return agentApi.editOpening(inp);
    if (/^[WCG]/.test(id)) return agentApi.editWall(inp);
    if (id[0] === 'F') {
      if (inp.delete) return agentApi.deleteElements([id]);
      if (inp.kind) { const li = state.lib.get(String(inp.kind).toLowerCase()); return agentApi.setFixture(id, li ? li.kind : String(inp.kind)); }
      return 'değişiklik yok';
    }
    if (id[0] === 'R') { if (inp.delete) return agentApi.deleteElements([id]); return 'mahal adı için apply.rooms kullanın'; }
    if (id[0] === 'S') { if (inp.delete) return agentApi.deleteElements([id]); return 'eskiz için yalnız silme desteklenir'; }
    throw new Error('bilinmeyen kimlik: ' + id);
  },
  addStructure: (inp) => {
    const t = String(inp.type || '').toLowerCase();
    if (t === 'door' || t === 'window') return agentApi.addOpening({ ...inp, kind: t });
    if (t === 'wall') return agentApi.addWall(+inp.x1, +inp.y1, +inp.x2, +inp.y2, inp.thicknessCm ? +inp.thicknessCm : 10);
    if (t === 'column') return agentApi.addColumn(inp.at, inp.sizeCm, inp.rotDeg);
    throw new Error('type door | window | wall | column olmalı');
  },
  editOpening: ({ id, kind, widthCm, heightCm, sillCm, shiftCm, toWall, atCm, delete: del }) => {
    const m = state.model, k = 1 / m.unitScale;
    const o = m.openings.find((x) => x.id === String(id));
    if (!o) throw new Error('boşluk bulunamadı: ' + id);
    const out = [];
    if (del) { setOv(o.id, { deleted: true }); return o.id + ' silindi'; }
    if (shiftCm != null || toWall) {
      const host = m.walls.find((w) => w.id === (toWall ? String(toWall) : o.hostWall));
      if (!host) throw new Error('hedef duvar bulunamadı (hostWall yok; toWall ile duvar ver)');
      const n = toWall ? openingOnWall({ wall: host, kind: kind || effKind(o), widthCm: +widthCm || o.width / k, atCm: atCm == null ? null : +atCm, k })
        : shiftedOpening({ opening: { ...o, kind: kind || effKind(o) }, wall: host, shiftCm: +shiftCm || 0, widthCm: +widthCm || null, k });
      n.id = 'OM' + (state.manualOpenings.length + 1);
      state.manualOpenings.push(n); m.openings.push(n);
      const old = state.overrides[o.id] || {};
      if (o.manual) { state.manualOpenings = state.manualOpenings.filter((x) => x.id !== o.id); m.openings.splice(m.openings.indexOf(o), 1); }
      else state.overrides[o.id] = { ...old, kind: 'solid' }; // eski yer duvarla dolar
      const patch = {};
      if (Number.isFinite(+heightCm)) patch.heightCm = +heightCm; else if (old.heightCm) patch.heightCm = old.heightCm;
      if (Number.isFinite(+sillCm)) patch.sillCm = +sillCm; else if (old.sillCm) patch.sillCm = old.sillCm;
      if (Object.keys(patch).length) state.overrides[n.id] = patch;
      plan.setModel(m, state.overrides); renderStats(); renderTodo(); rebuild3d(); renderSel();
      return `${o.id} → ${n.id}: ${n.kind} ${Math.round(n.width / k)} cm, ${host.id} duvarında başından ${Math.round(n.span[0] / k)} cm (eski yer ${o.manual ? 'kaldırıldı' : 'duvarla dolduruldu'})`;
    }
    const patch = {};
    if (kind && ['door', 'window', 'empty', 'solid'].includes(kind)) { patch.kind = kind; out.push('tür ' + kind); }
    if (Number.isFinite(+heightCm)) { patch.heightCm = +heightCm; out.push('yükseklik ' + heightCm); }
    if (Number.isFinite(+sillCm)) { patch.sillCm = +sillCm; out.push('parapet ' + sillCm); }
    if (Number.isFinite(+widthCm) && +widthCm > 0 && Math.abs(+widthCm - o.width / k) > 1) {
      // genişlik: aynı duvarda, aynı merkezde yeniden aç (algılanmış boşluk dolar)
      const host = m.walls.find((w) => w.id === o.hostWall);
      if (!host) throw new Error('genişlik için ana duvar bulunamadı; toWall ile verin');
      const n = shiftedOpening({ opening: { ...o, kind: patch.kind || effKind(o) }, wall: host, shiftCm: 0, widthCm: +widthCm, k });
      n.id = 'OM' + (state.manualOpenings.length + 1); state.manualOpenings.push(n); m.openings.push(n);
      if (o.manual) { state.manualOpenings = state.manualOpenings.filter((x) => x.id !== o.id); m.openings.splice(m.openings.indexOf(o), 1); } else state.overrides[o.id] = { ...(state.overrides[o.id] || {}), kind: 'solid' };
      state.overrides[n.id] = patch; plan.setModel(m, state.overrides); renderStats(); renderTodo(); rebuild3d(); renderSel();
      return `${o.id} → ${n.id}: genişlik ${widthCm} cm`;
    }
    if (!Object.keys(patch).length) return 'değişiklik yok';
    setOv(o.id, patch);
    return `${o.id}: ${out.join(', ')}`;
  },
  editWall: ({ id, heightCm, delete: del, exterior }) => {
    const el = findById(state.model, String(id));
    if (!el || !/^[WCG]/.test(String(id))) throw new Error('duvar/kolon/cam cephe bulunamadı: ' + id);
    if (del) {
      // elle eklenen kolon ise listeden de çıkar
      state.manualColumns = state.manualColumns.filter((c) => c.id !== el.id);
      setOv(el.id, { deleted: true });
      if (el.id[0] === 'W') { state.model = { ...state.model }; runDetectKeep(); }
      return el.id + ' kaldırıldı';
    }
    const patch = {};
    if (Number.isFinite(+heightCm)) patch.heightCm = +heightCm;
    if (typeof exterior === 'boolean') { el.exterior = exterior; }
    setOv(el.id, patch);
    return `${el.id} güncellendi`;
  },
  resetProject: () => {
    state.manualFixtures = []; state.manualOpenings = []; state.manualColumns = []; state.manualWalls = []; state.mepOverrides = {}; state.aiTour = null;
    for (const ov of (state.overlays || []).reverse()) { const B = state.islands.find((i) => i.id === ov.other); const inB = (x, y) => B && x >= B.bbox[0] && x <= B.bbox[2] && y >= B.bbox[1] && y <= B.bbox[3]; for (const p of state.drawing.prims) if (inB(p.pts[0], p.pts[1])) for (let q = 0; q < p.pts.length; q += 2) { p.pts[q] -= ov.dx; p.pts[q + 1] -= ov.dy; } for (const t of state.drawing.texts) if (inB(t.x, t.y)) { t.x -= ov.dx; t.y -= ov.dy; } if (B) B.bbox = [B.bbox[0] - ov.dx, B.bbox[1] - ov.dy, B.bbox[2] - ov.dx, B.bbox[3] - ov.dy]; }
    state.overlays = []; state._partList = null;
    runDetect();
    return 'proje baştan algılandı; tüm düzenlemeler geri alındı';
  },
  addFixtures: ({ kind, room, count, layout, sizeCm, spacingCm, rotDeg, at }) => {
    const m = state.model, k = 1 / m.unitScale;
    kind = String(kind || '').toLowerCase();
    const li = state.lib.get(kind);
    if (!FIXTURE_KINDS[kind] && !SETS[kind] && !(li && li.kind !== 'ignore')) throw new Error(`bilinmeyen tür: ${kind}. Türler: ${Object.keys(FIXTURE_KINDS).join(', ')}; takımlar: ${Object.keys(SETS).join(', ')}; kütüphane: ${state.lib.list().map((i) => i.name).join(', ') || '-'}`);
    const live = liveFixtures().filter((f) => !state.overrides[f.id]?.deleted);
    // engeller: duvar, kolon, zemindeki tefriş (tavandaki klima / yer süzgeci / radyatör engel değil)
    const obstacles = [...m.walls.filter((w) => !state.overrides[w.id]?.deleted).map((w) => w.poly), ...m.columns.map((c) => c.poly), ...live.filter((f) => !['ac', 'drain', 'radiator', 'faucet'].includes(f.kind)).map((f) => f.poly)];
    let res;
    if (typeof at === 'string' && /^M\d+$/.test(at)) at = agentApi._point(at);
    if (!at && room && /^M\d+$/.test(String(room))) { const m = state.marks.find((m) => m.id === room); if (m?.type === 'point') at = [m.x, m.y]; else if (m) { const c = agentApi._point(room); const r = roomAt(c[0], c[1]); if (r) room = r.id; } }
    if (Array.isArray(at) && at.length === 2) res = fixtureAt({ kind, x: +at[0], y: +at[1], sizeCm: Array.isArray(sizeCm) && sizeCm.length === 2 ? sizeCm.map(Number) : null, rotDeg: +rotDeg || 0, k, lib: state.lib });
    else {
      const r = m.rooms.find((r) => r.id === String(room)) || (room && m.rooms.find((r) => (state.overrides[r.id]?.name ?? r.name ?? '').toLocaleLowerCase('tr') === String(room).toLocaleLowerCase('tr')));
      if (!r) throw new Error('mahal bulunamadı: ' + room + ' (list_rooms ile kimliğe bak)');
      res = layoutInRoom({ room: r, kind, count: +count || 0, sizeCm: Array.isArray(sizeCm) && sizeCm.length === 2 ? sizeCm.map(Number) : null, layout: layout || 'grid', spacingCm: +spacingCm || 60, rotDeg: rotDeg == null ? null : +rotDeg, obstacles, k, lib: state.lib });
      if (!res.items.length) throw new Error('mahale sığmadı; daha küçük ölçü, daha az adet ya da başka layout deneyin');
    }
    const n0 = state.manualFixtures.length;
    const added = res.items.map((it, i) => ({ id: 'FM' + (n0 + i + 1), kind: it.kind, label: it.lib ? (state.lib.get(it.lib)?.label || it.lib) : (FIXTURE_KINDS[it.kind]?.label || it.kind), name: it.lib ? 'kütüphane: ' + it.lib : 'sohbetle eklendi', poly: it.poly, center: it.center, rot: it.rot, wCm: it.wCm, hCm: it.hCm, l: -1, source: 'manual', lib: it.lib }));
    state.manualFixtures.push(...added);
    state.fixtures = state.fixtures.concat(added);
    plan.setFixtures(liveFixtures()); renderStats(); rebuild3d();
    return `${res.label}: ${res.groups} adet yerleştirildi (${added.length} öğe: ${added.map((f) => f.id).join(', ')})`;
  },
  addOpening: ({ wall, kind, widthCm, atCm, heightCm, sillCm }) => {
    const m = state.model, k = 1 / m.unitScale;
    const w = m.walls.find((w) => w.id === String(wall));
    if (!w) throw new Error('duvar bulunamadı: ' + wall + ' (list_walls)');
    const kd = kind === 'window' ? 'window' : 'door';
    const o = openingOnWall({ wall: w, kind: kd, widthCm: +widthCm || (kd === 'door' ? 90 : 120), atCm: atCm == null ? null : +atCm, k });
    o.id = 'OM' + (state.manualOpenings.length + 1);
    state.manualOpenings.push(o);
    m.openings.push(o);
    const patch = {};
    if (Number.isFinite(+heightCm)) patch.heightCm = +heightCm;
    if (Number.isFinite(+sillCm)) patch.sillCm = +sillCm;
    if (Object.keys(patch).length) state.overrides[o.id] = patch;
    plan.setModel(m, state.overrides); renderStats(); renderTodo(); rebuild3d(); renderSel();
    return `${o.id}: ${kd === 'door' ? 'kapı' : 'pencere'} ${Math.round(o.width / k)} cm, ${w.id} duvarında (başından ${Math.round(o.span[0] / k)} cm)`;
  },
  addColumn: (at, sizeCm, rotDeg) => {
    if (typeof at === 'string') at = agentApi._point(at);
    if (!Array.isArray(at) || at.length !== 2) throw new Error('at: [x, y] ya da M.. işareti gerekli');
    const k = 1 / state.model.unitScale;
    const c = columnAt({ x: +at[0], y: +at[1], sizeCm: Array.isArray(sizeCm) && sizeCm.length ? sizeCm.map(Number) : [40, 40], rotDeg: +rotDeg || 0, k });
    c.id = 'CM' + (state.manualColumns.length + 1);
    state.manualColumns.push(c);
    state.model.columns.push(c);
    plan.setModel(state.model, state.overrides); renderStats(); rebuild3d();
    return `${c.id} kolonu eklendi`;
  },
  show: ({ view, select: sel, tour, panel }) => {
    if (panel === 'advanced' || panel === 'ayrintili') agentUi.toggleLegacy(true);
    if (panel === 'simple' || panel === 'sade') agentUi.toggleLegacy(false);
    if (view === '3d' || view === 'plan') showTab(view);
    if (sel) { if (!findById(state.model, sel) && !state.fixtures.some((f) => f.id === sel)) throw new Error(sel + ' bulunamadı'); select(sel); if (state.tab === 'plan') plan.fitModel(); }
    if (tour) startTour();
    return 'tamam';
  },
};

// hata ayıklama / test: sayfa API'si (konsoldan dwg2bim.api.listRooms() gibi)
window.dwg2bim = { api: agentApi, state };

const agentUi = (() => {
  let sample = null, tools = null, busy = false, ctl = null;
  const log = $('chatLog');
  const addMsg = (cls, text) => { const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text; log.appendChild(d); log.scrollTop = log.scrollHeight; return d; };
  const setBusy = (b) => { busy = b; $('agentReview').disabled = b || !state.drawing; $('chatSend').disabled = b || !state.drawing; $('agentStop').hidden = !b; };
  // araç çağrılarını günlüğe yaz
  // araç çağrıları: cevap balonunun üstünde tek katlanır satır ("⚙ 5 işlem"), açılınca ayrıntı
  let group = null;
  const toolLine = (text) => {
    if (!group) { group = document.createElement('details'); group.className = 'tools'; group.innerHTML = '<summary></summary>'; log.insertBefore(group, log.lastElementChild); }
    const d = document.createElement('div'); d.textContent = text; group.appendChild(d);
    group.querySelector('summary').textContent = `${group.children.length - 1} işlem`;
    log.scrollTop = log.scrollHeight;
    return d;
  };
  const wrapTools = (list) => list.map((t) => ({ ...t, execute: async (input, cx) => {
    const line = toolLine(`${t.name}${input && Object.keys(input).length ? ' ' + JSON.stringify(input).slice(0, 120) : ''} …`);
    try { const r = await t.execute(input, cx); line.textContent = `${t.name}: ${String(typeof r === 'string' ? r : JSON.stringify(r)).split('\n')[0].slice(0, 140)}`; return r; }
    catch (e) { line.textContent = `${t.name}: hata — ${e.message}`; line.classList.add('err'); throw e; }
  } }));
  async function run(message, { tier = 'default', shown = message } = {}) {
    if (!sample || busy || !state.drawing) return null;
    setBusy(true);
    addMsg('user', shown);
    group = null;
    const out = addMsg('ai thinking', 'Düşünüyor…');
    setStatus($('agentStatus'), tier === 'complex' ? 'Claude projeyi inceliyor; araç çağrıları aşağıda görünür (1-3 dakika sürebilir).' : 'Claude çalışıyor…');
    ctl = new AbortController();
    try {
      const r = await runAgent(sample, {
        snapshot: agentApi.snapshot(), history: state.chat, message, tools, tier, signal: ctl.signal,
        onText: ({ text }) => { out.classList.remove('thinking'); out.textContent = text; log.scrollTop = log.scrollHeight; },
      });
      out.classList.remove('thinking');
      out.textContent = r.text;
      state.chat.push({ role: 'user', content: shown }, { role: 'assistant', content: r.text });
      setStatus($('agentStatus'), r.truncated ? 'Cevap uzunluk sınırında kesildi.' : '', r.truncated ? 'err' : 'ok');
      return r;
    } catch (e) {
      out.textContent = e?.text || '';
      if (!e?.text) out.remove();
      addMsg('ai err', errorText(e));
      setStatus($('agentStatus'), errorText(e), e?.code === 'cancelled' ? '' : 'err');
      if (e?.code === 'not_granted' || e?.code === 'sampling_disabled' || e?.code === 'tools_unavailable') disable();
      return null;
    } finally { setBusy(false); ctl = null; }
  }
  function disable() { $('agentBox').classList.add('off'); $('agentUnavail').hidden = false; $('agentReview').hidden = true; $('chatSend').hidden = true; $('chatIn').hidden = true; $('wizClaude').hidden = true; $('btnAsk').hidden = true; }
  const intro = (text) => addMsg('ai', text);
  const REVIEW_SHOWN = 'Projeyi uçtan uca incele ve gerekli ayarları yap.';
  // dosya açılınca: Claude varsa önce elden geçirir (ilk çağrıda claude.ai onay sorar), sonra model gösterilir
  async function autoReview() {
    if (!state.drawing) return;
    if (!sample) {
      showTab('3d');
      intro(`${state.fileName} açıldı ve otomatik algılandı. Bu sürümde Claude sohbeti yok; claude.ai içindeki sürümde projeyi Claude elden geçirir ve yazdıklarınızı uygular.`);
      return;
    }
    showTab('plan');
    intro(`${state.fileName} açıldı. Şimdi projeyi uçtan uca inceliyorum: katman rolleri, birim, kapı/pencereler, mahal adları, tesisat katmanları ve kot. İlk seferinde claude.ai izin soracak; bu 1-3 dakika sürebilir.`);
    const r = await run(REVIEW_TASK, { tier: 'complex', shown: REVIEW_SHOWN });
    showTab('3d');
    if (r) intro('İnceleme bitti ve ayarlar uygulandı. Buradan yazarak devam edin: ör. "giriş kapısı O5 olsun", "tavan 320 cm", "M-EMİŞ dönüş havası", "WC\'ye pisuvar ekleme, F3\'ü sil", "geziyi başlat".');
  }
  capSample.then(async (sm) => {
    if (!sm) return disable();
    const lim = await sm.limits().catch(() => null);
    if (!lim?.tools) return disable();
    sample = sm;
    tools = wrapTools(makeTools(agentApi)).slice(0, lim.tools.maxCount || 20);
    $('agentUnavail').hidden = true; $('agentIntro').hidden = false;
    $('agentTier').textContent = 'Claude · aboneliğinizle, anahtarsız';
    setBusy(false);
    // analiz ekranı: uçtan uca inceleme, sonra 3B
    const w = $('wizClaude');
    w.hidden = true;
    w.textContent = 'Claude projeyi uçtan uca incelesin';
    w.onclick = async () => {
      if (!state.drawing || busy) return;
      w.disabled = true;
      setStatus($('wizStatus'), 'Claude projeyi inceliyor; ilerleme Asistan sekmesinde görünür (1-3 dakika sürebilir).');
      showPanel('pAi');
      const r = await run(REVIEW_TASK, { tier: 'complex', shown: 'Projeyi uçtan uca incele ve gerekli ayarları yap.' });
      w.disabled = false;
      if (r) { $('wizAnswer').value = r.text; setStatus($('wizStatus'), 'İnceleme tamamlandı; model gösteriliyor.', 'ok'); $('wizShow3d').click(); }
      else setStatus($('wizStatus'), $('agentStatus').textContent, 'err');
    };
    const b = $('btnAsk');
    b.hidden = true; // ajan modu varken kopyala-yapıştır yolundaki kısayol gereksiz
  });
  $('agentReview').onclick = () => run(REVIEW_TASK, { tier: 'complex', shown: REVIEW_SHOWN });
  const toggleLegacy = (on) => { state.showLegacy = on ?? $('legacy').hidden; $('legacy').hidden = !state.showLegacy; if (state.showLegacy) showPanel('pSum'); };
  $('legacyLink').onclick = (e) => { e.preventDefault(); toggleLegacy(true); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('legacy').hidden) toggleLegacy(false); });
  $('agentStop').onclick = () => ctl?.abort();
  const send = () => { const t = $('chatIn').value.trim(); if (!t) return; $('chatIn').value = ''; run(t); };
  $('chatSend').onclick = send;
  $('chatIn').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
  return {
    onDrawing() { state.chat = []; log.innerHTML = ''; setStatus($('agentStatus'), ''); if (sample) setBusy(false); },
    available: () => !!sample,
    intro, autoReview, toggleLegacy,
  };
})();


function applyAnswer(given) {
  let a = given && typeof given === 'object' && !(given instanceof Event) ? given : null;
  if (!a) { try { a = parseAnswer($('answerIn').value); } catch (e) { aiStatus(e.message, 'err'); return e.message; } }
  const d = state.drawing;
  if (!d) return 'Açık bir çizim yok.';
  const byName = new Map(d.layers.map((l, i) => [l.name.toLocaleLowerCase('tr'), i]));
  const done = [];
  const missing = [];
  let redetect = false, layersChanged = false;
  if (a.layers && typeof a.layers === 'object') {
    for (const [key, role] of [['walls', 'wall'], ['columns', 'column'], ['texts', 'text'], ['doors', 'door'], ['windows', 'window']]) {
      if (!Array.isArray(a.layers[key])) continue;
      const set = new Set();
      for (const n of a.layers[key]) {
        const i = byName.get(String(n).toLocaleLowerCase('tr'));
        if (i == null) missing.push(n); else set.add(i);
      }
      if (key === 'walls' && !set.size) continue;
      const before = [...state.roles[role]].sort().join();
      state.roles[role] = set;
      if ([...set].sort().join() !== before) layersChanged = true;
    }
    if (layersChanged) { state.autoRegion = layerBBox(state.roles.wall); state.region = null; renderLayers(); redetect = true; done.push('katmanlar'); }
  }
  const p = a.params || {};
  let nParams = 0;
  for (const [k, v] of Object.entries(p)) {
    if (DETECT_KEYS.includes(k) && typeof v === 'number' && v > 0) { if (state.params[k] !== v) redetect = true; state.params[k] = v; nParams++; }
    else if (BUILD_NUM.includes(k) && typeof v === 'number' && v >= 0) { state.build[k] = v; nParams++; }
    else if (BUILD_TXT.includes(k) && typeof v === 'string') { state.build[k] = v; nParams++; }
    else if (BUILD_CHK.includes(k) && typeof v === 'boolean') { state.build[k] = v; nParams++; }
  }
  if (nParams) done.push(nParams + ' ölçü');
  fillParams();
  if (redetect) runDetect();
  let nOps = 0, nRooms = 0;
  if (!layersChanged && state.model) {
    const ids = new Set(state.model.openings.map((o) => o.id));
    for (const [id, o] of Object.entries(a.openings || {})) {
      if (!ids.has(id) || !o) continue;
      const patch = {};
      if (o.kind === 'delete') patch.deleted = true;
      else if (['door', 'window', 'empty', 'solid'].includes(o.kind)) patch.kind = o.kind;
      if (typeof o.heightCm === 'number') patch.heightCm = o.heightCm;
      if (typeof o.sillCm === 'number') patch.sillCm = o.sillCm;
      state.overrides[id] = { ...(state.overrides[id] || {}), ...patch };
      nOps++;
    }
    const rids = new Set(state.model.rooms.map((r) => r.id));
    for (const [id, r] of Object.entries(a.rooms || {})) {
      if (rids.has(id) && r && typeof r.name === 'string') { state.overrides[id] = { ...(state.overrides[id] || {}), name: r.name }; nRooms++; }
    }
    if (nOps) done.push(nOps + ' boşluk');
    if (nRooms) done.push(nRooms + ' mahal adı');
  }
  // Tesisat: bu projedeki katman kararları
  let nMep = 0, nLearn = 0, nIgn = 0;
  for (const [name, v] of Object.entries(a.mep || {})) {
    const i = byName.get(String(name).toLocaleLowerCase('tr'));
    if (i == null || !v || (v.kind && !KINDS[v.kind])) { if (i == null) missing.push(name); continue; }
    const cur = state.mepProfiles.get(i) || state.kb.classify(state.drawing.layers[i].name);
    state.mepOverrides[i] = {
      kind: v.kind || cur.kind, system: SYSTEMS[v.system] ? v.system : cur.system || 'other',
      elevRef: v.elevRef === 'floor' ? 'floor' : v.elevRef === 'ceiling' ? 'ceiling' : cur.elevRef || 'ceiling',
      elevOffsetCm: Number.isFinite(+v.elevOffsetCm) ? +v.elevOffsetCm : cur.elevOffsetCm || 0,
      sizeCm: Number.isFinite(+v.sizeCm) && +v.sizeCm > 0 ? +v.sizeCm : cur.sizeCm, source: 'ai', unknown: false,
    };
    nMep++;
  }
  // Öğrenme: genel kurallar bilgi bankasına
  for (const r of Array.isArray(a.learn) ? a.learn : []) if (state.kb.addRule(r, 'ai')) nLearn++;
  for (const r of Array.isArray(a.ignore) ? a.ignore : []) if (state.kb.addIgnore(r, 'ai')) nIgn++;
  if (nLearn || nIgn) { state.kb.save(); renderKb(); }
  if (Number.isFinite(+a.ceilingCm) && +a.ceilingCm >= 150 && state.ceiling.source !== 'user') {
    state.ceiling = { cm: Math.round(+a.ceilingCm), source: 'ai', text: String(a.ceilingReason || '').slice(0, 120) };
    $('ceilDlg').hidden = true;
    done.push('asma tavan kotu ' + state.ceiling.cm + ' cm');
  }
  if (nMep) done.push(nMep + ' tesisat katmanı');
  if (nLearn || nIgn) done.push(`bilgi bankasına ${nLearn} yeni kural${nIgn ? ' + ' + nIgn + ' temizlik kuralı' : ''}`);
  runMep(false);
  plan.setModel(state.model, state.overrides);
  renderStats();
  rebuild3d();
  renderSel();
  if (a.tour && (Array.isArray(a.tour.order) || a.tour.notes)) {
    state.aiTour = { order: Array.isArray(a.tour.order) ? a.tour.order.map(String) : null, notes: a.tour.notes && typeof a.tour.notes === 'object' ? a.tour.notes : {} };
    done.push('gezi rotası');
  }
  if (a.report || Array.isArray(a.issues)) {
    state.aiReport = { report: String(a.report || ''), issues: (Array.isArray(a.issues) ? a.issues : []).slice(0, 20) };
    renderReport();
    done.push('analiz raporu');
  }
  renderTodo();
  let msg = done.length ? 'Uygulandı: ' + done.join(', ') + '.' : 'Cevapta uygulanacak bir ayar bulunamadı.';
  if (Array.isArray(a.questions) && a.questions.length) msg += ' Yapay zekânın soruları: ' + a.questions.slice(0, 3).join(' / ');
  if (missing.length) msg += ' Bulunamayan katman: ' + missing.join(', ') + '.';
  if (layersChanged && (a.openings || a.rooms)) msg += ' Katmanlar değiştiği için boşluk/mahal numaraları yenilendi; ince ayar için yeni bir komut oluşturup tekrar sorun.';
  if (a.notes) msg += ' Not: ' + a.notes;
  aiStatus(msg, done.length ? 'ok' : 'err');
  return msg;
}
$('btnApply').onclick = () => applyAnswer();

// ------------------------------------------------------------ RVT inceleme
const rvtStatus = (m, k) => setStatus($('rvtStatus'), m, k);
async function inspectRvt(file) {
  showPanel('pSum');
  $('stepRvt').open = true;
  rvtStatus('RVT okunuyor…');
  try {
    const info = await readRvt(file);
    const groups = Object.entries(info.groups).filter(([, v]) => v.length)
      .map(([k, v]) => `<div><div class="hint">${esc(k)}</div><div class="chips">${v.map((s) => `<span>${esc(s)}</span>`).join('')}</div></div>`).join('');
    $('rvtOut').innerHTML = `
      <div class="row" style="align-items:flex-start">
        ${info.previewUrl ? `<img src="${info.previewUrl}" alt="RVT önizleme resmi">` : ''}
        <dl class="facts" style="flex:1;min-width:0">
          <dt>Dosya</dt><dd>${esc(info.fileName)} (${info.sizeMB} MB)</dd>
          <dt>Revit</dt><dd>${esc(info.version || '?')} ${esc(info.build)}</dd>
          <dt>Kayıt yolu</dt><dd>${esc(info.path || '-')}</dd>
          <dt>Bağlantı</dt><dd>${info.links?.length ? info.links.map((l) => esc(l.type + ': ' + l.path)).join('<br>') : '-'}</dd>
        </dl>
      </div>
      <div style="display:grid;gap:6px;margin-top:8px">${groups}</div>`;
    rvtStatus('Okundu. 3B geometri RVT içinde kapalı formatta; karşılaştırma için Revit\'ten IFC dışa aktarımı gerekir.', 'ok');
  } catch (e) {
    rvtStatus('RVT okunamadı: ' + e.message, 'err');
  }
}
$('rvtInput').onchange = () => { const f = $('rvtInput').files[0]; if (f) inspectRvt(f); $('rvtInput').value = ''; };

// ------------------------------------------------------------ başlangıç
plan.resize();
// paylaşımlı kütüphane deposu (artifact db); yoksa yalnız localStorage
if (window.claude?.use) window.claude.use('db').then((db) => db && state.lib.attach(db).then((n) => { if (n) console.info('kütüphane: paylaşımlı depodan ' + n + ' kayıt'); })).catch(() => {});
// açılış: karşılama ekranı (demo düğmesi ile örnek bina)
$('welcome').hidden = false;
overlay(null);
