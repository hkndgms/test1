# DWG2BIM

AutoCAD DWG/DXF kat planından 3B BIM modeli (IFC) üreten, tamamen tarayıcıda çalışan araç.
Sunucu veya bulut gerekmez; dosyalar kullanıcının bilgisayarından çıkmaz.

## Ne yapar

1. **DWG/DXF okur:** LibreDWG'nin WebAssembly sürümü kullanılır. Bloklar açılır, OCS aynalamaları ve yaylar düzeltilir.
2. **Katmanları eşler:** Duvar ve kolon katmanları otomatik önerilir, elle değiştirilebilir.
3. **Algılar:**
   - **Duvarlar:** duvar katmanındaki ince kapalı alanlar; açık uçlar otomatik kapatılır.
   - **Kolonlar:** kolon katmanındaki kapalı alanlar.
   - **Kapı ve pencere boşlukları:** karşılıklı duvar uçları arasındaki boşluklar.
   - **Mahaller:** odalar, adları ve alanlarıyla.
   - **Bina dış hattı.**
4. **Düzenleme:** Plana tıklanan boşluğun türü değiştirilebilir (pencere / kapı / geçiş). Yükseklik ve parapet ayarlanabilir, öğe silinebilir, mahal adı değiştirilebilir.
5. **Önizleme:** 3B olarak gösterir (three.js).
6. **Dışa aktarma:** **IFC4** dosyası üretir. Revit'te *Dosya › Aç › IFC* ile açılıp *Farklı Kaydet › RVT* yapılabilir. FreeCAD ve Blender (Bonsai) ile de açılır.
7. **Yapay zekâ asistanı:** Çizimin özetini ve talimatları içeren bir komut üretir. Komut bir yapay zekâya (Claude, ChatGPT…) yapıştırılır, gelen JSON cevabı uygulamaya geri yapıştırılır. Katmanlar, ölçüler, kapı/pencere türleri ve mahal adları otomatik ayarlanır.
8. **RVT inceleme:** Revit olmadan okunabilenleri gösterir: sürüm, önizleme resmi, bağlantılar, tip adları. 3B geometri kapalı formatta olduğu için okunamaz.

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
  vendor/             libredwg-web 0.7.14 (GPL-3.0), three.js 0.180 (MIT)
  samples/            örnek DWG ve RVT
ornek-dosyalar/       özgün örnek dosyalar
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
# Uçtan uca tarayıcı testi (playwright gerekir)
node tests/e2e.cjs http://localhost:8000/ /tmp
```

## Sınırlamalar (ilk sürüm)

- Tek kat. Düz duvarlar; kavisli duvarlar parçalı yaklaşıklanır. Çatı, merdiven ve döşeme boşlukları yok.
- Duvarlar IFC'de çizimdeki dış hatlarıyla parça parça aktarılır (her parça ayrı `IfcWall`). Pencere üstü ve altı lento/parapet olarak ayrı duvar parçalarıdır.
- Dış cephedeki boşluklar varsayılan olarak pencere sayılır; giriş kapılarını planda tıklayarak ya da yapay zekâ asistanıyla değiştirin.
- Algılama kalitesi çizimin düzenine bağlıdır: duvarlar ayrı katmanda ve kapalı/paralel çizgilerle çizilmiş olmalıdır.

## Lisans

Uygulama GPL-3.0 lisanslı LibreDWG'yi içerdiği için bütünü GPL-3.0 uyumlu dağıtılmalıdır.
