// DWG2BIM ana uygulama: dosya okuma, katman rolleri, algılama, düzenleme,
// 3B önizleme, IFC dışa aktarma, yapay zekâ asistanı ve RVT inceleme.
import { detect, DEFAULT_PARAMS, UNIT_NAMES, UNIT_TO_CM, collectSegments, buildFaces } from './detect.js';
import { buildSolids, DEFAULT_BUILD } from './build3d.js';
import { writeIfc } from './ifc.js';
import { makeZip } from './zip.js';
import { Plan2D, findById } from './view2d.js';
import { buildPrompt, parseAnswer } from './ai-prompt.js';
import { readRvt } from './rvt.js';

const $ = (id) => document.getElementById(id);
const SAMPLE_DWG = 'samples/taziye-evi.dwg';
const SAMPLE_RVT = 'samples/taziye-evi.rvt';

const state = {
  drawing: null,
  fileName: '',
  units: 5,
  roles: { wall: new Set(), column: new Set(), text: new Set() },
  region: null,
  autoRegion: null,
  params: { ...DEFAULT_PARAMS },
  build: { ...DEFAULT_BUILD },
  model: null,
  overrides: {},
  selected: null,
  tab: 'plan',
  view3d: null,
};

// ------------------------------------------------------------ yardımcılar
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
let worker = null;
function getWorker() {
  if (!worker) worker = new Worker(new URL('./dwg-worker.js', import.meta.url), { type: 'module' });
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
    overlay('Örnek proje indiriliyor (4,4 MB)…');
    const r = await fetch(SAMPLE_DWG);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    loadBuffer(await r.arrayBuffer(), 'ÖRNEK · 03.10.2026_TAZIYE_EVI_MEKANIK_PROJE.dwg');
  } catch (e) {
    overlay('Örnek dosya indirilemedi (' + e.message + '). Kendi DWG dosyanızı açabilirsiniz.', 'Örnek açılamadı');
  }
}

function onDrawing(d, secs) {
  state.drawing = d;
  state.units = UNIT_TO_CM[d.units] != null && d.units !== 0 ? d.units : 5;
  state.region = null;
  plan.setDrawing(d);
  autoRoles();
  renderLayers();
  renderFacts(secs);
  ['btnDetect', 'btnPrompt', 'btnAsk'].forEach((id) => ($(id).disabled = false));
  runDetect();
  plan.fitModel();
  overlay(null);
  if (state.model?.walls.length) status(`Okundu (${secs} sn) ve algılandı. Plandaki öğelere tıklayarak düzenleyebilirsiniz.`, 'ok');
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
const WALL_RE = /duvar|wall|perde/i;
const COL_RE = /beton|kolon|column|colm|struct|tasiyici|taşıyıcı/i;
const SKIP_RE = /^m[-_]|hvac|vrf|tesisat|walky|tefri|tarama|hatch|olcu|ölçü|dim|yazi|yazı|text/i;

function layerBBox(set) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const p of state.drawing.prims) {
    if (!set.has(p.l)) continue;
    for (let i = 0; i < p.pts.length; i += 2) {
      const x = p.pts[i], y = p.pts[i + 1];
      if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y;
    }
  }
  if (!isFinite(a)) return null;
  const m = Math.max(c - a, d - b) * 0.05;
  return [a - m, b - m, c + m, d + m];
}

function autoRoles() {
  const d = state.drawing;
  const k = 1 / (UNIT_TO_CM[state.units] ?? 1);
  const tol = state.params.tolCm * k;
  const cands = d.layers.map((l, i) => ({ l, i })).filter(({ l }) => l.count > 0 && WALL_RE.test(l.name) && !SKIP_RE.test(l.name));
  // Her aday katmanla gerçek algılama yap; bir binayı en iyi tarif edeni seç
  // (mahal, adlı mahal ve dış duvar sayısı ağır basar). Çok kalabalık katmanlar
  // genellikle bütün paftaya dağılmış detaylardır; yalnızca yedek olarak bakılır.
  let best = null;
  const big = [];
  for (const c of cands) {
    const segs = collectSegments(d, new Set([c.i]), null);
    if (segs.length > 20000) { big.push({ c, n: segs.length }); continue; }
    const set = new Set([c.i]);
    const m = detect(d, { units: state.units, wallLayers: set, columnLayers: new Set(), region: layerBBox(set), params: state.params });
    const score = 10 * m.rooms.length + 10 * m.rooms.filter((r) => r.name).length + 2 * m.walls.filter((w) => w.exterior).length + 0.5 * m.walls.length;
    if (score > 0 && (!best || score > best.score)) best = { i: c.i, score };
  }
  if (!best && big.length) {
    big.sort((a, b) => a.n - b.n);
    const f = buildFaces(collectSegments(d, new Set([big[0].c.i]), null), tol, [state.params.minThicknessCm * k * 0.5, state.params.maxThicknessCm * k]);
    if (f.faces.some((x) => x.area > 0)) best = { i: big[0].c.i, score: 1 };
  }
  state.roles = { wall: new Set(best ? [best.i] : []), column: new Set(), text: new Set() };
  state.autoRegion = best ? layerBBox(state.roles.wall) : null;
  if (best) {
    let bc = null;
    for (const { l, i } of d.layers.map((l, i) => ({ l, i }))) {
      if (!l.count || !COL_RE.test(l.name) || /tarama|hatch/i.test(l.name)) continue;
      const m = detect(d, { units: state.units, wallLayers: new Set(), columnLayers: new Set([i]), region: state.autoRegion, params: state.params });
      if (!bc || m.columns.length > bc.n) bc = { i, n: m.columns.length };
    }
    if (bc && bc.n > 0) state.roles.column.add(bc.i);
  }
}

