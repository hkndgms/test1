// Algılanan 2B modeli + parametreleri, metre cinsinden 3B katılara çevirir.
// Hem 3B görünüm hem de IFC yazıcı bu listeyi kullanır.

import { polyArea } from './detect.js';

export const DEFAULT_BUILD = {
  projectName: 'Taziye Evi',
  storeyName: 'Zemin Kat',
  levelCm: 0,
  wallHeightCm: 300,
  slabThicknessCm: 15,
  makeFloor: true,
  makeRoof: false,
  roofThicknessCm: 20,
  doorHeightCm: 210,
  windowSillCm: 90,
  windowHeightCm: 150,
  makeSpaces: true,
};

// Element tipleri: wall, column, slab, roof, lintel, sill, door, window, space
export function buildSolids(model, params, overrides = {}) {
  const P = { ...DEFAULT_BUILD, ...params };
  const s = model.unitScale / 100; // çizim birimi -> metre
  const all = [...model.walls, ...model.columns].flatMap((w) => w.poly);
  let ox = Infinity, oy = Infinity;
  for (const [x, y] of all) { if (x < ox) ox = x; if (y < oy) oy = y; }
  if (!all.length) {
    // duvar yoksa (salt tesisat paftası) başlangıç noktası tesisattan alınır
    const m = params.mep;
    const pts = m ? [...m.pipes.flatMap((p) => p.pts), ...m.ducts.flatMap((d) => d.poly), ...m.boxes.flatMap((b) => b.poly)] : [];
    if (!pts.length) return { solids: [], origin: [0, 0], P };
    for (const [x, y] of pts) { if (x < ox) ox = x; if (y < oy) oy = y; }
  }
  const tr = (p) => [(p[0] - ox) * s, (p[1] - oy) * s];
  const ccw = (poly) => (polyArea(poly) < 0 ? poly.slice().reverse() : poly);
  const H = P.wallHeightCm / 100;
  const out = [];
  const ov = (id) => overrides[id] || {};

  for (const w of model.walls) {
    const o = ov(w.id);
    if (o.deleted) continue;
    const h = (o.heightCm ?? P.wallHeightCm) / 100;
    out.push({
      type: 'wall', id: w.id, src: w.id, name: `Duvar ${Math.round(w.thickness * model.unitScale)} cm`,
      profile: ccw(w.poly.map(tr)), z0: 0, z1: h,
      props: { exterior: !!w.exterior, thicknessCm: Math.round(w.thickness * model.unitScale), lengthM: +(w.length * s || 0).toFixed(2) },
    });
  }
  for (const c of model.columns) {
    const o = ov(c.id);
    if (o.deleted) continue;
    out.push({ type: 'column', id: c.id, src: c.id, name: 'Kolon', profile: ccw(c.poly.map(tr)), z0: 0, z1: (o.heightCm ?? P.wallHeightCm) / 100, props: {} });
  }
  for (const op of model.openings) {
    const o = ov(op.id);
    if (o.deleted) continue;
    const kind = o.kind || op.kind;
    const rect = ccw(op.rect.map(tr));
    const host = ov(op.hostWall);
    const top = (host.heightCm ?? P.wallHeightCm) / 100;
    const widthCm = Math.round(op.width * model.unitScale);
    if (kind === 'empty') continue;
    // kapı/pencere gövdesi: duvar ortasında ince bir levha
    const [cx, cy] = tr(op.center);
    const al = op.along, ac = op.across;
    const hw = (op.width * s) / 2;
    const panel = (thk) => ccw([
      [cx - al[0] * hw - ac[0] * thk / 2, cy - al[1] * hw - ac[1] * thk / 2],
      [cx + al[0] * hw - ac[0] * thk / 2, cy + al[1] * hw - ac[1] * thk / 2],
      [cx + al[0] * hw + ac[0] * thk / 2, cy + al[1] * hw + ac[1] * thk / 2],
      [cx - al[0] * hw + ac[0] * thk / 2, cy - al[1] * hw + ac[1] * thk / 2],
    ]);
    if (kind === 'door') {
      const dh = (o.heightCm ?? P.doorHeightCm) / 100;
      out.push({ type: 'door', id: op.id, src: op.id, name: `Kapı ${widthCm}`, profile: panel(0.05), z0: 0, z1: dh, props: { widthM: widthCm / 100, heightM: dh, exterior: op.exterior } });
      if (top - dh > 0.01) out.push({ type: 'lintel', id: op.id + '-L', src: op.id, name: `Lento ${op.id}`, profile: rect, z0: dh, z1: top, props: {} });
    } else {
      const sill = (o.sillCm ?? P.windowSillCm) / 100;
      const wh = (o.heightCm ?? P.windowHeightCm) / 100;
      const head = Math.min(top, sill + wh);
      if (sill > 0.01) out.push({ type: 'sill', id: op.id + '-S', src: op.id, name: `Parapet ${op.id}`, profile: rect, z0: 0, z1: sill, props: {} });
      out.push({ type: 'window', id: op.id, src: op.id, name: `Pencere ${widthCm}x${Math.round(wh * 100)}`, profile: panel(0.04), z0: sill, z1: head, props: { widthM: widthCm / 100, heightM: +(head - sill).toFixed(3), sillM: sill, exterior: op.exterior } });
      if (top - head > 0.01) out.push({ type: 'lintel', id: op.id + '-L', src: op.id, name: `Lento ${op.id}`, profile: rect, z0: head, z1: top, props: {} });
    }
  }
  if (model.outline && P.makeFloor) {
    out.push({ type: 'slab', id: 'SLAB', src: 'SLAB', name: 'Zemin döşemesi', profile: ccw(model.outline.map(tr)), z0: -P.slabThicknessCm / 100, z1: 0, props: {} });
  }
  if (model.outline && P.makeRoof) {
    out.push({ type: 'roof', id: 'ROOF', src: 'ROOF', name: 'Tavan döşemesi', profile: ccw(model.outline.map(tr)), z0: H, z1: H + P.roofThicknessCm / 100, props: {} });
  }
  if (P.makeSpaces) {
    for (const r of model.rooms) {
      const o = ov(r.id);
      if (o.deleted) continue;
      out.push({ type: 'space', id: r.id, src: r.id, name: o.name ?? r.name ?? '', profile: ccw(r.poly.map(tr)), z0: 0, z1: H, props: { areaM2: +(Math.abs(r.area) * s * s).toFixed(2) } });
    }
  }
  if (params.mep) out.push(...buildMepSolids(params.mep, params.mepProfiles, { ceilingCm: params.ceilingCm ?? 280, origin: [ox, oy], scale: s, layerNames: params.layerNames }));
  return { solids: out, origin: [ox, oy], scale: s, P };
}

