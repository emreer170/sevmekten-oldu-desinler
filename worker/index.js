// Cloudflare Workers sürümü: aynı site, veritabanı olarak D1 kullanır. Statik dosyalar (public/) Cloudflare'in "assets" özelliğiyle sunulur;
// bu Worker yalnızca /api/* isteklerini ve her gün çalışan hatırlatma görevini yönetir.
import config from '../config.json';

const sessions = config.sessions.map((s) => ({ ...s, id: `${s.date}T${s.time}` }));
const sessionById = new Map(sessions.map((s) => [s.id, s]));
const limits = { maxSeatsPerPhone: 8, maxReservationsPerIpPerHour: 4, minFormSeconds: 4, ...(config.limits || {}) };

const siteUrl = (config.site?.url || '').replace(/\/$/, '');

// ---- veritabanı şeması: ilk istekte eksik tablo/sütunlar kendiliğinden eklenir (elle migrasyon gerekmez) ----
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, session_id TEXT NOT NULL, name TEXT NOT NULL, surname TEXT NOT NULL,
    phone TEXT NOT NULL, phone_norm TEXT NOT NULL, email TEXT, seats INTEGER NOT NULL, payment_method TEXT NOT NULL, paid INTEGER NOT NULL DEFAULT 0,
    note TEXT, reminder_sent INTEGER NOT NULL DEFAULT 0, arrived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  'CREATE INDEX IF NOT EXISTS idx_res_session ON reservations(session_id)',
  'CREATE INDEX IF NOT EXISTS idx_res_phone ON reservations(phone_norm)',
  'CREATE TABLE IF NOT EXISTS hits (kind TEXT NOT NULL, ip TEXT NOT NULL, ts INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS idx_hits ON hits(kind, ip, ts)',
  `CREATE TABLE IF NOT EXISTS waitlist (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT,
    notified INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  'CREATE INDEX IF NOT EXISTS idx_wait_session ON waitlist(session_id)',
];
const NEW_COLUMNS = [['arrived', 'ALTER TABLE reservations ADD COLUMN arrived INTEGER NOT NULL DEFAULT 0']];
let schemaReady;
function ensureSchema(env) {
  schemaReady ??= (async () => {
    await env.DB.batch(SCHEMA.map((q) => env.DB.prepare(q)));
    const cols = (await env.DB.prepare('PRAGMA table_info(reservations)').all()).results.map((c) => c.name);
    for (const [name, ddl] of NEW_COLUMNS) if (!cols.includes(name)) await env.DB.prepare(ddl).run();
  })().catch((e) => { schemaReady = undefined; throw e; });
  return schemaReady;
}

const isPast = (s) => new Date(`${s.date}T${s.time}:00+03:00`) < new Date(); // İstanbul saati
const clean = (v, max) => String(v ?? '').trim().slice(0, max);
const normPhone = (p) => String(p).replace(/\D/g, '').slice(-10);
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });

// ---- yönetici oturumu (imzalı çerez) ----
const enc = new TextEncoder();
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(value));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function safeEqual(a, b, secret) { // sabit zamanlı karşılaştırma: iki değerin de HMAC'i karşılaştırılır
  return (await hmac(secret, a)) === (await hmac(secret, b));
}
async function makeToken(env) {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  return `${exp}.${await hmac(env.SESSION_SECRET, exp)}`;
}
async function validToken(env, token) {
  if (!token || !env.SESSION_SECRET) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  return (await hmac(env.SESSION_SECRET, exp)) === sig;
}
const getCookie = (req, name) => (req.headers.get('cookie') || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];

// ---- istek sınırları ----
async function hitCount(db, kind, ip, windowMs) {
  const r = await db.prepare('SELECT COUNT(*) AS n FROM hits WHERE kind = ? AND ip = ? AND ts > ?').bind(kind, ip, Date.now() - windowMs).first();
  return r.n;
}
const addHit = (db, kind, ip) => db.prepare('INSERT INTO hits (kind, ip, ts) VALUES (?, ?, ?)').bind(kind, ip, Date.now()).run();

// ---- e-posta (Gmail SMTP ya da Resend; ikisi de yoksa mail gönderilmez) ----
async function makeMailer(env) {
  const from = env.MAIL_FROM || env.SMTP_USER || 'rezervasyon@localhost';
  if (env.MAIL_MODE === 'console') {
    return { send: async (to, subject, text) => { console.log(`[MAIL → ${to}] ${subject}\n${text}\n`); return true; }, close: async () => {} };
  }
  if (env.RESEND_API_KEY) {
    return {
      send: async (to, subject, text) => {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST', headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [to], subject, text }),
        });
        if (!r.ok) console.error('Resend hatası:', r.status, await r.text());
        return r.ok;
      },
      close: async () => {},
    };
  }
  if (env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS) {
    const { WorkerMailer } = await import('worker-mailer');
    const port = Number(env.SMTP_PORT || 465);
    const m = await WorkerMailer.connect({ host: env.SMTP_HOST, port, secure: port === 465, authType: 'plain', credentials: { username: env.SMTP_USER, password: env.SMTP_PASS } });
    return {
      send: async (to, subject, text) => {
        try { await m.send({ from: { email: from }, to: { email: to }, subject, text }); return true; }
        catch (e) { console.error('SMTP hatası:', e.message); return false; }
      },
      close: async () => { try { await m.close(); } catch {} },
    };
  }
  return null;
}
const durationMin = parseInt(config.play.duration, 10) || 95;
function calTimes(session) { // İstanbul = UTC+3 (yaz saati uygulaması yok)
  const start = new Date(`${session.date}T${session.time}:00+03:00`);
  const end = new Date(start.getTime() + durationMin * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return { start: f(start), end: f(end) };
}
function googleCal(session) {
  const t = calTimes(session);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: config.play.title, dates: `${t.start}/${t.end}`, location: `${config.venue.name}, ${config.venue.address}`, details: config.play.tagline || '' });
  return `https://calendar.google.com/calendar/render?${q}`;
}
const manageLine = () => (siteUrl ? `\nRezervasyonunuzu görüntülemek veya iptal etmek için: ${siteUrl}/#sorgu` : '');
const dayLabel = (date) => new Date(date + 'T12:00:00Z').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long', timeZone: 'UTC' });
const waLine = () => (config.contact?.whatsapp ? `\nSorularınız ya da değişiklik için WhatsApp: ${config.contact.whatsapp}` : '');
function details({ code, session, seats, method }) {
  const total = seats * config.price.amount;
  const pay = method === 'havale'
    ? `Ödeme: Havale/EFT ile ${total} ${config.price.currency}\nIBAN: ${config.payment.iban}\n${config.payment.accountName} - ${config.payment.bank}\n${config.payment.note}`
    : `Ödeme: Gişede nakit, ${total} ${config.price.currency}`;
  const map = config.venue.mapUrl ? `\nHarita: ${config.venue.mapUrl}` : '';
  return `Rezervasyon kodu: ${code}\nTarih: ${dayLabel(session.date)}, saat ${session.time}\nKişi sayısı: ${seats}\nYer: ${config.venue.name}, ${config.venue.address}${map}\n${pay}`;
}
const confirmationText = (r, session) =>
  `Merhaba ${r.name},\n\n${config.play.title} için rezervasyonunuz onaylandı.\n\n${details({ code: r.code, session, seats: r.seats, method: r.payment_method })}\n\nGişede rezervasyon kodunuzu söylemeniz yeterli. Oyundan önceki gün size bir hatırlatma maili göndereceğiz.\n\nTakvime ekle: ${googleCal(session)}${manageLine()}${waLine()}\n\nGörüşmek üzere!`;
