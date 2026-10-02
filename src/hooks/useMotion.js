import { useEffect, useState } from 'react';

/** True when the visitor has asked the OS for reduced motion. */
export function useReducedMotion() {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Fades/slides in every [data-reveal] element as it scrolls into view.
 * Siblings are staggered automatically. Waits until `enabled` (the page loader has opened).
 * Elements rendered later (e.g. vehicles fetched from the admin database) are picked up too.
 */
export function useScrollReveal(enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    // Reveals still run with reduced motion; CSS just drops the sliding for those visitors
    if (!('IntersectionObserver' in window)) {
      document.querySelectorAll('[data-reveal]').forEach(el => el.classList.add('is-in'));
      return;
    }
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) {
          e.target.classList.add('is-in');
          obs.unobserve(e.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    const watch = els => els.forEach(el => {
      if (el.classList.contains('is-in')) return;
      const sibs = [...el.parentElement.children].filter(c => c.hasAttribute('data-reveal'));
      const i = sibs.indexOf(el);
      if (i > 0) el.style.setProperty('--d', `${Math.min(i, 6) * 0.07}s`);
      obs.observe(el);
    });
    watch([...document.querySelectorAll('[data-reveal]')]);

    const mo = new MutationObserver(records => {
      const added = [];
      records.forEach(r => r.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.hasAttribute('data-reveal')) added.push(n);
        added.push(...n.querySelectorAll('[data-reveal]'));
      }));
      if (added.length) watch(added);
    });
    mo.observe(document.body, { childList: true, subtree: true });

    return () => { obs.disconnect(); mo.disconnect(); };
  }, [enabled]);
}

/** Id of the section currently in the middle of the viewport (for nav highlighting). */
export function useActiveSection(ids) {
  const [active, setActive] = useState(ids[0]);
  useEffect(() => {
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setActive(e.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ids.map(id => document.getElementById(id)).filter(Boolean).forEach(el => obs.observe(el));
    return () => obs.disconnect();
  }, [ids]);
  return active;
}
