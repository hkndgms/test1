// DWG2BIM ana uygulama: dosya okuma, katman rolleri, algılama, düzenleme,
// 3B önizleme, IFC dışa aktarma, yapay zekâ asistanı ve RVT inceleme.
import { detect, DEFAULT_PARAMS, UNIT_NAMES, UNIT_TO_CM } from './detect.js';
import { autoSetup } from './auto.js';
import { KnowledgeBase, SYSTEMS, KINDS, fold } from './kb.js';
import { layerStats, extractMep, detectElevations } from './mep.js';
import { buildSolids, DEFAULT_BUILD } from './build3d.js';
import { writeIfc } from './ifc.js';
import { makeZip } from './zip.js';
import { Plan2D, findById, findMepById } from './view2d.js';
import { buildPrompt, parseAnswer } from './ai-prompt.js';
import { readRvt } from './rvt.js';

const $ = (id) => document.getElementById(id);
const SAMPLE_DWG = 'samples/taziye-evi.dwg.b64.txt';
const SAMPLE_RVT = 'samples/taziye-evi.rvt.b64.txt';

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
};

// ------------------------------------------------------------ yardımcılar
// Örnekler base64 metin olarak paketlenir (bkz. tools/pack-samples.mjs)
async function fetchSample(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const bin = atob((await r.text()).trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}
function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function themeColors() {
  return {
    canvas: css('--canvas'), ink: css('--ink'), muted: css('--muted'), accent: css('--accent'),
    accentSoft: css('--accent-soft'), wall: css('--wall'), wallExt: css('--wall-ext'), wallEdge: css('--wall-edge'),
    column: css('--column'), win: css('--win'), door: css('--door'), empty: css('--empty'),
    room: css('--room'), roomSel: css('--room-sel'), outline: css('--outline'),
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

function loadBuffer(buf, name) {
  const isDxf = /\.dxf$/i.test(name);
  state.fileName = name;
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

async function loadSample() {
  try {
    overlay('Örnek proje indiriliyor (6 MB)…');
    loadBuffer(await fetchSample(SAMPLE_DWG), 'ÖRNEK · 03.10.2026_TAZIYE_EVI_MEKANIK_PROJE.dwg');
  } catch (e) {
    overlay('Örnek dosya indirilemedi (' + e.message + '). Kendi DWG dosyanızı açabilirsiniz.', 'Örnek açılamadı');
  }
}

function onDrawing(d, secs) {
  state.drawing = d;
  state.units = UNIT_TO_CM[d.units] != null && d.units !== 0 ? d.units : 5;
  state.region = null;
  state.mepOverrides = {};
  state.systemsOff = new Set();
  state.elevations = null;
  state.ceiling = { cm: 280, source: 'default', text: '' };
  state.ceilingAsked = false;
  $('ceilDlg').hidden = true;
  plan.setDrawing(d);
  autoRoles();
  renderLayers();
  renderFacts(secs);
  ['btnDetect', 'btnPrompt', 'btnAsk'].forEach((id) => ($(id).disabled = false));
  runDetect();
  plan.fitModel();
  overlay(null);
  if (state.model?.walls.length || mepCount()) {
    const ign = state.islands?.length > 1 ? ` ${state.islands.length - 1} ayrık çizim grubu yok sayıldı.` : '';
    status(`Okundu (${secs} sn) ve algılandı.${ign} ${state.unitNote || 'Plandaki öğelere tıklayarak düzenleyebilirsiniz.'}`, 'ok');
  }
}

function renderFacts(secs) {
  const d = state.drawing;
  const f = $('facts');
  f.hidden = false;
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
$('btnSample').onclick = loadSample;
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
  for (const tr of $('layerRows').querySelectorAll('tr[data-i]')) tr.hidden = q && !tr.dataset.name.includes(q);
}
$('layerFilter').oninput = applyLayerFilter;
$('btnAuto').onclick = () => { if (!state.drawing) return; state.units = UNIT_TO_CM[state.drawing.units] != null && state.drawing.units !== 0 ? state.drawing.units : 5; autoRoles(); state.region = null; renderLayers(); runDetect(); plan.fitModel(); };
$('btnRegion').onclick = () => {
  if (!state.drawing) return;
  plan.regionMode = !plan.regionMode;
  $('btnRegion').classList.toggle('on', plan.regionMode);
  status(plan.regionMode ? 'Planda algılanacak alanın çevresine bir dikdörtgen çizin.' : '');
};
$('btnRegionReset').onclick = () => { state.region = null; runDetect(); };

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
const emptyModel = () => ({ walls: [], columns: [], openings: [], rooms: [], outline: null, unitScale: UNIT_TO_CM[state.units] ?? 1, stats: {} });

function runDetect() {
  if (!state.drawing) return;
  const t0 = performance.now();
  const region = state.region || state.autoRegion || null;
  plan.region = state.region;
  state.model = state.roles.wall.size ? detect(state.drawing, {
    units: state.units, wallLayers: state.roles.wall, columnLayers: state.roles.column,
    textLayers: state.roles.text, doorLayers: state.roles.door, windowLayers: state.roles.window, region, params: state.params,
  }) : emptyModel();
  state.overrides = {};
  state.selected = null;
  plan.setModel(state.model, state.overrides);
  renderStats();
  runMep(false);
  renderSel();
  rebuild3d(false);
  const hasAny = state.model.walls.length || mepCount() > 0;
  ['btnExport', 'btnExportTop'].forEach((id) => ($(id).disabled = !hasAny));
  const ms = Math.round(performance.now() - t0);
  if (!state.roles.wall.size && !mepCount()) status('Duvar katmanı seçilmedi ve tesisat bulunamadı. Katman listesinden en az bir katmanı "Duvar" yapın.', 'err');
  else if (!state.model.walls.length && !mepCount()) status('Seçilen katmanlarda duvar bulunamadı. Başka bir katman deneyin veya "En kalın duvar" ayarını artırın.', 'err');
  else status(`Algılandı (${ms} ms). Plandaki öğelere tıklayarak düzenleyebilirsiniz.`, 'ok');
}

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
  const region = state.region || state.autoRegion || null;
  const arch = new Set([...state.roles.wall, ...state.roles.column, ...state.roles.door, ...state.roles.window, ...state.roles.text]);
  state.mepStats = layerStats(d, region, state.units).filter((st) => !arch.has(st.l));
  state.mepProfiles = new Map();
  for (const st of state.mepStats) state.mepProfiles.set(st.l, profileFor(st.l));
  state.mep = extractMep(d, { region, units: state.units, profiles: state.mepProfiles });
  plan.mepUnitScale = UNIT_TO_CM[state.units] ?? 1;
  plan.setMep(state.mep, state.mepProfiles, { visible: state.mepVisible, systems: visibleSystems() });
  // kot: projede varsa oradan, yoksa kullanıcıya sor
  if (!state.elevations) {
    state.elevations = detectElevations(d, region);
    if (state.elevations.ceiling) state.ceiling = { cm: state.elevations.ceiling.cm, source: 'project', text: state.elevations.ceiling.text };
  }
  renderMepPanel();
  if (mepCount() && state.ceiling.source === 'default' && !state.ceilingAsked) askCeiling();
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
    $('resultNote').textContent = `${ext} dış, ${walls.length - ext} iç duvar · mahallerin toplamı ${area.toFixed(1)} m². Plandaki bir öğeye tıklayarak düzenleyin.`;
  }
}

function buildAll() {
  return buildSolids(state.model, {
    ...state.build, mep: state.mepVisible ? state.mep : null, mepProfiles: state.mepProfiles,
    ceilingCm: state.ceiling.cm, layerNames: state.drawing.layers.map((l) => l.name),
  }, state.overrides);
}

function rebuild3d(keepCamera = true) {
  if (!state.view3d || !state.model) return;
  state.view3d.setSolids(buildAll().solids, { keepCamera });
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
  renderStats();
  rebuild3d();
  renderSel();
}

function numField(id, label, value, unit = 'cm') {
  return `<div class="field"><label for="${id}">${label}</label><div class="unit" data-u="${unit}"><input type="number" id="${id}" value="${value}" step="5"></div></div>`;
}

function renderSel() {
  const box = $('selPanel');
  const me = findMepById(state.mep, state.selected);
  if (me) return renderMepSel(box, me);
  const el = findById(state.model, state.selected);
  if (!el) { box.innerHTML = ''; return; }
  const id = el.id, ov = state.overrides[id] || {}, B = state.build;
  let html = '';
  if (id[0] === 'O') {
    const kind = ov.kind || el.kind;
    html = `<div class="row"><b>Boşluk ${id}</b><span class="hint">${cm(el.width)} cm genişlik · ${cm(el.thickness)} cm duvar · ${el.exterior ? 'dış cephe' : 'iç'}</span></div>
      <div class="seg" role="group" aria-label="Boşluk türü">
        <button data-kind="window" class="${kind === 'window' ? 'on' : ''}">Pencere</button>
        <button data-kind="door" class="${kind === 'door' ? 'on' : ''}">Kapı</button>
        <button data-kind="empty" class="${kind === 'empty' ? 'on' : ''}">Geçiş</button>
      </div>
      <div class="grid2">
        ${kind === 'window' ? numField('selSill', 'Parapet', ov.sillCm ?? B.windowSillCm) + numField('selH', 'Pencere yüksekliği', ov.heightCm ?? B.windowHeightCm) : ''}
        ${kind === 'door' ? numField('selH', 'Kapı yüksekliği', ov.heightCm ?? B.doorHeightCm) : ''}
      </div>
      ${kind === 'empty' ? '<p class="hint">Geçiş: kapı, pencere ve lento oluşturulmaz.</p>' : ''}
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
$('mepOn').onchange = () => {
  state.mepVisible = $('mepOn').checked;
  plan.setMep(state.mep, state.mepProfiles, { visible: state.mepVisible, systems: visibleSystems() });
  rebuild3d();
};
$('archOn').onchange = () => { state.archVisible = $('archOn').checked; state.view3d?.setVisibility({ arch: state.archVisible, systems: visibleSystems() }); };
function setCeiling(cm, source, text = '') {
  if (!(cm >= 150 && cm <= 2000)) return;
  state.ceiling = { cm: Math.round(cm), source, text };
  renderMepPanel();
  rebuild3d();
}
$('ceilCm').onchange = () => setCeiling(parseFloat($('ceilCm').value), 'user');
$('ceilCands').addEventListener('click', (e) => { const v = +e.target.dataset.cm; if (v) setCeiling(v, 'user'); });

// Projede kot yoksa kullanıcıya sor
function askCeiling() {
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
  return buildPrompt({
    drawing: state.drawing, roles: state.roles, params: state.params, buildParams: state.build, model: state.model, fileName: state.fileName,
    mepStats: state.mepStats, mepProfiles: state.mepProfiles, elevations: state.elevations, ceiling: state.ceiling, islands: state.islands,
  });
}
$('btnPrompt').onclick = () => {
  if (!state.drawing) return;
  $('promptOut').value = currentPrompt();
  $('btnCopy').disabled = false;
  aiStatus(`Komut hazır (${$('promptOut').value.length.toLocaleString('tr')} karakter). Kopyalayıp yapay zekâya yapıştırın.`);
};
$('btnCopy').onclick = () => {
  const t = $('promptOut');
  navigator.clipboard.writeText(t.value).then(
    () => aiStatus('Kopyalandı.', 'ok'),
    () => { t.focus(); t.select(); aiStatus('Otomatik kopyalanamadı; metin seçildi, Ctrl+C ile kopyalayın.'); },
  );
};
$('answerIn').oninput = () => ($('btnApply').disabled = !$('answerIn').value.trim() || !state.drawing);
capSample.then((sample) => {
  if (!sample) return;
  const b = $('btnAsk');
  b.hidden = false;
  b.disabled = !state.drawing;
  b.onclick = async () => {
    if (!state.drawing) return;
    const prompt = currentPrompt();
    $('promptOut').value = prompt;
    b.disabled = true;
    aiStatus('Claude düşünüyor…');
    try {
      const r = await sample(prompt, { onText: ({ text }) => { $('answerIn').value = text; } });
      $('answerIn').value = r.text;
      $('btnApply').disabled = false;
      aiStatus('Cevap geldi. Kontrol edip "Cevabı uygula"ya basın.', 'ok');
    } catch (e) {
      aiStatus(e?.code === 'not_granted' ? 'Claude erişimine izin verilmedi.' : 'Claude cevap veremedi: ' + (e?.message || e?.code), 'err');
    } finally { b.disabled = false; }
  };
});

function applyAnswer() {
  let a;
  try { a = parseAnswer($('answerIn').value); } catch (e) { aiStatus(e.message, 'err'); return; }
  const d = state.drawing;
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
      else if (['door', 'window', 'empty'].includes(o.kind)) patch.kind = o.kind;
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
  let msg = done.length ? 'Uygulandı: ' + done.join(', ') + '.' : 'Cevapta uygulanacak bir ayar bulunamadı.';
  if (Array.isArray(a.questions) && a.questions.length) msg += ' Yapay zekânın soruları: ' + a.questions.slice(0, 3).join(' / ');
  if (missing.length) msg += ' Bulunamayan katman: ' + missing.join(', ') + '.';
  if (layersChanged && (a.openings || a.rooms)) msg += ' Katmanlar değiştiği için boşluk/mahal numaraları yenilendi; ince ayar için yeni bir komut oluşturup tekrar sorun.';
  if (a.notes) msg += ' Not: ' + a.notes;
  aiStatus(msg, done.length ? 'ok' : 'err');
}
$('btnApply').onclick = applyAnswer;

// ------------------------------------------------------------ RVT inceleme
const rvtStatus = (m, k) => setStatus($('rvtStatus'), m, k);
async function inspectRvt(file) {
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
$('btnRvtSample').onclick = async () => {
  rvtStatus('Örnek RVT indiriliyor (11 MB)…');
  try {
    inspectRvt(new File([await fetchSample(SAMPLE_RVT)], 'taziye_evi_30092026.dwg.rvt'));
  } catch (e) { rvtStatus('Örnek RVT indirilemedi: ' + e.message, 'err'); }
};

// ------------------------------------------------------------ başlangıç
plan.resize();
loadSample();
