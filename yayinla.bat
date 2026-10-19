@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurup tekrar calistirin.
  pause
  exit /b 1
)
node scripts\deploy.mjs
pause
