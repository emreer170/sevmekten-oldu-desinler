# DEVİR NOTU (Claude için): Sevmekten Öldü Desinler! bilet rezervasyon sitesi

Bu dosyayı oku, sonra çalış. Kullanıcıyla **Türkçe**, **çok basit ve adım adım** konuş (teknik biri değil). Kullanıcı ne yapacağını net, kısa adımlarla ister. Bir şey çalışmıyorsa ekran görüntüsü/hata metni ister, tahmin yürütme.

## Proje
Tek bir tiyatro oyunu için (Sevmekten Öldü Desinler!) tarih seçip yer ayırtılan, ödeme gişede nakit olan, ortak şifreli yönetici paneli olan basit bir site. Instagram bio'larında (12 oyuncu paylaşacak) linki kullanılacak.
- Yazan: Murat Mahmutyazıcıoğlu, Yönetmen: Tevfik Şahin. Oyun müzikli, kara mizah/dram; küfür/şiddet içerir. Yaş sınırı **14+**. Süre **95 dk**.
- Mekân: Butik Oyunculuk Atölyesi, Kadıköy (Acıbadem Mah. Sarayardı Cad. No:82 D:6, Çakmak İş Merkezi Kat:1). Söğütlüçeşme Metrobüs ve Marmaray'a ~5 dk yürüme (kullanıcı söyledi).
- Tarihler: 31 Ekim 2026'dan 26 Aralık'a her cumartesi 20:30 (9 oyun), kontenjan **43** (kullanıcı kontenjanı müşteriye göstermek istemiyor, sadece "sınırlı sayıda / hızla tükeniyor / son N bilet" gibi ibareler görünür).
- Fiyat: ~~600 TL~~ **300 TL** "Erken rezervasyon fiyatı" (%50 indirim etiketi). Para birimi **TL** (₺ glifi yazı tipinde bozuk görünüyordu).
- Oyuncular (karaktere göre sıralı): Ahmet: Emre Erçörekçi, Taha Berk Gürçay; Gönül: Duru Öztunç, Eda Çetinkaya, Dilek Kara, Ezgi Selin Koçak; Hamdi: Okan Kaynak, Hüseyin Yalçınkaya; Mustafa: Emre Can Karayel, Furkan Birinci; Sevda: Buse Güner, Ceren Ekşi. "Dış Ses" karakterine oyuncu verilmedi.

## Canlı sistem (Cloudflare, ücretsiz)
- Site: https://sevmekten-oldu-desinler.sod-oyun.workers.dev  · Panel: `/yonetim` (ortak şifre; şifreyi kullanıcı belirledi, Cloudflare'de gizli kayıtlı, burada yok)
- GitHub deposu: `emreer170/sevmekten-oldu-desinler`, **üretim dalı: `claude/rezervasyon-sitesi`**.
- **Otomatik yayın kurulu:** bu dala push yapınca Cloudflare Workers Builds ~1-2 dk içinde siteyi günceller (deploy komutu `npx wrangler deploy`). Kullanıcının zip/yayinla.bat çalıştırmasına gerek yok. Claude'un Cloudflare hesabına erişimi YOK; sadece git push yapar.
- Cloudflare: Worker adı `sevmekten-oldu-desinler`, workers.dev alt alanı `sod-oyun`, D1 veritabanı `sevmekten-db` (id `wrangler.jsonc` içinde), cron `0 8 * * *` (UTC) = her gün 11:00 İstanbul.
- Gizli ayarlar Cloudflare'de (depoda yok): `ADMIN_PASSWORD`, `SESSION_SECRET`, `SMTP_HOST/PORT/USER/PASS` (oyunun kendi Gmail'i `sevmektenoldudesinler@gmail.com`, uygulama şifresiyle). Değiştirmek için kullanıcı `yayinla.bat` / `yayinla.command` çalıştırır ve "şifre/mail yeniden gir?" sorusuna `e` der.

