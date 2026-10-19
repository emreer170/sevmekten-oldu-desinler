const $ = (id) => document.getElementById(id);
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const money = (n, cur) => `${n.toLocaleString('tr-TR')}\u00a0${cur}`; // TL rakama yapışık kalsın, satır sonunda bölünmesin
let show, seats = 1;
const openedAt = Date.now();

function selectedSession() {
  const id = document.querySelector('input[name=session]:checked')?.value;
  return show.sessions.find((s) => s.id === id);
}
function updateTotal() {
  $('seatsOut').textContent = seats;
  $('total').textContent = money(seats * show.price.amount, show.price.currency);
}
function renderSessions() {
  const box = $('sessions');
  box.replaceChildren();
  $('noSessions').hidden = show.sessions.length > 0;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  let group = null, lastMonth = '';
  show.sessions.forEach((s) => {
    const d = new Date(s.date + 'T12:00:00');
    const month = d.toLocaleDateString('tr-TR', { month: 'long' });
    if (month !== lastMonth) {
      lastMonth = month;
      const wrap = el('div', 'month');
      wrap.append(el('h3', null, month));
      group = el('div', 'month-list');
      wrap.append(group);
      box.append(wrap);
    }
    const label = el('label', 'session' + (s.level === 'sold' ? ' full' : ''));
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'session', value: s.id, disabled: s.level === 'sold' });
    input.onchange = () => {
      seats = Math.min(seats, s.available);
      updateTotal();
      // tarih seçilince bir sonraki adıma (kişi sayısı ve bilgiler) geç
      const next = $('adim2');
      const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      setTimeout(() => next.scrollIntoView({ behavior: calm ? 'auto' : 'smooth', block: 'start' }), 250);
    };
    const date = el('div', 'sdate');
    date.append(el('b', null, d.getDate()), el('small', null, d.toLocaleDateString('tr-TR', { month: 'short' }).replace('.', '')));
    const info = el('div', 'sinfo');
    info.append(
      el('strong', null, d.toLocaleDateString('tr-TR', { weekday: 'long' }) + ' · ' + s.time),
      el('span', null, `${show.venue.name}${show.venue.city ? ', ' + show.venue.city : ''}`),
    );
    const lvl = el('em', 'lvl ' + s.level, { sold: 'Tükendi', last: `Son ${s.left} bilet!`, few: 'Hızla tükeniyor', limited: 'Sınırlı sayıda' }[s.level]);
    label.append(input, date, info, lvl, el('i', 'tick', '✓'));
    group.append(label);
  });
}
function renderPage() {
  const { play, venue, price, cast } = show;
  document.title = `${play.title} – Bilet Rezervasyonu`;
  $('title').textContent = play.title;
  $('tagline').textContent = play.tagline;
  const credits = [play.writer && `Yazan · ${play.writer}`, play.director && `Yönetmen · ${play.director}`].filter(Boolean).join('   |   ');
  if (credits) { $('director').textContent = credits; $('director').hidden = false; }
  $('description').replaceChildren(...play.description.split('\n').filter(Boolean).map((t) => Object.assign(document.createElement('p'), { textContent: t })));
  $('duration').textContent = play.duration;
  $('age').textContent = play.ageLimit;
  $('price').textContent = money(price.amount, price.currency);
  $('stickyPrice').textContent = money(price.amount, price.currency);
  if (price.oldAmount > price.amount) {
    $('oldPrice').textContent = money(price.oldAmount, price.currency);
    $('badge').textContent = `%${Math.round((1 - price.amount / price.oldAmount) * 100)} İNDİRİM`;
    $('oldPrice').hidden = $('badge').hidden = false;
  }
  $('venueName').textContent = venue.name;
  $('venueAddress').textContent = venue.address;
  if (venue.mapUrl) { $('mapLink').href = venue.mapUrl; $('mapLink').hidden = false; }
  if (show.instagram) { $('insta').href = show.instagram; $('insta').hidden = false; }
  if (cast.length) {
    $('oyuncular').hidden = false;
    if (play.director) $('directorLine').textContent = `Yönetmen: ${play.director}`;
    $('cast').replaceChildren();
    cast.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'person';
      let pic;
      if (p.photo) { pic = document.createElement('img'); pic.src = p.photo; pic.alt = p.name; pic.loading = 'lazy'; }
      else { pic = document.createElement('div'); pic.className = 'ph'; pic.textContent = p.name.split(' ').filter((w, i, a) => i === 0 || i === a.length - 1).map((w) => w.charAt(0)).join(''); }
      const info = document.createElement('div'); info.className = 'info';
      const n = document.createElement('strong'); n.textContent = p.name;
      const r = document.createElement('small'); r.textContent = p.role; r.hidden = !p.role;
      const b = document.createElement('p'); b.textContent = p.bio; b.hidden = !p.bio;
      info.append(n, r, b);
      el.append(pic, info);
      $('cast').append(el);
    });
  }
  const media = $('media');
  if (play.video) {
    const v = Object.assign(document.createElement('video'), { src: play.video, controls: true, playsInline: true, preload: 'metadata' });
    if (play.poster) v.poster = play.poster;
    media.append(v); media.hidden = false;
  } else if (play.poster) {
    const i = Object.assign(document.createElement('img'), { src: play.poster, alt: `${play.title} afişi` });
    media.append(i); media.hidden = false;
  }
  setupWhatsapp();
  setupMarquee(cast);
  setupExtras();
  renderSessions();
  updateTotal();
}

