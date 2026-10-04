// Uçtan uca tarayıcı testi: node tests/e2e.cjs <url> <çıktı klasörü>
const path = require('path');
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const url = process.argv[2] || 'http://localhost:8765/';
  const out = process.argv[3] || '.';
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: 'localhost,127.0.0.1' } : undefined;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'], proxy });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, acceptDownloads: true, colorScheme: process.env.DARK ? 'dark' : 'light' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  const t0 = Date.now();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => /lgılandı|bulunamadı|açılamadı/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
  console.log('status:', await page.textContent('#status'), `(${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  console.log('stats:', await page.$$eval('.stat', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
  console.log('note:', await page.textContent('#resultNote'));
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(out, 'e2e-plan.png') });
  // bir boşluğa tıkla: plan ortasında arama yerine model koordinatından
  const clicked = await page.evaluate(() => true);
  // 3B
  await page.click('#tab3d');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: path.join(out, 'e2e-3d.png') });
  await page.click('#tabPlan');
  // yapay zekâ komutu
  await page.click('#stepAi summary');
  await page.click('#btnPrompt');
  const prompt = await page.inputValue('#promptOut');
  console.log('prompt length', prompt.length);
  require('fs').writeFileSync(path.join(out, 'prompt.txt'), prompt);
  // örnek cevap uygula
  await page.fill('#answerIn', '```json\n{"params":{"wallHeightCm":320,"doorHeightCm":220},"openings":{"O1":{"kind":"door"}},"rooms":{"R1":{"name":"Test Mahal"}},"notes":"deneme"}\n```');
  await page.click('#btnApply');
  console.log('ai:', await page.textContent('#aiStatus'));
  // IFC indir
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 15000 }), page.click('#btnExport')]);
  const p = path.join(out, dl.suggestedFilename());
  await dl.saveAs(p);
  console.log('download:', p);
  // RVT
  await page.click('#stepRvt summary');
  await page.click('#btnRvtSample');
  await page.waitForFunction(() => /Okundu|okunamadı|indirilemedi/.test(document.getElementById('rvtStatus').textContent), null, { timeout: 60000 });
  console.log('rvt:', await page.textContent('#rvtStatus'));
  console.log('rvt facts:', (await page.textContent('#rvtOut')).replace(/\s+/g, ' ').slice(0, 400));
  await page.screenshot({ path: path.join(out, 'e2e-panel.png'), fullPage: false });
  console.log('console errors/warnings:', errors.length ? '\n  ' + errors.slice(0, 15).join('\n  ') : 'none');
  await browser.close();
})().catch((e) => { console.error('E2E FAILED', e); process.exit(1); });
