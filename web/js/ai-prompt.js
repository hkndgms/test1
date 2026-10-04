// Yapay zekâ asistanı: çizimi özetleyen bir komut (prompt) üretir ve
// yapay zekânın döndürdüğü JSON cevabını çözümler.

import { UNIT_NAMES } from './detect.js';

export function buildPrompt({ drawing, roles, params, buildParams, model, fileName }) {
  const layerRows = drawing.layers
    .map((l, i) => ({ i, ...l }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 150)
    .map((l) => {
      const r = roles.wall.has(l.i) ? 'DUVAR' : roles.column.has(l.i) ? 'KOLON' : roles.text.has(l.i) ? 'YAZI' : '-';
      return `${l.name}\t${l.count}\t${r}`;
    });
  const texts = [...new Set(drawing.texts.filter((t) => t.s.length > 2 && t.s.length < 40 && /\p{L}{3}/u.test(t.s)).map((t) => t.s))].slice(0, 120);
  const blocks = [...new Set(drawing.inserts.map((b) => b.name))].slice(0, 60);
  const th = {};
  for (const w of model?.walls || []) { const k = Math.round(w.thickness * model.unitScale); th[k] = (th[k] || 0) + 1; }
  const openingRows = (model?.openings || []).map((o) => `${o.id}\t${Math.round(o.width * model.unitScale)}\t${o.exterior ? 'dış' : 'iç'}\t${o.kind}${o.weak ? '\tzayıf' : ''}`);
  const roomRows = (model?.rooms || []).map((r) => `${r.id}\t${(Math.abs(r.area) * model.unitScale ** 2 / 1e4).toFixed(1)} m²\t${r.name || '(adsız)'}`);

  return `Sen bir mimari BIM asistanısın. "DWG2BIM" adlı bir tarayıcı uygulaması bir AutoCAD DWG kat planından 3B BIM modeli (IFC) üretiyor. Aşağıda uygulamanın çizimden çıkardığı özet var. Görevin: uygulamanın modeli doğru kurması için gereken ayarları SADECE aşağıdaki JSON biçiminde geri vermek.

KURALLAR
- Cevabın tek bir \`\`\`json kod bloğu olsun; açıklamaları "notes" alanına yaz.
- Katman adlarını listede GÖRDÜĞÜN GİBİ (büyük/küçük harf ve Türkçe karakterler dahil) yaz.
- "walls": duvar dış hatlarının çizildiği katman(lar). Tesisat (M-, HVAC, VRF, ST-), tefriş, tarama, ölçü, yazı katmanlarını SEÇME.
- "columns": betonarme kolon/perde katmanları. "texts": mahal (oda) adlarının yazıldığı katmanlar; emin değilsen boş bırak.
- Yükseklikler santimetre. Türkiye'de tipik: kat yüksekliği 300-350, kapı 210-220, pencere parapeti 90-110, pencere yüksekliği 120-180.
- "openings": yalnızca değiştirmek istediğin boşlukları yaz. kind: "door" (kapı), "window" (pencere), "empty" (kapısız geçiş/koridor), "delete" (boşluk değil). Dış cephedeki giriş kapılarını "door" yap (mahal adlarından ve genişlikten tahmin et, örn. 150+ cm dış boşluk ana giriş olabilir).
- "rooms": adsız veya yanlış adlı mahaller için isim önerebilirsin.
- Bilmediğin alanı hiç yazma.

İSTENEN CEVAP BİÇİMİ
\`\`\`json
{
  "layers": { "walls": ["..."], "columns": ["..."], "texts": [] },
  "params": {
    "wallHeightCm": 300, "slabThicknessCm": 15, "doorHeightCm": 210,
    "windowSillCm": 90, "windowHeightCm": 150, "makeRoof": false,
    "minThicknessCm": 5, "maxThicknessCm": 60, "maxDoorCm": 260,
    "projectName": "...", "storeyName": "Zemin Kat"
  },
  "openings": { "O12": { "kind": "door", "heightCm": 220 }, "O3": { "kind": "window", "sillCm": 100, "heightCm": 140 } },
  "rooms": { "R4": { "name": "..." } },
  "notes": "kısa açıklama"
}
\`\`\`

ÇİZİM ÖZETİ
Dosya: ${fileName || '-'}
Birim: ${UNIT_NAMES[drawing.units] || drawing.units} (INSUNITS=${drawing.units})
Mevcut ayarlar: duvar yüksekliği ${buildParams.wallHeightCm} cm, kapı ${buildParams.doorHeightCm} cm, parapet ${buildParams.windowSillCm} cm, pencere ${buildParams.windowHeightCm} cm, kalınlık aralığı ${params.minThicknessCm}-${params.maxThicknessCm} cm

KATMANLAR (ad, nesne sayısı, şu anki rol)
${layerRows.join('\n')}

ÜST SEVİYE BLOKLAR
${blocks.join(', ') || '-'}

ÇİZİMDEKİ YAZILARDAN ÖRNEKLER
${texts.join(' | ') || '-'}

ALGILAMA SONUCU
Duvar: ${model?.walls.length ?? 0} adet, kalınlık dağılımı (cm: adet): ${Object.entries(th).map(([k, v]) => `${k}: ${v}`).join(', ') || '-'}
Kolon: ${model?.columns.length ?? 0} adet
Boşluklar (id, genişlik cm, konum, şu anki tür):
${openingRows.join('\n') || '-'}
Mahaller (id, alan, ad):
${roomRows.join('\n') || '-'}
`;
}

export function parseAnswer(text) {
  if (!text || !text.trim()) throw new Error('Cevap boş.');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = fence ? fence[1] : text;
  const a = body.indexOf('{'), b = body.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Cevapta JSON bulunamadı. Yapay zekâdan cevabı ```json bloğu olarak vermesini isteyin.');
  body = body.slice(a, b + 1);
  try {
    return JSON.parse(body);
  } catch {
    // sık görülen hatalar: sondaki virgüller, akıllı tırnaklar
    const fixed = body.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/,\s*([}\]])/g, '$1');
    try { return JSON.parse(fixed); } catch (e) { throw new Error('JSON çözümlenemedi: ' + e.message); }
  }
}