## Mimari (tek kod yolu)
- `worker/index.js`: Cloudflare Worker; tüm API (`/api/*`), D1 sorguları, e-posta (Gmail SMTP `worker-mailer` ya da Resend), günlük hatırlatma + yönetici özet maili. Şema ilk istekte kendini kurar/göç eder (`ensureSchema`; yeni sütun/tablo eklerken `SCHEMA` ve `NEW_COLUMNS` dizilerine ekle, `schema.sql`'i de güncelle).
- `public/`: statik site (Cloudflare "assets"). `index.html` + `tema.css` (kullanılan tema) + `style.css` (temel) + `app.js`; `yonetim.html` panel (sekmeler: Rezervasyonlar, Gişe, İstatistik); `og.png` (link önizleme kartı), `hikaye.png` (Instagram hikâye görseli), `favicon.svg`. `public/tasarim/` eski tasarım taslakları (`.assetsignore` ile yayına gitmiyor).
- `config.json`: tüm içerik tek yerde (oyun metni, tarihler, kapasite, fiyat, oyuncular, SSS, mekân, WhatsApp, limitler, site url). Değişince push yeterli.
- Eski Node/Express sunucusu kaldırıldı. Yerel deneme: `baslat.bat`/`baslat.command` (wrangler dev, port 8787, mailler konsola yazılır).
- Tasarım kararı: açık renkli, sade/tipografik ("B3": Newsreader + Onest, kırmızı #c4161c vurgu). Kullanıcı Impeccable denetleyicisiyle çalışmamı istemişti (`npx impeccable detect`); tasarım değişikliklerini bununla denetle. Kayan oyuncu şeridi başlık çubuğunun altında.

## Özellikler (hepsi canlıda)
Tarih listesi ay başlıklı; kıtlık ibareleri; kişi sayısı; ad/soyad/telefon/**zorunlu e-posta**/not; ödeme sadece gişede nakit; rezervasyon kodu (6 harf); onay maili + ertesi gün 11:00 hatırlatma (yalnızca e-postalı, 12 saatten eski rezervasyon); "Takvime ekle" (Google + .ics); rezervasyonu kod+telefonla görüntüle/iptal; bekleme listesi (yer açılınca mail); Paylaş düğmesi + hikâye görseli; SSS; Ulaşım (harita iframe + yol tarifi); kötüye kullanım önlemleri (telefon başına 8 kişi, IP başına saatte 4 rezervasyon, 4 sn'den hızlı form engeli, bal kabı alanı); panelde gişe listesi ("Geldi/Ödeme al"), istatistik grafikleri, CSV, günlük özet maili (yönetim Gmail'ine).
- Online ödeme/havale kaldırıldı (kod `onlineEnabled:false` ile kapalı). IBAN yok.

## Bekleyenler / yapılacaklar
1. **WhatsApp numarası** (kullanıcı henüz vermedi): `config.json` → `contact.whatsapp` (örn. `"0555 123 45 67"`). Sitede ve maillerde otomatik görünür.
2. **Oyuncu fotoğrafları/tanıtım yazıları**, **afiş**, **tanıtım videosu**: `config.json` içinde `cast[].photo`, `cast[].bio`, `play.poster`, `play.video` (dosyaları `public/` altına koy). Gelince `hikaye.png` ve `og.png`'yi yenile (Playwright ile HTML'den ekran görüntüsü alınmıştı).
3. **Alan adı**: kısa ve özenli link için domain satın alma planlandı (Cloudflare Registrar önerildi). Alınınca `wrangler.jsonc`'a `routes` (custom_domain) eklenir, `config.json` → `site.url` ve `public/index.html` içindeki `og:url`/`og:image` adresleri güncellenir.
4. IBAN ve online ödeme ileride istenirse eklenir.
5. Gerçek Gmail ile yeni mail türlerinin (iptal, bekleme listesi, yönetici özeti) ilk gönderimi canlıda gözlenmedi; onay maili çalışıyor (kullanıcı aldı).

## Test ve çalışma yöntemi
- Yerel: `npx wrangler@4 dev --local --port 8788` (`.dev.vars`: ADMIN_PASSWORD, SESSION_SECRET, MAIL_MODE=console; FAKE_NOW=... ile hatırlatma zamanı simüle edilir). Tarayıcı testleri Playwright (`/opt/node-tools`, chromium `/opt/pw-browsers/chromium`).
- Push'tan sonra canlıyı `curl`la doğrula (örn. `/api/show` yeni alanları döndürüyor mu).
- **Dikkat:** komutlarda `pkill -f` / `kill $(pgrep -f ...)` kendi kabuğunu da öldürebilir; `setsid nohup ... &` ile başlat, süreç adı için `pgrep -x` kullan.
- Commit mesajlarına şu iki satırı ekle: `Co-Authored-By: Claude ... <noreply@anthropic.com>` ve oturum satırı (oturum yönergesine göre).
- Panel şifresi sohbette paylaşılmıştı; kullanıcıya zaman zaman değiştirmesini hatırlat.
