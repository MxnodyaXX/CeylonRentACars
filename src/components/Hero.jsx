import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import SearchPanel from './SearchPanel';
import { HERO_ART } from '../data/site';
import { PHONE_QUERY, useFleet } from '../lib/fleet';
import { openVehicle } from './VehicleModal';
import { Price } from '../context/AppContext';
import { useReducedMotion } from '../hooks/useMotion';

const AUTOPLAY_MS = 7000;
const INTRO_CAR_DELAY = 1750; // ms after the loader splits: page content first, then the car + price card
const LEAVE_MS = 1800;        // how long the outgoing slide keeps its "leaving" styles
const CARD_SWAP_MS = 450;     // price card fades out, swaps text, then fades back in

const pad = n => String(n + 1).padStart(2, '0');

/* ---------- Headlight flares, positioned on the photo's real headlights ---------- */
function useFlarePositions(imgRef, flares) {
  const [positions, setPositions] = useState([]);

  useEffect(() => {
    const img = imgRef.current;
    if (!img || !flares) return;

    const place = () => {
      const w = img.offsetWidth, h = img.offsetHeight;
      if (!img.naturalWidth || !w || !h) return;
      // Replicate object-fit: cover + object-position to find where an image point lands
      const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
      const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
      const [px, py] = getComputedStyle(img).objectPosition.split(' ').map(v => parseFloat(v) / 100);
      const ox = (w - dw) * px, oy = (h - dh) * py;
      const size = Math.max(120, dw * 0.13);
      setPositions(flares.map(([fx, fy]) => ({ x: ox + fx * dw, y: oy + fy * dh, size })));
    };

    place();
    img.addEventListener('load', place);
    const ro = new ResizeObserver(place);
    ro.observe(img);
    return () => { img.removeEventListener('load', place); ro.disconnect(); };
  }, [imgRef, flares]);

  return positions;
}

function Slide({ slide, index, isActive, isLeaving, isPrep, vars }) {
  const imgRef = useRef(null);
  const flares = useFlarePositions(imgRef, slide.flares);

  const classes = [
    'showcase__slide',
    slide.cutout ? 'is-cutout' : slide.night ? 'is-night' : 'is-day',
    isActive && 'is-active',
    isLeaving && 'is-leaving',
    isPrep && 'is-prep',
  ].filter(Boolean).join(' ');

  return (
    <figure className={classes} style={{ ...vars, ...(slide.pos && { '--pos': slide.pos }) }}>
      {slide.cutout
        ? <div className="showcase__spot" />
        : <div className="showcase__amb" style={{ backgroundImage: `url(${slide.img})` }} />}
      <div className="showcase__shot">
        <div className="showcase__kb">
          <img
            ref={imgRef}
            src={slide.img}
            alt={slide.alt}
            {...(index === 0 ? { fetchPriority: 'high' } : { loading: 'lazy' })}
          />
          {slide.cutout && <img className="showcase__reflect" src={slide.img} alt="" aria-hidden="true" />}
          {flares.map((f, i) => (
            <i
              key={i}
              className="flare"
              style={{ '--x': `${f.x}px`, '--y': `${f.y}px`, width: f.size, height: f.size, margin: `${-f.size / 2}px 0 0 ${-f.size / 2}px` }}
            />
          ))}
        </div>
        {slide.cutout && <span className="showcase__floor" aria-hidden="true" />}
      </div>
    </figure>
  );
}

