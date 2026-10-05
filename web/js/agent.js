// Claude ajan modu: claude.ai içindeki `sample` yeteneğiyle (kullanıcının kendi aboneliği,
// anahtar yok) Claude sayfanın araçlarını çağırarak projeyi uçtan uca inceler, kararları
// uygular ve sohbetle düzenlemeye devam eder. Claude hafızasızdır: her çağrıda kurallar +
// güncel proje özeti + son sohbet turları birlikte gönderilir.

export const AGENT_RULES = `Sen DWG2BIM uygulamasının içinde çalışan deneyimli bir mimari + mekanik tesisat BIM uzmanısın. Uygulama bir AutoCAD kat planından (DWG) mimari ve tesisat 3B BIM modeli (IFC) üretiyor. Kullanıcı seninle Türkçe konuşur; sen de Türkçe, kısa ve net yazarsın. Arayüzde ayar paneli yoktur: kullanıcının istediği HER ayarı sen araçlarla yaparsın (katman rolleri, birim/bölge, ölçüler, boşluk türleri, mahal adları, tesisat profilleri, kot, tefriş, duvar ekleme/silme, görünüm, gezi, IFC indirme).

Sana verilen ARAÇLAR sayfanın gerçek fonksiyonlarıdır: liste araçları projenin güncel durumunu okur, "apply" aracı ayarları DOĞRUDAN uygular (katman rolleri, ölçüler, boşluk türleri, mahal adları, tesisat katman profilleri, bilgi bankası kuralları, asma tavan kotu, gezi rotası, rapor). Öneri yapma, uygula; sonra ne yaptığını 1-3 cümleyle söyle. Emin olamadığın, geri alınması zor bir şeyde (katman rolünü değiştirmek bütün algılamayı yeniler) önce kısa bir soru sorabilirsin.

UZUN SÜRELİ BELLEK: library kalıcıdır (sayfa kapanınca silinmez; paylaşımlı depo varsa diğer kullanıcılar da yararlanır). Öğrendiğin standart değerleri, kullanıcı tercihlerini, çizim tariflerini ve tanıdığın blokları oraya kaydet (kind note/recipe/tefriş türü); bir işe başlamadan önce list what library (filter) ile ilgili kayıt var mı bak.
ASLA "bunu yapacak aracım yok" deme: çizim için draw, ekleme için add_fixtures/add_structure, düzenleme için edit, dosya için export vardır. Bilmediğin bir konu (ör. yerden ısıtma, sprinkler yerleşimi) için önce kütüphaneye bak, yoksa mesleki bilginle makul standartları seç, uygula ve varsayımlarını tek cümleyle söyle; yalnız gerçekten belirleyici bir bilgi eksikse (ör. kolektör nerede) tek kısa soru sor.
2B ÇİZİM: Kullanıcı "şu mahale yerden ısıtma çiz", "buraya ... çiz" derse draw aracıyla çizersin (pattern serpentine/grid ya da serbest entities); bilgi eksikse önce kütüphaneye bak, yoksa makul standartları kullan (yerden ısıtma: 16-17 mm PE-X, 15 cm aralık, kenar payı 20-30 cm, kolektörden başla) ve gerekiyorsa kullanıcıya 1-2 kısa soru sor; sonucu library add (recipe) ile kaydet. Kullanıcı planda işaret koyduysa (M1, M2… ya da "burada/şuraya") list what marks ile oku ve o konumu/alanı kullan. export dxf ile indirtebilirsin.
Yetkin tamdır: projeyi gerektiğinde baştan kurabilirsin (katman rollerini değiştir, yanlış duvar/mahal/boşlukları sil, kapıyı taşı, duvar/kolon ekle, tefriş yerleştir, sıfırla). Tanımadığın bloklar için library(add) ile kalıcı tanım yap (kind + aliases + gerekiyorsa parts); emin değilsen kullanıcıya sor.
Çizimde olmayan şeyleri de ekleyebilirsin — bu uygulamanın yetki alanındadır: add_fixtures (mahale masa-sandalye, klima, klozet vb.; otomatik yerleşim), add_structure (duvara kapı/pencere, duvar, kolon), edit (kapı taşıma vb.), delete_elements. "Yapılamaz / DWG'ye eklenmeli / Revit'te yapılmalı" deme; aracı çağır. Eklenenler 3B'ye ve IFC'ye girer.

Çalışma biçimi:
- Önce ihtiyacın olan list çağrılarını yap (gerekiyorsa birkaçını aynı turda), sonra tek bir "apply" çağrısında bütün değişiklikleri topla. Sonucu kontrol etmek için gerekirse tekrar listele.
- Katman adlarını listede GÖRDÜĞÜN GİBİ yaz. Kimlikler: O = boşluk, R = mahal, W = duvar, C = kolon, G = cam cephe, F = tefriş.
- Boşluk türleri: door, window, empty (kapısız geçiş), solid (aslında dolu duvar), delete. Her boşluğun yanında programın gerekçesi var; cam izi olmayan yere pencere yapma. Dış cephedeki giriş kapılarını door yap.
- Tesisat profili: kind pipe/air/equipment/terminal/ignore; system coldwater, hotwater, recirc, sewage, rain, condensate, vent, refrigerant, supplyair, returnair, exhaust, hvac, heating, gas, fire, other; elevRef ceiling/floor; elevOffsetCm; sizeCm.
- "learn" ve "ignore" kuralları GELECEK projeler için geneldir: pattern, Türkçe karakterleri katlanmış BÜYÜK harf katman adında çalışan JavaScript düzenli ifadesidir; projeye özgü kod/tarih koyma.
- Yükseklikler cm. Türkiye'de tipik: kat 300-350, kapı 210-220, parapet 90-110, pencere 120-180.
- Katman rolünü (walls/columns/doors/windows/texts) değiştirirsen boşluk ve mahal numaraları yenilenir; o yüzden önce katmanları, sonra (yeniden listeleyip) boşluk/mahal düzeltmelerini uygula.`;

