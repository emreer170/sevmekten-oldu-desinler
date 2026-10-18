const $ = (id) => document.getElementById(id);
const fmtDate = (d) => new Date(d + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
const money = (n, cur) => `${n.toLocaleString('tr-TR')} ${cur}`;
let show, seats = 1;

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
  show.sessions.forEach((s) => {
    const label = document.createElement('label');
    label.className = 'session' + (s.level === 'sold' ? ' full' : '');
    const input = Object.assign(document.createElement('input'), { type: 'radio', name: 'session', value: s.id, disabled: s.level === 'sold' });
    input.onchange = () => { seats = Math.min(seats, s.available); updateTotal(); };
    const text = document.createElement('span');
    text.textContent = `${fmtDate(s.date)} · ${s.time}`;
    const left = document.createElement('small');
    left.textContent = { sold: 'Biletler tükendi', last: `Son ${s.left} bilet!`, few: 'Hızla tükeniyor', limited: 'Sınırlı sayıda bilet' }[s.level];
    left.className = 'lvl ' + s.level;
    label.append(input, text, left);
    box.append(label);
  });
}
function renderPage() {
  const { play, venue, price, cast } = show;
  document.title = `${play.title} – Bilet Rezervasyonu`;
  $('title').textContent = play.title;
  $('tagline').textContent = play.tagline;
  if (play.director) { $('director').textContent = `Yönetmen: ${play.director}`; $('director').hidden = false; }
  $('description').textContent = play.description;
  $('duration').textContent = play.duration;
  $('age').textContent = play.ageLimit;
  $('price').textContent = money(price.amount, price.currency);
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
    $('castSection').hidden = false;
    cast.forEach((p) => {
      const el = document.createElement('div');
      el.className = 'person';
      let pic;
      if (p.photo) { pic = document.createElement('img'); pic.src = p.photo; pic.alt = p.name; pic.loading = 'lazy'; }
      else { pic = document.createElement('div'); pic.className = 'ph'; pic.textContent = p.name.charAt(0); }
      const info = document.createElement('div'); info.className = 'info';
      const n = document.createElement('strong'); n.textContent = p.name;
      const r = document.createElement('small'); r.textContent = p.role; r.hidden = !p.role;
      const b = document.createElement('p'); b.textContent = p.bio; b.hidden = !p.bio;
      info.append(n, r, b);
      el.append(pic, info);
      $('cast').append(el);
    });
  }
  renderSessions();
  updateTotal();
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
  if (!body.sessionId) { err.textContent = 'Lütfen bir tarih seçin.'; err.hidden = false; return; }
  $('submit').disabled = true;
  try {
    const res = await fetch('/api/reservations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { err.textContent = data.error || 'Bir hata oluştu.'; err.hidden = false; if (res.status === 409) load(); return; }
    $('form').hidden = true;
    $('done').hidden = false;
    $('code').textContent = data.code;
    $('summary').textContent = `${fmtDate(data.session.date)}, saat ${data.session.time} · ${data.seats} kişi · ${money(data.total, show.price.currency)} · ${data.method === 'havale' ? 'Havale ile ödenecek' : 'Gişede ödenecek'}`;
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
