// DWG veritabanını (libredwg-web DwgDatabase) dünya koordinatlarında
// düz bir çizim listesine çevirir: bloklar açılır, OCS aynalaması ve
// yaylar düzeltilir, renkler çözülür.

import { aciToHex } from './aci.js';

const MAX_DEPTH = 10;
const ARC_SEG = 24; // tam daire başına segment (yaylar orantılı)
const DWG_CLOSED = 512; // libredwg LWPOLYLINE ham bayrağı: kapalı
const PL_CLOSED = 1; // POLYLINE2D bayrağı: kapalı

// 2B afin matris [a, b, c, d, e, f]: x' = a*x + b*y + e, y' = c*x + d*y + f
const I = [1, 0, 0, 1, 0, 0];
function mul(m, n) {
  return [
    m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
    m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
    m[0] * n[4] + m[1] * n[5] + m[4], m[2] * n[4] + m[3] * n[5] + m[5],
  ];
}
const mirrored = (e) => e.extrusionDirection && e.extrusionDirection.z < -0.5;

function bulgeArc(out, x1, y1, x2, y2, bulge) {
  // out'a (x1,y1) hariç, (x2,y2) dahil ara noktaları ekler
  const theta = 4 * Math.atan(bulge); // işaretli tarama açısı (+ = saat yönü tersi)
  const dx = x2 - x1, dy = y2 - y1;
  const chord = Math.hypot(dx, dy);
  if (chord < 1e-9) return;
  const b = Math.abs(bulge);
  const R = (chord * (1 + b * b)) / (4 * b);
  const sag = (b * chord) / 2;
  const side = Math.sign(bulge); // merkez kirişin solunda (+) / sağında (-)
  const nx = (-dy / chord) * side, ny = (dx / chord) * side;
  const cx = (x1 + x2) / 2 + nx * (R - sag), cy = (y1 + y2) / 2 + ny * (R - sag);
  const a1 = Math.atan2(y1 - cy, x1 - cx);
  const n = Math.max(2, Math.ceil((Math.abs(theta) / (2 * Math.PI)) * ARC_SEG));
  for (let i = 1; i < n; i++) {
    const a = a1 + (theta * i) / n;
    out.push(cx + R * Math.cos(a), cy + R * Math.sin(a));
  }
  out.push(x2, y2);
}

function arcPts(cx, cy, r, a0, a1, rx = r, rot = 0) {
  let sweep = a1 - a0;
  while (sweep <= 0) sweep += 2 * Math.PI;
  const n = Math.max(4, Math.ceil((sweep / (2 * Math.PI)) * ARC_SEG * 2));
  const out = [];
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let i = 0; i <= n; i++) {
    const a = a0 + (sweep * i) / n;
    const px = rx * Math.cos(a), py = r * Math.sin(a);
    out.push(cx + px * cr - py * sr, cy + px * sr + py * cr);
  }
  return out;
}

