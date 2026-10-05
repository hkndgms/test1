// Claude ajan modu: claude.ai içindeki `sample` yeteneğiyle (kullanıcının kendi aboneliği,
// anahtar yok) Claude sayfanın araçlarını çağırarak projeyi uçtan uca inceler, kararları
// uygular ve sohbetle düzenlemeye devam eder. Claude hafızasızdır: her çağrıda kurallar +
// güncel proje özeti + son sohbet turları birlikte gönderilir.

export const AGENT_RULES = `Sen DWG2BIM uygulamasının içinde çalışan deneyimli bir mimari + mekanik tesisat BIM uzmanısın. Uygulama bir AutoCAD kat planından (DWG) mimari ve tesisat 3B BIM modeli (IFC) üretiyor. Kullanıcı seninle Türkçe konuşur; sen de Türkçe, kısa ve net yazarsın. Arayüzde ayar paneli yoktur: kullanıcının istediği HER ayarı sen araçlarla yaparsın (katman rolleri, birim/bölge, ölçüler, boşluk türleri, mahal adları, tesisat profilleri, kot, tefriş, duvar ekleme/silme, görünüm, gezi, IFC indirme).

Sana verilen ARAÇLAR sayfanın gerçek fonksiyonlarıdır: liste araçları projenin güncel durumunu okur, "apply" aracı ayarları DOĞRUDAN uygular (katman rolleri, ölçüler, boşluk türleri, mahal adları, tesisat katman profilleri, bilgi bankası kuralları, asma tavan kotu, gezi rotası, rapor). Öneri yapma, uygula; sonra ne yaptığını 1-3 cümleyle söyle. Emin olamadığın, geri alınması zor bir şeyde (katman rolünü değiştirmek bütün algılamayı yeniler) önce kısa bir soru sorabilirsin.

UZUN SÜRELİ BELLEK: library kalıcıdır (sayfa kapanınca silinmez; paylaşımlı depo varsa diğer kullanıcılar da yararlanır). Öğrendiğin standart değerleri, kullanıcı tercihlerini, çizim tariflerini ve tanıdığın blokları oraya kaydet (kind note/recipe/tefriş türü); bir işe başlamadan önce library list (filter) ile ilgili kayıt var mı bak.
2B ÇİZİM: Kullanıcı "şu mahale yerden ısıtma çiz", "buraya ... çiz" derse draw aracıyla çizersin (pattern serpentine/grid ya da serbest entities); bilgi eksikse önce kütüphaneye bak, yoksa makul standartları kullan (yerden ısıtma: 16-17 mm PE-X, 15 cm aralık, kenar payı 20-30 cm, kolektörden başla) ve gerekiyorsa kullanıcıya 1-2 kısa soru sor; sonucu library add (recipe) ile kaydet. Kullanıcı planda işaret koyduysa (M1, M2… ya da "burada/şuraya") list_drawing marks ile oku ve o konumu/alanı kullan. export dxf ile indirtebilirsin.
Yetkin tamdır: projeyi gerektiğinde baştan kurabilirsin (katman rollerini değiştir, yanlış duvar/mahal/boşlukları sil, kapıyı taşı, duvar/kolon ekle, tefriş yerleştir, sıfırla). Tanımadığın bloklar için library(add) ile kalıcı tanım yap (kind + aliases + gerekiyorsa parts); emin değilsen kullanıcıya sor.
Çizimde olmayan şeyleri de ekleyebilirsin — bu uygulamanın yetki alanındadır: add_fixtures (mahale masa-sandalye, klima, klozet vb.; otomatik yerleşim), add_structure (duvara kapı/pencere, duvar, kolon), edit (kapı taşıma vb.), delete_elements. "Yapılamaz / DWG'ye eklenmeli / Revit'te yapılmalı" deme; aracı çağır. Eklenenler 3B'ye ve IFC'ye girer.

Çalışma biçimi:
- Önce ihtiyacın olan liste araçlarını çağır (gerekiyorsa birkaçını aynı turda), sonra tek bir "apply" çağrısında bütün değişiklikleri topla. Sonucu kontrol etmek için gerekirse tekrar listele.
- Katman adlarını listede GÖRDÜĞÜN GİBİ yaz. Kimlikler: O = boşluk, R = mahal, W = duvar, C = kolon, G = cam cephe, F = tefriş.
- Boşluk türleri: door, window, empty (kapısız geçiş), solid (aslında dolu duvar), delete. Her boşluğun yanında programın gerekçesi var; cam izi olmayan yere pencere yapma. Dış cephedeki giriş kapılarını door yap.
- Tesisat profili: kind pipe/air/equipment/terminal/ignore; system coldwater, hotwater, recirc, sewage, rain, condensate, vent, refrigerant, supplyair, returnair, exhaust, hvac, heating, gas, fire, other; elevRef ceiling/floor; elevOffsetCm; sizeCm.
- "learn" ve "ignore" kuralları GELECEK projeler için geneldir: pattern, Türkçe karakterleri katlanmış BÜYÜK harf katman adında çalışan JavaScript düzenli ifadesidir; projeye özgü kod/tarih koyma.
- Yükseklikler cm. Türkiye'de tipik: kat 300-350, kapı 210-220, parapet 90-110, pencere 120-180.
- Katman rolünü (walls/columns/doors/windows/texts) değiştirirsen boşluk ve mahal numaraları yenilenir; o yüzden önce katmanları, sonra (yeniden listeleyip) boşluk/mahal düzeltmelerini uygula.`;

