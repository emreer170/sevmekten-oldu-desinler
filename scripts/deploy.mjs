// Siteyi Cloudflare'e (ücretsiz) yayınlar. Çalıştırma: node scripts/deploy.mjs  (ya da yayinla.bat / yayinla.command)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import readline from 'node:readline/promises';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const WRANGLER = ['--yes', 'wrangler@4'];
const DB_NAME = 'sevmekten-db';
const PLACEHOLDER = 'BURAYA_DATABASE_ID';

const say = (m = '') => console.log(m);
function wrangler(args, { capture = false, input } = {}) {
  const r = spawnSync('npx', [...WRANGLER, ...args], { shell: true, encoding: 'utf8', input, stdio: capture ? ['pipe', 'pipe', 'pipe'] : [input ? 'pipe' : 'inherit', 'inherit', 'inherit'] });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}
export const parseDbId = (text) => text.match(/"database_id"\s*:\s*"([0-9a-fA-F-]{36})"/)?.[1];
export const patchConfig = (text, id) => text.replace(/"database_id"\s*:\s*"[^"]*"/, `"database_id": "${id}"`);

if (process.argv.includes('--selftest')) { // betiğin yardımcı fonksiyonlarını dener
  const sample = '{\n "d1_databases": [ { "binding": "DB", "database_name": "x", "database_id": "123e4567-e89b-12d3-a456-426614174000" } ] }';
  console.log(parseDbId(sample) === '123e4567-e89b-12d3-a456-426614174000' && patchConfig('"database_id": "BURAYA"', 'abc').includes('"abc"') ? 'selftest tamam' : 'selftest HATA');
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q, def = '') => ((await rl.question(q)).trim() || def);

say('\n=== Sevmekten Öldü Desinler: Cloudflare\'e yayınlama ===\n');

// 1) Giriş
say('1/5  Cloudflare hesabı kontrol ediliyor...');
let who = wrangler(['whoami'], { capture: true });
if (!who.ok || /not authenticated|You are not logged in/i.test(who.out)) {
  say('Tarayıcı açılacak. Ücretsiz hesabınızla giriş yapıp "İzin ver / Allow" deyin. Hesabınız yoksa orada oluşturabilirsiniz (kredi kartı gerekmez).');
  if (!wrangler(['login']).ok) { say('Giriş yapılamadı. Tekrar deneyin.'); process.exit(1); }
}

// 2) Veritabanı
let cfg = readFileSync('wrangler.jsonc', 'utf8');
const firstTime = cfg.includes(PLACEHOLDER);
if (firstTime) {
  say('\n2/5  Veritabanı oluşturuluyor...');
  let r = wrangler(['d1', 'create', DB_NAME], { capture: true });
  let id = parseDbId(r.out);
  if (!id) { // zaten varsa listeden bul
    const l = wrangler(['d1', 'list', '--json'], { capture: true });
    try { id = JSON.parse(l.out.slice(l.out.indexOf('['))).find((d) => d.name === DB_NAME)?.uuid; } catch {}
  }
  if (!id) { say('Veritabanı oluşturulamadı:\n' + r.out); process.exit(1); }
  writeFileSync('wrangler.jsonc', patchConfig(cfg, id));
  say('Veritabanı hazır.');
} else say('\n2/5  Veritabanı zaten ayarlı, atlanıyor.');

// 3) Tablolar
say('\n3/5  Tablolar kuruluyor...');
if (!wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=schema.sql', '--yes']).ok) { say('Tablolar kurulamadı.'); process.exit(1); }

// 4) Yayın
say('\n4/5  Site yayınlanıyor...');
say('(İlk seferde Cloudflare adres için bir isim isteyebilir; yazıp Enter\'a basın. Bu isim adresin bir parçası olur.)\n');
if (!wrangler(['deploy']).ok) { say('Yayınlama başarısız oldu. Yukarıdaki hata mesajını bana gönderin.'); process.exit(1); }

// 5) Gizli ayarlar (şifre, mail)
let secrets = {};
const redo = firstTime || /^e/i.test(await ask('\nPanel şifresini ve mail ayarlarını yeniden girmek ister misiniz? (e/H) '));
if (redo) {
  say('\n5/5  Güvenlik ayarları');
  let pw = '';
  while (pw.length < 8) pw = await ask('Yönetim paneli için bir şifre belirleyin (en az 8 karakter): ');
  secrets = { ADMIN_PASSWORD: pw, SESSION_SECRET: randomBytes(32).toString('hex') };
  if (/^e/i.test(await ask('\nRezervasyon onay ve hatırlatma maili gönderilsin mi? Gmail hesabı gerekir (e/H) '))) {
    say('Google hesabınızda "Uygulama şifresi" oluşturun (myaccount.google.com/apppasswords, 2 adımlı doğrulama açık olmalı).');
    secrets.SMTP_HOST = 'smtp.gmail.com'; secrets.SMTP_PORT = '465';
    secrets.SMTP_USER = await ask('Gmail adresiniz: ');
    secrets.SMTP_PASS = (await ask('16 haneli uygulama şifresi (boşluksuz da olur): ')).replace(/\s/g, '');
  }
  const dir = mkdtempSync(join(tmpdir(), 'sod-'));
  const file = join(dir, 'secrets.json');
  writeFileSync(file, JSON.stringify(secrets));
  const ok = wrangler(['secret', 'bulk', file], { capture: true });
  rmSync(dir, { recursive: true, force: true });
  if (!ok.ok) { say('Ayarlar kaydedilemedi:\n' + ok.out); process.exit(1); }
  say('Ayarlar kaydedildi.');
}
rl.close();

say('\n=== TAMAM ===');
say('Siteniz yayında. Adresi yukarıdaki "https://sevmekten-oldu-desinler.….workers.dev" satırında bulabilirsiniz.');
say('Yönetim paneli: adresin sonuna /yonetim ekleyin.');
