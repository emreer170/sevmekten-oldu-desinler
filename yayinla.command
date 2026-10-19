#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null; then
  echo "Node.js kurulu degil. https://nodejs.org adresinden LTS surumunu kurup tekrar calistirin."
  read -n 1 -s -r -p "Kapatmak icin bir tusa basin"; exit 1
fi
node scripts/deploy.mjs
read -n 1 -s -r -p "Kapatmak icin bir tusa basin"
