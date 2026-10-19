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
    $('done').scrollIntoView({ behavior: 'smooth' });
  } catch {
    err.textContent = 'Bağlantı hatası, lütfen tekrar deneyin.'; err.hidden = false;
  } finally { $('submit').disabled = false; }
});

$('copyIban').onclick = async () => {
  try { await navigator.clipboard.writeText(show.payment.iban.replace(/\s/g, '')); $('copyIban').textContent = 'Kopyalandı ✓'; } catch {}
};

load();
