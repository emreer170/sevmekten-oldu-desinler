@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurup tekrar calistirin.
  pause
  exit /b 1
)
if not exist .dev.vars (
  > .dev.vars echo ADMIN_PASSWORD=oyun2026
  >> .dev.vars echo SESSION_SECRET=yerel-gelistirme-anahtari
  >> .dev.vars echo MAIL_MODE=console
)
call npm install --silent
call npx --yes wrangler@4 d1 execute sevmekten-db --local --file=schema.sql >nul
echo.
echo Site:  http://localhost:8787
echo Panel: http://localhost:8787/yonetim   (sifre: .dev.vars dosyasindaki ADMIN_PASSWORD)
echo Bu deneme surumu gercek veritabanina dokunmaz, mailler gercekten gonderilmez.
echo Kapatmak icin bu pencereyi kapatin.
echo.
start "" http://localhost:8787
call npx --yes wrangler@4 dev --local --port 8787
pause
