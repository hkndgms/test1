// Yapay zekâ asistanı: çizimi özetleyen bir komut (prompt) üretir ve
// yapay zekânın döndürdüğü JSON cevabını çözümler.

import { UNIT_NAMES } from './detect.js';
import { SYSTEMS, KINDS } from './kb.js';

// Çizim özeti (yapay zekâya giden veri kısmı): katmanlar, bloklar, yazılar, algılama sonucu,
// sorunlar, tesisat katmanları, kot. Hem kopyala-yapıştır komutu hem de ajan modu bunu kullanır.
export function buildSnapshot({ drawing, roles, params, buildParams, model, fileName, mepStats = [], mepProfiles = new Map(), elevations = null, ceiling = null, islands = [], diagnostics = [], mep = null, fixtures = [] }) {
  const layerRows = drawing.layers
    .map((l, i) => ({ i, ...l }))
    .filter((l) => l.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 150)
    .map((l) => {
      const r = roles.wall.has(l.i) ? 'DUVAR' : roles.column.has(l.i) ? 'KOLON' : roles.door?.has(l.i) ? 'KAPI' : roles.window?.has(l.i) ? 'PENCERE' : roles.text.has(l.i) ? 'YAZI' : '-';
      return `${l.name}\t${l.count}\t${r}`;
    });
  const texts = [...new Set(drawing.texts.filter((t) => t.s.length > 2 && t.s.length < 40 && /\p{L}{3}/u.test(t.s)).map((t) => t.s))].slice(0, 120);
  const blocks = [...new Set(drawing.inserts.map((b) => b.name))].slice(0, 60);
  const th = {};
  for (const w of model?.walls || []) { const k = Math.round(w.thickness * model.unitScale); th[k] = (th[k] || 0) + 1; }
  const openingRows = (model?.openings || []).map((o) => `${o.id}\t${Math.round(o.width * model.unitScale)}\t${o.exterior ? 'dış' : 'iç'}\t${o.kind}${o.why ? '\t(' + o.why + ')' : ''}`);
  const roomRows = (model?.rooms || []).map((r) => `${r.id}\t${(Math.abs(r.area) * model.unitScale ** 2 / 1e4).toFixed(1)} m²\t${r.name || '(adsız)'}`);

  // Tesisat katmanları: bilinmeyenler önce, sonra kullanılanlar, sonra yok sayılan tesisat benzerleri
  const mepRows = mepStats.map((st) => ({ st, p: mepProfiles.get(st.l) || {} }))
    .filter(({ st, p }) => (p.kind && p.kind !== 'ignore') || p.unknown || /^m[-_ ]|vrf|hvac|klima|yang|fire|daikin|tesisat/i.test(st.name) || st.count >= 200)
    .sort((a, b) => (a.p.unknown ? 0 : 1) - (b.p.unknown ? 0 : 1) || b.st.count - a.st.count)
    .slice(0, 70)
    .map(({ st, p }) => {
      const cur = p.unknown && !p.kind ? 'BİLİNMİYOR' : p.kind === 'ignore' ? `yok sayılıyor (${p.note || ''})` : `${p.kind}/${p.system}/${p.elevRef === 'floor' ? 'döşeme' : 'tavan'}${p.elevOffsetCm >= 0 ? '+' : ''}${p.elevOffsetCm ?? 0}cm/ölçü ${p.sizeCm ?? '-'}cm [${p.source}]`;
      const extra = [st.blocks.length ? 'bloklar: ' + st.blocks.join(', ') : '', st.texts.length ? 'yazılar: ' + st.texts.slice(0, 5).join(' ; ') : ''].filter(Boolean).join(' | ');
      return `${st.name}\t${st.count} nesne (açık ${st.open}, kapalı ${st.closed}), toplam ${st.lengthM} m, tipik boyut ${st.typicalCm} cm\t→ ${cur}${extra ? '\t' + extra : ''}`;
    });
  const kotRows = (elevations?.candidates || []).map((k) => `+${(k.cm / 100).toFixed(2)} (${k.count} kez)`).join(', ');

  const diagRows = diagnostics.map((x, i) => `${i + 1}. [${x.severity}] ${x.text}${x.data && x.data.length && x.data.length <= 40 ? ' (' + x.data.join(', ') + ')' : ''}`);
  const named = mep ? [...new Set(mep.boxes.filter((b) => b.name).map((b) => b.name))].slice(0, 30) : [];

  return `ÇİZİM ÖZETİ
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
Cam giydirme cephe / cam bölme: ${model?.curtains?.length ?? 0} şerit
Tefriş (blok adından / ıslak hacim kümesinden tanınan): ${Object.entries(fixtures.reduce((a, f) => ((a[f.label] = (a[f.label] || 0) + 1), a), {})).map(([k, v]) => `${k} ${v}`).join(', ') || '-'}
Boşluklar (id, genişlik cm, konum, şu anki tür):
${openingRows.join('\n') || '-'}
Mahaller (id, alan, ad):
${roomRows.join('\n') || '-'}

PROGRAMIN TESPİT ETTİĞİ SORUNLAR VE BELİRSİZLİKLER
${diagRows.join('\n') || 'Belirgin sorun bulunmadı; yine de bütün projeyi kontrol et.'}

ADIYLA TANINAN CİHAZ BLOKLARI
${named.join(', ') || '-'}

TESİSAT KATMANLARI (asıl plan bölgesinde; ad, içerik özeti → uygulamanın şu anki kararı [kaynak])
${mepRows.join('\n') || '-'}

KOT BİLGİSİ
Asma tavan kotu: ${ceiling ? (ceiling.source === 'project' ? ceiling.cm + ' cm (projeden: ' + ceiling.text + ')' : ceiling.source === 'default' ? 'projede bulunamadı (varsayılan ' + ceiling.cm + ' cm)' : ceiling.cm + ' cm (' + ceiling.source + ')') : '-'}
Çizimde geçen kot yazıları: ${kotRows || '-'}
Paftadaki ayrık çizim grubu sayısı: ${islands.length} (asıl plan dışındakiler yok sayıldı)
`;
}

