import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from './Icon';

/*
 * The wedding cars on a revolving stage: the stage picture (public/img/WeddingCarsBG) with the
 * front car standing on its podium and the others waiting round it in the dark, always facing
 * the visitor. Just the car (the admin's cut-out image), no frame. It turns to the next car on
 * its own; drag it to spin it yourself, or tap a car at the side to bring it round. Positions are
 * set straight on the elements every frame, so spinning never re-renders React (only the caption
 * does, when the front car changes).
 */
// Where the podium's top is in the stage picture (1672 × 941), as fractions of its width / height
const PODIUM = { x: 0.5, y: 0.815, width: 0.6, floor: 0.06 };   // floor: how far below the podium top the floor is
const HOLD_MS = 3200;      // how long each car stays at the front
const TURN_MS = 1500;      // turning to the next car
const IDLE_MS = 9000;      // after the visitor stops, start turning again
const TAP_PX = 6;
const CURTAIN_MS = 2600;   // the curtains opening (matches the CSS)

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function WeddingShowcase({ cars, pickedId, onPick }) {
  const n = cars.length;
  const step = 360 / Math.max(n, 1);
  const [front, setFront] = useState(0);
  const [userLed, setUserLed] = useState(false);       // captions are announced once the visitor is turning it
  // the curtains: closed until the stage scrolls into view, then they sweep open once
  // (with "reduce motion" on — e.g. Windows' Animation effects off — they gently fade instead)
  const [curtain, setCurtain] = useState('closed');
  const stageRef = useRef(null);
  const frameRef = useRef(null);
  const cardRefs = useRef([]);
  const landRef = useRef(null);
  const m = useRef({ angle: 0, mode: 'hold', since: 0, from: 0, to: 0, dur: 0, size: { w: 300, r: 240, drop: 0 }, drag: null, lastUser: -Infinity, frontIdx: 0, visible: true, still: false, curtainUp: curtain === 'gone', last: { angle: 0, at: 0 } });

  // a car arrives on the podium: light sweeps over it, a ring ripples out, a flare streaks across
  const land = () => {
    const s = m.current;
    if (s.still) return;
    // (classes go on elements whose className React never changes, so a re-render can't cut them short)
    for (const el of [cardRefs.current[s.frontIdx]?.querySelector('.wed-car__shine'), landRef.current]) {
      if (!el) continue;
      el.classList.remove('is-landing');
      void el.offsetWidth;                                  // restart the CSS animations
      el.classList.add('is-landing');
    }
  };

  // where every car stands for one angle of the turntable
  const place = () => {
    const s = m.current;
    const { r, drop } = s.size;
    // motion blur from how fast it is turning (degrees per frame at 60 fps)
    const now = performance.now();
    const speed = s.last.at ? Math.abs(s.angle - s.last.angle) / Math.max(1, (now - s.last.at) / 16.7) : 0;
    s.last = { angle: s.angle, at: now };
    if (frameRef.current) frameRef.current.style.setProperty('--speed', s.still ? '0' : Math.min(1, speed / 4).toFixed(2));
    for (let i = 0; i < n; i++) {
      const el = cardRefs.current[i];
      if (!el) continue;
      const phi = ((s.angle + i * step) * Math.PI) / 180;
      const depth = (Math.cos(phi) + 1) / 2;                // 1 at the front, 0 at the back
      el.style.transform = `translate3d(${(r * Math.sin(phi)).toFixed(1)}px, ${(drop * Math.sin(phi) ** 2).toFixed(1)}px, ${(r * Math.cos(phi)).toFixed(1)}px)`;
      el.style.setProperty('--depth', depth.toFixed(3));
    }
    const idx = ((Math.round(-s.angle / step) % n) + n) % n;
    if (idx !== s.frontIdx) { s.frontIdx = idx; setFront(idx); }
  };

  const turnTo = (target, dur, now = performance.now()) => {
    const s = m.current;
    Object.assign(s, { mode: 'turn', from: s.angle, to: target, dur: s.still ? 1 : dur, since: now });
  };

  // shortest way round to car i
  const bringRound = (i) => {
    const s = m.current;
    let delta = ((-i * step - s.angle) % 360 + 540) % 360 - 180;
    if (Math.abs(delta) < 0.01) delta = 0;
    s.lastUser = performance.now();
    setUserLed(true);
    turnTo(s.angle + delta, 700 + Math.abs(delta) * 6);
  };

  // size from the stage picture: the front car about fills the podium, the side cars stand just off it
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    const measure = () => {
      const fw = frame.clientWidth;
      const w = Math.round(fw * PODIUM.width * 0.62);
      const sideX = fw * PODIUM.width * (n <= 2 ? 0.5 : 0.66);
      const r = n < 2 ? 0 : n === 2 ? sideX : Math.min(fw * 0.6, sideX / Math.sin(Math.min(Math.PI / 2, (2 * Math.PI) / n)));
      m.current.size = { w, r, drop: fw * (941 / 1672) * PODIUM.floor };
      frame.style.setProperty('--car-w', `${w}px`);
      frame.style.setProperty('--ring-r', `${Math.round(r)}px`);
      place();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  // the motor: hold, turn, hold … paused off-screen, in a hidden tab, or for reduced motion
  useEffect(() => {
    const s = m.current;
    s.still = reducedMotion();
    s.since = performance.now();
    let raf = 0;
    const tick = (now) => {
      raf = 0;
      if (s.mode === 'turn') {
        const t = Math.min(1, (now - s.since) / s.dur);
        s.angle = s.from + (s.to - s.from) * (s.dur > 900 ? ease(t) : easeOut(t));
        const done = t >= 1;
        if (done) { s.angle = s.to; s.mode = 'hold'; s.since = now; }
        place();
        if (done) { s.last.at = 0; frameRef.current?.style.setProperty('--speed', '0'); land(); }
      } else if (s.mode === 'hold' && s.curtainUp && !s.still && n > 1 && now - s.lastUser > IDLE_MS && now - s.since > HOLD_MS && !document.hidden) {
        const snapped = Math.round(s.angle / step) * step;
        turnTo(snapped - step, TURN_MS, now);
      }
      if (s.visible) raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([e]) => {
      s.visible = e.isIntersecting;
      if (s.visible && !raf) raf = requestAnimationFrame(tick);
    });
    if (stageRef.current) io.observe(stageRef.current);
    raf = requestAnimationFrame(tick);
    return () => { io.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }, [n]); // eslint-disable-line react-hooks/exhaustive-deps

  // open the curtains when most of the stage is on screen; the stage starts turning once they're open
  useEffect(() => {
    if (curtain !== 'closed') return undefined;
    const stage = stageRef.current;
    let timer = 0;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      setCurtain('opening');
      timer = setTimeout(() => {
        setCurtain('gone');
        Object.assign(m.current, { curtainUp: true, since: performance.now() });
      }, CURTAIN_MS);
    }, { threshold: 0.55 });
    if (stage) io.observe(stage);
    return () => { io.disconnect(); clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // dragging spins it: one card width ≈ one car
  const onPointerDown = (e) => {
    if (n < 2 || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const s = m.current;
    s.drag = { x: e.clientX, angle: s.angle, moved: 0, last: [[e.clientX, e.timeStamp]], tapped: e.target.closest('[data-i]')?.dataset.i };
    s.mode = 'drag';
    stageRef.current.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const s = m.current;
    if (!s.drag) return;
    const dx = e.clientX - s.drag.x;
    s.drag.moved = Math.max(s.drag.moved, Math.abs(dx));
    s.drag.last = [...s.drag.last.slice(-4), [e.clientX, e.timeStamp]];
    s.angle = s.drag.angle + (dx / s.size.w) * step;
    place();
  };
  const onPointerUp = () => {
    const s = m.current;
    const d = s.drag;
    if (!d) return;
    s.drag = null;
    s.lastUser = performance.now();
    if (d.moved < TAP_PX) {
      s.mode = 'hold';
      if (d.tapped != null && Number(d.tapped) !== s.frontIdx) bringRound(Number(d.tapped));
      return;
    }
    setUserLed(true);
    // let it run on a little in the direction it was flicked, then settle on a car
    const [[x0, t0]] = d.last;
    const [x1, t1] = d.last[d.last.length - 1];
    const v = t1 > t0 ? ((x1 - x0) / (t1 - t0)) * (step / s.size.w) : 0;   // degrees per ms
    const target = Math.round((s.angle + v * 260) / step) * step;
    turnTo(target, 650 + Math.min(600, Math.abs(target - s.angle) * 5));
  };

  const onKeyDown = (e) => {
    if (n < 2) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); bringRound(front + 1); }
    if (e.key === 'ArrowLeft') { e.preventDefault(); bringRound(front - 1); }
  };

  const car = cars[Math.min(front, n - 1)];

  return (
    <div className="wed-show" data-curtain={curtain} role="group" aria-roledescription="carousel" aria-label="Wedding cars" onKeyDown={onKeyDown}>
      <div className="wed-stage" ref={stageRef} onPointerDown={onPointerDown} onPointerMove={onPointerMove}
           onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="wed-frame" ref={frameRef} style={{ '--podium-x': PODIUM.x, '--podium-y': PODIUM.y }}>
          <img className="wed-frame__bg" src="/img/WeddingCarsBG.jpg" alt="" draggable="false" />
          {/* drawn before the cars, so the ring and flare pass behind them */}
          <div className="wed-land" ref={landRef} aria-hidden="true"><i /><i /><b /></div>
          <div className="wed-scene">
            {cars.map((v, i) => {
              // the cut-out stands on the podium as it is; a photo with a background is faded at its edges
              const src = v.cutoutImg || v.img;
              return (
                <div key={v.id} data-i={i} ref={(el) => { cardRefs.current[i] = el; }} className={`wed-car${i === front ? ' is-front' : ''}`} aria-hidden={i !== front}>
                  {src ? <img src={src} alt="" draggable="false" className={v.cutoutImg ? '' : 'is-photo'} /> : <Icon name="car" />}
                  {/* the light sweep, cut to the car's own shape */}
                  {v.cutoutImg && <span className="wed-car__shine" style={{ '--src': `url("${v.cutoutImg}")` }} />}
                </div>
              );
            })}
          </div>
        </div>
        <div className="wed-flare" aria-hidden="true" />
      </div>

      {curtain !== 'gone' && (
        <div className="wed-curtain" aria-hidden="true">
          <i className="wed-curtain__l" />
          <i className="wed-curtain__r" />
          <b className="wed-curtain__top" />
        </div>
      )}

      {/* arrows over the stage's sides (outside the stage, so the drag handling never swallows their clicks) */}
      {n > 1 && (
        <div className="wed-nav">
          <button type="button" aria-label="Turn to the previous car" onClick={() => bringRound(front - 1)}><Icon name="left" /></button>
          <button type="button" aria-label="Turn to the next car" onClick={() => bringRound(front + 1)}><Icon name="right" /></button>
        </div>
      )}

      <div className="wed-cap" key={car.id} aria-live={userLed ? 'polite' : 'off'}>
        <p className="wed-cap__no">{String(front + 1).padStart(2, '0')}<span> / {String(n).padStart(2, '0')}</span></p>
        {/* the name rises in letter by letter (read out whole) */}
        <h3 aria-label={car.name}>
          {car.name.split(' ').map((word, w, words) => (
            <Fragment key={w}>
              {w > 0 && ' '}
              <span className="wed-word" aria-hidden="true">
                {[...word].map((ch, c) => (
                  <span key={c} className="wed-char" style={{ '--i': words.slice(0, w).join('').length + w + c }}>{ch}</span>
                ))}
              </span>
            </Fragment>
          ))}
        </h3>
        <ul>
          {car.year && <li><Icon name="calendar" size="sm" />{car.year}</li>}
          <li><Icon name="seat" size="sm" />{car.seats} seats</li>
          <li><Icon name="gear" size="sm" />{car.transmission}</li>
        </ul>
        <button type="button" className={`btn ${pickedId === car.id ? 'btn--red' : 'btn--white'}`} onClick={() => onPick(car.id)}>
          {pickedId === car.id ? <><Icon name="check" size="sm" />Selected — continue</> : <>Ask about this car <Icon name="arrow" size="sm" /></>}
        </button>
      </div>
    </div>
  );
}
