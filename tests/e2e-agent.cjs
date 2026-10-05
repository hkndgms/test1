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
        const ops = await call('list_openings', { kind: 'empty' });
        const rooms = await call('list_rooms');
        const firstRoom = String(rooms).split('\n')[1]?.split('\t')[0];
        const firstOpening = String(await call('list_openings')).split('\n')[1]?.split('\t')[0];
        const changes = { params: { wallHeightCm: 330 }, ceilingCm: 300, ceilingReason: 'test', report: 'Taklit inceleme raporu.', issues: [{ severity: 'low', title: 'Test', detail: 'taklit', fixed: true }] };
        if (firstRoom) changes.rooms = { [firstRoom]: { name: 'Test Mahal' } };
        if (firstOpening) changes.openings = { [firstOpening]: { kind: 'door' } };
        const applied = await call('apply', { changes });
        text = `İnceleme bitti. Özet ${String(ov).length} karakter, boş geçiş listesi ${String(ops).split('\n').length - 1} satır.\nUygulandı: ${applied}\n[${log.join(', ')}]`;
      } else if (/3b|3d/i.test(last)) {
        const r = await call('show', { view: '3d' });
        text = `3B görünüme geçtim (${r}). [${log.join(', ')}]`;
      } else {
        const r = await call('list_mep');
        text = `Tesisat özeti ilk satır: ${String(r).split('\n')[0]} [${log.join(', ')}]`;
      }
      if (opts.onText) opts.onText({ text, delta: text });
      return { text, truncated: false, modelTierApplied: opts.modelTier || 'default' };
    };
    sample.json = async () => ({});
    sample.limits = async () => ({ maxPromptBytes: 262144, tools: { maxCount: 20 } });
    window.claude = { use: async (name) => (name === 'sample' ? sample : null) };
  });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#welcome:not([hidden])', { timeout: 60000 });
  await page.click('#welcomeDemo');
  await page.waitForFunction(() => /lgılandı/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  await page.click('#stabAi');
  await page.waitForFunction(() => !document.getElementById('agentReview').disabled, null, { timeout: 20000 });
  console.log('agent tier:', await page.textContent('#agentTier'));
  // uçtan uca inceleme
  await page.click('#agentReview');
  await page.waitForFunction(() => /Tamam|kesildi|veremedi|izin/.test(document.getElementById('agentStatus').textContent), null, { timeout: 120000 });
  console.log('status:', await page.textContent('#agentStatus'));
  console.log('chat:', (await page.textContent('#chatLog')).replace(/\s+/g, ' ').slice(0, 500));
  console.log('ai status:', await page.textContent('#aiStatus'));
  console.log('wall height param:', await page.inputValue('#pWallH').catch(() => '?'), '| ceiling:', await page.textContent('#ceilSrc'));
  // sohbet
  await page.fill('#chatIn', 'Tesisat katmanlarını özetle');
  await page.press('#chatIn', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#chatLog .msg.user').length >= 2 && /Tamam/.test(document.getElementById('agentStatus').textContent), null, { timeout: 60000 });
  await page.fill('#chatIn', '3B göster');
  await page.press('#chatIn', 'Enter');
  await page.waitForFunction(() => document.querySelectorAll('#chatLog .msg.user').length >= 3 && /Tamam/.test(document.getElementById('agentStatus').textContent), null, { timeout: 60000 });
  console.log('tab 3d after chat:', await page.$eval('#tab3d', (b) => b.classList.contains('on')));
  console.log('sample calls:', JSON.stringify(await page.evaluate(() => window.__sampleCalls.map((c) => ({ turns: c.turns, tier: c.tier, tools: c.tools.length })))));
  await page.screenshot({ path: path.join(out, 'e2e-agent.png') });
  // analiz ekranı akışı: yeni dosya yerine demo yeniden açılıp wizClaude benzetimi
  console.log('wizClaude label:', await page.textContent('#wizClaude'), '| hidden:', await page.$eval('#wizClaude', (b) => b.hidden));
  console.log('errors:', errors.length ? errors.join(' | ') : 'none');
  await browser.close();
})().catch((e) => { console.error('E2E-AGENT FAILED', e); process.exit(1); });
