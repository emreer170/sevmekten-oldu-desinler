#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurup tekrar calistirin."
  read -n 1 -s -r -p "Kapatmak icin bir tusa basin"; exit 1
fi
[ -f .dev.vars ] || printf 'ADMIN_PASSWORD=oyun2026\nSESSION_SECRET=yerel-gelistirme-anahtari\nMAIL_MODE=console\n' > .dev.vars
npm install --silent
npx --yes wrangler@4 d1 execute sevmekten-db --local --file=schema.sql >/dev/null
echo
echo "Site:  http://localhost:8787"
echo "Panel: http://localhost:8787/yonetim  (sifre: .dev.vars dosyasindaki ADMIN_PASSWORD)"
echo "Bu deneme surumu gercek veritabanina dokunmaz, mailler gercekten gonderilmez."
echo
( sleep 6; (open http://localhost:8787 || xdg-open http://localhost:8787) >/dev/null 2>&1 ) &
npx --yes wrangler@4 dev --local --port 8787
