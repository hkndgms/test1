// Projenin teşhisi: programın emin olamadığı veya eksik bulduğu noktalar.
// Hem "Yapılacaklar" listesine hem de yapay zekâ analiz komutuna girer.
import { SYSTEMS, fold } from './kb.js';

export function diagnose(st) {
  const out = [];
  const add = (severity, code, text, data) => out.push({ severity, code, text, data });
  const d = st.drawing;
  if (!d) return out;
  const m = st.model;
  const layerName = (l) => d.layers[l]?.name || '?';

  if (st.unitNote) add('low', 'unit', st.unitNote);
  if (!m?.walls.length) add('high', 'no-walls', 'Mimari duvar bulunamadı; duvar katmanı yanlış seçilmiş ya da çizim yalnız tesisat içeriyor olabilir.');

  // Mimari belirsizlikler
  if (m?.walls.length) {
    const ov = st.overrides;
    const kind = (o) => ov[o.id]?.kind || o.kind;
    const ext = m.openings.filter((o) => o.exterior);
    if (ext.length && !ext.some((o) => kind(o) === 'door')) add('medium', 'entrance', `Dış cephedeki ${ext.length} boşluğun hepsi pencere sayıldı; giriş kapıları belirlenmeli.`, ext.map((o) => o.id));
    const weak = m.openings.filter((o) => o.weak && !ov[o.id]);
    if (weak.length) add('low', 'weak-openings', `${weak.length} boşluk bir duvarın yan yüzüne bakıyor (koridor da olabilir, kapı da).`, weak.map((o) => o.id));
    const noname = m.rooms.filter((r) => !(ov[r.id]?.name ?? r.name));
    if (noname.length) add('low', 'room-names', `${noname.length} mahalin adı çizimde bulunamadı.`, noname.map((r) => r.id));
    const odd = m.walls.filter((w) => { const t = w.thickness * m.unitScale; return t < 7 || t > 45; });
    if (odd.length) add('low', 'wall-thickness', `${odd.length} duvarın kalınlığı alışılmadık (7 cm altı veya 45 cm üstü); kaplama, parapet veya yanlış algı olabilir.`, odd.map((w) => w.id));
  }

  // Tesisat
  const prof = st.mepProfiles || new Map();
  const unknown = (st.mepStats || []).filter((s) => { const p = prof.get(s.l); return p?.unknown && !p.kind; });
  if (unknown.length) add('high', 'unknown-layers', `${unknown.length} tesisat katmanı tanınmadı: ${unknown.slice(0, 8).map((s) => s.name).join(', ')}.`, unknown.map((s) => s.name));
  const mepN = st.mep ? st.mep.pipes.length + st.mep.ducts.length + st.mep.boxes.length : 0;
  if (mepN && st.ceiling?.source === 'default') add('high', 'ceiling', 'Asma tavan kotu projede bulunamadı; tesisat varsayılan 280 cm ile yerleştirildi.');
  if (st.mep) {
    const noDia = new Map();
    for (const p of st.mep.pipes) if (p.diaSrc !== 'label') { const s = prof.get(p.l)?.system || 'other'; noDia.set(s, (noDia.get(s) || 0) + p.lengthCm / 100); }
    const rows = [...noDia.entries()].filter(([, v]) => v > 5).map(([k, v]) => `${(SYSTEMS[k] || SYSTEMS.other).label} ${v.toFixed(0)} m`);
    if (rows.length) add('low', 'pipe-dia', `Çap yazısı bulunamayan borular varsayılan çapla çizildi: ${rows.join(', ')}.`);
  }
  const xrefIgn = (st.mepStats || []).filter((s) => { const p = prof.get(s.l); return p?.kind === 'ignore' && p.wouldBe && s.count >= 50; });
  if (xrefIgn.length) add('medium', 'xref-mep', `Başka çizimden bağlanmış ${xrefIgn.length} tesisat katmanı yok sayıldı (${xrefIgn.slice(0, 4).map((s) => `${s.name} (${s.count})`).join(', ')}). Bu projeye aitse etkinleştirilmeli.`, xrefIgn.map((s) => s.name));
  const zero = (st.mepStats || []).find((s) => s.name === '0' && s.count > 500);
  if (zero) add('low', 'layer-0', `"0" katmanında bölgede ${zero.count} nesne var (blok içerikleri: ${zero.blocks.join(', ') || '-'}); tesisat cihazları burada kalmış olabilir.`);
  const other = (st.islands || []).filter((i) => i !== st.planIsland && (i.mep || 0) >= 200);
  if (other.length) add('low', 'other-islands', `Asıl plan dışında tesisat içeren ${other.length} çizim grubu yok sayıldı (kolon şeması, lejant veya başka kat olabilir).`);
  return out;
}

export const SEV_LABEL = { high: 'önemli', medium: 'orta', low: 'düşük' };
export { fold };
