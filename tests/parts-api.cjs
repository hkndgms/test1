// Pafta bölümleri + kesit okuma + bindirme: sayfa API'si (window.dwg2bim.api) üzerinden
// node tests/parts-api.cjs <url> <dwg>
const { chromium } = require(process.env.PW || 'playwright');
(async () => {
  const [url, dwg] = [process.argv[2] || 'http://localhost:8765/', process.argv[3]];
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox', '--use-gl=swiftshader'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  p.on('pageerror', (e) => console.log('PAGEERROR', e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded' });
  await p.waitForSelector('#welcome:not([hidden])');
  await p.setInputFiles('#fileInput', dwg);
  await p.waitForFunction(() => /lgılandı|bulunamadı/.test(document.getElementById('status').textContent), null, { timeout: 180000 });
  const list = await p.evaluate(() => window.dwg2bim.api.setParts(null));
  console.log(list);
  const rows = list.split('\n').slice(1).map((r) => r.split('\t'));
  const sec = rows.find((r) => /kesit/.test(r[2])) || rows[1];
  if (sec) console.log('\n--- read_part', sec[0], '\n' + (await p.evaluate((id) => window.dwg2bim.api.readPart(id), sec[0])).slice(0, 1200));
  const sim = rows.find((r) => /benzer boyut/.test(r.join('\t')));
  if (sim) {
    const other = sim.join('\t').match(/benzer boyut: ([\d,]+)/)[1].split(',')[0];
    console.log('\n--- overlay', other, '→', sim[0]);
    console.log(await p.evaluate(([b2, o]) => window.dwg2bim.api.overlayParts(b2, [o]), [sim[0], other]));
    await p.waitForFunction(() => /lgılandı/.test(document.getElementById('status').textContent), null, { timeout: 120000 });
    console.log('after overlay:', await p.textContent('#sideSum'));
  }
  await b.close();
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
