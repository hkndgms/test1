# @Voice Aloud Reader — Özellik Envanteri (v1, taslak)

Kaynak: Hyperionics resmi site/özellik rehberleri, Play Store açıklaması, değişiklik günlüğü ve
üçüncü taraf incelemeler (Ekim 2026 itibarıyla). Uygulama paketi: `com.hyperionics.avar`.
Son sürümler 40.x serisinde. Bu liste "ne yapıyor" sorusunun cevabıdır; "nasıl yapıyor" kısmı
ayrı bir analiz dokümanında ele alınacak.

Durum sütunu: ✅ doğrulandı (resmi kaynak) · ◐ ikincil kaynak · ❓ kullanarak doğrulanmalı

## 1. İçerik kaynakları (girdi)

| # | Özellik | Durum |
|---|---------|-------|
| 1.1 | Web sayfası: URL yapıştırma, paylaş menüsünden gönderme, dahili tarayıcı | ✅ |
| 1.2 | Akıllı makale çıkarma (menü, reklam, kenar çubuklarını temizleme) | ✅ |
| 1.3 | Dosya tarayıcısı ile yerel dosya açma | ✅ |
| 1.4 | PDF (metin çıkarma) | ✅ |
| 1.5 | PDF OCR (taranmış sayfalar) + manuel kırpma aracı | ✅ |
| 1.6 | EPUB, AZW3, FB2 e-kitap | ✅ |
| 1.7 | Word (doc, docx), RTF, ODT | ✅ (eski changelog) ❓ güncel durum |
| 1.8 | HTML ve düz metin dosyası | ✅ |
| 1.9 | Panodan metin yapıştırma / kendi metnini yazma | ✅ |
| 1.10 | Dropbox ve izlenen İndirilenler klasöründen otomatik alma | ✅ |
| 1.11 | Bulut sürücü bağlantıları (tarayıcıdan indirilen dosyayı otomatik açma) | ✅ (37.8.5) |
| 1.12 | WhatsApp sohbet dışa aktarımını okuma | ◐ |
| 1.13 | Web roman bölümlerini toplu olarak listeye aktarma | ◐ (forum) |

## 2. Okuma listeleri ve kütüphane

| # | Özellik | Durum |
|---|---------|-------|
| 2.1 | Birden fazla okuma listesi (haber, kitap, dil çalışması, iş vb.) | ✅ |
| 2.2 | Listede sıralı/kesintisiz oynatma (makale bitince sonrakine geç) | ✅ |
| 2.3 | Yatay kaydırma ile önceki/sonraki makale | ✅ |
| 2.4 | Yer imleri (bookmark), kulaklık tuşuyla yer imi bırakma | ✅ |
| 2.5 | Kaldığı yerden devam (okuma konumu hafızası) | ✅ |
| 2.6 | Cihazlar arası senkron: konum, yer imi ve listeler (Dropbox; gizlilik politikası Google Drive diyor) | ✅ ❓ hangisi güncel |
| 2.7 | Sayfaları listeye ekleyen yarı otomatik geçici çözüm (ayarlardan açılır) | ✅ |

## 3. Seslendirme (TTS)

| # | Özellik | Durum |
|---|---------|-------|
| 3.1 | Cihazdaki tüm TTS motorları (Google, Samsung vb.) | ✅ |
| 3.2 | Bulut sesleri: Google WaveNet, Amazon Polly, Microsoft Azure (kullanıcının kendi anahtarı, ücretli) | ✅ |
| 3.3 | Hız, perde (pitch), ses seviyesi ayarı | ✅ |
| 3.4 | Dil otomatik algılama ve dile göre ses seçimi | ◐ |
| 3.5 | Metin içi açıklama etiketleriyle ses/dil/hız/perde/duraklama değiştirme | ✅ |
| 3.6 | Diyalog sesleri: anlatıcı + karakter sesleri, diyalog algılama sihirbazı (Dlg1/Dlg2) | ✅ |
| 3.7 | Kayıtlı ses grupları; karakter başına motor/hız/perde/ses | ✅ |
| 3.8 | Telaffuz düzeltme (speech replacement), regex destekli | ✅ |
| 3.9 | Etiketli telaffuz setleri (materyal türüne göre) | ◐ (premium) |
| 3.10 | Sese kaydetme: WAV/OGG; tüm liste/kitap boyunca sürekli kayıt (premium) | ✅ |