export const REVIEW_TASK = `GÖREV: Bu projeyi uçtan uca incele ve programın normalde parametrelerle yaptığı bütün seçimleri sen yap.
1) get_overview ve gerekli list_* araçlarıyla projeyi oku: katman rolleri doğru mu (duvar/kolon/kapı/pencere/yazı), birim ve bölge mantıklı mı, sorun listesindeki her madde.
1a) TEMİZLİK: review_notes ve list_walls/list_rooms ile çöp ve yanlış algıları bul: 1 m²'nin altındaki anlamsız mahaller, 10 cm'den kısa duvar kırıntıları, lejant/şema/detaydan gelen öğeler, süs blokları → delete_elements; çöp katmanlar → apply.ignore (genel kural) ve apply.mep ile ignore; tanınmayan ama gerçek tefriş/cihaz blokları → library add (kind + aliases). Modelin temiz ve okunur olmasını sağla.
1b) parts list ile paftadaki ayrık çizim bölümlerini listele (tür tahmini ve benzer boyut bilgisiyle): asıl kat planı hangisi, lejant/şema/detay/vaziyet planı hangisi karar ver. Birden çok gerçek plan parçası varsa (büyük proje iki paftaya bölünmüş) hepsini parts select ile seç. AYNI ALANIN BAŞKA ÇİZİMLERİ (tavan/tefriş/tesisat planı: benzer boyutlu bölüm) varsa parts overlay ile asıl planın üstüne bindir — yan yana iki bina yapma. Kesit/görünüş bölümlerini parts read ile oku; kat yüksekliği, parapet, kapı/pencere yüksekliği gibi değerleri apply.params'a yansıt. Bölüm değişince algılama yenilenir; listeleri tekrar oku.
2) Yanlış katman rolü varsa apply.layers ile düzelt (sonra listeleri yeniden oku).
3) Boşlukları gözden geçir: giriş kapıları, cam izi olmayan "pencere"ler, geniş geçişler; mahal adlarını tamamla; ölçüleri (kat yüksekliği, kapı, parapet, pencere) projeye göre ayarla.
4) Tesisat katmanlarını sınıflandır (özellikle BİLİNMİYOR olanlar), asma tavan kotunu çizimden çıkarabiliyorsan ver.
5) Gelecek projeler için genel learn / ignore kuralları öner.
6) Gezi rotası (tour) ve 3-6 cümlelik rapor + sorun listesi (issues) yaz; bunları da apply ile ver.
Sonunda kullanıcıya ne yaptığını ve nelere dikkat etmesi gerektiğini kısa maddelerle yaz.`;

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} karakter kısaltıldı)` : s);

// api: sayfanın sunduğu fonksiyonlar (app.js). Hepsi küçük düz veri döndürür.
export function makeTools(api) {
  const tools = [
    {
      name: 'get_overview',
      description: 'Projenin güncel özetini döndürür: dosya, birim, katmanlar ve rolleri, algılama sayıları, boşluklar (gerekçeleriyle), mahaller, tesisat katmanları ve profilleri, kot bilgisi, programın tespit ettiği sorunlar. İncelemeye bununla başla.',
      execute: () => clip(api.snapshot(), 120000),
    },
    {
      name: 'list_layers',
      description: 'Katmanları döndürür: ad, nesne sayısı, mimari rol (wall/column/door/window/text/-), tesisat profili. filter: ada göre süzme (isteğe bağlı).',
      inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
      execute: ({ filter }) => api.listLayers(filter ? String(filter) : ''),
    },
    {
      name: 'list_openings',
      description: 'Boşlukları döndürür: id, tür, genişlik cm, dış/iç, programın gerekçesi, varsa değişiklik. kind ile süzülebilir (door, window, empty, solid).',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' } } },
      execute: ({ kind }) => api.listOpenings(kind ? String(kind) : ''),
    },
    {
      name: 'list_rooms',
      description: 'Mahalleri döndürür: id, alan m², ad (yoksa boş), içindeki tefriş türleri.',
      execute: () => api.listRooms(),
    },
    {
      name: 'list_walls',
      description: 'Duvar, kolon ve cam cephe şeritlerini döndürür: id, kalınlık cm, uzunluk m, dış/iç, çizim koordinatlarında sınır kutusu (add_structure / tefriş koordinatı için).',
      execute: () => api.listWalls(),
    },
    {
      name: 'list_fixtures',
      description: 'Tanınan tefrişi döndürür: id, tür, ölçü, kaynak (blok adı / küme / sohbetle eklendi), hangi mahalde.',
      execute: () => api.listFixtures(),
    },
    {
      name: 'list_mep',
      description: 'Tesisat katmanlarını içerik özeti ve şu anki profiliyle (kind/system/kot/ölçü/kaynak) döndürür; bilinmeyenler önce. Ayrıca çıkarılan boru/kanal/cihaz sayıları.',
      execute: () => api.listMep(),
    },
    {
      name: 'list_drawing',
      description: 'Çizimin ham içeriğini ve kullanıcı işaretlerini okur. what "texts": yazılar (mahal adları, kot, başlık, çap/ölçü) — filter metin, layer katman süzgeci; "blocks": blok adları ve adetleri — filter; "marks": kullanıcının planda koyduğu işaretler (M1 nokta / alan, hangi mahalde) — kullanıcı "burada/şuraya" derse önce bunu oku; clear true işaretleri temizler; "sketches": sohbetle çizilmiş 2B varlıklar.',
      inputSchema: { type: 'object', properties: { what: { type: 'string' }, filter: { type: 'string' }, layer: { type: 'string' }, clear: { type: 'boolean' } }, required: ['what'] },
      execute: ({ what, filter, layer, clear }) => (what === 'blocks' ? api.listBlocks(filter ? String(filter) : '') : what === 'marks' ? api.marks(!!clear) : what === 'sketches' ? api.listSketches() : api.listTexts(filter ? String(filter) : '', layer ? String(layer) : '')),
    },
    {
      name: 'review_notes',
      description: 'Programın emin olamadığı noktalar (önem, açıklama, kimlikler) + tanınmayan bloklar (ad, adet, ölçü, katman) + profili bilinmeyen tesisat katmanları + kütüphanedeki tanımlar. Temizlik ve kütüphane kararları için.',
      execute: () => api.diagnostics() + '\n\n' + api.listUnknown(),
    },
    {
      name: 'apply',
      description: 'Değişiklikleri DOĞRUDAN uygular ve ne yapıldığını döndürür. changes alanları (hepsi isteğe bağlı): layers {walls,columns,doors,windows,texts: [katman adı]}, params {wallHeightCm, doorHeightCm, windowSillCm, windowHeightCm, slabThicknessCm, makeRoof, minThicknessCm, maxThicknessCm, maxDoorCm, projectName, storeyName}, openings {"O12": {kind, heightCm, sillCm}}, rooms {"R4": {name}}, mep {"KATMAN ADI": {kind, system, elevRef, elevOffsetCm, sizeCm}}, learn [{pattern, kind, system, elevRef, elevOffsetCm, sizeCm, note}], ignore [{pattern, reason}], ceilingCm, ceilingReason, tour {order:[R..], notes:{R..: "..."}}, report, issues [{severity, title, detail, fixed}].',
      inputSchema: { type: 'object', properties: { changes: { type: 'object' } }, required: ['changes'] },
      execute: ({ changes }) => api.apply(changes && typeof changes === 'object' ? changes : {}),
    },
    {
      name: 'edit',
      description: 'Öğe düzenler / siler. id ön ekine göre: O boşluk (kind door|window|empty|solid, widthCm, heightCm, sillCm, shiftCm = duvar boyunca taşı [eski yer duvarla dolar], toWall + atCm = başka duvara al), W/C/G duvar-kolon-cam cephe (heightCm, exterior), F tefriş (kind: tür ya da kütüphane adı), S eskiz. delete true: kaldırır; ids ile birden çok kimlik birden silinir (çöp temizliği). Kapı yeri yanlışsa shiftCm/toWall ile düzelt.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, kind: { type: 'string' }, widthCm: { type: 'number' }, heightCm: { type: 'number' }, sillCm: { type: 'number' }, shiftCm: { type: 'number' }, toWall: { type: 'string' }, atCm: { type: 'number' }, exterior: { type: 'boolean' }, delete: { type: 'boolean' } } },
      execute: (inp) => (Array.isArray(inp.ids) && inp.ids.length ? api.deleteElements(inp.ids.map(String)) : api.edit(inp)),
    },
    {
      name: 'add_fixtures',
      description: 'Çizimde OLMAYAN tefrişi ekler ve mahale otomatik yerleştirir: kind tek tür (table, chair, desk, sofa, bed, cabinet, counter, wc, sink, urinal, shower, bathtub, ac, radiator…), takım (table_set = masa + 4 sandalye, meeting_set, desk_set, sofa_set, bed_set, wc_set) ya da kütüphane öğesi adı. room: mahal kimliği (R..). count: kaç adet (0 = sığdığı kadar). layout: grid | row | perimeter (duvar dibi). sizeCm [en, derinlik], spacingCm, rotDeg isteğe bağlı. room yerine at [x,y] (çizim koordinatı) verilirse tek öğe o noktaya konur.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' }, room: { type: 'string' }, count: { type: 'number' }, layout: { type: 'string' }, sizeCm: { type: 'array', items: { type: 'number' } }, spacingCm: { type: 'number' }, rotDeg: { type: 'number' }, at: { type: 'array', items: { type: 'number' } } }, required: ['kind'] },
      execute: (inp) => api.addFixtures(inp),
    },
    {
      name: 'add_structure',
      description: 'Çizimde olmayan yapı öğesi ekler. type "door"|"window": mevcut duvara açar (wall W.., widthCm, atCm duvar başından [boşsa orta], heightCm, sillCm; duvar 3B\'de kesilir). type "wall": iki nokta arası duvar (x1,y1,x2,y2 çizim koordinatı, thicknessCm; mahaller yeniden hesaplanır). type "column": at [x,y], sizeCm [en, boy], rotDeg.',
      inputSchema: { type: 'object', properties: { type: { type: 'string' }, wall: { type: 'string' }, widthCm: { type: 'number' }, atCm: { type: 'number' }, heightCm: { type: 'number' }, sillCm: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, thicknessCm: { type: 'number' }, at: { type: 'array', items: { type: 'number' } }, sizeCm: { type: 'array', items: { type: 'number' } }, rotDeg: { type: 'number' } }, required: ['type'] },
      execute: (inp) => api.addStructure(inp),
    },
    {
      name: 'parts',
      description: 'Paftadaki ayrık çizim bölümleri. action "list": bölümler (tür tahmini: kat planı / kesit-görünüş / şema / lejant / detay / vaziyet / tavan-tefriş planı; boyut; içerik; benzer boyutlu bölümler). "select" ids: işlenecek bölümleri seç (algılama yenilenir). "read" id: bölümün içeriğini oku (kot yazıları ve farkları → kat yüksekliği, parapet; ölçü sayıları; yazılar; katmanlar). "overlay" base + others: aynı alanın başka çizimlerini (tavan/tefriş/tesisat planı) asıl planın üstüne bindirir — yan yana iki bina yapma.',
      inputSchema: { type: 'object', properties: { action: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, id: { type: 'string' }, base: { type: 'string' }, others: { type: 'array', items: { type: 'string' } } }, required: ['action'] },
      execute: ({ action, ids, id, base, others }) => {
        if (action === 'select') return api.setParts(Array.isArray(ids) ? ids.map(String) : []);
        if (action === 'read') return api.readPart(String(id));
        if (action === 'overlay') return api.overlayParts(String(base), Array.isArray(others) ? others.map(String) : []);
        return api.setParts(null);
      },
    },
    {
      name: 'library',
      description: 'Kalıcı öğe kütüphanesi (tarayıcıda saklanır; sonraki oturum ve projelerde geçerli). action "list"; "add": name, label, kind (temel tür: table, chair, desk, sofa, bed, cabinet, counter, wc, sink, urinal, shower, bathtub, ac, radiator, drain, faucet, ksink, squat ya da "ignore" = süs/çöp; "note" = uzun süreli bilgi notu [text, tags]: standart değerler, kullanıcı tercihleri, öğrenilen kurallar; "recipe" = çizim tarifi [text, params]), sizeCm [en, derinlik], aliases (bu bloğu tanıyacak düzenli ifadeler; katlanmış BÜYÜK harf blok adı; projeye özgü ön ek koyma), parts (isteğe bağlı 3B: [{x, y, w, d, z0, z1, mat, shape}] cm, x merkezden sağa, y arkadan öne; mat wood|fabric|metal|chrome|ceramic|glass|seat; shape box|oval), note; "remove": name. Tanımlanan öğe add_fixtures kind olarak kullanılır ve blokları otomatik tanır.',
      inputSchema: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string' }, sizeCm: { type: 'array', items: { type: 'number' } }, aliases: { type: 'array', items: { type: 'string' } }, parts: { type: 'array', items: { type: 'object' } }, note: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, params: { type: 'object' }, filter: { type: 'string' } }, required: ['action'] },
      execute: ({ action, ...def }) => (action === 'add' ? api.libraryAdd(def) : action === 'remove' ? api.library(String(def.name || '')) : api.library('', def.filter ? String(def.filter) : '')),
    },
    {
      name: 'show',
      description: 'Görünümü değiştirir: view "plan" veya "3d"; select ile bir öğeyi seçip gösterir; tour true ise otomatik geziyi başlatır; panel "advanced" ayrıntılı ayar panellerini açar, "simple" kapatır.',
      inputSchema: { type: 'object', properties: { view: { type: 'string' }, select: { type: 'string' }, tour: { type: 'boolean' }, panel: { type: 'string' } } },
      execute: ({ view, select, tour, panel }) => api.show({ view: view ? String(view) : '', select: select ? String(select) : '', tour: !!tour, panel: panel ? String(panel) : '' }),
    },
    {
      name: 'draw',
      description: '2B çizim yapar (plana işlenir, DXF olarak indirilebilir, system verilirse 3B\'de boru olarak da görünür). İki biçim: (a) entities: serbest varlıklar [{type line pts[x1,y1,x2,y2]} | {type polyline pts[[x,y],...] closed} | {type circle center r} | {type arc center r a0 a1} | {type text at text h}] çizim koordinatında (list_walls / marks ile al); (b) pattern: "serpentine" (yerden ısıtma / kılcal boru: pitchCm aralık, marginCm kenar payı, startAt M.. işareti ya da [x,y] kolektör tarafı) veya "grid" (spacingCm). Alan: room R.. ya da mark M.. (alan işareti). layer: katman adı (ör. M-YERDEN ISITMA); system: coldwater|hotwater|heating|... (3B boru rengi/kotu); widthCm çizgi kalınlığı. Kullanıcı bir çizim isteyince önce library list ile ilgili not/tarif var mı bak; yoksa standart değerleri kullan ve library add (kind note/recipe) ile kaydet.',
      inputSchema: { type: 'object', properties: { entities: { type: 'array', items: { type: 'object' } }, pattern: { type: 'string' }, room: { type: 'string' }, mark: { type: 'string' }, pitchCm: { type: 'number' }, spacingCm: { type: 'number' }, marginCm: { type: 'number' }, startAt: {}, layer: { type: 'string' }, system: { type: 'string' }, widthCm: { type: 'number' }, label: { type: 'string' } } },
      execute: (inp) => api.draw(inp),
    },
    {
      name: 'export',
      description: 'Dosya indirir (kullanıcıya kaydetme onayı çıkar). format "ifc": 3B BIM modeli. format "dxf": 2B çizim — sohbetle çizilenler + (include "model" ise) algılanan duvar/kapı/pencere/mahal/tefriş çizgileri, orijinal plan koordinatlarında; AutoCAD açar, "Farklı kaydet → DWG" yapılır (tarayıcıda doğrudan DWG yazılamıyor).',
      inputSchema: { type: 'object', properties: { format: { type: 'string' }, include: { type: 'string' } }, required: ['format'] },
      execute: ({ format, include }) => (format === 'dxf' ? api.exportDxf(String(include || 'sketches')) : api.exportIfc()),
    },
    {
      name: 'reset_project',
      description: 'Bütün düzenlemeleri (silinenler, tür değişiklikleri, eklenen tefriş/kapı/kolon/duvar, bindirilen bölümler) geri alır ve çizimi baştan algılar.',
      execute: () => api.resetProject(),
    },
  ];
  return tools;
}

// Bir sohbet turu: kurallar + güncel özet + son turlar + yeni mesaj. Araçlı çağrı önbelleğe alınmaz.
export async function runAgent(sample, { rules = AGENT_RULES, snapshot, history = [], message, tools, tier = 'default', onText, signal, maxHistory = 12 }) {
  const turns = [
    { role: 'user', content: `${rules}\n\nGÜNCEL PROJE ÖZETİ (her mesajda yenilenir):\n${clip(snapshot, 160000)}` },
    ...history.slice(-maxHistory),
    { role: 'user', content: message },
  ];
  return sample(turns, { tools, modelTier: tier, cache: false, onText, signal });
}

// Hata kodlarını kullanıcı diline çevir
export function errorText(e) {
  const c = e?.code;
  if (c === 'not_granted') return 'Claude erişimine izin verilmedi. Sayfanın izinler menüsünden izin verebilirsiniz.';
  if (c === 'rate_limited') return 'Kullanım sınırına ulaşıldı; biraz sonra tekrar deneyin.';
  if (c === 'cancelled') return 'Durduruldu.';
  if (c === 'refused') return 'Claude bu isteği yanıtlamadı; isteği değiştirip tekrar deneyin.';
  if (c === 'prompt_too_large') return 'Proje özeti çok büyük; daha küçük bir bölge seçip tekrar deneyin.';
  if (c === 'tools_unavailable') return 'Bu görüntüleyici araç çağrısını desteklemiyor; komut kopyala-yapıştır yolunu kullanın.';
  if (c === 'session_expired') return 'Oturum süresi doldu; claude.ai\'ye yeniden giriş yapın.';
  return 'Claude cevap veremedi: ' + (e?.message || c || e);
}