// ------------------------------------------------------------ mekanik tesisat
// profiles: Map<layer, {kind, system, elevRef, elevOffsetCm, sizeCm}>
// Kot: (asma tavan veya döşeme) + fark. Boru: eksen kotu. Cihaz: tavana asılıysa
// üst yüzü, döşemedeyse alt yüzü bu kota oturur.
export function buildMepSolids(mep, profiles, { ceilingCm, origin, scale, layerNames = [] }) {
  if (!mep) return [];
  const [ox, oy] = origin;
  const s = scale;
  const tr = (p) => [(p[0] - ox) * s, (p[1] - oy) * s];
  const ccw = (poly) => (polyArea(poly) < 0 ? poly.slice().reverse() : poly);
  const elev = (prof) => ((prof.elevRef === 'floor' ? 0 : ceilingCm) + (prof.elevOffsetCm || 0)) / 100;
  const out = [];
  for (const p of mep.pipes) {
    const prof = profiles.get(p.l);
    if (!prof || prof.kind !== 'pipe' || prof.hidden) continue;
    const dia = (p.diaSrc === 'label' && p.diaCm ? p.diaCm : prof.sizeCm || 2.5) / 100;
    const z = elev(prof);
    out.push({
      type: 'pipe', id: p.id, src: p.id, l: p.l, system: prof.system, name: `${layerNames[p.l] || ''} Ø${Math.round(dia * 1000)}`,
      path: p.pts.map((q) => [...tr(q), z]), r: Math.max(dia / 2, 0.004),
      props: { diaMm: Math.round(dia * 1000), diaSrc: p.diaSrc, lengthM: +(p.lengthCm / 100).toFixed(2), layer: layerNames[p.l] || '' },
    });
  }
  for (const d of mep.ducts) {
    const prof = profiles.get(d.l);
    if (!prof || prof.kind !== 'air' || prof.hidden) continue;
    const h = (d.heightCm || Math.min(d.widthCm, prof.sizeCm || 30)) / 100;
    const e = elev(prof);
    const [z0, z1] = prof.elevRef === 'floor' ? [e, e + h] : [e - h, e];
    out.push({
      type: 'duct', id: d.id, src: d.id, l: d.l, system: prof.system, name: `Kanal ${Math.round(d.widthCm)}x${Math.round(h * 100)}`,
      profile: ccw(d.poly.map(tr)), z0, z1, props: { widthCm: Math.round(d.widthCm), heightCm: Math.round(h * 100), layer: layerNames[d.l] || '' },
    });
  }
  for (const b of mep.boxes) {
    const prof = profiles.get(b.l);
    if (!prof || prof.kind === 'ignore' || prof.kind === 'pipe' || prof.hidden) continue;
    const airTerm = prof.kind === 'air';
    const h = (airTerm ? 5 : prof.sizeCm || 30) / 100;
    const e = elev(prof);
    const [z0, z1] = prof.elevRef === 'floor' ? [e, e + h] : [e - h, e];
    out.push({
      type: airTerm ? 'airterminal' : prof.kind === 'terminal' ? 'terminal' : 'equipment',
      id: b.id, src: b.id, l: b.l, system: prof.system, name: b.name || layerNames[b.l] || '',
      profile: ccw(b.poly.map(tr)), z0, z1, props: { layer: layerNames[b.l] || '', block: b.name || '' },
    });
  }
  return out;
}