export function cleanMText(s) {
  if (!s) return '';
  return s
    .replace(/\\P/g, ' ')
    .replace(/\\[ACFHQTWfcpL][^;\\{}]*;/g, '')
    .replace(/\\[LlOoKk]/g, '')
    .replace(/\\S([^;]*);/g, (_, x) => x.replace(/[#^]/g, '/'))
    .replace(/[{}]/g, '')
    .replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±')
    .replace(/\s+/g, ' ')
    .trim();
}

export function flattenDwg(db, { maxPoints = 6e6 } = {}) {
  const layerList = db.tables?.LAYER?.entries || [];
  const layers = [];
  const layerIdx = new Map();
  for (const L of layerList) {
    layerIdx.set(L.name, layers.length);
    layers.push({
      name: L.name,
      color: aciToHex(Math.abs(L.colorIndex ?? 7)),
      off: !!L.off || (L.colorIndex ?? 0) < 0 || !!L.frozen,
      count: 0,
    });
  }
  const getLayer = (name) => {
    if (!layerIdx.has(name)) {
      layerIdx.set(name, layers.length);
      layers.push({ name, color: '#888888', off: false, count: 0 });
    }
    return layerIdx.get(name);
  };

  const blocks = new Map();
  for (const b of db.tables?.BLOCK_RECORD?.entries || []) blocks.set(b.name, b);

  const prims = []; // {l, c, closed, pts:number[]}
  const texts = []; // {l, x, y, h, rot, s}
  const inserts = []; // üst seviye blok yerleşimleri (bilgi amaçlı)
  let points = 0;
  let truncated = false;

  function emit(l, c, closed, local, m) {
    if (local.length < 4) return;
    if (points + local.length / 2 > maxPoints) { truncated = true; return; }
    const pts = new Array(local.length);
    for (let i = 0; i < local.length; i += 2) {
      const x = local[i], y = local[i + 1];
      pts[i] = m[0] * x + m[1] * y + m[4];
      pts[i + 1] = m[2] * x + m[3] * y + m[5];
    }
    points += local.length / 2;
    layers[l].count++;
    prims.push({ l, c, closed, pts });
  }

  function color(e, inhColor, l) {
    const ci = e.colorIndex;
    if (ci === 0) return inhColor; // BYBLOCK
    if (ci === 256 || ci == null) return -1; // BYLAYER
    return ci;
  }

  function walk(ents, m, inhLayer, inhColor, depth) {
    for (const e of ents) {
      if (e.isVisible === false) continue;
      const lname = e.layer === '0' && inhLayer != null ? layers[inhLayer].name : e.layer;
      const l = getLayer(lname ?? '0');
      let c = color(e, inhColor, l);
      if (c === -1 && e.layer === '0' && inhColor != null) c = inhColor;
      const mir = mirrored(e);
      const om = mir ? mul(m, [-1, 0, 0, 1, 0, 0]) : m; // OCS: Z=-1 => X aynası
      switch (e.type) {
        case 'LINE':
          emit(l, c, false, [e.startPoint.x, e.startPoint.y, e.endPoint.x, e.endPoint.y], m);
          break;
        case 'LWPOLYLINE':
        case 'POLYLINE2D': {
          const v = e.vertices || [];
          if (!v.length) break;
          const closed = e.type === 'LWPOLYLINE' ? (e.flag & DWG_CLOSED) !== 0 : (e.flag & PL_CLOSED) !== 0;
          const verts = e.type === 'POLYLINE2D' ? v.filter((p) => !(p.flag & 16)) : v; // kontrol noktalarını at
          const out = [verts[0].x, verts[0].y];
          const n = verts.length;
          for (let i = 1; i < n + (closed ? 1 : 0); i++) {
            const a = verts[i - 1], b = verts[i % n];
            if (a.bulge) bulgeArc(out, a.x, a.y, b.x, b.y, a.bulge);
            else out.push(b.x, b.y);
          }
          if (closed && !verts[n - 1].bulge) out.length -= 2; // kapanış noktası tekrarını kaldır
          emit(l, c, closed, out, om);
          break;
        }
        case 'ARC':
          emit(l, c, false, arcPts(e.center.x, e.center.y, e.radius, e.startAngle, e.endAngle), om);
          break;
        case 'CIRCLE': {
          const p = arcPts(e.center.x, e.center.y, e.radius, 0, 2 * Math.PI);
          p.length -= 2;
          emit(l, c, true, p, om);
          break;
        }
        case 'ELLIPSE': {
          const mx = e.majorAxisEndPoint.x, my = e.majorAxisEndPoint.y;
          const ra = Math.hypot(mx, my);
          const full = Math.abs(e.endAngle - e.startAngle - 2 * Math.PI) < 1e-6 || (e.startAngle === 0 && e.endAngle === 0);
          const p = arcPts(e.center.x, e.center.y, ra * e.axisRatio, e.startAngle, full ? e.startAngle + 2 * Math.PI : e.endAngle, ra, Math.atan2(my, mx));
          emit(l, c, false, p, om);
          break;
        }
        case 'SPLINE': {
          const src = (e.fitPoints && e.fitPoints.length ? e.fitPoints : e.controlPoints) || [];
          const p = [];
          for (const q of src) p.push(q.x, q.y);
          emit(l, c, !!(e.flag & 1), p, m);
          break;
        }
        case 'SOLID': {
          const k = [e.corner1, e.corner2, e.corner4, e.corner3].filter(Boolean);
          const p = [];
          for (const q of k) p.push(q.x, q.y);
          emit(l, c, true, p, om);
          break;
        }
        case 'TEXT':
        case 'MTEXT':
        case 'ATTRIB': {
          const tp = e.type === 'MTEXT' ? e.insertionPoint : e.startPoint || e.text?.startPoint;
          const raw = typeof e.text === 'string' ? e.text : e.text?.text;
          const s = cleanMText(raw);
          if (!tp || !s) break;
          const x = om[0] * tp.x + om[1] * tp.y + om[4], y = om[2] * tp.x + om[3] * tp.y + om[5];
          const sc = Math.hypot(m[0], m[2]);
          texts.push({ l, x, y, h: (e.textHeight || 10) * sc, rot: (e.rotation || 0) + Math.atan2(m[2], m[0]), s, c });
          layers[l].count++;
          break;
        }
        case 'INSERT': {
          const b = blocks.get(e.name);
          if (!b || depth >= MAX_DEPTH) break;
          if (b.name.startsWith('*D')) break; // ölçülendirme blokları
          const r = e.rotation || 0;
          const sx = e.xScale || 1, sy = e.yScale || 1;
          const bp = b.basePoint || { x: 0, y: 0 };
          const ip = e.insertionPoint;
          let lm = [Math.cos(r) * sx, -Math.sin(r) * sy, Math.sin(r) * sx, Math.cos(r) * sy, ip.x, ip.y];
          lm = mul(lm, [1, 0, 0, 1, -bp.x, -bp.y]);
          const wm = mul(om, lm);
          if (depth === 0) inserts.push({ name: e.name, layer: lname, x: wm[4], y: wm[5] });
          walk(b.entities || [], wm, l, c === -1 ? null : c, depth + 1);
          if (Array.isArray(e.attribs)) walk(e.attribs, m, l, c, depth + 1);
          break;
        }
        default:
          break;
      }
    }
  }

  walk(db.entities || [], I, null, null, 0);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of prims) for (let i = 0; i < p.pts.length; i += 2) {
    const x = p.pts[i], y = p.pts[i + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }

  return {
    units: db.header?.INSUNITS ?? 0,
    layers,
    prims,
    texts,
    inserts,
    bbox: [minX, minY, maxX, maxY],
    stats: { prims: prims.length, texts: texts.length, points, truncated },
  };
}
