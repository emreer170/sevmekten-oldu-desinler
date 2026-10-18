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
