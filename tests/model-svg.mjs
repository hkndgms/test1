// Algılanan modeli hata ayıklama için SVG'ye çizer: node tests/model-svg.mjs model.json out.svg
import fs from 'fs';
const { model: m } = JSON.parse(fs.readFileSync(process.argv[2]));
const all = [...m.walls, ...m.columns].flatMap((w) => w.poly);
const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
const x0 = Math.min(...xs) - 50, x1 = Math.max(...xs) + 50, y0 = Math.min(...ys) - 50, y1 = Math.max(...ys) + 50;
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const P = (poly) => poly.map((p) => `${p[0].toFixed(1)},${(-p[1]).toFixed(1)}`).join(' ');
const out = [];
for (const r of m.rooms) out.push(`<polygon points="${P(r.poly)}" fill="#ffe9a8" stroke="#c90" stroke-width="2"/>`);
for (const w of m.walls) out.push(`<polygon points="${P(w.poly)}" fill="${w.exterior ? '#d33' : '#f99'}" stroke="#600" stroke-width="1.5"/>`);
for (const c of m.columns) out.push(`<polygon points="${P(c.poly)}" fill="#33c" stroke="#003" stroke-width="1"/>`);
const oc = { window: '#2bd', door: '#2a2', empty: '#bbb' };
for (const o of m.openings) out.push(`<polygon points="${P(o.rect)}" fill="${oc[o.kind]}" fill-opacity="0.8"/><text x="${o.center[0]}" y="${-o.center[1]}" font-size="22" text-anchor="middle">${o.id}</text>`);
for (const r of m.rooms) { const c = r.poly.reduce((a, p) => [a[0] + p[0] / r.poly.length, a[1] + p[1] / r.poly.length], [0, 0]); out.push(`<text x="${c[0]}" y="${-c[1]}" font-size="30" text-anchor="middle">${esc(r.name || r.id)} ${(r.area / 1e4).toFixed(1)}</text>`); }
for (const w of m.walls) { const c = w.poly[0]; out.push(`<text x="${c[0]}" y="${-c[1]}" font-size="16" fill="#600">${w.id}</text>`); }
if (m.outline) out.push(`<polygon points="${P(m.outline)}" fill="none" stroke="#0a0" stroke-width="4" stroke-dasharray="20 10"/>`);
fs.writeFileSync(process.argv[3], `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${-y1} ${x1 - x0} ${y1 - y0}" width="2000" style="background:#fff">${out.join('')}</svg>`);