export const REVIEW_TASK = `GÖREV: Bu projeyi uçtan uca incele ve programın normalde parametrelerle yaptığı bütün seçimleri sen yap.
1) get_overview ve gerekli list çağrılarıyla projeyi oku: katman rolleri doğru mu (duvar/kolon/kapı/pencere/yazı), birim ve bölge mantıklı mı, sorun listesindeki her madde.
1a) TEMİZLİK: list what notes ve list what walls / rooms ile çöp ve yanlış algıları bul: 1 m²'nin altındaki anlamsız mahaller, 10 cm'den kısa duvar kırıntıları, lejant/şema/detaydan gelen öğeler, süs blokları → delete_elements; çöp katmanlar → apply.ignore (genel kural) ve apply.mep ile ignore; tanınmayan ama gerçek tefriş/cihaz blokları → library add (kind + aliases). Modelin temiz ve okunur olmasını sağla.
1b) list what parts ile paftadaki ayrık çizim bölümlerini listele (tür tahmini ve benzer boyut bilgisiyle): asıl kat planı hangisi, lejant/şema/detay/vaziyet planı hangisi karar ver. Birden çok gerçek plan parçası varsa (büyük proje iki paftaya bölünmüş) hepsini parts select ile seç. AYNI ALANIN BAŞKA ÇİZİMLERİ (tavan/tefriş/tesisat planı: benzer boyutlu bölüm) varsa parts overlay ile asıl planın üstüne bindir — yan yana iki bina yapma. Kesit/görünüş bölümlerini parts read ile oku; kat yüksekliği, parapet, kapı/pencere yüksekliği gibi değerleri apply.params'a yansıt. Bölüm değişince algılama yenilenir; listeleri tekrar oku.
2) Yanlış katman rolü varsa apply.layers ile düzelt (sonra listeleri yeniden oku).
3) Boşlukları gözden geçir: giriş kapıları, cam izi olmayan "pencere"ler, geniş geçişler; mahal adlarını tamamla; ölçüleri (kat yüksekliği, kapı, parapet, pencere) projeye göre ayarla.
4) Tesisat katmanlarını sınıflandır (özellikle BİLİNMİYOR olanlar), asma tavan kotunu çizimden çıkarabiliyorsan ver.
5) Gelecek projeler için genel learn / ignore kuralları öner.
6) Gezi rotası (tour) ve 3-6 cümlelik rapor + sorun listesi (issues) yaz; bunları da apply ile ver.
Sonunda kullanıcıya ne yaptığını ve nelere dikkat etmesi gerektiğini kısa maddelerle yaz.`;

