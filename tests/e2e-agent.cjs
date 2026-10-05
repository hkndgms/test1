// Ajan modu tarayıcı testi: claude.ai'nin `sample` yeteneği taklit edilir (gerçek model yok).
// Taklit, sayfanın araçlarını çağırır (get_overview, list_openings, apply, show) ve bir cevap yazar;
// böylece araç bağlantısı, sohbet arayüzü ve analiz ekranı akışı doğrulanır.
// node tests/e2e-agent.cjs <url> <çıktı klasörü>
const path = require('path');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8765/';
  const out = process.argv[3] || '.';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/404|ERR_/.test(m.text())) errors.push(m.text()); });
  await page.addInitScript(() => {
    // Taklit sample: araçları sırayla çağırır, sonra metin üretir
    const calls = [];
    window.__sampleCalls = calls;
    const sample = async (input, opts = {}) => {
      const turns = Array.isArray(input) ? input : [{ role: 'user', content: input }];
      const last = turns[turns.length - 1].content;
      calls.push({ turns: turns.length, last: last.slice(0, 80), tools: (opts.tools || []).map((t) => t.name), tier: opts.modelTier });
      const tool = (n) => (opts.tools || []).find((t) => t.name === n);
      const log = [];
      const call = async (n, inp) => { const t = tool(n); if (!t) return `no tool ${n}`; try { const r = await t.execute(inp || {}, { signal: new AbortController().signal }); log.push(n + ' ok'); return r; } catch (e) { log.push(n + ' err ' + e.message); return 'Error: ' + e.message; } };
      let text;
      if (/uçtan uca|GÖREV:/i.test(last)) {
        const ov = await call('get_overview');
        const ops = await call('list', { what: 'openings', kind: 'empty' });
        const rooms = await call('list', { what: 'rooms' });
        const firstRoom = String(rooms).split('\n')[1]?.split('\t')[0];
        const firstOpening = String(await call('list', { what: 'openings' })).split('\n')[1]?.split('\t')[0];
        const changes = { params: { wallHeightCm: 330 }, ceilingCm: 300, ceilingReason: 'test', report: 'Taklit inceleme raporu.', issues: [{ severity: 'low', title: 'Test', detail: 'taklit', fixed: true }] };
        if (firstRoom) changes.rooms = { [firstRoom]: { name: 'Test Mahal' } };
        if (firstOpening) changes.openings = { [firstOpening]: { kind: 'door' } };
        const applied = await call('apply', { changes });
        text = `İnceleme bitti. Özet ${String(ov).length} karakter, boş geçiş listesi ${String(ops).split('\n').length - 1} satır.\nUygulandı: ${applied}\n[${log.join(', ')}]`;
      } else if (/masa|sandalye|tefriş ekle/i.test(last)) {
        const rooms = String(await call('list', { what: 'rooms' })).split('\n').slice(1);
        const big = rooms.map((r) => r.split('\t')).sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]))[0];
        const r = await call('add_fixtures', { kind: 'table_set', room: big[0], count: 4 });
        const r2 = await call('add_fixtures', { kind: 'ac', room: big[0], count: 1, layout: 'perimeter' });
        text = `${r} / ${r2} [${log.join(', ')}]`;
      } else if (/kapı aç|kapı ekle/i.test(last)) {
        const walls = String(await call('list', { what: 'walls' })).split('\n').slice(2).map((r) => r.split('\t')).filter((r) => r[1] === 'duvar' && r[4] === 'iç' && parseFloat(r[3]) > 3);
        const r = await call('add_structure', { type: 'door', wall: walls[0][0], widthCm: 100 });
        const c = await call('add_structure', { type: 'column', at: [300, 300], sizeCm: [40, 40] });
        text = `${r} / ${c} [${log.join(', ')}]`;
      } else if (/kütüphane|tabure/i.test(last)) {
        const u = await call('list', { what: 'notes' });
        const a = await call('library', { action: 'add', name: 'bar_tabure', label: 'Bar taburesi', kind: 'chair', sizeCm: [38, 38], aliases: ['TABURE|STOOL'], parts: [{ x: 0, y: 0, w: 36, d: 36, z0: 70, z1: 76, mat: 'fabric', shape: 'oval' }, { x: 0, y: 14, w: 4, d: 4, z0: 0, z1: 70, mat: 'chrome' }, { x: 0, y: 0, w: 36, d: 36, z0: 0, z1: 2, mat: 'chrome', shape: 'oval' }] });
        const rooms = String(await call('list', { what: 'rooms' })).split('\n').slice(1).map((r) => r.split('\t'));
        const mut = rooms.find((r) => /MUTFAK/.test(r[2])) || rooms[0];
        const r = await call('add_fixtures', { kind: 'bar_tabure', room: mut[0], count: 3, layout: 'row' });
        const l = await call('list', { what: 'library' });
        text = `${String(u).split('\n')[0]} / ${a} / ${r} / kütüphane ${String(l).split('\n').length - 1} satır [${log.join(', ')}]`;
      } else if (/kapıyı taşı|duvarı sil/i.test(last)) {
        const ops = String(await call('list', { what: 'openings', kind: 'door' })).split('\n').slice(1).map((r) => r.split('\t')).filter((r) => r[3] === 'iç');
        const e = await call('edit', { id: ops[0][0], shiftCm: 60 });
        const walls = String(await call('list', { what: 'walls' })).split('\n').slice(2).map((r) => r.split('\t')).filter((r) => r[1] === 'duvar' && r[4] === 'iç');
        const w = await call('edit', { id: walls[walls.length - 1][0], delete: true });
        text = `${e} / ${w} [${log.join(', ')}]`;
      } else if (/yerden ısıtma|çiz/i.test(last)) {
        const mk = await call('list', { what: 'marks' });
        const rooms = String(await call('list', { what: 'rooms' })).split('\n').slice(1).map((r) => r.split('\t'));
        const of = rooms.find((r) => /OFİS 1/.test(r[2])) || rooms[0];
        const lib = await call('list', { what: 'library', filter: 'ısıtma' });
        const n = await call('library', { action: 'add', name: 'yerden_isitma_std', kind: 'recipe', label: 'Yerden ısıtma standardı', text: 'PE-X 16 mm, aralık 15 cm, kenar payı 25 cm, kolektörden başla', tags: ['ısıtma', 'serpantin'], params: { pitchCm: 15, marginCm: 25 } });
        const d = await call('draw', { pattern: 'serpentine', room: of[0], pitchCm: 15, marginCm: 25, layer: 'M-YERDEN ISITMA', system: 'heating' });
        const e = await call('draw', { entities: [{ type: 'circle', center: [100, 100], r: 20 }, { type: 'text', at: [120, 100], text: 'KOLEKTÖR', h: 12 }], layer: 'M-YERDEN ISITMA' });
        const x = await call('export', { format: 'dxf', include: 'model' });
        text = `${String(mk).split('\n')[0]} / ${n} / ${d} / ${e} / ${x} [${log.join(', ')}]`;
      } else if (/3b|3d/i.test(last)) {
        const r = await call('show', { view: '3d' });
        text = `3B görünüme geçtim (${r}). [${log.join(', ')}]`;
      } else {
        const r = await call('list', { what: 'mep' });
        text = `Tesisat özeti ilk satır: ${String(r).split('\n')[0]} [${log.join(', ')}]`;
      }
      if (opts.onText) opts.onText({ text, delta: text });
      return { text, truncated: false, modelTierApplied: opts.modelTier || 'default' };
    };
    sample.json = async () => ({});
    sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 16 } });
    // 19 araç 20 sınırının altında kalmalı
    window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#welcome:not([hidden])', { timeout: 60000 });
  await page.click('#welcomeDemo');
  await page.waitForFunction(() => /lgılandı/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  await page.waitForFunction(() => !document.getElementById('agentReview').disabled, null, { timeout: 20000 });
  console.log('intro:', (await page.textContent('#chatLog')).replace(/\s+/g, ' ').slice(0, 120));
  console.log('side:', await page.textContent('#sideFile'), '|', await page.textContent('#sideSum'));
  console.log('parts menu hidden (demo tek bölüm):', await page.$eval('#partsMenu', (e) => e.hidden), '| legacy hidden:', await page.$eval('#legacy', (e) => e.hidden));
  console.log('agent tier:', await page.textContent('#agentTier'));
  // uçtan uca inceleme
  const idle = (n) => page.waitForFunction((n) => document.querySelectorAll('#chatLog .msg.user').length > n && !document.getElementById('chatSend').disabled && !document.querySelector('#chatLog .msg.ai.thinking'), n, { timeout: 120000 });
  await page.click('#agentReview');
  await idle(0);
  console.log('status:', await page.textContent('#agentStatus'));
  console.log('chat:', (await page.textContent('#chatLog')).replace(/\s+/g, ' ').slice(0, 500));
  console.log('ai status:', await page.textContent('#aiStatus'));
  console.log('wall height param:', await page.inputValue('#pWallH').catch(() => '?'), '| ceiling:', await page.textContent('#ceilSrc'));
  // sohbet
  await page.fill('#chatIn', 'Tesisat katmanlarını özetle');
  await page.press('#chatIn', 'Enter');
  await idle(1);
  await page.fill('#chatIn', '3B göster');
  await page.press('#chatIn', 'Enter');
  await idle(2);
  console.log('tab 3d after chat:', await page.$eval('#tab3d', (b) => b.classList.contains('on')));
  // çizimde olmayan öğeler: masa-sandalye, klima, kapı, kolon
  // kullanıcı işareti: plan üstüne nokta koy (API ile)
  await page.evaluate(() => window.dwg2bim.api && window.dwg2bim.state.marks.length === 0 && (window.__mark = true));
  const dlAll = [];
  page.on('download', (d) => dlAll.push(d));
  for (const msg of ['Giriş holüne masa sandalye koy', 'Koridora bir kapı aç', 'Kütüphaneye bar taburesi ekle ve mutfağa koy', 'İlk iç kapıyı taşı ve son iç duvarı sil', 'Ofis 1 e yerden ısıtma çiz ve dxf indir']) {
    const n = await page.$$eval('#chatLog .msg.user', (l) => l.length);
    await page.fill('#chatIn', msg); await page.press('#chatIn', 'Enter');
    await idle(n);
    console.log('>', msg, '→', (await page.$$eval('#chatLog .msg.ai', (l) => l[l.length - 1].textContent)).slice(0, 200));
  }
  console.log('side after adds:', await page.textContent('#sideSum'));
  console.log('sketches:', await page.evaluate(() => window.dwg2bim.state.sketches.length), '| dxf downloads:', dlAll.map((d) => d.suggestedFilename()).join(','));
  if (dlAll.length) { const pth = path.join(out, 'agent-' + dlAll[0].suggestedFilename()); await dlAll[0].saveAs(pth); console.log('dxf saved:', pth); }
  await page.click('#tabPlan'); await page.waitForTimeout(800); await page.screenshot({ path: path.join(out, 'e2e-agent-plan.png') });
  await page.click('#tab3d'); await page.waitForTimeout(1500);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(out, 'e2e-agent-adds.png') });
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), page.click('#btnExportTop')]);
  const ifcPath = path.join(out, 'agent-' + dl.suggestedFilename()); await dl.saveAs(ifcPath); console.log('ifc:', ifcPath);
  console.log('sample calls:', JSON.stringify(await page.evaluate(() => window.__sampleCalls.map((c) => ({ turns: c.turns, tier: c.tier, tools: c.tools.length })))));
  await page.screenshot({ path: path.join(out, 'e2e-agent.png') });
  // analiz ekranı akışı: yeni dosya yerine demo yeniden açılıp wizClaude benzetimi
  console.log('wizClaude label:', await page.textContent('#wizClaude'), '| hidden:', await page.$eval('#wizClaude', (b) => b.hidden));
  console.log('errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error('E2E-AGENT FAILED', e); process.exit(1); });
