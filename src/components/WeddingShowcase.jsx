import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/*
 * The wedding cars on show: a row of arches, the chosen car large in the middle.
 * Swipe, use the arrows or tap a side arch. It moves on by itself until someone takes over.
 */
const AUTO_MS = 5000;
const SWIPE_PX = 40;

// Fixed so petals don't jump on every re-render: [left %, size px, seconds, delay s, drift px]
const PETALS = [
  [4, 11, 13, 0, 50], [12, 8, 16, 5, -40], [21, 13, 12, 9, 60], [30, 9, 17, 2, -30], [39, 7, 14, 11, 40], [48, 12, 15, 6, -50],
  [57, 8, 13, 1, 30], [66, 11, 18, 8, -60], [75, 9, 14, 4, 50], [84, 13, 16, 10, -40], [92, 8, 12, 3, 30], [97, 10, 17, 7, -30],
];

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function WeddingShowcase({ cars, pickedId, onPick }) {
  const [active, setActive] = useState(0);
  const [auto, setAuto] = useState(() => !reducedMotion());
  const [held, setHeld] = useState(false);          // pointer or keyboard focus is on the display
  const dragFrom = useRef(null);
  const n = cars.length;
  const car = cars[Math.min(active, n - 1)];
  const spot = Math.min(active, n - 1);

  const go = (i) => setActive(((i % n) + n) % n);
  const take = (i) => { setAuto(false); go(i); };   // the visitor is in charge from now on

  useEffect(() => {
    if (!auto || held || n < 2) return undefined;
    const t = setInterval(() => { if (!document.hidden) setActive((a) => (a + 1) % n); }, AUTO_MS);
    return () => clearInterval(t);
  }, [auto, held, n]);

  const onPointerDown = (e) => { dragFrom.current = e.clientX; };
  const onPointerUp = (e) => {
    if (dragFrom.current == null) return;
    const dx = e.clientX - dragFrom.current;
    dragFrom.current = null;
    if (Math.abs(dx) >= SWIPE_PX && n > 1) take(spot + (dx < 0 ? 1 : -1));
  };
  const onKeyDown = (e) => {
    if (n < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); take(spot + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); take(spot - 1); }
  };

  return (
    <div className="wed-show" role="group" aria-roledescription="carousel" aria-label="Wedding cars" onKeyDown={onKeyDown}
         onMouseEnter={() => setHeld(true)} onMouseLeave={() => setHeld(false)}
         onFocus={() => setHeld(true)} onBlur={() => setHeld(false)}>
      <div className="wed-petals" aria-hidden="true">
        {PETALS.map(([left, size, secs, delay, drift]) => (
          <i key={left} style={{ left: `${left}%`, width: size, height: size * 1.3, animationDuration: `${secs}s`, animationDelay: `-${delay}s`, '--drift': `${drift}px` }} />
        ))}
      </div>

      <div className="wed-stage" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { dragFrom.current = null; }}>
        {cars.map((v, i) => {
          // the shortest way round, so the row loops without an end
          let off = i - spot;
          if (off > n / 2) off -= n;
          if (off < -n / 2) off += n;
          const far = Math.abs(off) > 2;
          return (
            <button key={v.id} type="button" className={`wed-arch${off === 0 ? ' is-centre' : ''}${far ? ' is-far' : ''}`}
                    style={{ '--off': off, '--abs': Math.abs(off), zIndex: 10 - Math.abs(off) }}
                    tabIndex={off === 0 || far ? -1 : 0} aria-hidden={off === 0 || far}
                    aria-label={`Show the ${v.name}`} onClick={() => { if (off !== 0) take(i); }}>
              <span className={`wed-arch__pic${v.img && v.img === v.cutoutImg ? ' is-cutout' : ''}`}>
                {v.img ? <img src={v.img} alt="" draggable="false" /> : <Icon name="car" />}
              </span>
            </button>
          );
        })}
        <div className="wed-floor" aria-hidden="true" />
      </div>

      <div className="wed-cap" key={car.id} aria-live={auto ? 'off' : 'polite'}>
        <p className="wed-cap__no">{String(spot + 1).padStart(2, '0')}<span> / {String(n).padStart(2, '0')}</span></p>
        <h3>{car.name}</h3>
        <ul>
          {car.year && <li><Icon name="calendar" size="sm" />{car.year}</li>}
          <li><Icon name="seat" size="sm" />{car.seats} seats</li>
          <li><Icon name="gear" size="sm" />{car.transmission}</li>
        </ul>
        <button type="button" className={`btn ${pickedId === car.id ? 'btn--red' : 'btn--white'}`} onClick={() => onPick(car.id)}>
          {pickedId === car.id ? <><Icon name="check" size="sm" />Selected — continue</> : <>Ask about this car <Icon name="arrow" size="sm" /></>}
        </button>
      </div>

      {n > 1 && (
        <div className="wed-nav">
          <button type="button" aria-label="Previous car" onClick={() => take(spot - 1)}><Icon name="left" size="sm" /></button>
          <div className="wed-nav__dots">
            {cars.map((v, i) => (
              <button key={v.id} type="button" className={i === spot ? 'is-on' : ''} aria-label={v.name} aria-current={i === spot || undefined} onClick={() => take(i)} />
            ))}
          </div>
          <button type="button" aria-label="Next car" onClick={() => take(spot + 1)}><Icon name="right" size="sm" /></button>
        </div>
      )}
    </div>
  );
}