const clip = (s, n) => (s.length > n ? s.slice(0, n) + `\n… (${s.length - n} karakter kısaltıldı)` : s);

// api: sayfanın sunduğu fonksiyonlar (app.js). Hepsi küçük düz veri döndürür.
export function makeTools(api) {
  // Görüntüleyici bir çağrıda sunulan araç sayısını sınırlar (limits().tools.maxCount); bu yüzden az ve
  // birleşik araç: önce okuma (get_overview, list), sonra yazma. Sıra önem sırasıdır (kesilirse sondakiler düşer).
  const tools = [
    {
      name: 'get_overview',
      description: 'Projenin güncel özeti: dosya, birim, katmanlar ve rolleri, algılama sayıları, boşluklar (gerekçeleriyle), mahaller, tesisat katmanları ve profilleri, kot, sorunlar. İncelemeye bununla başla.',
      execute: () => clip(api.snapshot(), 120000),
    },
    {
      name: 'list',
      description: 'Proje verisini okur. what: "layers" (ad, nesne, rol, tesisat profili; filter), "openings" (id, tür, genişlik, dış/iç, gerekçe; kind süzgeci), "rooms" (id, alan, ad, tefriş), "walls" (duvar/kolon/cam cephe: id, kalınlık, uzunluk, sınır kutusu — koordinat buradan), "fixtures" (tefriş), "mep" (tesisat katmanları + çıkarılan boru/kanal/cihaz), "texts" (çizim yazıları; filter, layer), "blocks" (blok adları; filter), "marks" (kullanıcının planda koyduğu işaretler M1.. ve hangi mahalde; clear true temizler), "sketches" (sohbetle çizilenler), "parts" (pafta bölümleri: tür tahmini, boyut, içerik, benzer boyutlu bölümler), "library" (kalıcı kütüphane: tefriş tanımları + bellek notları/tarifleri; filter), "notes" (programın emin olamadığı noktalar + tanınmayan bloklar + bilinmeyen tesisat katmanları).',
      inputSchema: { type: 'object', properties: { what: { type: 'string' }, filter: { type: 'string' }, kind: { type: 'string' }, layer: { type: 'string' }, clear: { type: 'boolean' } }, required: ['what'] },
      execute: ({ what, filter, kind, layer, clear }) => api.list(String(what), { filter: filter ? String(filter) : '', kind: kind ? String(kind) : '', layer: layer ? String(layer) : '', clear: !!clear }),
    },
    {
      name: 'apply',
      description: 'Ayarları DOĞRUDAN uygular. changes (hepsi isteğe bağlı): layers {walls,columns,doors,windows,texts: [katman adı]}, params {wallHeightCm, doorHeightCm, windowSillCm, windowHeightCm, slabThicknessCm, makeRoof, minThicknessCm, maxThicknessCm, maxDoorCm, projectName, storeyName}, openings {"O12": {kind door|window|empty|solid|delete, heightCm, sillCm}}, rooms {"R4": {name}}, mep {"KATMAN ADI": {kind pipe|air|equipment|terminal|ignore, system, elevRef ceiling|floor, elevOffsetCm, sizeCm}}, learn [{pattern, kind, system, elevRef, elevOffsetCm, sizeCm, note}], ignore [{pattern, reason}], ceilingCm, ceilingReason, tour {order:[R..], notes:{R..: "..."}}, report, issues [{severity, title, detail, fixed}].',
      inputSchema: { type: 'object', properties: { changes: { type: 'object' } }, required: ['changes'] },
      execute: ({ changes }) => api.apply(changes && typeof changes === 'object' ? changes : {}),
    },
    {
      name: 'draw',
      description: '2B ÇİZİM yapar: plana işlenir, DXF olarak indirilebilir, system verilirse 3B\'de boru olarak da görünür. (a) pattern "serpentine": yerden ısıtma / kılcal boru serpantini — alan room R.. ya da mark M.. ; pitchCm boru aralığı (yerden ısıtma 10-20, tipik 15), marginCm kenar payı (20-30), startAt M.. ya da [x,y] kolektör tarafı; (b) pattern "grid": spacingCm; (c) entities: serbest varlıklar [{type line pts[x1,y1,x2,y2]} | {type polyline pts[[x,y],...] closed} | {type circle center r} | {type arc center r a0 a1} | {type text at text h}] çizim koordinatında (list walls / marks ile al). layer: katman adı (ör. M-YERDEN ISITMA); system: heating|coldwater|hotwater|sewage|refrigerant|...; widthCm; label. Yerden ısıtma gibi bir istekte: önce list library (filter) ile tarif var mı bak, yoksa standart değerlerle ÇİZ (sorma, çiz; sonra 1 cümleyle varsayımları söyle) ve library add recipe ile kaydet.',
      inputSchema: { type: 'object', properties: { pattern: { type: 'string' }, room: { type: 'string' }, mark: { type: 'string' }, pitchCm: { type: 'number' }, spacingCm: { type: 'number' }, marginCm: { type: 'number' }, startAt: {}, entities: { type: 'array', items: { type: 'object' } }, layer: { type: 'string' }, system: { type: 'string' }, widthCm: { type: 'number' }, label: { type: 'string' } } },
      execute: (inp) => api.draw(inp),
    },
    {
      name: 'add_fixtures',
      description: 'Çizimde OLMAYAN tefrişi ekler ve mahale otomatik yerleştirir: kind tek tür (table, chair, desk, sofa, bed, cabinet, counter, wc, sink, urinal, shower, bathtub, ac, radiator…), takım (table_set = masa + 4 sandalye, meeting_set, desk_set, sofa_set, bed_set, wc_set) ya da kütüphane öğesi adı. room R.. (ya da alan işareti M..); count (0 = sığdığı kadar); layout grid | row | perimeter; sizeCm [en, derinlik]; spacingCm; rotDeg; at [x,y] ya da M.. ile tek noktaya.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' }, room: { type: 'string' }, count: { type: 'number' }, layout: { type: 'string' }, sizeCm: { type: 'array', items: { type: 'number' } }, spacingCm: { type: 'number' }, rotDeg: { type: 'number' }, at: {} }, required: ['kind'] },
      execute: (inp) => api.addFixtures(inp),
    },
    {
      name: 'add_structure',
      description: 'Çizimde olmayan yapı öğesi ekler. type "door"|"window": mevcut duvara açar (wall W.., widthCm, atCm duvar başından [boşsa orta], heightCm, sillCm; duvar 3B\'de kesilir). type "wall": iki nokta arası duvar (x1,y1,x2,y2, thicknessCm; mahaller yeniden hesaplanır). type "column": at [x,y] ya da M.., sizeCm, rotDeg.',
      inputSchema: { type: 'object', properties: { type: { type: 'string' }, wall: { type: 'string' }, widthCm: { type: 'number' }, atCm: { type: 'number' }, heightCm: { type: 'number' }, sillCm: { type: 'number' }, x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, thicknessCm: { type: 'number' }, at: {}, sizeCm: { type: 'array', items: { type: 'number' } }, rotDeg: { type: 'number' } }, required: ['type'] },
      execute: (inp) => api.addStructure(inp),
    },
    {
      name: 'edit',
      description: 'Öğe düzenler / siler. id ön ekine göre: O boşluk (kind, widthCm, heightCm, sillCm, shiftCm = duvar boyunca taşı [eski yer duvarla dolar], toWall + atCm = başka duvara al), W/C/G duvar-kolon-cam cephe (heightCm, exterior), F tefriş (kind), S eskiz. delete true kaldırır; ids ile birden çok kimlik birden silinir.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, kind: { type: 'string' }, widthCm: { type: 'number' }, heightCm: { type: 'number' }, sillCm: { type: 'number' }, shiftCm: { type: 'number' }, toWall: { type: 'string' }, atCm: { type: 'number' }, exterior: { type: 'boolean' }, delete: { type: 'boolean' } } },
      execute: (inp) => (Array.isArray(inp.ids) && inp.ids.length ? api.deleteElements(inp.ids.map(String)) : api.edit(inp)),
    },
    {
      name: 'library',
      description: 'KALICI KÜTÜPHANE / UZUN SÜRELİ BELLEK (sayfa kapanınca silinmez; paylaşımlı depo varsa diğer kullanıcılar da okur). action "add": name, kind = tefriş türü (table, chair, wc, ac… + sizeCm, aliases [blok adını yakalayan düzenli ifadeler], parts [{x,y,w,d,z0,z1,mat,shape}] 3B) | "ignore" (süs/çöp blok) | "note" (bilgi, standart, tercih: text, tags) | "recipe" (çizim tarifi: text, params); label, note. action "remove": name. Listelemek için list what library.',
      inputSchema: { type: 'object', properties: { action: { type: 'string' }, name: { type: 'string' }, label: { type: 'string' }, kind: { type: 'string' }, sizeCm: { type: 'array', items: { type: 'number' } }, aliases: { type: 'array', items: { type: 'string' } }, parts: { type: 'array', items: { type: 'object' } }, note: { type: 'string' }, text: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } }, params: { type: 'object' } }, required: ['action'] },
      execute: ({ action, ...def }) => (action === 'remove' ? api.library(String(def.name || '')) : api.libraryAdd(def)),
    },
    {
      name: 'parts',
      description: 'Pafta bölümleri (liste için list what parts). action "select" ids: işlenecek bölümleri seç (algılama yenilenir). "read" id: bölümün içeriğini oku (kot yazıları ve farkları → kat yüksekliği, parapet; ölçü sayıları; yazılar). "overlay" base + others: aynı alanın başka çizimlerini (tavan/tefriş/tesisat planı) asıl planın üstüne bindirir — yan yana iki bina yapma.',
      inputSchema: { type: 'object', properties: { action: { type: 'string' }, ids: { type: 'array', items: { type: 'string' } }, id: { type: 'string' }, base: { type: 'string' }, others: { type: 'array', items: { type: 'string' } } }, required: ['action'] },
      execute: ({ action, ids, id, base, others }) => {
        if (action === 'read') return api.readPart(String(id));
        if (action === 'overlay') return api.overlayParts(String(base), Array.isArray(others) ? others.map(String) : []);
        return api.setParts(Array.isArray(ids) ? ids.map(String) : []);
      },
    },
    {
      name: 'export',
      description: 'Dosya indirir (kullanıcıya kaydetme onayı çıkar). format "ifc": 3B BIM modeli. format "dxf": 2B çizim — sohbetle çizilenler + (include "model" ise) algılanan duvar/kapı/pencere/mahal/tefriş, orijinal plan koordinatlarında; AutoCAD açar, "Farklı kaydet → DWG" (tarayıcıda doğrudan DWG yazılamıyor).',
      inputSchema: { type: 'object', properties: { format: { type: 'string' }, include: { type: 'string' } }, required: ['format'] },
      execute: ({ format, include }) => (format === 'dxf' ? api.exportDxf(String(include || 'sketches')) : api.exportIfc()),
    },
    {
      name: 'show',
      description: 'Görünüm: view "plan" | "3d"; select id (öğeyi seçip gösterir); tour true otomatik gezi; panel "advanced" ayrıntılı ayarlar, "simple" kapatır.',
      inputSchema: { type: 'object', properties: { view: { type: 'string' }, select: { type: 'string' }, tour: { type: 'boolean' }, panel: { type: 'string' } } },
      execute: ({ view, select, tour, panel }) => api.show({ view: view ? String(view) : '', select: select ? String(select) : '', tour: !!tour, panel: panel ? String(panel) : '' }),
    },
    {
      name: 'reset_project',
      description: 'Bütün düzenlemeleri geri alır ve çizimi baştan algılar.',
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