const reminderText = (r, session) =>
  `Merhaba ${r.name},\n\n${config.play.title} oyunu yarın akşam saat ${session.time}'de başlıyor. Rezervasyonunuzu hatırlatmak istedik.\n\n${details({ code: r.code, session, seats: r.seats, method: r.payment_method })}\n\nOyun başlamadan en az 15 dakika önce gelmenizi öneririz. Planınız değiştiyse lütfen rezervasyonunuzu iptal edin ki yerinizi başkasına açabilelim.${manageLine()}${waLine()}\n\nGörüşmek üzere!`;

// ---- genel veri ----
async function taken(db) {
  const { results } = await db.prepare('SELECT session_id, COALESCE(SUM(seats),0) AS n FROM reservations GROUP BY session_id').all();
  return Object.fromEntries(results.map((r) => [r.session_id, r.n]));
}
async function publicShow(db) {
  const t = await taken(db);
  return {
    play: config.play, venue: config.venue, price: config.price, instagram: config.instagram, cast: config.cast, maxSeats: config.maxSeatsPerReservation,
    contact: config.contact || {}, faq: config.faq || [], site: config.site || {},
    payment: { onlineEnabled: !!config.payment.onlineEnabled, iban: config.payment.iban, accountName: config.payment.accountName, bank: config.payment.bank, note: config.payment.note },
    sessions: sessions.filter((s) => !isPast(s)).map((s) => {
      const remaining = Math.max(0, s.capacity - (t[s.id] || 0));
      const level = remaining === 0 ? 'sold' : remaining <= 10 ? 'last' : remaining <= 25 ? 'few' : 'limited';
      return { id: s.id, date: s.date, time: s.time, level, left: level === 'last' ? remaining : undefined, available: Math.min(remaining, config.maxSeatsPerReservation) };
    }),
  };
}

