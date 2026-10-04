# DWG2BIM

AutoCAD DWG/DXF kat planından 3B BIM modeli (IFC) üreten, tamamen tarayıcıda çalışan araç.
Sunucu veya bulut gerekmez; dosyalar kullanıcının bilgisayarından çıkmaz.

## Ne yapar

**Akış:**
- **İlk açılış:** Kısa bir **karşılama ekranı** ne olduğunu ve üç adımda nasıl kullanıldığını anlatır. "Demo binayı gör" ile program tarafından üretilen örnek bir ofis binası (`web/js/demo.js`: cam giydirme cepheli giriş holü, toplantı, mutfak, ofisler, WC grubu, teknik hacim; tefriş, klima ve borular) normal algılama hattından geçirilip 3B gösterilir. Dışarıdan hiçbir dosya indirilmez.
- **Kendi dosyanız:** Bir DWG yüklenince model hemen gösterilmez. Önce **analiz ekranı** açılır: program tespitlerini özetler, yapay zekâ komutunu verir; cevap yapıştırılınca düzeltmeler uygulanır, sonra 2B veya 3B gösterilir. claude.ai'de "Claude ile otomatik yap" ile bu adım tek tıktır.
- **Otomatik gezi:** 3B görünümdeki **Otomatik gezi** düğmesiyle başlar (kendiliğinden açılmaz). Göz hizasında (1,6 m) binanın içinde dolaşılır.
  - Rota mahalleri kapı ve geçişlerden bağlar; girişten başlar, her mahalde çevresine bakar.
  - Yapay zekâ cevabındaki `tour.order` / `tour.notes` varsa o sıra ve açıklamalar kullanılır.
  - Duraklat / hız / bitir kontrolleri vardır.

1. **DWG/DXF okur:** LibreDWG'nin WebAssembly sürümü kullanılır. Bloklar açılır, OCS aynalamaları ve yaylar düzeltilir.
2. **Katmanları eşler:** Duvar ve kolon katmanları otomatik önerilir, elle değiştirilebilir.
3. **Algılar:**
   - **Duvarlar:** duvar katmanındaki ince kapalı alanlar; açık uçlar otomatik kapatılır.
   - **Kolonlar:** kolon katmanındaki kapalı alanlar.
   - **Kapı ve pencere boşlukları:** karşılıklı duvar uçları arasındaki boşluklar. Türü kanıta göre belirlenir:
     - **dolu:** içi taşıyıcı tarama veya beton ise;
     - **kapı:** açılış yayı varsa;
     - **pencere:** cam/doğrama çizgisi boşluğu kesiyorsa ya da boşlukla sınırlı paralel cam/denizlik çizgileri varsa;
     - **kanıt yoksa:** dar dış boşluk dolu, geniş dış boşluk geçiş sayılır.
     Her kararın gerekçesi seçim kartında gösterilir.
   - **Cam giydirme cephe / cam bölme:** Cam katmanındaki (kapı açılış yayları hariç) ince uzun şeritler, bir duvar boşluğunun içinde değilse `IfcCurtainWall` olur: tam yükseklik cam, dikme ve kayıtlarla. Şeritler arasındaki açılış yaylı aralıklar kapıdır. Kapı yayı geniş bir boşluğun yalnız bir kısmını kaplıyor ve kalanında cam çizgisi varsa boşluk **kapı + cam** olarak bölünür. 3 m'den geniş dış cam boşlukları vitrin gibi parapetsiz, tam yükseklik cam yapılır.
   - **Çakışma yok:** Üst üste binen boşluklardan kanıtı zayıf olan atılır; cam şeritler duvar ve boşluklarla çakışmaz; aynı yere bölünmüş duvarlar boşluk sayılmaz; dış/iç çizgisi eksik tek çizgili duvarlar dolu sayılır. Kapı yayı yalnız menteşesi boşluğun kenarındaysa kanıt sayılır (komşu kapının yayı değil).
   - **Cam bölmeler:** Pencere işareti katmanlarındaki (cam, doğrama) çizgiler mahal sınırına katılır.
   - **Tefriş:** Blok adından (klozet, alaturka, pisuvar, lavabo, eviye, batarya/musluk, duş, küvet, yer süzgeci, klima iç ünitesi, radyatör, masa, sandalye, kanepe, yatak, dolap, tezgâh) ya da blok patlatılmışsa ıslak hacimlerdeki çizgi kümelerinin boyutundan tanınır. Her tür için parametrik 3B parçalar üretilir (rezervuar + gövde, lavabo + ayak + batarya, duş teknesi + cam, duvar/kaset tipi klima…). IFC: `IfcSanitaryTerminal`, `IfcValve(FAUCET)`, `IfcWasteTerminal`, `IfcUnitaryEquipment`, `IfcSpaceHeater`, `IfcFurniture`.
   - **Süs çizimleri yok sayılır:** ağaç, palmiye, bitki, insan, araç, logo, kuzey oku gibi bloklar ve katmanlar 3B'ye ve IFC'ye geçmez.
   - **Elle duvar çizme:** Çizimde olmayan bir duvar Mimari sekmesindeki **Duvar çiz** aracıyla iki tıklamada eklenir; mahaller yeniden hesaplanır.
   - **Açık uç onarımı:** Açık kalan duvar uçları kapatılır. Bu, kayık biten çizgilerde ve sıva + yalıtım + gövdesi ayrı çizilmiş çok katmanlı duvarlarda da çalışır. Birkaç cm kala biten çizgiler karşı duvara uzatılır.
   - **Mahaller:** odalar, adları ve alanlarıyla.
   - **Bina dış hattı.**
