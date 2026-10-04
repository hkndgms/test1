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
  // kot sorusu açıldıysa: önerilen ilk kotu seç, yoksa varsayılanla devam
  const handleCeil = async (label) => {
    if (await page.isVisible('#ceilDlg')) {
      const cands = await page.$$('#ceilDlgCands button');
      if (cands.length) await cands[0].click();
      const v = await page.inputValue('#ceilDlgCm');
      await page.click('#ceilDlgOk');
      console.log('   kot sorusu (' + label + '): ' + v + ' cm seçildi');
    }
  };
  await handleCeil('ilk');
  console.log('mep note:', await page.textContent('#mepNote'));
  console.log('systems:', (await page.textContent('#sysChips')).replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: path.join(out, 'e2e-plan.png') });
  // Örnekten sonra başka DWG dosyaları yükle (EXTRA=dosya1,dosya2)
  for (const f of (process.env.EXTRA || '').split(',').filter(Boolean)) {
    await page.evaluate(() => { document.getElementById('status').textContent = ''; });
    await page.setInputFiles('#fileInput', f);
    await page.waitForFunction(() => /lgılandı|bulunamadı|açılamadı|seçilmedi|Okundu/.test(document.getElementById('status').textContent) || !document.getElementById('overlay').hidden && /açılamadı|Hata/.test(document.querySelector('#overlay b').textContent), null, { timeout: 60000 });
    const ov = await page.$eval('#overlay', (o) => (o.hidden ? '' : o.textContent.replace(/\s+/g, ' ')));
    await page.waitForTimeout(800);
    await handleCeil(path.basename(f));
    console.log('   mep note:', await page.textContent('#mepNote'));
    console.log('   systems:', (await page.textContent('#sysChips')).replace(/\s+/g, ' ').trim());
    console.log('   ceiling:', await page.inputValue('#ceilCm'), '|', await page.textContent('#ceilSrc'));
    console.log('extra', path.basename(f), '->', (await page.textContent('#status')).slice(0, 260), ov ? '| overlay: ' + ov.slice(0, 160) : '');
    console.log('   stats:', await page.$$eval('.stat', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()).join(' | ')));
    console.log('   wall layer:', await page.$$eval('tr.role-wall td.nm, tr.role-column td.nm', (els) => els.map((e) => e.textContent).join(', ')), '| unit:', await page.$eval('#pUnits', (s) => s.value));
    await page.screenshot({ path: path.join(out, 'e2e-extra-' + path.basename(f) + '.png') });
    await page.click('#tab3d'); await page.waitForTimeout(4000);
    await page.screenshot({ path: path.join(out, 'e2e-extra3d-' + path.basename(f) + '.png') });
    await page.click('#tabPlan');
  }
  if (process.env.EXTRA) { console.log('console errors/warnings:', errors.filter((e) => !/error code: 64|ERR_TOO_MANY|404/.test(e)).join('\n  ') || 'none'); await browser.close(); return; }
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
  await page.fill('#answerIn', '```json\n{"params":{"wallHeightCm":320,"doorHeightCm":220},"openings":{"O1":{"kind":"door"}},"rooms":{"R1":{"name":"Test Mahal"}},' +
    '"mep":{"M-HVAC EMİŞ":{"kind":"air","system":"returnair","elevRef":"ceiling","elevOffsetCm":-10,"sizeCm":25}},' +
    '"learn":[{"pattern":"YANGIN[\\\\s._-]*YMV|YANGIN[\\\\s._-]*DOLAB","kind":"equipment","system":"fire","elevRef":"floor","elevOffsetCm":60,"sizeCm":90,"note":"yangın dolabı"}],' +
    '"ignore":[{"pattern":"KOLON[\\\\s._-]*SEMA","reason":"kolon şeması"}],"ceilingCm":300,"ceilingReason":"test","notes":"deneme"}\n```');
  await page.click('#btnApply');
  console.log('ai:', await page.textContent('#aiStatus'));
  console.log('kb:', await page.textContent('#kbStats'), '|', (await page.textContent('#kbList')).slice(0, 160));
  console.log('ceiling after ai:', await page.inputValue('#ceilCm'), '|', await page.textContent('#ceilSrc'));
  const hasLearned = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('dwg2bim.kb.v1')).learned.length; } catch { return -1; } });
  console.log('localStorage learned rules:', hasLearned);
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
