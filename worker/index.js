// Cloudflare Workers sürümü: aynı site, veritabanı olarak D1 kullanır. Statik dosyalar (public/) Cloudflare'in "assets" özelliğiyle sunulur;
// bu Worker yalnızca /api/* isteklerini ve her gün çalışan hatırlatma görevini yönetir.
import config from '../config.json';

const sessions = config.sessions.map((s) => ({ ...s, id: `${s.date}T${s.time}` }));
const sessionById = new Map(sessions.map((s) => [s.id, s]));
const limits = { maxSeatsPerPhone: 8, maxReservationsPerIpPerHour: 4, minFormSeconds: 4, ...(config.limits || {}) };

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
  `Merhaba ${r.name},\n\n${config.play.title} için rezervasyonunuz onaylandı.\n\n${details({ code: r.code, session, seats: r.seats, method: r.payment_method })}\n\nGişede rezervasyon kodunuzu söylemeniz yeterli. Oyundan önceki gün size bir hatırlatma maili göndereceğiz.${waLine()}\n\nGörüşmek üzere!`;
const reminderText = (r, session) =>
  `Merhaba ${r.name},\n\n${config.play.title} oyunu yarın akşam saat ${session.time}'de başlıyor. Rezervasyonunuzu hatırlatmak istedik.\n\n${details({ code: r.code, session, seats: r.seats, method: r.payment_method })}\n\nOyun başlamadan en az 15 dakika önce gelmenizi öneririz. Planınız değiştiyse lütfen bizi bilgilendirin ki yerinizi başkasına açabilelim.${waLine()}\n\nGörüşmek üzere!`;

// ---- genel veri ----
async function taken(db) {
  const { results } = await db.prepare('SELECT session_id, COALESCE(SUM(seats),0) AS n FROM reservations GROUP BY session_id').all();
  return Object.fromEntries(results.map((r) => [r.session_id, r.n]));
}
async function publicShow(db) {
  const t = await taken(db);
  return {
    play: config.play, venue: config.venue, price: config.price, instagram: config.instagram, cast: config.cast, maxSeats: config.maxSeatsPerReservation,
    contact: config.contact || {},
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

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    try {
      if (path === '/api/show' && method === 'GET') return json(await publicShow(env.DB));
      if (path === '/api/reservations' && method === 'POST') return await reserve(req, env, ctx);
      if (path === '/api/admin/login' && method === 'POST') return await adminLogin(req, env);
      if (path === '/api/admin/logout' && method === 'POST') return json({ ok: true }, 200, { 'Set-Cookie': 'admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });
      if (path.startsWith('/api/admin/')) {
        if (!(await validToken(env, getCookie(req, 'admin')))) return json({ error: 'Giriş gerekli' }, 401);
        if (path === '/api/admin/data' && method === 'GET') return json(await adminData(env));
        if (path === '/api/admin/export.csv' && method === 'GET') return await adminCsv(env);
        const m = path.match(/^\/api\/admin\/reservations\/(\d+)$/);
        if (m && method === 'PATCH') {
          let b = {}; try { b = await req.json(); } catch {}
          const r = await env.DB.prepare('UPDATE reservations SET paid = ? WHERE id = ?').bind(b.paid ? 1 : 0, Number(m[1])).run();
          return json({ ok: r.meta.changes > 0 });
        }
        if (m && method === 'DELETE') {
          const r = await env.DB.prepare('DELETE FROM reservations WHERE id = ?').bind(Number(m[1])).run();
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
    ctx.waitUntil(runReminders(env, env.FAKE_NOW ? new Date(env.FAKE_NOW) : new Date()).then((r) => console.log('Hatırlatma:', JSON.stringify(r))).catch((e) => console.error('Hatırlatma hatası:', e.message)));
  },
};