async function reserve(req, env, ctx) {
  const db = env.DB;
  const ip = req.headers.get('CF-Connecting-IP') || 'bilinmiyor';
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Geçersiz istek.' }, 400); }
  if (b.website) return json({ ok: true }); // bal kabı alanı
  if (!(Number(b.elapsed) >= limits.minFormSeconds * 1000)) return json({ error: 'Form çok hızlı gönderildi, lütfen tekrar deneyin.' }, 429);
  if ((await hitCount(db, 'res', ip, 3600 * 1000)) >= limits.maxReservationsPerIpPerHour)
    return json({ error: 'Bu cihazdan kısa sürede çok fazla rezervasyon yapıldı. Lütfen daha sonra tekrar deneyin ya da bizimle iletişime geçin.' }, 429);

  const session = sessionById.get(b.sessionId);
  const name = clean(b.name, 60), surname = clean(b.surname, 60), phone = clean(b.phone, 25), email = clean(b.email, 120), note = clean(b.note, 300);
  const seats = Number.parseInt(b.seats, 10);
  if (!session || isPast(session)) return json({ error: 'Lütfen geçerli bir tarih seçin.' }, 400);
  if (!name || !surname) return json({ error: 'Ad ve soyad gerekli.' }, 400);
  if (!/^\+?[0-9 ()-]{10,20}$/.test(phone)) return json({ error: 'Geçerli bir telefon numarası girin.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Onay ve hatırlatma maili için geçerli bir e-posta adresi girin.' }, 400);
  if (!Number.isInteger(seats) || seats < 1 || seats > config.maxSeatsPerReservation)
    return json({ error: `Kişi sayısı 1 ile ${config.maxSeatsPerReservation} arasında olmalı.` }, 400);
  const allowed = config.payment.onlineEnabled ? ['gise', 'havale'] : ['gise'];
  if (!allowed.includes(b.paymentMethod)) return json({ error: 'Online ödeme henüz açık değil, gişede nakit ödeme seçin.' }, 400);

  const pn = normPhone(phone);
  // Kontenjan ve telefon sınırı kontrolü ile ekleme TEK sorguda yapılır, böylece aynı anda gelen isteklerde kontenjan aşılmaz.
  for (let i = 0; i < 5; i++) {
    const code = newCode();
    try {
      const r = await db.prepare(`INSERT INTO reservations (code, session_id, name, surname, phone, phone_norm, email, seats, payment_method, note)
        SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10
        WHERE (SELECT COALESCE(SUM(seats),0) FROM reservations WHERE session_id = ?2) + ?8 <= ?11
          AND (SELECT COALESCE(SUM(seats),0) FROM reservations WHERE phone_norm = ?6) + ?8 <= ?12`)
        .bind(code, session.id, name, surname, phone, pn, email || null, seats, 'gise', note || null, session.capacity, limits.maxSeatsPerPhone).run();
      if (r.meta.changes === 0) {
        const left = session.capacity - ((await taken(db))[session.id] || 0);
        if (seats > left) return json({ error: left > 0 ? `Bu tarihte yalnızca ${left} yer kaldı.` : 'Bu tarih için yerler doldu.' }, 409);
        return json({ error: `Bu telefon numarasıyla en fazla ${limits.maxSeatsPerPhone} kişilik rezervasyon yapılabilir.` }, 409);
      }
      ctx.waitUntil((async () => {
        await addHit(db, 'res', ip);
        if (email) {
          const mailer = await makeMailer(env);
          if (mailer) { await mailer.send(email, `Rezervasyonunuz onaylandı – ${config.play.title}`, confirmationText({ name, code, seats, payment_method: 'gise' }, session)); await mailer.close(); }
        }
      })().catch((e) => console.error(e.message)));
      return json({ ok: true, code, seats, method: 'gise', total: seats * config.price.amount, session: { date: session.date, time: session.time } });
    } catch (e) {
      if (!/UNIQUE/i.test(String(e.message)) || i === 4) { console.error(e.message); return json({ error: 'Bir hata oluştu, lütfen tekrar deneyin.' }, 500); }
    }
  }
}


