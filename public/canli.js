// Canlı davranışlar: kaydırınca belirme, afiş eğilmesi/kayması, ilerleme çubuğu, afiş büyütme.
// Süs amaçlıdır; çalışmazsa site yine tam kullanılır.
(() => {
  const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (id) => document.getElementById(id);

  // ---- kaydırınca belirme ----
  let io;
  function reveal() {
    if (calm || !('IntersectionObserver' in window)) { document.querySelectorAll('.rv').forEach((e) => e.classList.add('in')); return; }
    io = io || new IntersectionObserver((list) => list.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    const mark = (sel, step) => document.querySelectorAll(sel).forEach((el, i) => {
      if (el.dataset.rv) return;
      el.dataset.rv = '1'; el.classList.add('rv');
      if (step) el.style.setProperty('--i', i % 8);
      io.observe(el);
    });
    mark('#bilet, .sorgu, .section > h2, .section > .lead, .contact .actions, .ig, .mapbox, .share .actions');
    mark('.spec > div', true); mark('.month', true); mark('.person', true); mark('.faq details', true);
  }
  document.addEventListener('sod:ready', reveal);
  reveal();

  // ---- ilerleme çubuğu, başlık gölgesi, afiş kayması ----
  const bar = $('progress'), top = document.querySelector('.top'), pbtn = $('posterBtn');
  let ticking = false;
  function frame() {
    ticking = false;
    const y = scrollY, max = document.documentElement.scrollHeight - innerHeight;
    if (bar) bar.style.setProperty('--p', max > 0 ? Math.min(1, y / max).toFixed(4) : 0);
    if (top) top.classList.toggle('scrolled', y > 8);
    if (pbtn && !calm && y < innerHeight * 1.2) pbtn.style.setProperty('--py', `${(y * -0.06).toFixed(1)}px`);
  }
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(frame); } }, { passive: true });
  frame();

  // ---- afiş: fareyle hafif eğilme ----
  if (pbtn && !calm && matchMedia('(hover: hover) and (pointer: fine)').matches) {
    pbtn.addEventListener('pointermove', (e) => {
      const r = pbtn.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      pbtn.classList.add('tilting');
      pbtn.style.setProperty('--ry', `${(x * 9).toFixed(2)}deg`);
      pbtn.style.setProperty('--rx', `${(-y * 9).toFixed(2)}deg`);
      pbtn.style.setProperty('--r', '0deg');
    });
    pbtn.addEventListener('pointerleave', () => {
      pbtn.classList.remove('tilting');
      ['--ry', '--rx'].forEach((k) => pbtn.style.setProperty(k, '0deg'));
      pbtn.style.setProperty('--r', '1.5deg');
    });
  }

  // ---- afiş büyütme ----
  const box = $('lightbox');
  if (pbtn && box && box.showModal) {
    pbtn.addEventListener('click', () => { const im = box.querySelector('img'); if (!im.getAttribute('src')) im.src = '/afis.jpg'; box.showModal(); });
    box.addEventListener('click', (e) => { if (e.target === box || e.target.tagName === 'IMG') box.close(); });
  }
})();
