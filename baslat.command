#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurup tekrar calistirin."
  read -n 1 -s -r -p "Kapatmak icin bir tusa basin"
  exit 1
fi
[ -f .env ] || printf 'ADMIN_PASSWORD=oyun2026\nSESSION_SECRET=yerel-gelistirme-anahtari\nADMIN_PATH=/yonetim\nPORT=3000\n' > .env
echo
echo "Site:  http://localhost:3000"
echo "Panel: http://localhost:3000/yonetim  (sifre: .env dosyasindaki ADMIN_PASSWORD)"
echo "Kapatmak icin bu pencereyi kapatin."
echo
( sleep 2; (open http://localhost:3000 || xdg-open http://localhost:3000) >/dev/null 2>&1; (open http://localhost:3000/yonetim || xdg-open http://localhost:3000/yonetim) >/dev/null 2>&1 ) &
node server.js