## 4. Oynatma kontrolleri

| # | Özellik | Durum |
|---|---------|-------|
| 4.1 | Alt çubuk: oynat/duraklat, önceki/sonraki cümle | ✅ |
| 4.2 | Bildirim ve kilit ekranı kontrolleri, arka planda okuma | ✅ |
| 4.3 | Kulaklık/araç tuşları: oynat, duraklat, geri, ileri; uzun basınca makale değiştirme | ✅ |
| 4.4 | Kulaklık tuş eşlemeyi tersine çevirme; Bluetooth bağlanınca ilk Play'i yoksayma | ✅ |
| 4.5 | Cihazı yatay sallayarak başlat/durdur (aşırı sallanınca otomatik kapatma) | ✅ |
| 4.6 | Uyku zamanlayıcısı: 1 dk – 5 saat | ✅ |
| 4.7 | Tekrar (repeat) düğmesi, varsayılan gizli | ✅ |
| 4.8 | Android Auto eklentisi (ayrı APK): listeden seçme, araç ekranından kontrol | ✅ |

## 5. Görüntüleme ve okuma deneyimi

| # | Özellik | Durum |
|---|---------|-------|
| 5.1 | Kelime ve cümle vurgulama (okunan yeri takip) | ✅ |
| 5.2 | Yazı boyutu, OpenDyslexic yazı tipi | ✅ |
| 5.3 | Yüksek kontrast ve özel renk temaları | ✅ |
| 5.4 | E-kitapta orijinal biçimlendirme ve görseller | ◐ |
| 5.5 | Dikey Çince/Japonca metin desteği | ◐ |
| 5.6 | Ekran açık tutma ayarları | ✅ |

## 6. Dil araçları

| # | Özellik | Durum |
|---|---------|-------|
| 6.1 | Uzun basınca sözlük, çeviri, Wikipedia, web arama | ✅ |
| 6.2 | Makale çevirisi (Google Translate) | ✅ |
| 6.3 | İki dilli (interleaved) görünüm; anlık cümle çevirisi | ✅ |
| 6.4 | Kaynak ve çeviri metin için ayrı sesler | ✅ |

## 7. Ticari model ve eklentiler

| # | Özellik | Durum |
|---|---------|-------|
| 7.1 | Ücretsiz sürüm reklamlı (banner + makale geçişinde tam ekran) | ✅ |
| 7.2 | Premium lisans (ayrı uygulama `com.hyperionics.avarLic`): reklam kaldırma, sürekli kayıt, telaffuz setleri, otomatik eklenti kontrolü | ✅ |
| 7.3 | @Voice Connector, @Voice Auto Plugin (ayrı dağıtılan eklentiler) | ✅ |
| 7.4 | Bulut TTS için kullanıcı kendi API anahtarını girer | ✅ |

## 8. Doğrulanması gereken açık sorular

- Senkron gerçekten Dropbox mu, Google Drive mı, ikisi de mi?
- Word/ODT desteği güncel sürümde hâlâ var mı?
- WhatsApp dışa aktarma ve dikey CJK metin güncel sürümde var mı?
- Ayar menüsünün tam ağacı (ekran görüntüleriyle çıkarılmalı).
- Makale çıkarma algoritmasının davranışı (Readability benzeri mi, kendi kuralları mı?).

## 9. Bu envanterin kullanımı

Sonraki adım: her satır için iOS karşılığını (yerleşik API / açık kaynak kütüphane / kendimiz yazarız)
belirleyip `02-ios-karsiliklari.md` dosyasını üretmek, ardından MVP kapsamını seçmek.
