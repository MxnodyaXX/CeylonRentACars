import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './Icon';
import { Price } from '../context/AppContext';

/*
 * The wedding cars as a showroom: one car at a time on a lit floor, its name large at the top
 * left with its details under it. Changing car slides the old one out and the new one in
 * (600 ms) while the name and details swap in step. Arrows, the dots, the "Next" preview at the
 * right edge, the ← → keys and swiping on a phone all change car.
 * Images: the admin's cut-out (trimmed / flipped as set in Website → Wedding cars → Place on stage),
 * else a photo with its edges faded.
 */
const SLIDE_MS = 600;
const SWAP_MS = 210;       // the name and details change part-way through the slide
const SWIPE_PX = 40;

const pad = (i) => String(i + 1).padStart(2, '0');

/*
 * The car's picture, with the trim and flip saved in the admin. `shine` (a number that changes on
 * every arrival) adds a band of light running over the bodywork, cut to the car's own shape.
 */
function CarPic({ car, className = '', shine }) {
  // no cut-out: a wedding photo of the decorated car, else the car's own photo
  const src = car.cutoutImg || car.wedding?.photos?.[0] || car.img;
  if (!src) return <span className={`wsr-pic wsr-pic--none ${className}`}><Icon name="car" /></span>;
  if (!car.cutoutImg) return <img className={`wsr-pic is-photo ${className}`} src={src} alt="" draggable="false" />;
  const mask = { '--src': `url("${src}")` };
  const st = car.stage;
  const c = st?.crop;
  const trimmed = c && (c.t || c.r || c.b || c.l);
  if (!trimmed && !st?.flip) {
    return (
      <>
        <img className={`wsr-pic ${className}`} src={src} alt="" draggable="false" />
        {shine != null && <span key={shine} className="wsr-shine" style={mask} />}
      </>
    );
  }
  const cw = 1 - (c?.l ?? 0) - (c?.r ?? 0);
  const ch = 1 - (c?.t ?? 0) - (c?.b ?? 0);
  const geo = { left: `${(-(c?.l ?? 0) / cw) * 100}%`, top: `${(-(c?.t ?? 0) / ch) * 100}%`, width: `${100 / cw}%`, height: `${100 / ch}%` };
  return (
    <span className={`wsr-pic wsr-pic--crop ${className}`} style={{ '--ar': (st.aspect * cw) / Math.max(0.01, ch) }}>
      <span style={st.flip ? { transform: 'scaleX(-1)' } : undefined}>
        <img src={src} alt="" draggable="false" style={geo} />
        {shine != null && <span key={shine} className="wsr-shine wsr-shine--fill" style={{ ...geo, ...mask }} />}
      </span>
    </span>
  );
}

