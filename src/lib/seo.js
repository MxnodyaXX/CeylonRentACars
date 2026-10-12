import { useEffect } from 'react';
import { PAGES, ROBOTS_INDEX, ROBOTS_NOINDEX, canonicalOf } from '../seo/pages';

const setMeta = (selector, value) => { const el = document.head.querySelector(selector); if (el) el.setAttribute('content', value); };

/**
 * Keep the title, description, canonical and robots tags in step with the page when the
 * app moves between pages without a reload (the first load already has them from the build).
 */
export function usePageSeo(path) {
  useEffect(() => {
    const page = PAGES[path] ?? PAGES['/'];
    const url = canonicalOf(PAGES[path] ? path : '/');
    document.title = page.title;
    setMeta('meta[name="description"]', page.description);
    setMeta('meta[name="robots"]', page.noindex ? ROBOTS_NOINDEX : ROBOTS_INDEX);
    setMeta('meta[property="og:title"]', page.title);
    setMeta('meta[property="og:description"]', page.description);
    setMeta('meta[property="og:url"]', url);
    setMeta('meta[name="twitter:title"]', page.title);
    setMeta('meta[name="twitter:description"]', page.description);
    document.head.querySelector('link[rel="canonical"]')?.setAttribute('href', url);
  }, [path]);
}