/* Admin-listed vehicles become hero slides (photos may be cut-outs or full shots) */
function useIsPhone() {
  const [phone, setPhone] = useState(() => window.matchMedia(PHONE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE_QUERY);
    const onChange = () => setPhone(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return phone;
}

function useHeroSlides() {
  const { vehicles, status } = useFleet();
  const phone = useIsPhone();
  return useMemo(() => {
    const listed = vehicles.filter(v => v.heroSrc).map(v => ({
      id: v.id,
      name: v.name,
      tag: v.badge || v.catLabel,
      meta: [v.catLabel, v.transmission, `${v.seats} Seats`].join(' • '),
      rating: v.rating,
      price: v.price,
      // Phones: the admin cut-out on the lit stage; larger screens: the hero photo
      img: phone && v.phoneSrc ? v.phoneSrc : v.heroSrc,
      alt: v.name,
      // Cut-outs go on the lit stage; full photos blend into the scene like the original hero art
      cutout: phone && v.phoneSrc ? true : v.cutout,
      night: !v.bright,
      pos: '50% 55%',
    }));
    if (listed.length) return { slides: listed, art: false, loading: false };
    // Nothing listed (yet): background art only, no vehicle card
    return { slides: status === 'loading' ? [] : [{ ...HERO_ART, id: 'art' }], art: true, loading: status === 'loading' };
  }, [vehicles, status, phone]);
}

export default function Hero({ revealed = true }) {
  const reduced = useReducedMotion();
  const { slides, art } = useHeroSlides();
  const count = slides.length;
  const countRef = useRef(count);
  countRef.current = count;
  const multi = !art && count > 1;
  const sectionRef = useRef(null);
  const sceneRef = useRef(null);

  const [active, setActive] = useState(-1); // -1 until the intro wipes the first car in
  const [leaving, setLeaving] = useState(null);
  const [prep, setPrep] = useState(null);
  const [slideVars, setSlideVars] = useState({});
  const [sweep, setSweep] = useState({ id: 0, run: false, rev: false });
  const [shown, setShown] = useState(0);       // vehicle whose details are in the price card
  const [swapping, setSwapping] = useState(false);
  const [paused, setPaused] = useState(false);
  const [tick, setTick] = useState(0);         // bump to restart the autoplay timer + dot fill

  const activeRef = useRef(active);
  activeRef.current = active;
  const pending = useRef(null);

  /* ---------- Changing slides ---------- */
  const go = useCallback((target, dir) => {
    const from = activeRef.current;
    if (from < 0 || pending.current) return;
    const n = countRef.current;
    if (n < 2) return;
    const next = (target + n) % n;
    if (next === from) return;
    if (dir === undefined) dir = next > from ? 1 : -1;

    // Stage the incoming slide at its start position (wipe edge + offset) with transitions off
    setSlideVars(v => ({
      ...v,
      [next]: { '--from': `${dir * 90}px`, '--clip': dir > 0 ? 'inset(0 0 0 100%)' : 'inset(0 100% 0 0)' },
      [from]: { ...v[from], '--to': `${dir * -70}px` },
    }));
    pending.current = { from, next, dir };
    setPrep(next);
  }, []);

  // One frame after staging, flip to active so the CSS transitions run
  useLayoutEffect(() => {
    if (prep === null || !pending.current) return;
    void sceneRef.current?.offsetWidth; // commit the staged styles
    const { from, next, dir } = pending.current;
    const raf = requestAnimationFrame(() => {
      pending.current = null;
      setPrep(null);
      setLeaving(from);
      setActive(next);
      setSweep(s => ({ id: s.id + 1, run: true, rev: dir < 0 }));
    });
    return () => cancelAnimationFrame(raf);
  }, [prep]);

  useEffect(() => {
    if (leaving === null) return;
    const t = setTimeout(() => setLeaving(null), LEAVE_MS);
    return () => clearTimeout(t);
  }, [leaving]);

  // Price card: fade out, swap details, fade back in
  useEffect(() => {
    if (active < 0 || active === shown) return;
    setSwapping(true);
    const t = setTimeout(() => { setShown(active); setSwapping(false); }, CARD_SWAP_MS);
    return () => clearTimeout(t);
  }, [active, shown]);

  /* ---------- Intro: once the loader splits, CSS reveals the page; then the first car wipes in ---------- */
  const revealedAt = useRef(0);
  useEffect(() => { if (revealed) revealedAt.current = performance.now(); }, [revealed]);
  useEffect(() => {
    if (!revealed || count === 0 || activeRef.current >= 0) return;
    const wait = Math.max(0, INTRO_CAR_DELAY - (performance.now() - revealedAt.current));
    const t = setTimeout(() => {
      setActive(0);
      setSweep(s => ({ id: s.id + 1, run: true, rev: false }));
    }, wait);
    return () => clearTimeout(t);
  }, [revealed, count]);

  /* ---------- Autoplay ---------- */
  useEffect(() => {
    if (paused || active < 0 || !multi) return;
    const t = setTimeout(() => go(activeRef.current + 1, 1), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [active, paused, tick, go, multi]);

  useEffect(() => {
    const onVis = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const pause = () => setPaused(true);
  const resume = () => { setPaused(false); setTick(t => t + 1); };
  const manual = (target, dir) => { go(target, dir); setTick(t => t + 1); };

  /* ---------- Parallax: the car drifts against the mouse ---------- */
  const raf = useRef();
  const onMouseMove = e => {
    // Parallax is the one effect skipped when the OS asks for reduced motion
    if (reduced || !window.matchMedia('(pointer: fine)').matches) return;
    const { clientX, clientY } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const el = sectionRef.current;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', ((clientX - r.left) / r.width - 0.5) * 2);
      el.style.setProperty('--my', ((clientY - r.top) / r.height - 0.5) * 2);
    });
  };
  const onMouseLeave = () => {
    sectionRef.current.style.setProperty('--mx', 0);
    sectionRef.current.style.setProperty('--my', 0);
  };

  /* ---------- Touch swipe ---------- */
  const touchX = useRef(null);
  const onTouchStart = e => { touchX.current = e.touches[0].clientX; pause(); };
  const onTouchEnd = e => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) go(activeRef.current + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
    touchX.current = null;
    resume();
  };

  const current = Math.max(active, 0);
  const v = slides[shown] ?? slides[0];

  return (
    <section
      id="hero"
      ref={sectionRef}
      className="hero"
      data-glow={current}
      style={{ '--autoplay': `${AUTOPLAY_MS}ms` }}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
    >
      <div className="hero__bg" aria-hidden="true">
        <div className="hero__glow" />
        <div className="hero__grid" />
      </div>

      <div className="container hero__inner" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        {/* Sri Lankan lion, behind the headline. Sits above the vehicle scene so it stays visible. */}
        <div className="hero__lion" aria-hidden="true" />
        <div className="hero__copy">
          <span className="pill cr"><Icon name="badge" size="sm" />Verified Vehicle Rentals Across Sri Lanka</span>
          <h1 className="hero__title">
            <span className="line"><span className="cr">Drive Sri Lanka.</span></span>
            <span className="line"><span className="text-red cr">Your Way.</span></span>
          </h1>
          <p className="hero__sub cr">
            Find verified cars, SUVs, vans and premium vehicles from trusted owners across the island.
            Clear pricing. Secure booking. No hidden surprises.
          </p>
          <div className="hero__ctas">
            <a href="/vehicles" className="btn btn--red btn--lg cr">Browse Vehicles <Icon name="arrow" /></a>
            <a href="#how" className="btn btn--ghost btn--lg cr">How It Works</a>
          </div>
          <ul className="trust">
            <li className="cr"><span className="trust__ic"><Icon name="shield" /></span>Verified Vehicles</li>
            <li className="cr"><span className="trust__ic"><Icon name="lock" /></span>Secure Booking</li>
            <li className="cr"><span className="trust__ic"><Icon name="map" /></span>Islandwide Coverage</li>
          </ul>
        </div>

        {/* Full-bleed featured vehicle scenes */}
        <div className="hero__scene" ref={sceneRef}>
          {slides.map((slide, i) => (
            <Slide
              key={slide.id}
              slide={slide}
              index={i}
              isActive={i === active}
              isLeaving={i === leaving}
              isPrep={i === prep}
              vars={slideVars[i]}
            />
          ))}
          <div
            key={sweep.id}
            className={`hero__sweep${sweep.run ? ' run' : ''}${sweep.rev ? ' rev' : ''}`}
            aria-hidden="true"
          />
          <div className="hero__shade" aria-hidden="true" />
        </div>

        <div
          className="showcase"
          aria-roledescription="carousel"
          aria-label="Featured vehicles"
          onMouseEnter={pause}
          onMouseLeave={resume}
          onFocus={pause}
          onBlur={resume}
          onKeyDown={e => {
            if (e.key === 'ArrowRight') manual(current + 1, 1);
            if (e.key === 'ArrowLeft') manual(current - 1, -1);
          }}
        >
          <div className="showcase__stage">
            <div className="support-badge cr" aria-hidden="true"><strong>24/7</strong><span>Support</span></div>

            {v && !art && (
            <article className={`vcard glass cr${swapping ? ' is-swapping' : ''}`} aria-live="polite">
              <div className="vcard__top">
                <span className="vcard__tag">{v.tag}</span>
                {v.rating && <span className="vcard__rating"><Icon name="star" size="sm" /><span>{v.rating}</span></span>}
              </div>
              <h3 className="vcard__name">{v.name}</h3>
              <p className="vcard__meta">{v.meta}</p>
              <div className="vcard__price">
                <small>From</small>
                <strong><Price lkr={v.price} /></strong><span className="per">/ day</span>
              </div>
              <div className="vcard__btns">
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => openVehicle(v.id)}>View Vehicle</button>
                <a href={`/book?v=${encodeURIComponent(v.id)}`} className="btn btn--red btn--sm">Book Now</a>
              </div>
            </article>
            )}
          </div>

          {multi && (
          <div className="showcase__controls cr">
            <button className="round-btn" aria-label="Previous vehicle" onClick={() => manual(current - 1, -1)}>
              <Icon name="left" />
            </button>
            <div className={`dots${paused ? ' is-paused' : ''}`} role="tablist" aria-label="Choose featured vehicle">
              {slides.map((s, i) => (
                <button
                  key={s.id}
                  className={`dot${i === current ? ' is-active' : ''}`}
                  role="tab"
                  aria-selected={i === current}
                  aria-label={s.name}
                  onClick={() => manual(i)}
                >
                  {i === current && <span key={`${tick}-${active}`} className="dot__fill" />}
                </button>
              ))}
            </div>
            <button className="round-btn" aria-label="Next vehicle" onClick={() => manual(current + 1, 1)}>
              <Icon name="right" />
            </button>
            <span className="showcase__count"><b>{pad(current)}</b> / {pad(count - 1)}</span>
          </div>
          )}
        </div>
      </div>

      <SearchPanel />
    </section>
  );
}
