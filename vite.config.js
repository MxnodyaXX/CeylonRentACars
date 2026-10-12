import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { PAGES, ROBOTS_INDEX, ROBOTS_NOINDEX, canonicalOf } from './src/seo/pages.js';

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/**
 * The site is one client-rendered app, so every page is the same index.html. After the build,
 * write dist/<page>/index.html for each page in src/seo/pages.js with that page's title,
 * description, canonical and robots tags — crawlers and link previews then get the right
 * details without running JavaScript. (vercel.json routes each page to its file.)
 */
function seoPages() {
  let outDir = 'dist';
  return {
    name: 'seo-pages',
    apply: 'build',
    configResolved(c) { outDir = resolve(c.root, c.build.outDir); },
    closeBundle() {
      const base = readFileSync(join(outDir, 'index.html'), 'utf8');
      for (const [path, page] of Object.entries(PAGES)) {
        if (path === '/') continue;   // index.html already carries the home page tags
        const url = canonicalOf(path);
        const title = esc(page.title), desc = esc(page.description);
        let html = base
          .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
          .replace(/(<meta name="description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<meta name="robots" content=")[^"]*(")/, `$1${page.noindex ? ROBOTS_NOINDEX : ROBOTS_INDEX}$2`)
          .replace(/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${desc}$2`)
          .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`)
          .replace(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${title}$2`)
          .replace(/(<meta name="twitter:description" content=")[^"]*(")/, `$1${desc}$2`);
        mkdirSync(join(outDir, path), { recursive: true });
        writeFileSync(join(outDir, path, 'index.html'), html);
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), seoPages()],
  // admin/ is a separate app (the MRAC admin panel) with its own package.json —
  // only scan the customer site's entry for dependencies.
  optimizeDeps: { entries: ['index.html'] },
});
