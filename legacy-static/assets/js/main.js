(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Toast ---------- */
  const toastEl = $('.toast');
  let toastTimer;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), 3200);
  }

  /* ---------- Sticky header ---------- */
  const header = $('.header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 12);
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  /* Active nav link follows the section in view */
  const navLinks = $$('.nav a');
  const sections = navLinks.map(a => $(a.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window) {
    const navObs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        const id = '#' + e.target.id;
        navLinks.forEach(a => a.classList.toggle('is-active', a.getAttribute('href') === id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    sections.forEach(s => navObs.observe(s));
  }

  /* ---------- Mobile drawer ---------- */
  const drawer = $('#drawer');
  const burger = $('.burger');
  const setDrawer = open => {
    drawer.classList.toggle('is-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    burger.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : '';
  };
  burger.addEventListener('click', () => setDrawer(true));
  $('.js-close-drawer').addEventListener('click', () => setDrawer(false));
  drawer.addEventListener('click', e => {
    if (e.target === drawer || e.target.closest('a')) setDrawer(false);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') setDrawer(false); });

  /* ---------- Currency ---------- */
  // Approximate display rates (LKR per unit). Replace with live rates from your backend.
  const RATES = { LKR: 1, USD: 300, EUR: 325, GBP: 385 };
  const SYMBOL = { LKR: 'LKR ', USD: '$', EUR: '€', GBP: '£' };
  let currency = 'LKR';
  try { currency = localStorage.getItem('crc-currency') || 'LKR'; } catch (_) {}
  if (!RATES[currency]) currency = 'LKR';

  function formatPrice(lkr) {
    const v = lkr / RATES[currency];
    const n = currency === 'LKR'
      ? Math.round(v).toLocaleString('en-US')
      : (Math.round(v * 10) / 10).toLocaleString('en-US', { maximumFractionDigits: v < 100 ? 1 : 0 });
    return SYMBOL[currency] + n;
  }
  function renderPrices() {
    $$('.price[data-lkr]').forEach(el => { el.textContent = formatPrice(+el.dataset.lkr); });
  }
  const currencySelects = $$('.js-currency');
  currencySelects.forEach(sel => {
    sel.value = currency;
    sel.addEventListener('change', () => {
      currency = sel.value;
      currencySelects.forEach(s => { s.value = currency; });
      try { localStorage.setItem('crc-currency', currency); } catch (_) {}
      renderPrices();
      if (currency !== 'LKR') toast(`Showing approximate prices in ${currency}. You’ll be charged in LKR.`);
    });
  });
  renderPrices();

  /* ---------- Hero carousel ---------- */
  const VEHICLES = [
    { name: 'Toyota Aqua',       tag: 'Eco Favourite',  meta: 'Hybrid • Automatic • 5 Seats', rating: '4.8', price: 10500 },
    { name: 'Toyota Prius 2019', tag: 'Popular Choice', meta: 'Hybrid • Automatic • 5 Seats', rating: '4.9', price: 12500 },
    { name: 'Suzuki Wagon R',    tag: 'Best Value',     meta: 'Economy • Automatic • 4 Seats', rating: '4.7', price: 8500 },
    { name: 'Honda Vezel',       tag: 'Family SUV',     meta: 'SUV • Hybrid • 5 Seats',       rating: '4.8', price: 15500 },
    { name: 'Toyota KDH',        tag: 'Group Travel',   meta: 'Van • Diesel • 14 Seats',      rating: '4.9', price: 18500 },
  ];

  const hero = $('.hero');
  const slides = $$('.showcase__slide');
  const dots = $$('.dot');
  const card = $('.vcard');
  const countEl = $('.js-count');
  const stage = $('.hero__inner');
  const sweep = $('.hero__sweep');
  const AUTOPLAY_MS = 7000;
  const dotsWrap = $('.dots');
  hero.style.setProperty('--autoplay', AUTOPLAY_MS + 'ms');

  // Restart the progress fill on the active dot
  function restartTick() {
    dots.forEach(d => d.classList.remove('tick'));
    const active = dots[current];
    void active.offsetWidth;
    if (!reduceMotion) active.classList.add('tick');
  }
  let current = 0;
  let timer;
  let swapTimer;

  function go(next, dir) {
    next = (next + slides.length) % slides.length;
    if (next === current) return;
    if (dir === undefined) dir = next > current ? 1 : -1;

    const prev = slides[current];
    const incoming = slides[next];

    // Jump the incoming photo to its start offset without animating, then let it glide in
    const shot = $('.showcase__shot', incoming);
    shot.style.transition = 'none';
    incoming.style.setProperty('--from', `${dir * 90}px`);
    // Wipe in from the side the car is travelling from
    incoming.style.setProperty('--clip', dir > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)');
    void shot.offsetWidth;
    shot.style.transition = '';

    // Light band sweeps across in the same direction
    sweep.classList.remove('run', 'rev');
    void sweep.offsetWidth;
    sweep.classList.add('run');
    if (dir < 0) sweep.classList.add('rev');

    prev.style.setProperty('--to', `${dir * -70}px`);
    prev.classList.remove('is-active');
    prev.classList.add('is-leaving');
    setTimeout(() => prev.classList.remove('is-leaving'), 1800);
    incoming.classList.add('is-active');

    dots.forEach((d, i) => {
      d.classList.toggle('is-active', i === next);
      d.setAttribute('aria-selected', String(i === next));
    });

    hero.dataset.glow = String(next);
    countEl.textContent = String(next + 1).padStart(2, '0');

    // Info card: fade out, swap content, fade in
    const v = VEHICLES[next];
    card.classList.add('is-swapping');
    clearTimeout(swapTimer);
    swapTimer = setTimeout(() => {
      $('.js-v-name', card).textContent = v.name;
      $('.js-v-tag', card).textContent = v.tag;
      $('.js-v-meta', card).textContent = v.meta;
      $('.js-v-rating', card).textContent = v.rating;
      const priceEl = $('.js-v-price', card);
      priceEl.dataset.lkr = v.price;
      priceEl.textContent = formatPrice(v.price);
      card.classList.remove('is-swapping');
    }, reduceMotion ? 0 : 450);

    current = next;
    restartTick();
  }

  /* Photo focus point and headlight flares.
     data-pos    = object-position of the photo
     data-flares = headlight centres as fractions of the original image ("x,y x,y") */
  slides.forEach(slide => {
    if (slide.dataset.pos) slide.style.setProperty('--pos', slide.dataset.pos);
    if (!slide.dataset.flares) return;
    const kb = $('.showcase__kb', slide);
    slide._flares = slide.dataset.flares.split(' ').map(p => {
      const [fx, fy] = p.split(',').map(Number);
      const el = document.createElement('i');
      el.className = 'flare';
      kb.appendChild(el);
      return { el, fx, fy };
    });
  });

  function placeFlares() {
    slides.forEach(slide => {
      if (!slide._flares) return;
      const img = $('img', slide);
      const w = img.offsetWidth, h = img.offsetHeight;
      if (!img.naturalWidth || !w || !h) return;
      // Replicate object-fit: cover + object-position to find where an image point lands
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const [px, py] = getComputedStyle(img).objectPosition.split(' ').map(v => parseFloat(v) / 100);
      const ox = (w - dw) * px, oy = (h - dh) * py;
      const size = Math.max(120, dw * 0.13);
      slide._flares.forEach(f => {
        f.el.style.setProperty('--x', `${ox + f.fx * dw}px`);
        f.el.style.setProperty('--y', `${oy + f.fy * dh}px`);
        f.el.style.width = f.el.style.height = `${size}px`;
        f.el.style.margin = `${-size / 2}px 0 0 ${-size / 2}px`;
      });
    });
  }
  slides.forEach(s => $('img', s).addEventListener('load', placeFlares));
  window.addEventListener('resize', placeFlares);
  placeFlares();

  /* Subtle parallax: the car drifts against the mouse */
  if (!reduceMotion && window.matchMedia('(pointer: fine)').matches) {
    let raf;
    hero.addEventListener('mousemove', e => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = hero.getBoundingClientRect();
        hero.style.setProperty('--mx', (((e.clientX - r.left) / r.width) - 0.5) * 2);
        hero.style.setProperty('--my', (((e.clientY - r.top) / r.height) - 0.5) * 2);
      });
    });
    hero.addEventListener('mouseleave', () => {
      hero.style.setProperty('--mx', 0);
      hero.style.setProperty('--my', 0);
    });
  }

  /* Clip-path hero reveal: drop .is-intro on the next frame so the transitions run */
  requestAnimationFrame(() => requestAnimationFrame(() => hero.classList.remove('is-intro')));

  /* Intro: reveal the first car with the same light wipe on page load */
  if (!reduceMotion) {
    const first = slides[0];
    first.style.setProperty('--clip', 'inset(0 0 0 100%)');
    first.classList.remove('is-active');
    void first.offsetWidth;
    setTimeout(() => {
      first.classList.add('is-active');
      sweep.classList.add('run');
    }, 1000); // once the letterbox is about half open
  }

  const startAuto = () => {
    if (reduceMotion) return;
    clearInterval(timer);
    dotsWrap.classList.remove('is-paused');
    restartTick();
    timer = setInterval(() => go(current + 1, 1), AUTOPLAY_MS);
  };
  const stopAuto = () => {
    clearInterval(timer);
    dotsWrap.classList.add('is-paused');
  };

  $('.js-next').addEventListener('click', () => { go(current + 1, 1); startAuto(); });
  $('.js-prev').addEventListener('click', () => { go(current - 1, -1); startAuto(); });
  dots.forEach((d, i) => d.addEventListener('click', () => { go(i); startAuto(); }));

  const showcase = $('.showcase');
  showcase.addEventListener('mouseenter', stopAuto);
  showcase.addEventListener('mouseleave', startAuto);
  showcase.addEventListener('focusin', stopAuto);
  showcase.addEventListener('focusout', startAuto);
  showcase.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { go(current + 1, 1); }
    if (e.key === 'ArrowLeft') { go(current - 1, -1); }
  });

  // Touch swipe
  let touchX = null;
  stage.addEventListener('touchstart', e => { touchX = e.touches[0].clientX; stopAuto(); }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) go(current + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    touchX = null;
    startAuto();
  });

  document.addEventListener('visibilitychange', () => (document.hidden ? stopAuto() : startAuto()));
  startAuto();

  /* ---------- Search ---------- */
  const pdate = $('#pdate');
  const rdate = $('#rdate');
  const pickup = $('#pickup');
  const ret = $('#return');
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const today = new Date();
  pdate.min = iso(today);
  pdate.value = iso(addDays(today, 1));
  rdate.min = pdate.value;
  rdate.value = iso(addDays(today, 5));
  pdate.addEventListener('change', () => {
    rdate.min = pdate.value;
    if (rdate.value < pdate.value) rdate.value = iso(addDays(new Date(pdate.value), 3));
  });

  const note = $('.js-search-note');
  const NOTES = {
    self: 'No sign-up needed to browse — free cancellation on most vehicles.',
    driver: 'English-speaking drivers. Driver meals and lodging shown upfront.',
    airport: 'Meet & greet at CMB arrivals, 24 hours a day.',
  };
  $$('.search-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      $$('.search-tab').forEach(t => {
        t.classList.toggle('is-active', t === tab);
        t.setAttribute('aria-selected', String(t === tab));
      });
      const mode = tab.dataset.mode;
      if (mode === 'airport') pickup.value = 'Bandaranaike International Airport (CMB)';
      else if (pickup.value.startsWith('Bandaranaike')) pickup.value = 'Colombo';
      note.lastChild.textContent = NOTES[mode];
    });
  });

  $('.search').addEventListener('submit', e => {
    e.preventDefault();
    const where = pickup.value.trim() || 'Sri Lanka';
    const days = Math.max(1, Math.round((new Date(rdate.value) - new Date(pdate.value)) / 864e5));
    if (!ret.value.trim()) ret.placeholder = 'Same as pickup';
    toast(`Showing vehicles near ${where} for ${days} day${days > 1 ? 's' : ''}.`);
    $('#vehicles').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth' });
  });

  /* ---------- Vehicle filter chips ---------- */
  const cars = $$('.car');
  $$('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      $$('.chip').forEach(c => c.classList.toggle('is-active', c === chip));
      const f = chip.dataset.filter;
      cars.forEach(c => c.classList.toggle('is-hidden', f !== 'all' && c.dataset.cat !== f));
    });
  });

  /* ---------- Favourites ---------- */
  $$('.fav').forEach(btn => {
    btn.addEventListener('click', () => {
      const on = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.remove('pop');
      void btn.offsetWidth;
      btn.classList.add('pop');
      if (on) toast('Saved to your shortlist — no account needed.');
    });
  });

  /* ---------- FAQ: one open at a time ---------- */
  const faqs = $$('.faq details');
  faqs.forEach(d => d.addEventListener('toggle', () => {
    if (d.open) faqs.forEach(o => { if (o !== d) o.open = false; });
  }));

  /* ---------- Reveal on scroll ---------- */
  const reveal = $$('[data-reveal]');
  if ('IntersectionObserver' in window && !reduceMotion) {
    // Stagger siblings that share a parent
    reveal.forEach(el => {
      const sibs = [...el.parentElement.children].filter(c => c.hasAttribute('data-reveal'));
      const i = sibs.indexOf(el);
      if (i > 0) el.style.setProperty('--d', `${Math.min(i, 6) * 0.07}s`);
    });
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('is-in'); obs.unobserve(e.target); }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    reveal.forEach(el => obs.observe(el));
  } else {
    reveal.forEach(el => el.classList.add('is-in'));
  }

  $('.js-year').textContent = new Date().getFullYear();
})();
