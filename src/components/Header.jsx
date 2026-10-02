import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { NAV_LINKS } from '../data/site';
import { CURRENCIES, useApp } from '../context/AppContext';
import { useActiveSection } from '../hooks/useMotion';

const SECTION_IDS = ['hero', 'vehicles', 'how', 'why', 'deals', 'faq'];

/* Company logo. Dark-background versions are generated from public/img/CeylonRentACarsLogo.png:
   - "lockup": emblem + wordmark side by side (readable at header size)
   - "full":   the complete stacked logo (footer, loader) */
export function Logo({ variant = 'lockup', href = '#top', className = '' }) {
  return (
    <a href={href} className={`logo logo--${variant} ${className}`.trim()} aria-label="Ceylon Rent A Cars home">
      {variant === 'full' ? (
        <img src="/img/brand/logo-dark.png" alt="Ceylon Rent A Cars" className="logo__full" />
      ) : (
        <>
          <img src="/img/brand/emblem-dark.png" alt="" className="logo__emblem" />
          <img src="/img/brand/wordmark-dark.png" alt="Ceylon Rent A Cars" className="logo__wordmark" />
        </>
      )}
    </a>
  );
}

export function CurrencySelect({ long = false, className = '' }) {
  const { currency, setCurrency } = useApp();
  return (
    <label className={`currency ${className}`.trim()} title="Display currency">
      <Icon name="globe" />
      <select value={currency} onChange={e => setCurrency(e.target.value)} aria-label="Currency">
        {CURRENCIES.map(c => (
          <option key={c.code} value={c.code}>{long ? `${c.code} — ${c.name}` : c.code}</option>
        ))}
      </select>
      <Icon name="down" size="sm" />
    </label>
  );
}

export default function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const activeId = useActiveSection(SECTION_IDS);
  const activeHref = activeId === 'hero' ? '#top' : `#${activeId}`;

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = drawerOpen ? 'hidden' : '';
    const onKey = e => { if (e.key === 'Escape') setDrawerOpen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  return (
    <>
      <header className={`header${scrolled ? ' is-scrolled' : ''}`} id="top">
        <div className="container header__inner">
          <Logo />

          <nav className="nav" aria-label="Primary">
            {NAV_LINKS.map(l => (
              <a key={l.href} href={l.href} className={l.href === activeHref ? 'is-active' : undefined}>{l.label}</a>
            ))}
          </nav>

          <div className="header__actions">
            <CurrencySelect />
            <a href="#" className="btn btn--ghost btn--sm hide-sm">Sign In</a>
            <a href="#" className="btn btn--red btn--sm hide-md">List Your Vehicle</a>
            <button
              className="burger"
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              aria-controls="drawer"
              onClick={() => setDrawerOpen(true)}
            >
              <Icon name="menu" />
            </button>
          </div>
        </div>
      </header>

      <div
        className={`drawer${drawerOpen ? ' is-open' : ''}`}
        id="drawer"
        aria-hidden={!drawerOpen}
        onClick={e => { if (e.target === e.currentTarget || e.target.closest('a')) setDrawerOpen(false); }}
      >
        <div className="drawer__panel">
          <div className="drawer__head">
            <Logo />
            <button className="icon-btn" aria-label="Close menu" onClick={() => setDrawerOpen(false)}>
              <Icon name="x" />
            </button>
          </div>
          <nav className="drawer__nav">
            {NAV_LINKS.map(l => <a key={l.href} href={l.href}>{l.label}</a>)}
          </nav>
          <div className="drawer__foot">
            <a href="#" className="btn btn--ghost btn--block">Sign In</a>
            <a href="#" className="btn btn--red btn--block">List Your Vehicle</a>
          </div>
        </div>
      </div>
    </>
  );
}
