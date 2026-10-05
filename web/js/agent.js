// Claude ajan modu: claude.ai içindeki `sample` yeteneğiyle (kullanıcının kendi aboneliği,
// anahtar yok) Claude sayfanın araçlarını çağırarak projeyi uçtan uca inceler, kararları
// uygular ve sohbetle düzenlemeye devam eder. Claude hafızasızdır: her çağrıda kurallar +
// güncel proje özeti + son sohbet turları birlikte gönderilir.

export const AGENT_RULES = `Sen DWG2BIM uygulamasının içinde çalışan deneyimli bir mimari + mekanik tesisat BIM uzmanısın. Uygulama bir AutoCAD kat planından (DWG) mimari ve tesisat 3B BIM modeli (IFC) üretiyor. Kullanıcı seninle Türkçe konuşur; sen de Türkçe, kısa ve net yazarsın. Arayüzde ayar paneli yoktur: kullanıcının istediği HER ayarı sen araçlarla yaparsın (katman rolleri, birim/bölge, ölçüler, boşluk türleri, mahal adları, tesisat profilleri, kot, tefriş, duvar ekleme/silme, görünüm, gezi, IFC indirme).

Sana verilen ARAÇLAR sayfanın gerçek fonksiyonlarıdır: liste araçları projenin güncel durumunu okur, "apply" aracı ayarları DOĞRUDAN uygular (katman rolleri, ölçüler, boşluk türleri, mahal adları, tesisat katman profilleri, bilgi bankası kuralları, asma tavan kotu, gezi rotası, rapor). Öneri yapma, uygula; sonra ne yaptığını 1-3 cümleyle söyle. Emin olamadığın, geri alınması zor bir şeyde (katman rolünü değiştirmek bütün algılamayı yeniler) önce kısa bir soru sorabilirsin.

Çizimde olmayan şeyleri de ekleyebilirsin — bu uygulamanın yetki alanındadır: add_fixtures (mahale masa-sandalye, klima, klozet vb.; otomatik yerleşim), add_opening (duvara kapı/pencere), add_column, add_wall, delete_elements. "Yapılamaz / DWG'ye eklenmeli / Revit'te yapılmalı" deme; aracı çağır. Eklenenler 3B'ye ve IFC'ye girer.

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
1b) set_parts (ids boş) ile paftadaki ayrık çizim bölümlerini listele: asıl kat planı hangisi, lejant/şema/detay/vaziyet planı hangisi karar ver. Birden çok gerçek plan parçası varsa (örn. büyük proje iki paftaya bölünmüş) hepsini ids ile seç; yanlış bölüm seçilmişse düzelt. Bölüm değişince algılama yenilenir; listeleri tekrar oku.
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
      description: 'Boşlukları döndürür: id, tür, genişlik cm, dış/iç, programın gerekçesi, varsa kullanıcı/yapay zekâ değişikliği. kind ile süzülebilir (door, window, empty, solid).',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' } } },
      execute: ({ kind }) => api.listOpenings(kind ? String(kind) : ''),
    },
    {
      name: 'list_rooms',
      description: 'Mahalleri döndürür: id, ad (yoksa boş), alan m², içindeki tefriş türleri.',
      execute: () => api.listRooms(),
    },
    {
      name: 'list_walls',
      description: 'Duvar, kolon ve cam cephe şeritlerini döndürür: id, kalınlık cm, uzunluk m, dış/iç, çizim koordinatlarında sınır kutusu (add_wall için).',
      execute: () => api.listWalls(),
    },
    {
      name: 'list_fixtures',
      description: 'Tanınan tefrişi döndürür: id, tür, ölçü, kaynak (blok adı / küme), hangi mahalde.',
      execute: () => api.listFixtures(),
    },
    {
      name: 'list_mep',
      description: 'Tesisat katmanlarını içerik özeti ve şu anki profiliyle (kind/system/kot/ölçü/kaynak) döndürür; bilinmeyenler önce. Ayrıca çıkarılan boru/kanal/cihaz sayıları.',
      execute: () => api.listMep(),
    },
    {
      name: 'list_texts',
      description: 'Çizimdeki yazıları arar (mahal adları, kot yazıları, başlıklar, çap/ölçü yazıları). filter: içinde geçen metin (isteğe bağlı); layer: katman adı süzgeci (isteğe bağlı). En çok 200 satır: yazı, katman, konum.',
      inputSchema: { type: 'object', properties: { filter: { type: 'string' }, layer: { type: 'string' } } },
      execute: ({ filter, layer }) => api.listTexts(filter ? String(filter) : '', layer ? String(layer) : ''),
    },
    {
      name: 'list_blocks',
      description: 'Çizimdeki blok (sembol) adlarını ve sayılarını döndürür: tefriş, cihaz, kapı/pencere blokları. filter ile süzülebilir.',
      inputSchema: { type: 'object', properties: { filter: { type: 'string' } } },
      execute: ({ filter }) => api.listBlocks(filter ? String(filter) : ''),
    },
    {
      name: 'get_diagnostics',
      description: 'Programın emin olamadığı noktaların güncel listesi (önem, açıklama, ilgili kimlikler).',
      execute: () => api.diagnostics(),
    },
    {
      name: 'apply',
      description: 'Değişiklikleri DOĞRUDAN uygular ve ne yapıldığını döndürür. changes alanları (hepsi isteğe bağlı): layers {walls,columns,doors,windows,texts: [katman adı]}, params {wallHeightCm, doorHeightCm, windowSillCm, windowHeightCm, slabThicknessCm, makeRoof, minThicknessCm, maxThicknessCm, maxDoorCm, projectName, storeyName}, openings {"O12": {kind, heightCm, sillCm}}, rooms {"R4": {name}}, mep {"KATMAN ADI": {kind, system, elevRef, elevOffsetCm, sizeCm}}, learn [{pattern, kind, system, elevRef, elevOffsetCm, sizeCm, note}], ignore [{pattern, reason}], ceilingCm, ceilingReason, tour {order:[R..], notes:{R..: "..."}}, report, issues [{severity, title, detail, fixed}].',
      inputSchema: { type: 'object', properties: { changes: { type: 'object' } }, required: ['changes'] },
      execute: ({ changes }) => api.apply(changes && typeof changes === 'object' ? changes : {}),
    },
    {
      name: 'delete_elements',
      description: 'Verilen kimlikleri modelden kaldırır (W duvar, C kolon, O boşluk, R mahal, G cam cephe, F tefriş). Yanlış algılanmış öğeler için.',
      inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } }, required: ['ids'] },
      execute: ({ ids }) => api.deleteElements(Array.isArray(ids) ? ids.map(String) : []),
    },
    {
      name: 'set_fixture',
      description: 'Bir tefriş öğesinin türünü değiştirir. kind: wc, squat, urinal, sink, ksink, faucet, shower, bathtub, ac, radiator, drain, table, desk, chair, sofa, bed, cabinet, counter.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string' } }, required: ['id', 'kind'] },
      execute: ({ id, kind }) => api.setFixture(String(id), String(kind)),
    },
    {
      name: 'add_fixtures',
      description: 'Çizimde OLMAYAN tefrişi ekler ve mahale otomatik yerleştirir: kind tek tür (table, chair, desk, sofa, bed, cabinet, counter, wc, sink, urinal, shower, bathtub, ac, radiator…) ya da takım (table_set = masa + 4 sandalye, meeting_set, desk_set, sofa_set, bed_set, wc_set). room: mahal kimliği (R..). count: kaç takım/öğe (0 = sığdığı kadar). layout: grid | row | perimeter (duvar dibi). sizeCm [en, derinlik], spacingCm, rotDeg isteğe bağlı. room yerine at [x,y] (çizim koordinatı) verilirse tek öğe o noktaya konur. Kullanıcı "masa sandalye koy", "klima ekle" dediğinde kullan.',
      inputSchema: { type: 'object', properties: { kind: { type: 'string' }, room: { type: 'string' }, count: { type: 'number' }, layout: { type: 'string' }, sizeCm: { type: 'array', items: { type: 'number' } }, spacingCm: { type: 'number' }, rotDeg: { type: 'number' }, at: { type: 'array', items: { type: 'number' } } }, required: ['kind'] },
      execute: (inp) => api.addFixtures(inp),
    },
    {
      name: 'add_opening',
      description: 'Çizimde olmayan bir kapı ya da pencereyi mevcut bir duvara açar (duvar 3B\'de kesilir). wall: duvar kimliği (W..), kind door|window, widthCm, atCm: duvarın başından mesafe (boşsa ortaya), heightCm / sillCm isteğe bağlı.',
      inputSchema: { type: 'object', properties: { wall: { type: 'string' }, kind: { type: 'string' }, widthCm: { type: 'number' }, atCm: { type: 'number' }, heightCm: { type: 'number' }, sillCm: { type: 'number' } }, required: ['wall'] },
      execute: (inp) => api.addOpening(inp),
    },
    {
      name: 'add_column',
      description: 'Çizimde olmayan bir kolon ekler: at [x,y] çizim koordinatı, sizeCm [en, boy] (varsayılan 40x40), rotDeg.',
      inputSchema: { type: 'object', properties: { at: { type: 'array', items: { type: 'number' } }, sizeCm: { type: 'array', items: { type: 'number' } }, rotDeg: { type: 'number' } }, required: ['at'] },
      execute: ({ at, sizeCm, rotDeg }) => api.addColumn(at, sizeCm, rotDeg),
    },
    {
      name: 'add_wall',
      description: 'Çizimde eksik bir duvarı iki nokta arasına ekler (çizim koordinatları, list_walls ile aynı birim) ve mahalleri yeniden hesaplar. thicknessCm isteğe bağlı (varsayılan 10).',
      inputSchema: { type: 'object', properties: { x1: { type: 'number' }, y1: { type: 'number' }, x2: { type: 'number' }, y2: { type: 'number' }, thicknessCm: { type: 'number' } }, required: ['x1', 'y1', 'x2', 'y2'] },
      execute: ({ x1, y1, x2, y2, thicknessCm }) => api.addWall(+x1, +y1, +x2, +y2, thicknessCm ? +thicknessCm : 10),
    },
    {
      name: 'set_parts',
      description: 'Paftadaki ayrık çizim gruplarını (bölümleri) listeler ve/veya işlenecek bölümleri seçer. ids boşsa yalnız listeler; ids verilirse o bölümler birlikte işlenir (algılama yenilenir).',
      inputSchema: { type: 'object', properties: { ids: { type: 'array', items: { type: 'string' } } } },
      execute: ({ ids }) => api.setParts(Array.isArray(ids) ? ids.map(String) : null),
    },
    {
      name: 'show',
      description: 'Görünümü değiştirir: view "plan" veya "3d"; select ile bir öğeyi seçip gösterir; tour true ise otomatik geziyi başlatır; panel "advanced" ayrıntılı ayar panellerini açar, "simple" kapatır.',
      inputSchema: { type: 'object', properties: { view: { type: 'string' }, select: { type: 'string' }, tour: { type: 'boolean' }, panel: { type: 'string' } } },
      execute: ({ view, select, tour, panel }) => api.show({ view: view ? String(view) : '', select: select ? String(select) : '', tour: !!tour, panel: panel ? String(panel) : '' }),
    },
    {
      name: 'export_ifc',
      description: 'Modeli IFC dosyası olarak indirir (kullanıcıya kaydetme onayı çıkar). Kullanıcı "IFC indir / dışa aktar" dediğinde kullan.',
      execute: () => api.exportIfc(),
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