// ---- rezervasyon sorgulama / iptal / bekleme listesi ----
async function findReservation(db, code, phone) {
  const pn = normPhone(phone);
  if (pn.length !== 10) return null;
  const r = await db.prepare('SELECT * FROM reservations WHERE code = ?').bind(String(code || '').trim().toUpperCase()).first();
  return r && r.phone_norm === pn ? r : null;
}
async function notifyWaitlist(env, sessionId, freedSeats) { // yer açılınca bekleme listesindeki en eski kişilere haber ver
  const s = sessionById.get(sessionId);
  if (!s || isPast(s)) return;
  const { results } = await env.DB.prepare('SELECT * FROM waitlist WHERE session_id = ? AND notified = 0 ORDER BY id LIMIT ?').bind(sessionId, Math.max(1, freedSeats)).all();
  if (!results.length) return;
  const mailer = await makeMailer(env);
  if (!mailer) return;
  const done = [];
  for (const w of results) {
    const text = `Merhaba${w.name ? ' ' + w.name : ''},\n\n${dayLabel(s.date)} saat ${s.time} oyunu için bekleme listesine yazılmıştınız. Şu an yer açıldı.\n\nYerler hızla dolabilir, rezervasyon için: ${siteUrl || ''}\n\n${config.play.title}`;
    if (await mailer.send(w.email, `Yer açıldı – ${config.play.title}`, text)) done.push(w.id);
  }
  await mailer.close();
  if (done.length) await env.DB.batch(done.map((id) => env.DB.prepare('UPDATE waitlist SET notified = 1 WHERE id = ?').bind(id)));
}
async function lookupOrCancel(req, env, ctx, cancel) {
  const ip = req.headers.get('CF-Connecting-IP') || 'bilinmiyor';
  if ((await hitCount(env.DB, 'lookup', ip, 15 * 60 * 1000)) >= 10) return json({ error: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' }, 429);
  let b = {}; try { b = await req.json(); } catch {}
  const r = await findReservation(env.DB, b.code, b.phone);
  if (!r) { await addHit(env.DB, 'lookup', ip); return json({ error: 'Bu kod ve telefon numarasıyla rezervasyon bulunamadı.' }, 404); }
  const s = sessionById.get(r.session_id);
  if (!cancel) {
    return json({ ok: true, code: r.code, name: r.name, surname: r.surname, seats: r.seats, total: r.seats * config.price.amount, paid: !!r.paid,
      session: s ? { date: s.date, time: s.time } : null, canCancel: !!s && !isPast(s) });
  }
  if (!s || isPast(s)) return json({ error: 'Oyun tarihi geçtiği için bu rezervasyon iptal edilemez.' }, 409);
  await env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(r.id).run();
  ctx.waitUntil((async () => {
    await notifyWaitlist(env, r.session_id, r.seats);
    if (r.email) {
      const mailer = await makeMailer(env);
      if (mailer) { await mailer.send(r.email, `Rezervasyonunuz iptal edildi – ${config.play.title}`, `Merhaba ${r.name},\n\n${dayLabel(s.date)} saat ${s.time} için ${r.seats} kişilik rezervasyonunuz (${r.code}) iptal edildi.\n\nYeniden rezervasyon yapmak isterseniz: ${siteUrl || ''}${waLine()}`); await mailer.close(); }
    }
  })().catch((e) => console.error(e.message)));
  return json({ ok: true });
}
async function joinWaitlist(req, env, ctx) {
  const ip = req.headers.get('CF-Connecting-IP') || 'bilinmiyor';
  if ((await hitCount(env.DB, 'wait', ip, 3600 * 1000)) >= 5) return json({ error: 'Çok fazla deneme. Daha sonra tekrar deneyin.' }, 429);
  let b = {}; try { b = await req.json(); } catch {}
  const s = sessionById.get(b.sessionId);
  const email = clean(b.email, 120), name = clean(b.name, 60);
  if (!s || isPast(s)) return json({ error: 'Lütfen geçerli bir tarih seçin.' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: 'Geçerli bir e-posta adresi girin.' }, 400);
  const left = s.capacity - ((await taken(env.DB))[s.id] || 0);
  if (left > 0) return json({ error: 'Bu tarihte yer var, doğrudan rezervasyon yapabilirsiniz.' }, 409);
  const exists = await env.DB.prepare('SELECT id FROM waitlist WHERE session_id = ? AND email = ?').bind(s.id, email).first();
  const n = (await env.DB.prepare('SELECT COUNT(*) AS n FROM waitlist WHERE session_id = ?').bind(s.id).first()).n;
  if (!exists && n >= 100) return json({ error: 'Bekleme listesi dolu.' }, 409);
  if (!exists) await env.DB.prepare('INSERT INTO waitlist (session_id, email, name) VALUES (?, ?, ?)').bind(s.id, email, name || null).run();
  await addHit(env.DB, 'wait', ip);
  if (!exists) ctx.waitUntil((async () => {
    const mailer = await makeMailer(env);
    if (mailer) { await mailer.send(email, `Bekleme listesindesiniz – ${config.play.title}`, `Merhaba${name ? ' ' + name : ''},\n\n${dayLabel(s.date)} saat ${s.time} oyunu için bekleme listesine eklendiniz. Yer açılırsa size e-posta ile haber vereceğiz.${waLine()}`); await mailer.close(); }
  })().catch((e) => console.error(e.message)));
  return json({ ok: true });
}

// ---- yönetici ----
async function adminLogin(req, env) {
  const ip = req.headers.get('CF-Connecting-IP') || 'bilinmiyor';
  if ((await hitCount(env.DB, 'login', ip, 15 * 60 * 1000)) >= 10) return json({ error: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' }, 429);
  let b = {};
  try { b = await req.json(); } catch {}
  const ok = env.ADMIN_PASSWORD && env.SESSION_SECRET && (await safeEqual(String(b.password ?? ''), env.ADMIN_PASSWORD, env.SESSION_SECRET));
  if (!ok) { await addHit(env.DB, 'login', ip); return json({ error: 'Şifre yanlış.' }, 401); }
  return json({ ok: true }, 200, { 'Set-Cookie': `admin=${await makeToken(env)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200` });
}
async function adminData(env) {
  const { results: rows } = await env.DB.prepare('SELECT * FROM reservations ORDER BY session_id, created_at').all();
  return {
    price: config.price,
    sessions: sessions.map((s) => {
      const mine = rows.filter((r) => r.session_id === s.id);
      return { id: s.id, date: s.date, time: s.time, capacity: s.capacity, people: mine.reduce((a, r) => a + r.seats, 0), reservations: mine.length, paidPeople: mine.filter((r) => r.paid).reduce((a, r) => a + r.seats, 0) };
    }),
    reservations: rows.map(({ phone_norm, ...r }) => r),
    waitlist: (await env.DB.prepare('SELECT id, session_id, email, name, notified, created_at FROM waitlist ORDER BY session_id, id').all()).results,
  };
}
async function adminCsv(env) {
  const { results: rows } = await env.DB.prepare('SELECT * FROM reservations ORDER BY session_id, created_at').all();
  const esc = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
  const head = ['Kod', 'Tarih', 'Saat', 'Ad', 'Soyad', 'Telefon', 'E-posta', 'Kişi', 'Ödeme', 'Ödendi', 'Not', 'Oluşturulma'];
  const lines = rows.map((r) => { const s = sessionById.get(r.session_id);
    return [r.code, s?.date, s?.time, r.name, r.surname, r.phone, r.email, r.seats, r.payment_method === 'havale' ? 'Havale' : 'Gişe (nakit)', r.paid ? 'Evet' : 'Hayır', r.note, r.created_at].map(esc).join(','); });
  return new Response('﻿' + [head.map(esc).join(','), ...lines].join('\r\n'), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="rezervasyonlar.csv"' } });
}

// ---- hatırlatma (her gün 11:00 İstanbul) ----
const istanbulParts = (d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
  .formatToParts(d).filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
async function runReminders(env, now = new Date()) {
  const t = istanbulParts(now);
  const tomorrow = new Date(Date.UTC(+t.year, +t.month - 1, +t.day + 1)).toISOString().slice(0, 10);
  const ids = sessions.filter((s) => s.date === tomorrow).map((s) => s.id);
  if (!ids.length) return { sent: 0 };
  const mailer = await makeMailer(env);
  if (!mailer) return { sent: 0 };
  const { results: rows } = await env.DB.prepare(`SELECT * FROM reservations WHERE reminder_sent = 0 AND email IS NOT NULL AND email != ''
    AND created_at < datetime('now', '-12 hours') AND session_id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
  const done = [];
  for (const r of rows) {
    if (await mailer.send(r.email, `Yarın görüşüyoruz – ${config.play.title}`, reminderText(r, sessionById.get(r.session_id)))) done.push(r.id);
  }
  await mailer.close();
  if (done.length) await env.DB.batch(done.map((id) => env.DB.prepare('UPDATE reservations SET reminder_sent = 1 WHERE id = ?').bind(id))); // tek toplu işlem
  await env.DB.prepare('DELETE FROM hits WHERE ts < ?').bind(Date.now() - 24 * 3600 * 1000).run(); // eski kayıtları temizle
  return { sent: done.length };
}


// ---- yönetici için günlük özet maili ----
async function sendSummary(env, now = new Date()) {
  if (config.summary?.enabled === false) return { summary: false };
  const to = env.SUMMARY_TO || env.SMTP_USER || (env.MAIL_MODE === 'console' ? 'yonetici@localhost' : '');
  if (!to) return { summary: false };
  const mailer = await makeMailer(env);
  if (!mailer) return { summary: false };
  const { results: rows } = await env.DB.prepare('SELECT session_id, seats, paid, created_at FROM reservations').all();
  const { results: waits } = await env.DB.prepare('SELECT session_id, COUNT(*) AS n FROM waitlist WHERE notified = 0 GROUP BY session_id').all();
  const upcoming = sessions.filter((x) => !isPast(x));
  if (!upcoming.length) { await mailer.close(); return { summary: false }; }
  const dayAgo = now.getTime() - 24 * 3600 * 1000;
  const fresh = rows.filter((r) => new Date(r.created_at.replace(' ', 'T') + 'Z').getTime() > dayAgo);
  const lines = upcoming.map((x) => {
    const mine = rows.filter((r) => r.session_id === x.id);
    const people = mine.reduce((a, r) => a + r.seats, 0);
    const paid = mine.filter((r) => r.paid).reduce((a, r) => a + r.seats, 0);
    const w = waits.find((q) => q.session_id === x.id)?.n || 0;
    return `${dayLabel(x.date)} ${x.time}: ${people}/${x.capacity} kişi (${mine.length} rezervasyon, ${paid} kişinin ödemesi alındı${w ? `, ${w} kişi bekleme listesinde` : ''})`;
  });
  const total = rows.reduce((a, r) => a + r.seats, 0);
  const text = `Günaydın,\n\nSon 24 saatte ${fresh.length} yeni rezervasyon geldi (${fresh.reduce((a, r) => a + r.seats, 0)} kişi).\nToplam ${total} kişilik rezervasyon var.\n\nOyun günleri:\n${lines.join('\n')}${siteUrl ? `\n\nYönetim paneli: ${siteUrl}/yonetim` : ''}`;
  const ok = await mailer.send(to, `Günlük özet – ${config.play.title}`, text);
  await mailer.close();
  return { summary: ok };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    try {
      if (path.startsWith('/api/')) await ensureSchema(env);
      if (path === '/api/show' && method === 'GET') return json(await publicShow(env.DB));
      if (path === '/api/reservations' && method === 'POST') return await reserve(req, env, ctx);
      if (path === '/api/lookup' && method === 'POST') return await lookupOrCancel(req, env, ctx, false);
      if (path === '/api/cancel' && method === 'POST') return await lookupOrCancel(req, env, ctx, true);
      if (path === '/api/waitlist' && method === 'POST') return await joinWaitlist(req, env, ctx);
      if (path === '/api/admin/login' && method === 'POST') return await adminLogin(req, env);
      if (path === '/api/admin/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': 'admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
      if (path.startsWith('/api/admin/')) {
        if (!(await validToken(env, getCookie(req, 'admin')))) return json({ error: 'Giriş gerekli' }, 401);
        if (path === '/api/admin/data' && method === 'GET') return json(await adminData(env));
        if (path === '/api/admin/export.csv' && method === 'GET') return await adminCsv(env);
        const m = path.match(/^\/api\/admin\/reservations\/(\d+)$/);
        if (m && method === 'PATCH') {
          let b = {}; try { b = await req.json(); } catch {}
          const sets = [], vals = [];
          if ('paid' in b) { sets.push('paid = ?'); vals.push(b.paid ? 1 : 0); }
          if ('arrived' in b) { sets.push('arrived = ?'); vals.push(b.arrived ? 1 : 0); }
          if (!sets.length) return json({ ok: false }, 400);
          const r = await env.DB.prepare(`UPDATE reservations SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, Number(m[1])).run();
          return json({ ok: r.meta.changes > 0 });
        }
        if (m && method === 'DELETE') {
          const old = await env.DB.prepare('SELECT session_id, seats FROM reservations WHERE id = ?').bind(Number(m[1])).first();
          const r = await env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(Number(m[1])).run();
          if (old) ctx.waitUntil(notifyWaitlist(env, old.session_id, old.seats).catch((e) => console.error(e.message)));
          return json({ ok: r.meta.changes > 0 });
        }
      }
      return json({ error: 'Bulunamadı' }, 404);
    } catch (e) {
      console.error(e);
      return json({ error: 'Bir hata oluştu, lütfen tekrar deneyin.' }, 500);
    }
  },
  async scheduled(event, env, ctx) {
    const now = env.FAKE_NOW ? new Date(env.FAKE_NOW) : new Date();
    ctx.waitUntil((async () => {
      await ensureSchema(env);
      console.log('Hatırlatma:', JSON.stringify(await runReminders(env, now)));
      console.log('Özet:', JSON.stringify(await sendSummary(env, now)));
    })().catch((e) => console.error('Zamanlanmış görev hatası:', e.message)));
  },
};