function setupMarquee(cast) {
  if (!cast.length) return;
  const track = $('track');
  const group = () => {
    const g = document.createElement('div');
    g.className = 'group';
    const label = document.createElement('span');
    label.className = 'lbl';
    label.textContent = 'Sahnede';
    g.append(label);
    cast.forEach((p) => g.append(Object.assign(document.createElement('span'), { textContent: p.name })));
    return g;
  };
  track.replaceChildren(group(), group()); // iki kopya: döngü kesintisiz görünsün
  track.lastChild.setAttribute('aria-hidden', 'true');
  $('marquee').hidden = false;
}

function setupWhatsapp() {
  const num = (show.contact?.whatsapp || '').trim();
  const digits = num.replace(/\D/g, '').replace(/^0/, '');
  [['wa', 'Sorularınız için bize WhatsApp\'tan yazabilirsiniz: '], ['waDone', 'Değişiklik ya da sorularınız için WhatsApp: ']].forEach(([id, label]) => {
    const el = $(id);
    el.replaceChildren(label);
    if (num) {
      el.append(Object.assign(document.createElement('a'), { href: `https://wa.me/90${digits}`, target: '_blank', rel: 'noopener', textContent: num }));
    } else {
      el.append('numaramız yakında burada olacak.');
    }
    el.hidden = false;
  });
}

async function load() {
  show = await (await fetch('/api/show')).json();
  renderPage();
}

$('minus').onclick = () => { seats = Math.max(1, seats - 1); updateTotal(); };
$('plus').onclick = () => { seats = Math.min(selectedSession()?.available ?? show.maxSeats, seats + 1); updateTotal(); };

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('error');
  err.hidden = true;
  const f = new FormData(e.target);
  const body = Object.fromEntries(f);
  body.sessionId = f.get('session');
  body.seats = seats;
  body.elapsed = Date.now() - openedAt; // form ne kadar süredir açık (bot önlemi)
  if (!body.sessionId) { err.textContent = 'Lütfen bir tarih seçin.'; err.hidden = false; return; }
  $('submit').disabled = true;
  try {
    const res = await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Bir hata oluştu.'; err.hidden = false; if (res.status === 409) load(); return; }
    $('form').hidden = true;
    $('done').hidden = false;
    $('code').textContent = data.code;
    $('summary').textContent = `${fmtDate(data.session.date)}, saat ${data.session.time} · ${data.seats} kişi · ${money(data.total, show.price.currency)} · ${data.method === 'havale' ? 'Havale ile ödenecek' : 'Gişede nakit ödenecek'}`;
    if (data.method === 'havale') {
      $('bank').hidden = false;
      $('iban').textContent = show.payment.iban;
      $('bankInfo').textContent = `${show.payment.accountName} · ${show.payment.bank}. ${show.payment.note}`;
    }
    setCalendar($('gcal'), $('ics'), data.session, data.code);
    $('done').scrollIntoView({ behavior: 'smooth' });
  } catch {
    err.textContent = 'Bağlantı hatası, lütfen tekrar deneyin.'; err.hidden = false;
  } finally { $('submit').disabled = false; }
});