// Kopyala-yapıştır komutu: talimatlar + istenen JSON biçimi + çizim özeti
export function buildPrompt(opts) {
  return INSTRUCTIONS + '\n' + buildSnapshot(opts);
}

const INSTRUCTIONS = `Sen deneyimli bir mimari ve MEKANİK TESİSAT BIM uzmanısın. "DWG2BIM" adlı bir tarayıcı uygulaması bir AutoCAD DWG paftasından mimari + mekanik tesisat 3B BIM modeli (IFC) üretiyor. Aşağıda uygulamanın çizimden çıkardığı özet ve kendi tespit ettiği SORUNLAR var.
Görevin bütün projeyi bir uzman gözüyle ANALİZ ETMEK:
1) Programın listelediği sorun ve belirsizliklerin her birini değerlendir; düzeltebildiklerini aşağıdaki JSON alanlarıyla doğrudan düzelt.
2) Programın görmediği tutarsızlıkları da ara (ör. yanlış sistem atanmış katman, mantıksız kot, eksik giriş kapısı, şema/lejant olabilecek katmanlar, tesisatta eksik sistem).
3) Gelecek projelerde işe yarayacak genel kurallar öner (learn / ignore) ki program kendini geliştirsin.
4) Kısa bir analiz raporu ve sorun listesi yaz.
Cevabın SADECE aşağıdaki JSON biçiminde olsun.

KURALLAR
- Cevabın tek bir \`\`\`json kod bloğu olsun; açıklamaları "notes" alanına yaz.
- Katman adlarını listede GÖRDÜĞÜN GİBİ (büyük/küçük harf ve Türkçe karakterler dahil) yaz.
- "walls": duvar dış hatlarının çizildiği katman(lar). Tesisat (M-, HVAC, VRF, ST-), tefriş, tarama, ölçü, yazı katmanlarını SEÇME.
- "columns": betonarme kolon/perde katmanları. "texts": mahal (oda) adlarının yazıldığı katmanlar; emin değilsen boş bırak.
- "doors": kapı açılış yaylarının / kapı bloklarının çizildiği katmanlar; "windows": pencere doğramalarının katmanları. Boşluk bu katmanlardan bir çizime yakınsa türü otomatik kapı/pencere olur.
- Yükseklikler santimetre. Türkiye'de tipik: kat yüksekliği 300-350, kapı 210-220, pencere parapeti 90-110, pencere yüksekliği 120-180.
- "openings": yalnızca değiştirmek istediğin boşlukları yaz. kind: "door" (kapı), "window" (pencere), "empty" (kapısız geçiş/koridor), "solid" (aslında dolu duvar/kolon; cam değil), "delete" (boşluk değil). Her boşluğun yanında programın gerekçesi yazıyor; cam izi olmayan yerleri pencere yapma. Dış cephedeki giriş kapılarını "door" yap (mahal adlarından ve genişlikten tahmin et, örn. 150+ cm dış boşluk ana giriş olabilir).
- "rooms": adsız veya yanlış adlı mahaller için isim önerebilirsin.
- Bilmediğin alanı hiç yazma.

MEKANİK TESİSAT (asıl önem burada)
- "mep": aşağıdaki TESİSAT KATMANLARI listesindeki katmanlar için (özellikle BİLİNMİYOR olanlar ve yanlış sınıflandırılmış görünenler) karar ver. Katman adını listede göründüğü gibi yaz.
  kind: ${Object.keys(KINDS).map((k) => `"${k}"`).join(', ')} — pipe=tek çizgi boru, air=kapalı şekil kanal/menfez, equipment=cihaz (blok/şekil), terminal=küçük sembol (sprinkler başlığı, vana), ignore=çizilmeyecek (yazı, ölçü, şema, lejant, etki dairesi, başka projeden kalıntı).
  system: ${Object.keys(SYSTEMS).map((k) => `"${k}"`).join(', ')}.
  elevRef: "ceiling" (asma tavana göre) veya "floor" (döşemeye göre); elevOffsetCm: bu referanstan fark (tavan altı negatif); sizeCm: boru çapı / cihaz yüksekliği / kanal yüksekliği.
- "learn": GELECEKTEKİ PROJELERDE DE geçerli olacak GENEL kurallar öner. Bu uygulama öğrenir: kuralları bilgi bankasına kaydeder ve sonraki dosyalarda katman adlarına uygular. pattern, Türkçe karakterleri katlanmış (İ→I, Ş→S, Ğ→G, Ü→U, Ö→O, Ç→C) BÜYÜK harf katman adı üzerinde çalışan bir JavaScript düzenli ifadesidir (ör. "YANGIN[\\s._-]*DOLAB|HYDRANT"). Projeye özgü ad parçaları (proje kodu, tarih) koyma; meslekte yaygın adlandırmaları yakalayan kalıplar yaz.
- "ignore": aynı mantıkla genel TEMİZLİK kuralları (hangi katman adları her zaman çöp/çizilmez): {"pattern": "...", "reason": "..."}.
- "ceilingCm": asma tavan kotu (cm) — yalnız çizimden makul bir çıkarım yapabiliyorsan; "ceilingReason" ile gerekçesini yaz. Emin değilsen yazma, uygulama kullanıcıya soracak.
- "questions": bu katmanlardan emin olamadıkların için kullanıcıya sorulacak kısa sorular (en çok 3).

OTOMATİK GEZİ
- "tour": binanın içinde göz hizasında yapılacak otomatik gezi için mahal sırası ve her mahal için 1-2 cümlelik Türkçe açıklama: {"order": ["R7","R13",...], "notes": {"R7": "..."}}. Girişe yakın mahalden başla, komşu mahallerden geçerek mantıklı bir sırayla her önemli mahali gez; 3 m²'den küçük mahalleri atlayabilirsin.

ANALİZ ÇIKTISI
- "report": projenin 3-6 cümlelik özeti (ne tür bir yapı, hangi tesisat sistemleri var, modelin güvenilirliği, kullanıcının dikkat etmesi gerekenler). Türkçe yaz.
- "issues": [{"severity":"high|medium|low","title":"kısa başlık","detail":"ne yapılmalı","fixed":true|false}] — fixed=true: bu cevaptaki alanlarla düzelttin; false: kullanıcının yapması gerekiyor.

İSTENEN CEVAP BİÇİMİ
\`\`\`json
{
  "layers": { "walls": ["..."], "columns": ["..."], "doors": ["..."], "windows": [], "texts": [] },
  "params": {
    "wallHeightCm": 300, "slabThicknessCm": 15, "doorHeightCm": 210,
    "windowSillCm": 90, "windowHeightCm": 150, "makeRoof": false,
    "minThicknessCm": 5, "maxThicknessCm": 60, "maxDoorCm": 260,
    "projectName": "...", "storeyName": "Zemin Kat"
  },
  "openings": { "O12": { "kind": "door", "heightCm": 220 }, "O3": { "kind": "window", "sillCm": 100, "heightCm": 140 } },
  "rooms": { "R4": { "name": "..." } },
  "mep": { "M-YANGIN": { "kind": "terminal", "system": "fire", "elevRef": "ceiling", "elevOffsetCm": -5, "sizeCm": 6 } },
  "learn": [ { "pattern": "YANGIN[\\s._-]*DOLAB|HYDRANT|\\bIKV\\b", "kind": "equipment", "system": "fire", "elevRef": "floor", "elevOffsetCm": 60, "sizeCm": 90, "note": "yangın dolabı" } ],
  "ignore": [ { "pattern": "KOLON[\\s._-]*SEMA|RISER[\\s._-]*DIAGRAM", "reason": "kolon şeması" } ],
  "ceilingCm": 290, "ceilingReason": "...",
  "questions": ["..."],
  "tour": { "order": ["R1", "R2"], "notes": { "R1": "..." } },
  "report": "...",
  "issues": [ { "severity": "medium", "title": "...", "detail": "...", "fixed": false } ],
  "notes": "kısa açıklama"
}
\`\`\`
`;

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
