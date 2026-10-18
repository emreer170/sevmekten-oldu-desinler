import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import nodemailer from 'nodemailer';
import path from 'node:path';

const root = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(path.join(root, 'config.json'), 'utf8'));

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || randomBytes(32).toString('hex');
const ADMIN_PATH = process.env.ADMIN_PATH || '/yonetim';
const DB_PATH = process.env.DB_PATH || path.join(root, 'data', 'rezervasyon.db');

if (!ADMIN_PASSWORD) console.warn('UYARI: ADMIN_PASSWORD tanımlı değil, yönetici paneli kapalı.');

mkdirSync(path.dirname(DB_PATH), { recursive: true });
// E-posta (isteğe bağlı): SMTP_HOST, SMTP_USER, SMTP_PASS tanımlıysa onay maili gönderilir
const mailer = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 465),
      secure: (process.env.SMTP_PORT || '465') === '465',
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;
async function sendConfirmation({ to, name, code, session, seats, method }) {
  if (!mailer || !to) return;
  const when = new Date(session.date + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const total = seats * config.price.amount;
  const pay = method === 'havale'
    ? `Ödeme: Havale/EFT ile ${total} ${config.price.currency}\nIBAN: ${config.payment.iban}\n${config.payment.accountName} - ${config.payment.bank}\n${config.payment.note}`
    : `Ödeme: Gişede (${total} ${config.price.currency})`;
  try {
    await mailer.sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER, to,
      subject: `Rezervasyonunuz alındı – ${config.play.title} (${code})`,
      text: `Merhaba ${name},\n\n${config.play.title} için rezervasyonunuz alındı.\n\nKod: ${code}\nTarih: ${when}, saat ${session.time}\nKişi: ${seats}\nYer: ${config.venue.name}, ${config.venue.address}\n${pay}\n\nGörüşmek üzere!`,
    });
  } catch (e) { console.error('E-posta gönderilemedi:', e.message); }
}

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS reservations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL,
    surname TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT,
    seats INTEGER NOT NULL,
    payment_method TEXT NOT NULL,
    paid INTEGER NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_res_session ON reservations(session_id);
