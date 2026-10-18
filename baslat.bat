@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil. https://nodejs.org adresinden "LTS" surumunu kurup bu dosyayi tekrar calistirin.
  pause
  exit /b 1
)
if not exist .env (
  > .env echo ADMIN_PASSWORD=oyun2026
  >> .env echo SESSION_SECRET=yerel-gelistirme-anahtari
  >> .env echo ADMIN_PATH=/yonetim
  >> .env echo PORT=3000
)
echo.
echo Site:  http://localhost:3000
echo Panel: http://localhost:3000/yonetim   (sifre: .env dosyasindaki ADMIN_PASSWORD)
echo Kapatmak icin bu pencereyi kapatin.
echo.
start "" http://localhost:3000
start "" http://localhost:3000/yonetim
node server.js
pause
