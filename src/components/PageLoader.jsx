import { useEffect, useState } from 'react';

const LOGO = '/img/brand/logo-dark.png';
const MIN_SHOW_MS = 700;     // keep the loader up at least this long so it never just flashes
const LOGO_HOLD_MS = 1100;   // once the logo has appeared, let it be seen this long before splitting
const MAX_WAIT_MS = 4500;    // never block the page longer than this, even on a slow connection
const SEAM_MS = 450;         // seam finishes growing before the split
const SPLIT_MS = 1500;       // rows travelling off-screen (matches --split in the CSS)

const wait = ms => new Promise(r => setTimeout(r, ms));

function loadImage(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = img.onerror = resolve;
    img.src = src;
  });
}

/**
 * Full-screen intro: two horizontal rows meet at a glowing seam in the centre.
 * The logo sits on the top row, just above the seam. When the page is ready the
 * rows split apart (top goes up carrying the logo, bottom goes down), revealing
 * the site. `onReveal` fires the moment the split starts so the page can start
 * its own entrance animations in sync.
 */
export default function PageLoader({ heroReady, onReveal }) {
  const [phase, setPhase] = useState('loading'); // loading → ready → split → done
  const [logoShown, setLogoShown] = useState(false);

  useEffect(() => {
    let cancelled = false;
    document.documentElement.style.overflow = 'hidden';

    const ready = Promise.all([
      document.fonts?.ready ?? Promise.resolve(),
      Promise.resolve(heroReady).catch(() => {}), // first hero car (or fallback art) loaded
      loadImage(LOGO).then(() => wait(LOGO_HOLD_MS)),
      wait(MIN_SHOW_MS),
    ]);

    Promise.race([ready, wait(MAX_WAIT_MS)])
      .then(() => {
        if (cancelled) return;
        setPhase('ready');
        return wait(SEAM_MS);
      })
      .then(() => {
        if (cancelled) return;
        setPhase('split');
        document.documentElement.style.overflow = '';
        onReveal();
        return wait(SPLIT_MS);
      })
      .then(() => { if (!cancelled) setPhase('done'); });

    return () => {
      cancelled = true;
      document.documentElement.style.overflow = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (phase === 'done') return null;

  return (
    <div className={`loader is-${phase}`} aria-hidden="true">
      <div className="loader__row loader__row--top">
        {/* Rides away with the top row when the rows split */}
        <div className={`loader__brand${logoShown ? ' is-shown' : ''}`}>
          <img src={LOGO} alt="" onLoad={() => setLogoShown(true)} />
        </div>
      </div>
      <div className="loader__row loader__row--bottom" />
      <div className="loader__seam" />
    </div>
  );
}
