import { useEffect, useState } from 'react';

/*
 * Minimal client-side router (no dependency): the home page lives at "/" and the
 * fleet catalog at "/vehicles". Any internal <a href="/..."> navigates without a
 * reload, and in-page anchors like "#how" keep working from other pages by
 * returning home first and then scrolling to the section.
 */
const EVENT = 'app:navigate';

const current = () => ({ path: window.location.pathname.replace(/\/+$/, '') || '/', search: window.location.search });

function scrollToHash(hash) {
  if (!hash) { window.scrollTo({ top: 0 }); return; }
  // Wait for the new page to render before looking for the section
  let tries = 0;
  const find = () => {
    const el = document.getElementById(hash.slice(1));
    if (el) el.scrollIntoView({ behavior: 'smooth' });
    else if (tries++ < 20) setTimeout(find, 50);
  };
  find();
}

export function navigate(to) {
  const url = new URL(to, window.location.href);
  const samePage = url.pathname === window.location.pathname && url.search === window.location.search;
  if (samePage && url.hash) {
    history.replaceState(null, '', url.hash);
    scrollToHash(url.hash);
    return;
  }
  history.pushState(null, '', url.pathname + url.search + url.hash);
  window.dispatchEvent(new Event(EVENT));
  scrollToHash(url.hash);
}

/** Current { path, search }, updated on navigation and back/forward. */
export function useRoute() {
  const [route, setRoute] = useState(current);
  useEffect(() => {
    const update = () => setRoute(current());
    window.addEventListener('popstate', update);
    window.addEventListener(EVENT, update);
    return () => { window.removeEventListener('popstate', update); window.removeEventListener(EVENT, update); };
  }, []);
  return route;
}

/** One document-level click handler turns internal links into client-side navigation. */
export function useLinkInterception() {
  useEffect(() => {
    const onClick = e => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest('a[href]');
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
      const href = a.getAttribute('href');
      if (!href || href === '#') return;
      const onHome = window.location.pathname === '/';
      if (href.startsWith('/')) {
        e.preventDefault();
        navigate(href);
      } else if (href.startsWith('#') && !onHome) {
        // Section links ("#how", "#search") live on the home page
        e.preventDefault();
        navigate('/' + href);
      }
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);
}