$('copyIban').onclick = async () => {
  try { await navigator.clipboard.writeText(show.payment.iban.replace(/\s/g, '')); $('copyIban').textContent = 'Kopyalandı ✓'; } catch {}
};

// ---- takvim (Google Takvim bağlantısı ve .ics dosyası) ----
function calTimes(session) {
  const minutes = parseInt(show.play.duration, 10) || 95;
  const start = new Date(`${session.date}T${session.time}:00+03:00`); // İstanbul saati
  const end = new Date(start.getTime() + minutes * 60000);
  const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  return { start: f(start), end: f(end) };
}
function setCalendar(gcalEl, icsEl, session, code) {
  const t = calTimes(session);
  const place = `${show.venue.name}, ${show.venue.address}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: show.play.title, dates: `${t.start}/${t.end}`, location: place, details: `Rezervasyon kodu: ${code}` });
  gcalEl.href = `https://calendar.google.com/calendar/render?${q}`;
  const esc = (v) => String(v).replace(/[\;,]/g, (m) => '\\' + m).replace(/\n/g, '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sevmekten Oldu Desinler//TR', 'BEGIN:VEVENT',
    `UID:${code}@sevmekten-oldu-desinler`, `DTSTAMP:${calTimes({ date: session.date, time: session.time }).start}`,
    `DTSTART:${t.start}`, `DTEND:${t.end}`, `SUMMARY:${esc(show.play.title)}`, `LOCATION:${esc(place)}`,
    `DESCRIPTION:${esc('Rezervasyon kodu: ' + code)}`, 'BEGIN:VALARM', 'TRIGGER:-PT3H', 'ACTION:DISPLAY', 'DESCRIPTION:Oyun yaklasiyor', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  if (icsEl._url) URL.revokeObjectURL(icsEl._url);
  icsEl._url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  icsEl.href = icsEl._url;
  icsEl.download = 'sevmekten-oldu-desinler.ics';
}

// ---- paylaş ----
async function shareSite() {
  const url = `${location.origin}/`;
  const data = { title: show.play.title, text: `${show.play.title} · ${show.play.tagline} Biletini ayırt:`, url };
  const note = $('shareNote');
  const say = (m) => { note.textContent = m; note.hidden = false; setTimeout(() => { note.hidden = true; }, 4000); };
  if (navigator.share) {
    try { await navigator.share(data); return; } catch (e) { if (e && e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(`${data.text} ${url}`); say('Bağlantı kopyalandı, istediğin yere yapıştırabilirsin.'); }
  catch { say(url); }
}

// ---- sayfa eklentileri: ulaşım, SSS, bekleme listesi ----
function setupExtras() {
  const v = show.venue, place = `${v.name}, ${v.address}`;
  $('transportAddr').textContent = place;
  if (v.transport) { $('transportNote').textContent = v.transport; $('transportNote').hidden = false; }
  $('dirBtn').href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place)}`;
  const frame = $('mapFrame');
  const src = `https://www.google.com/maps?q=${encodeURIComponent(place)}&output=embed&hl=tr`;
  if (frame.getAttribute('src') !== src) frame.src = src;
  const faq = $('faq');
  faq.replaceChildren(...(show.faq || []).map((f) => {
    const d = document.createElement('details');
    const q = document.createElement('summary'); q.textContent = f.q;
    const a = document.createElement('p'); a.textContent = f.a;
    d.append(q, a);
    return d;
  }));
  $('sss').hidden = !(show.faq || []).length;
  // bekleme listesi yalnızca dolu bir tarih varsa görünür
  const sold = show.sessions.filter((x) => x.level === 'sold');
  $('waitBox').hidden = sold.length === 0;
  $('waitSession').replaceChildren(...sold.map((x) => Object.assign(document.createElement('option'), { value: x.id, textContent: `${fmtDate(x.date)} · ${x.time}` })));
}
$('shareBtn').onclick = shareSite;
$('shareDone').onclick = shareSite;
$('copyLink').onclick = async () => {
  try { await navigator.clipboard.writeText(`${location.origin}/`); $('copyLink').textContent = 'Kopyalandı ✓'; } catch { $('copyLink').textContent = location.origin; }
};

$('waitForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const msg = $('waitMsg');
  const f = Object.fromEntries(new FormData(e.target));
  msg.hidden = false; msg.textContent = 'Gönderiliyor…';
  try {
    const res = await fetch('/api/waitlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await res.json();
    msg.textContent = res.ok ? 'Bekleme listesine eklendiniz. Yer açılırsa e-posta ile haber vereceğiz.' : (d.error || 'Bir hata oluştu.');
    if (res.status === 409) load();
  } catch { msg.textContent = 'Bağlantı hatası, lütfen tekrar deneyin.'; }
});

// ---- rezervasyon sorgulama ve iptal ----
function openSorgu() { if (location.hash === '#sorgu') { $('sorgu').open = true; $('sorgu').scrollIntoView(); } }
window.addEventListener('hashchange', openSorgu);
$('lookupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('lookupErr'), box = $('lookupResult');
  err.hidden = true; box.hidden = true;
  const f = Object.fromEntries(new FormData(e.target));
  try {
    const res = await fetch('/api/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(f) });
    const d = await res.json();
    if (!res.ok) { err.textContent = d.error || 'Bir hata oluştu.'; err.hidden = false; return; }
    showReservation(d, f);
  } catch { err.textContent = 'Bağlantı hatası, lütfen tekrar deneyin.'; err.hidden = false; }
});
function showReservation(d, creds) {
  const box = $('lookupResult');
  const make = (tag, text, cls) => { const x = document.createElement(tag); if (text != null) x.textContent = text; if (cls) x.className = cls; return x; };
  box.replaceChildren();
  box.append(make('h3', `${d.name} ${d.surname}`));
  box.append(make('p', d.session ? `${fmtDate(d.session.date)}, saat ${d.session.time} · ${d.seats} kişi · ${money(d.total, show.price.currency)}` : ''));
  box.append(make('p', d.paid ? 'Ödemeniz alındı.' : 'Ödeme oyun günü gişede nakit alınacak.', 'muted'));
  if (d.session) {
    const row = make('div', null, 'actions');
    const g = make('a', "Google Takvim'e ekle", 'btn ghost'); g.target = '_blank'; g.rel = 'noopener';
    const i = make('a', 'Takvime ekle (.ics)', 'btn ghost');
    setCalendar(g, i, d.session, d.code);
    row.append(g, i);
    box.append(row);
  }
  if (d.canCancel) {
    const cancel = make('button', 'Rezervasyonu iptal et', 'btn danger'); cancel.type = 'button';
    const ask = make('div', null, 'ask'); ask.hidden = true;
    ask.append(make('p', 'Rezervasyonunuzu iptal etmek istediğinizden emin misiniz? Bu işlem geri alınamaz.'));
    const yes = make('button', 'Evet, iptal et', 'btn danger'); yes.type = 'button';
    const no = make('button', 'Vazgeç', 'btn ghost'); no.type = 'button';
    ask.append(yes, no);
    cancel.onclick = () => { cancel.hidden = true; ask.hidden = false; };
    no.onclick = () => { ask.hidden = true; cancel.hidden = false; };
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        const res = await fetch('/api/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(creds) });
        const r = await res.json();
        box.replaceChildren(make('p', res.ok ? 'Rezervasyonunuz iptal edildi. Yeriniz başkasına açıldı. Yeniden rezervasyon yapabilirsiniz.' : (r.error || 'Bir hata oluştu.'), res.ok ? 'ok' : 'error'));
        if (res.ok) load();
      } catch { yes.disabled = false; }
    };
    box.append(cancel, ask);
  } else if (d.session) box.append(make('p', 'Oyun tarihi geçtiği için bu rezervasyon iptal edilemez.', 'muted'));
  box.hidden = false;
}

load().then(openSorgu);