/* the decorated car's wedding photos, full screen: ← → to move, Esc to close */
function PhotoViewer({ name, photos, start, onClose }) {
  const [i, setI] = useState(start);
  const n = photos.length;
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') setI((x) => (x + 1) % n);
      if (e.key === 'ArrowLeft') setI((x) => (x - 1 + n) % n);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [n, onClose]);
  return (
    <div className="wsr-viewer" role="dialog" aria-modal="true" aria-label={`${name} — wedding photos`} onClick={onClose}>
      <div className="wsr-viewer__top" onClick={(e) => e.stopPropagation()}>
        <span><b>{name}</b> · {i + 1} / {n}</span>
        <button ref={closeRef} type="button" onClick={onClose} aria-label="Close photos"><Icon name="x" /></button>
      </div>
      <img key={photos[i]} className="wsr-viewer__img" src={photos[i]} alt={`${name}, wedding photo ${i + 1} of ${n}`} onClick={(e) => e.stopPropagation()} />
      {n > 1 && (
        <>
          <button type="button" className="wsr-viewer__nav is-prev" aria-label="Previous photo" onClick={(e) => { e.stopPropagation(); setI((x) => (x - 1 + n) % n); }}><Icon name="left" /></button>
          <button type="button" className="wsr-viewer__nav is-next" aria-label="Next photo" onClick={(e) => { e.stopPropagation(); setI((x) => (x + 1) % n); }}><Icon name="right" /></button>
          <div className="wsr-viewer__thumbs" onClick={(e) => e.stopPropagation()}>
            {photos.map((p, k) => (
              <button key={p} type="button" className={k === i ? 'is-active' : ''} aria-label={`Photo ${k + 1}`} onClick={() => setI(k)}>
                <img src={p} alt="" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* the name rises in letter by letter (read out whole) */
function Letters({ text }) {
  let i = 0;
  return (
    <span aria-hidden="true">
      {text.split(' ').map((word, w) => (
        <span key={w}>
          {w > 0 && ' '}
          <span className="wsr-word">
            {[...word].map((ch, c) => <span key={c} className="wsr-char" style={{ '--i': i++ }}>{ch}</span>)}
          </span>
        </span>
      ))}
    </span>
  );
}

export default function WeddingShowcase({ cars, pickedId, onPick }) {
  const n = cars.length;
  // idx: the car on the floor; from: the one sliding out; phase: idle → start (placed) → run (sliding)
  const [view, setView] = useState({ idx: 0, from: null, dir: 'next', phase: 'idle' });
  const [meta, setMeta] = useState({ idx: 0, phase: 'center' });
  const [announce, setAnnounce] = useState(false);
  const [land, setLand] = useState(0);           // goes up each time a car arrives: replays the light sweep and floor ripple
  const [moves, setMoves] = useState(0);         // goes up each time a slide starts: replays the floor streak
  const [viewer, setViewer] = useState(null);    // the wedding photos open full screen: { car, start }
  const closeViewer = useCallback(() => setViewer(null), []);
  const busy = useRef(false);
  const timers = useRef([]);
  const swipe = useRef(null);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => timers.current.push(setTimeout(fn, ms));

  const go = (target, dir) => {
    if (n < 2 || busy.current) return;
    const t = ((target % n) + n) % n;
    if (t === view.idx) return;
    setAnnounce(true);
    // (always animated, even with the device's "reduce motion" on — Windows turns that on when
    // Animation effects is off, and the owner wants the cars to move)
    busy.current = true;
    setView({ idx: t, from: view.idx, dir, phase: 'start' });
    setMoves((x) => x + 1);
    setMeta((m) => ({ ...m, phase: dir === 'next' ? 'exit-up' : 'exit-down' }));
    later(() => setMeta({ idx: t, phase: dir === 'next' ? 'enter-below' : 'enter-above' }), SWAP_MS);
    later(() => setLand((x) => x + 1), SLIDE_MS - 140);   // the light lands just as the car settles
    later(() => { setView((v) => ({ ...v, from: null, phase: 'idle' })); busy.current = false; }, SLIDE_MS + 20);
  };
  const step = (dir) => go(view.idx + (dir === 'next' ? 1 : -1), dir);

  // the new car is placed off to the side first, then both cars slide on the next frame
  useLayoutEffect(() => {
    if (view.phase !== 'start') return undefined;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setView((v) => (v.phase === 'start' ? { ...v, phase: 'run' } : v))); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [view.phase]);
  // the same for the name and details
  useLayoutEffect(() => {
    if (meta.phase !== 'enter-below' && meta.phase !== 'enter-above') return undefined;
    let r2 = 0;
    const r1 = requestAnimationFrame(() => { r2 = requestAnimationFrame(() => setMeta((m) => ({ ...m, phase: 'center' }))); });
    return () => { cancelAnimationFrame(r1); cancelAnimationFrame(r2); };
  }, [meta.phase]);

  // keep the list in range if the cars change
  useEffect(() => {
    if (view.idx >= n) { setView({ idx: 0, from: null, dir: 'next', phase: 'idle' }); setMeta({ idx: 0, phase: 'center' }); }
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e) => {
    if (viewer || e.target.closest('input, textarea, select')) return;   // (the photo viewer has its own keys)
    if (e.key === 'ArrowRight') { e.preventDefault(); step('next'); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); step('prev'); }
  };

  // swiping across the car changes it (vertical scrolling still works: touch-action pan-y)
  const onPointerDown = (e) => { if (e.pointerType !== 'mouse') swipe.current = { x: e.clientX, y: e.clientY }; };
  const onPointerUp = (e) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(e.clientY - s.y)) step(dx < 0 ? 'next' : 'prev');
  };

  const car = cars[Math.min(meta.idx, n - 1)];
  const next = cars[(view.idx + 1) % n];
  const enterCls = view.dir === 'next' ? 'is-enter-right' : 'is-enter-left';
  const exitCls = view.dir === 'next' ? 'is-exit-left' : 'is-exit-right';
  const run = view.phase === 'run';
  const picked = pickedId === car.id;
  const specs = [car.transmission, car.fuel !== '—' && car.fuel, `${car.seats} seats`, 'Driver included'].filter(Boolean);
  // the car's wedding hire terms from the admin (not set yet = decoration available, as before)
  const wed = car.wedding ?? {};
  const deco = { included: 'Decoration included', extra: 'Decoration on request', none: null }[wed.decoration] ?? (wed.decoration ? null : 'Decoration available');

  const pics = wed.photos ?? [];
  const askBtn = (extra = '') => (
    <div className={`wsr-btns ${extra}`}>
      {pics.length > 0 && (
        <button type="button" className="btn btn--dark" onClick={() => setViewer({ car, start: 0 })}>
          <Icon name="spark" size="sm" />Photos ({pics.length})
        </button>
      )}
      <button type="button" className={`btn ${picked ? 'btn--red' : 'btn--white'}`} onClick={() => onPick(car.id)}>
        {picked ? <><Icon name="check" size="sm" />Selected — continue</> : <>Ask about this car <Icon name="arrow" size="sm" /></>}
      </button>
    </div>
  );

  return (
    <div className="wsr" role="group" aria-roledescription="carousel" aria-label="Wedding cars" onKeyDown={onKeyDown}>
      {/* the car's name and details, top left; the main action top right */}
      <div className="wsr-head">
        <div className={`wsr-meta is-${meta.phase}`} aria-live={announce ? 'polite' : 'off'}>
          <div className="wsr-badges">
            <span className="wsr-badge wsr-badge--red">{car.catLabel || 'Wedding car'}</span>
            {car.year && <span className="wsr-badge">{car.year}</span>}
            {deco && <span className="wsr-badge wsr-badge--ok"><Icon name="check" size="sm" />{deco}</span>}
          </div>
          <h3 className="wsr-name" aria-label={car.name}><Letters key={car.id} text={car.name} /></h3>
          <p className="wsr-specs">{specs.join(' • ')}</p>
          {(wed.price || wed.highlights) && (
            <p className="wsr-extra">
              {wed.price > 0 && (
                <span className="wsr-price"><small>From</small><Price lkr={wed.price} as="strong" />{wed.hours ? <span>/ {wed.hours} hours</span> : null}</span>
              )}
              {wed.highlights && <span className="wsr-hl"><Icon name="spark" size="sm" />{wed.highlights}</span>}
            </p>
          )}
        </div>
        <div className="wsr-actions">{askBtn()}</div>
      </div>

      <div className={`wsr-stage${run ? ' is-moving' : ''}`} tabIndex={0} aria-label={`${car.name}, car ${meta.idx + 1} of ${n}. Use the arrow keys to change car.`}
           onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null; }}>
        <div key={view.idx} className={`wsr-watermark is-${view.dir}`} aria-hidden="true">Wedding {pad(view.idx)}</div>

        {/* the floor: soft light and shadow under the tyres, and the curved line */}
        <div className="wsr-floor" aria-hidden="true">
          <span className="wsr-floor__glow" />
          <span className="wsr-floor__shadow" />
          {land > 0 && <span key={`r${land}`} className="wsr-floor__ring"><i /><i /></span>}
          {moves > 0 && <span key={`s${moves}`} className={`wsr-floor__streak is-${view.dir}`} />}
          <svg viewBox="0 0 1000 110" preserveAspectRatio="none" fill="none">
            <defs>
              <linearGradient id="wsrArc" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#fff" stopOpacity="0" />
                <stop offset="18%" stopColor="#fff" stopOpacity=".22" />
                <stop offset="50%" stopColor="#ff3341" stopOpacity=".95" />
                <stop offset="82%" stopColor="#fff" stopOpacity=".22" />
                <stop offset="100%" stopColor="#fff" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d="M 45 28 C 210 -8, 790 -8, 955 28" stroke="#fff" strokeOpacity=".1" strokeWidth="1" strokeDasharray="4 6" vectorEffect="non-scaling-stroke" />
            <path d="M 15 36 C 180 96, 820 96, 985 36" stroke="url(#wsrArc)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
          </svg>
        </div>

        {/* the cars: the one sliding out and the one sliding in */}
        <div className="wsr-slot">
          {view.from != null && cars[view.from] && (
            <div key={cars[view.from].id} className={`wsr-car ${run ? `${exitCls} is-anim` : 'is-center'}`} aria-hidden="true">
              <CarPic car={cars[view.from]} />
            </div>
          )}
          {cars[view.idx] && (
            <div key={cars[view.idx].id} className={`wsr-car ${view.phase === 'start' ? enterCls : 'is-center'}${run ? ' is-anim' : ''}`}>
              <CarPic car={cars[view.idx]} shine={land > 0 ? land : undefined} />
            </div>
          )}
        </div>

        {n > 1 && (
          <>
            {/* the next car peeking in at the right edge (large screens) */}
            <button type="button" className="wsr-peek" onClick={() => step('next')} aria-label={`Next car: ${next.name}`}>
              <span className="wsr-peek__tag"><em>Next</em>{next.name}<Icon name="right" size="sm" /></span>
              <span className="wsr-peek__img"><CarPic car={next} /></span>
            </button>
            <button type="button" className="wsr-arrow wsr-arrow--prev" onClick={() => step('prev')} aria-label="Previous car"><Icon name="left" /></button>
            <button type="button" className="wsr-arrow wsr-arrow--next" onClick={() => step('next')} aria-label="Next car"><Icon name="right" /></button>
          </>
        )}
      </div>

      {n > 1 && (
        <div className="wsr-controls">
          <div className="wsr-bar">
            <button type="button" onClick={() => step('prev')} aria-label="Previous car"><Icon name="left" size="sm" /><span>Prev</span></button>
            <div className="wsr-bar__mid">
              <span className="wsr-count">{pad(view.idx)} / {String(n).padStart(2, '0')}</span>
              <div className="wsr-dots">
                {cars.map((c, i) => (
                  <button key={c.id} type="button" className={i === view.idx ? 'is-active' : ''} aria-label={`Show ${c.name}`} aria-current={i === view.idx}
                          onClick={() => go(i, i > view.idx ? 'next' : 'prev')} />
                ))}
              </div>
            </div>
            <button type="button" onClick={() => step('next')} aria-label="Next car"><span>Next</span><Icon name="right" size="sm" /></button>
          </div>
          <p className="wsr-hint wsr-hint--touch">Swipe left or right on the car to see the next one</p>
          <p className="wsr-hint wsr-hint--keys"><kbd>←</kbd><kbd>→</kbd> Use the arrow keys, the arrows or the preview on the right</p>
        </div>
      )}
      <div className="wsr-mobile-actions">{askBtn('is-block')}</div>
      {viewer && createPortal(
        <PhotoViewer name={viewer.car.name} photos={viewer.car.wedding.photos} start={viewer.start} onClose={closeViewer} />,
        document.body,
      )}
    </div>
  );
}