`);

const sessions = config.sessions.map((s) => ({ ...s, id: `${s.date}T${s.time}` }));
const sessionById = new Map(sessions.map((s) => [s.id, s]));

const seatsTaken = db.prepare('SELECT COALESCE(SUM(seats),0) AS n FROM reservations WHERE session_id = ?');
const insertRes = db.prepare(`INSERT INTO reservations
  (code, session_id, name, surname, phone, email, seats, payment_method, note)
  VALUES (?,?,?,?,?,?,?,?,?)`);

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');

const isPast = (s) => new Date(`${s.date}T${s.time}:00`) < new Date();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

// ---- yönetici oturumu (imzalı çerez) ----
const sign = (v) => createHmac('sha256', SESSION_SECRET).update(v).digest('hex');
function makeToken() {
  const exp = String(Date.now() + 12 * 3600 * 1000);
  return `${exp}.${sign(exp)}`;
}
function validToken(t) {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!exp || !sig || Number(exp) < Date.now()) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && timingSafeEqual(a, b);
}
const getCookie = (req, name) =>
  (req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).find(([k]) => k === name)?.[1];
const requireAdmin = (req, res, next) =>
  validToken(getCookie(req, 'admin')) ? next() : res.status(401).json({ error: 'Giriş gerekli' });

const attempts = new Map();
function tooManyAttempts(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  return list.length >= 10;
}

// ---- herkese açık API ----
function publicShow() {
  return {
    play: config.play, venue: config.venue, price: config.price, instagram: config.instagram,
    cast: config.cast, maxSeats: config.maxSeatsPerReservation,
    payment: { iban: config.payment.iban, accountName: config.payment.accountName, bank: config.payment.bank, note: config.payment.note },
    sessions: sessions.filter((s) => !isPast(s)).map((s) => ({
      id: s.id, date: s.date, time: s.time,
      remaining: Math.max(0, s.capacity - seatsTaken.get(s.id).n),
    })),
  };
}
app.get('/api/show', (_req, res) => res.json(publicShow()));

const clean = (v, max) => String(v ?? '').trim().slice(0, max);

app.post('/api/reservations', (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // bal kabı alanı: botlar doldurur
  const session = sessionById.get(b.sessionId);
  const name = clean(b.name, 60), surname = clean(b.surname, 60);
  const phone = clean(b.phone, 25), email = clean(b.email, 120), note = clean(b.note, 300);
  const seats = Number.parseInt(b.seats, 10);
  const method = b.paymentMethod;

  if (!session || isPast(session)) return res.status(400).json({ error: 'Lütfen geçerli bir tarih seçin.' });
  if (!name || !surname) return res.status(400).json({ error: 'Ad ve soyad gerekli.' });
  if (!/^\+?[0-9 ()-]{10,20}$/.test(phone)) return res.status(400).json({ error: 'Geçerli bir telefon numarası girin.' });
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-posta adresi geçersiz.' });
  if (!Number.isInteger(seats) || seats < 1 || seats > config.maxSeatsPerReservation)
    return res.status(400).json({ error: `Kişi sayısı 1 ile ${config.maxSeatsPerReservation} arasında olmalı.` });
  if (!['gise', 'havale'].includes(method)) return res.status(400).json({ error: 'Ödeme yöntemini seçin.' });

  // tek süreç ve eşzamanlı olmayan sürücü: kontrol + ekleme bölünemez
  db.exec('BEGIN IMMEDIATE');
  try {
    const left = session.capacity - seatsTaken.get(session.id).n;
    if (seats > left) {
      db.exec('ROLLBACK');
      return res.status(409).json({ error: left > 0 ? `Bu tarihte yalnızca ${left} yer kaldı.` : 'Bu tarih için yerler doldu.' });
    }
    let code;
    for (let i = 0; i < 5; i++) {
      code = newCode();
      try { insertRes.run(code, session.id, name, surname, phone, email || null, seats, method, note || null); break; }
      catch (e) { if (i === 4 || !/UNIQUE/.test(e.message)) throw e; }
    }
    db.exec('COMMIT');
    sendConfirmation({ to: email, name, code, session, seats, method });
    res.json({
      ok: true, code, seats, method,
      total: seats * config.price.amount,
      session: { date: session.date, time: session.time },
    });
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch {}
    console.error(e);
    res.status(500).json({ error: 'Bir hata oluştu, lütfen tekrar deneyin.' });
  }
});

// ---- yönetici API ----
app.post('/api/admin/login', (req, res) => {
  const ip = req.ip;
  if (tooManyAttempts(ip)) return res.status(429).json({ error: 'Çok fazla deneme. Biraz sonra tekrar deneyin.' });
  const given = Buffer.from(String(req.body?.password ?? ''));
  const real = Buffer.from(ADMIN_PASSWORD);
  const ok = ADMIN_PASSWORD && given.length === real.length && timingSafeEqual(given, real);
  if (!ok) {
    attempts.get(ip).push(Date.now());
    return res.status(401).json({ error: 'Şifre yanlış.' });
  }
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure}`);
  res.json({ ok: true });
});
app.post('/api/admin/logout', (_req, res) => {
  res.setHeader('Set-Cookie', 'admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/data', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM reservations ORDER BY session_id, created_at').all();
  res.json({
    price: config.price,
    sessions: sessions.map((s) => {
      const mine = rows.filter((r) => r.session_id === s.id);
      return {
        id: s.id, date: s.date, time: s.time, capacity: s.capacity,
        people: mine.reduce((a, r) => a + r.seats, 0),
        reservations: mine.length,
        paidPeople: mine.filter((r) => r.paid).reduce((a, r) => a + r.seats, 0),
      };
    }),
    reservations: rows,
  });
});

app.patch('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const paid = req.body?.paid ? 1 : 0;
  const r = db.prepare('UPDATE reservations SET paid = ? WHERE id = ?').run(paid, Number(req.params.id));
  res.json({ ok: r.changes > 0 });
});
app.delete('/api/admin/reservations/:id', requireAdmin, (req, res) => {
  const r = db.prepare('DELETE FROM reservations WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: r.changes > 0 });
});

app.get('/api/admin/export.csv', requireAdmin, (_req, res) => {
  const rows = db.prepare('SELECT * FROM reservations ORDER BY session_id, created_at').all();
  const esc = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // Excel formül enjeksiyonuna karşı
    return `"${s.replace(/"/g, '""')}"`;
  };
  const head = ['Kod', 'Tarih', 'Saat', 'Ad', 'Soyad', 'Telefon', 'E-posta', 'Kişi', 'Ödeme', 'Ödendi', 'Not', 'Oluşturulma'];
  const lines = rows.map((r) => {
    const s = sessionById.get(r.session_id);
    return [r.code, s?.date, s?.time, r.name, r.surname, r.phone, r.email, r.seats,
      r.payment_method === 'havale' ? 'Havale' : 'Gişe', r.paid ? 'Evet' : 'Hayır', r.note, r.created_at].map(esc).join(',');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="rezervasyonlar.csv"');
  res.send('﻿' + [head.map(esc).join(','), ...lines].join('\r\n'));
});

// ---- sayfalar ----
app.get(ADMIN_PATH, (_req, res) => {
  res.setHeader('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(root, 'views', 'admin.html'));
});
app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: ${ADMIN_PATH}\n`));
app.use(express.static(path.join(root, 'public')));

app.listen(PORT, () => console.log(`Site: http://localhost:${PORT}   Panel: http://localhost:${PORT}${ADMIN_PATH}`));