function roleOf(i) {
  return state.roles.wall.has(i) ? 'wall' : state.roles.column.has(i) ? 'column' : state.roles.text.has(i) ? 'text' : '';
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
    if (e.target.value === 'wall' || state.roles.wall.size) state.autoRegion = layerBBox(state.roles.wall);
    runDetect();
  }
});
function applyLayerFilter() {
  const q = $('layerFilter').value.trim().toLowerCase();
  for (const tr of $('layerRows').querySelectorAll('tr[data-i]')) tr.hidden = q && !tr.dataset.name.includes(q);
}
$('layerFilter').oninput = applyLayerFilter;
$('btnAuto').onclick = () => { if (!state.drawing) return; autoRoles(); state.region = null; renderLayers(); runDetect(); plan.fitModel(); };
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
function runDetect() {
  if (!state.drawing) return;
  const t0 = performance.now();
  if (!state.roles.wall.size) {
    state.model = null;
    plan.setModel(null);
    renderStats();
    status('Duvar katmanı seçilmedi. Katman listesinden en az bir katmanı "Duvar" yapın.', 'err');
    return;
  }
  const region = state.region || state.autoRegion || null;
  plan.region = state.region;
  state.model = detect(state.drawing, {
    units: state.units, wallLayers: state.roles.wall, columnLayers: state.roles.column,
    textLayers: state.roles.text, region, params: state.params,
  });
  state.overrides = {};
  state.selected = null;
  plan.setModel(state.model, state.overrides);
  renderStats();
  renderSel();
  rebuild3d(false);
  ['btnExport', 'btnExportTop'].forEach((id) => ($(id).disabled = !state.model.walls.length));
  const ms = Math.round(performance.now() - t0);
  if (!state.model.walls.length) status('Seçilen katmanlarda duvar bulunamadı. Başka bir katman deneyin veya "En kalın duvar" ayarını artırın.', 'err');
  else status(`Algılandı (${ms} ms). Plandaki öğelere tıklayarak düzenleyebilirsiniz.`, 'ok');
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

function rebuild3d(keepCamera = true) {
  if (!state.view3d || !state.model) return;
  state.view3d.setSolids(buildSolids(state.model, state.build, state.overrides).solids, { keepCamera });
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
  const ifc = writeIfc(buildSolids(state.model, state.build, state.overrides), { fileName: name + '.ifc' });
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
  return buildPrompt({ drawing: state.drawing, roles: state.roles, params: state.params, buildParams: state.build, model: state.model, fileName: state.fileName });
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
    for (const [key, role] of [['walls', 'wall'], ['columns', 'column'], ['texts', 'text']]) {
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
  plan.setModel(state.model, state.overrides);
  renderStats();
  rebuild3d();
  renderSel();
  let msg = done.length ? 'Uygulandı: ' + done.join(', ') + '.' : 'Cevapta uygulanacak bir ayar bulunamadı.';
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
  rvtStatus('Örnek RVT indiriliyor (8 MB)…');
  try {
    const r = await fetch(SAMPLE_RVT);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    inspectRvt(new File([await r.blob()], 'taziye_evi_30092026.dwg.rvt'));
  } catch (e) { rvtStatus('Örnek RVT indirilemedi: ' + e.message, 'err'); }
};

// ------------------------------------------------------------ başlangıç
plan.resize();
loadSample();
