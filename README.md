# Sevmekten Öldü Desinler – Bilet Rezervasyonu

Tek oyunluk, basit rezervasyon sitesi + ortak şifreli yönetici paneli.

## Çalıştırma
```
cp .env.example .env   # değerleri düzenleyin
npm install
export $(grep -v '^#' .env | xargs) && npm start
```
Site: `/`  ·  Panel: `ADMIN_PATH` (varsayılan `/yonetim`)

## Düzenleme
Oyun bilgisi, adres, fiyat, IBAN, oyuncular, tarihler ve kontenjan `config.json` içindedir.
Değişiklikten sonra sunucuyu yeniden başlatın. Oyuncu fotoğrafları `public/` altına konup `photo` alanına `/foto.jpg` şeklinde yazılır.

## Notlar
- Veriler `data/rezervasyon.db` (SQLite) dosyasında tutulur; barındırma yerinde **kalıcı disk** olmalı ve yedeği alınmalıdır.
- Node 22.13+ gerekir. Panel şifresini paylaştığınız herkes aynı şifreyle girer.

## Kolay başlatma (bilgisayarında)
1. Bir kez [Node.js](https://nodejs.org) LTS sürümünü kur (22.13 veya üstü).
2. Windows: `baslat.bat` dosyasına çift tıkla. Mac: `baslat.command` dosyasına çift tıkla (ilk seferde sağ tık → Aç).
3. Tarayıcıda site (`http://localhost:3000`) ve panel (`http://localhost:3000/yonetim`, şifre `oyun2026`) kendiliğinden açılır.

## E-posta onayı ve hatırlatma (ücretsiz, Gmail ile)
1. Google hesabında 2 adımlı doğrulamayı aç, sonra "Uygulama şifreleri"nden 16 haneli bir şifre oluştur.
2. `.env` dosyasına yaz: `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_USER=adres@gmail.com`, `SMTP_PASS=<16 haneli şifre>`.
3. Sunucuyu yeniden başlat. Mail adresi yazan herkese rezervasyon onayı gider, oyundan önceki gün (öğleden sonra) hatırlatma gider.
- Hatırlatma için sunucunun o gün açık olması gerekir. Mail ayarı boşsa hiçbir mail gitmez, site yine çalışır.
- Deneme için: `MAIL_MODE=console` yazarsan mailler gerçekten gitmez, sunucu penceresine yazılır.
- WhatsApp numarası: `config.json` içindeki `contact.whatsapp` alanına yaz (örn. `"0555 123 45 67"`).

## İnternette yayınlama (Cloudflare, ücretsiz)
1. Node.js kurulu olsun (bkz. yukarısı).
2. Windows: `yayinla.bat`, Mac: `yayinla.command` dosyasına çift tıkla.
3. Ekrandaki sorulara cevap ver: tarayıcıda Cloudflare'e giriş (hesap ücretsiz, kart istemez), panel şifresi, istersen Gmail bilgileri.
4. Bittiğinde ekranda `https://sevmekten-oldu-desinler.….workers.dev` adresi görünür. Panel: adresin sonuna `/yonetim`.
- Siteyi güncellemek için (örn. `config.json` değişince) aynı dosyayı yeniden çalıştır.
- Bilgisayarda deneme için eski `baslat` dosyaları çalışmaya devam eder (ayrı bir deneme veritabanı kullanır).
- Cloudflare sürümü `worker/index.js` ve `schema.sql` dosyalarında, yerel sürüm `server.js` içindedir. İkisi de aynı `config.json` ve `public/` klasörünü kullanır.

## Otomatik yayın (GitHub → Cloudflare) — kurulu
Cloudflare bu depoya bağlandı (kurulum tamam). Dala dala her push yapıldığında site kendiliğinden güncellenir (`yayinla.bat` gerekmez).
Kurulum (bir kez): Cloudflare paneli → Workers & Pages → `sevmekten-oldu-desinler` → Settings → Builds → Connect → GitHub.
Production branch: `claude/rezervasyon-sitesi`, Build command: boş, Deploy command: `npx wrangler deploy`.
Panel şifresi ve mail ayarları Cloudflare'de saklıdır, depoda yoktur. Veritabanı tablosu değişirse `schema.sql` ayrıca uygulanmalıdır.
