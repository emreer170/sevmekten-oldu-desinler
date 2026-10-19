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
