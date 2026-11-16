import { useEffect, useState } from 'react';

/*
 * Entrance for the Wedding Cars page: two champagne-silk curtains meet over a dark stage, two gold
 * rings draw themselves, then the curtains part to reveal the page. Played when the visitor arrives
 * from another page — on a first visit the site's own page loader already covers the screen.
 * A click (or any key) skips it.
 */
const OPEN_AT = 1700;   // the curtains start to part
const DONE_AT = 2650;   // the overlay is removed

export default function WeddingIntro({ onOpen }) {
  // the first-visit loader is still up → no curtain (the hero waits for the loader instead)
  const [phase, setPhase] = useState(() => (document.documentElement.classList.contains('is-loading') ? 'gone' : 'closed'));

  useEffect(() => {
    if (phase === 'gone') { onOpen?.(); return undefined; }
    const skip = () => setPhase((p) => (p === 'closed' ? 'open' : p));
    const t1 = setTimeout(() => setPhase('open'), OPEN_AT);
    window.addEventListener('keydown', skip, { once: true });
    return () => { clearTimeout(t1); window.removeEventListener('keydown', skip); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase !== 'open') return undefined;
    onOpen?.();
    const t = setTimeout(() => setPhase('gone'), DONE_AT - OPEN_AT);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  if (phase === 'gone') return null;
  return (
    <div className={`wintro${phase === 'open' ? ' is-open' : ''}`} aria-hidden="true" onClick={() => setPhase('open')}>
      <span className="wintro__curtain wintro__curtain--l" />
      <span className="wintro__curtain wintro__curtain--r" />
      <div className="wintro__mark">
        <svg viewBox="0 0 120 70" className="wintro__rings">
          <defs>
            <linearGradient id="wintro-gold" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#f6e7c1" />
              <stop offset=".5" stopColor="#d4ae6a" />
              <stop offset="1" stopColor="#9c7a3c" />
            </linearGradient>
          </defs>
          <circle cx="46" cy="38" r="24" pathLength="1" />
          <circle cx="74" cy="38" r="24" pathLength="1" />
          <path d="M60 9 l3.2 -4.5 l3.2 4.5 l-3.2 3.6 z" className="wintro__gem" />
        </svg>
        <span className="wintro__title">Wedding Cars</span>
        <span className="wintro__sub">Ceylon Rent A Cars</span>
      </div>
    </div>
  );
}

/** A few petals drifting down the hero (decoration only) */
const PETALS = Array.from({ length: 14 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  delay: -((i * 1.7) % 11),
  dur: 9 + ((i * 2.3) % 6),
  size: 9 + ((i * 5) % 9),
  sway: 18 + ((i * 7) % 26),
  tint: i % 3,
}));
export function Petals() {
  return (
    <div className="wpetals" aria-hidden="true">
      {PETALS.map((p, i) => (
        <span
          key={i}
          className={`wpetal wpetal--${p.tint}`}
          style={{ left: `${p.left}%`, width: p.size, height: p.size * 0.78, animationDelay: `${p.delay}s, ${p.delay}s`, animationDuration: `${p.dur}s, ${p.dur / 3}s`, '--sway': `${p.sway}px` }}
        />
      ))}
    </div>
  );
}