4. **Düzenleme:** Plana tıklanan boşluğun türü değiştirilebilir (pencere / kapı / geçiş). Yükseklik ve parapet ayarlanabilir, öğe silinebilir, mahal adı değiştirilebilir.
5. **Önizleme:** 3B olarak gösterir (three.js). Kapılar kasa + 90° açık kanat + kol, pencereler denizlik + kasa + kayıt + cam, cam cepheler dikme + cam olarak parçalı çizilir; her parça kendi malzemesiyle.
6. **Dışa aktarma:** **IFC4** dosyası üretir. Revit'te *Dosya › Aç › IFC* ile açılıp *Farklı Kaydet › RVT* yapılabilir. FreeCAD ve Blender (Bonsai) ile de açılır.
7. **Yapay zekâ asistanı:** Çizimin özetini ve talimatları içeren bir komut üretir. Komut bir yapay zekâya (Claude, ChatGPT…) yapıştırılır, gelen JSON cevabı uygulamaya geri yapıştırılır. Katmanlar, ölçüler, kapı/pencere türleri ve mahal adları otomatik ayarlanır.
8. **Mekanik tesisat:** Tesisat katmanları bilgi bankasıyla sınıflandırılır ve aşağıdaki gibi 3B'ye ve IFC'ye aktarılır:
   - **Borular** (soğuk/sıcak su, pis su, yağmur, VRF, sprinkler…): tek çizgilerden. Çap, yakındaki Ø/DN yazısından okunur.
   - **Kanal ve menfezler:** kapalı şekillerden.
   - **Cihazlar:** bloklardan (blok adıyla) veya kümelemeyle.
   - **Uç birimler:** sprinkler başlıkları ve vanalar.
   - **IFC sınıfları:** `IfcPipeSegment`, `IfcDuctSegment`, `IfcAirTerminal`, `IfcUnitaryEquipment`, `IfcFireSuppressionTerminal`, `IfcValve` ve sistem başına `IfcDistributionSystem`.
   - **Kot:** Asma tavan kotu projede yazıyorsa okunur; yoksa kullanıcıya sorulur ve çizimdeki kot yazıları öneri olarak gösterilir.
9. **Pafta bölümleri:** Pafta ayrık çizimlere bölünür ve her bölüm adıyla (içindeki başlık yazısından), boyutuyla ve içeriğiyle listelenir. Bir veya birden çok bölüm seçilip birlikte işlenebilir. Her bölüm kendi katmanları ve birimiyle algılanır, sonuçlar tek modelde birleşir.
10. **Çöp çizim ayıklama:** Pafta ayrık çizim gruplarına bölünür. Asıl plan, duvar algılama ve tesisat içeriğine göre seçilir. Lejant, kolon şeması, detay ve uzak kalıntılar yok sayılır. Ayrıca şunlar atlanır: sprinkler etki daireleri, yazı/ölçü/tarama katmanları ve başka projelerden bağlanmış referans katmanları (`...$0$...`, `SUPERPOZE`).
11. **Öğrenen bilgi bankası:** Bilinmeyen katmanlar işaretlenir ve yapay zekâ komutuna içerik özetleriyle eklenir.
    - Yapay zekâdan hem bu projenin kararları hem de gelecek projeler için genel kurallar (`learn`, `ignore`) istenir.
    - Gelen kurallar tarayıcıda saklanır, JSON olarak dışa/içe aktarılabilir.
    - Kullanıcı bir katmanın ayarını "Öğret" düğmesiyle de kural yapabilir.
12. **RVT inceleme:** Revit olmadan okunabilenleri gösterir: sürüm, önizleme resmi, bağlantılar, tip adları. 3B geometri kapalı formatta olduğu için okunamaz.

## Klasörler

```
web/                  uygulama (derleme adımı yok, doğrudan yayınlanır)
  app.html            sayfa içeriği (claude.ai Artifact biçimi)
  index.html          tam HTML (tools/build-pages.mjs üretir; GitHub Pages / yerel sunucu)
  js/flatten.js       DWG veritabanı -> düz çizgi listesi
  js/detect.js        duvar / kolon / boşluk / mahal algılama
  js/build3d.js       2B model + ölçüler -> 3B katılar
  js/ifc.js           IFC4 STEP yazıcı
  js/view2d.js        plan görüntüleyici (canvas)
  js/view3d.js        3B görüntüleyici (three.js)
  js/ai-prompt.js     yapay zekâ komutu üretme / cevap çözümleme
  js/rvt.js           RVT (OLE/CFB) bilgi okuyucu
  js/islands.js       paftayı ayrık çizim gruplarına bölme
  js/auto.js          asıl plan, katman rolleri ve birim tahmini
  js/kb.js            bilgi bankası: tesisat sistemleri, yerleşik/öğrenilmiş kurallar
  js/mep.js           tesisat çıkarımı ve kot tespiti
  js/tour.js          otomatik gezi rotası (mahaller + kapılar)
  js/fixtures.js      tefriş tanıma (blok adı / ıslak hacim kümeleri), süs ayıklama
  js/demo.js          açılış demosu: üretilen örnek bina (gerçek DWG gibi işlenir)
  js/diagnose.js      programın tespit ettiği sorunlar (yapay zekâ analizine gider)
  vendor/             libredwg-web 0.7.14 (GPL-3.0), three.js 0.180 (MIT)
ornek-dosyalar/       testlerde kullanılan özgün örnek dosyalar (siteye konmaz)
tests/                Node ve tarayıcı testleri
tools/                yardımcı betikler
```

## Yerelde çalıştırma

```bash
node tools/build-pages.mjs          # web/index.html üret
cd web && python3 -m http.server 8000
# tarayıcıda http://localhost:8000
```

## Testler

```bash
# Örnek DWG'den algılama + IFC üretimi (Node 20+)
IFC=/tmp/test.ifc node tests/run-sample.mjs
# IFC doğrulama (pip install ifcopenshell)
python3 tests/validate_ifc.py /tmp/test.ifc
# Otomatik kurulum + tesisat çıkarımı (+ IFC_DIR verilirse IFC)
IFC_DIR=/tmp node tests/run-mep.mjs dosya1.dwg dosya2.dwg
# Duvar kapsama ve boşluk kanıtı analizi
node tests/coverage.mjs dosya.dwg cikti.svg
node tests/openings-evidence.mjs dosya.dwg
# Birden çok dosya için tek satır özet (duvar, mahal, cam cephe, boşluk türleri, tefriş)
node tests/summary.mjs a.dwg b.dwg
# Uçtan uca tarayıcı testi (playwright gerekir; EXTRA=dosya.dwg ile ek dosya yükler)
node tests/e2e.cjs http://localhost:8000/ /tmp
```

## Sınırlamalar (ilk sürüm)

- Tesisat: 2B planda kot yoktur. Her katman tek bir kota (tavandan/döşemeden fark) yerleştirilir. Düşey kolonlar, eğimler ve bağlantı parçaları (dirsek, te) henüz yok. Tek çizgili havalandırma kanalları (kapalı şekil olmayan) çizilmez.
- Tek kat. Düz duvarlar; kavisli duvarlar parçalı yaklaşıklanır. Çatı, merdiven ve döşeme boşlukları yok.
- Duvarlar IFC'de çizimdeki dış hatlarıyla parça parça aktarılır (her parça ayrı `IfcWall`). Pencere üstü ve altı lento/parapet olarak ayrı duvar parçalarıdır.
- Cam izi olmayan geniş dış boşluklar "geçiş" sayılır. Giriş kapısı veya pencere olanları planda tıklayarak ya da yapay zekâ asistanıyla değiştirin.
- Algılama kalitesi çizimin düzenine bağlıdır: duvarlar ayrı katmanda ve kapalı/paralel çizgilerle çizilmiş olmalıdır.

## Lisans

Uygulama GPL-3.0 lisanslı LibreDWG'yi içerdiği için bütünü GPL-3.0 uyumlu dağıtılmalıdır.
