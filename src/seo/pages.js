/*
 * Search-engine details for each page. Used in two places:
 *  - vite.config.js (build): writes dist/<page>/index.html with these tags, so crawlers and
 *    link previews see the right title / description / canonical without running JavaScript
 *  - src/lib/seo.js (browser): updates the same tags when moving between pages in the app
 */
export const SITE_URL = 'https://ceylonrentacars.com';
export const SITE_NAME = 'Ceylon Rent A Cars';

export const PAGES = {
  '/': {
    title: 'Ceylon Rent A Cars | Car Rental in Sri Lanka',
    description: 'Find your ideal rental car in Sri Lanka with Ceylon Rent A Cars. Explore vehicles, compare rental options and send your inquiry online.',
  },
  '/vehicles': {
    title: 'Rental Cars, SUVs & Vans in Sri Lanka | Ceylon Rent A Cars',
    description: 'Browse cars, SUVs, vans and premium vehicles for rent in Sri Lanka. Compare daily rates, choose self drive or a driver, and send your inquiry online.',
  },
  '/feedback': {
    title: 'Share Your Feedback | Ceylon Rent A Cars',
    description: 'Rented a vehicle from Ceylon Rent A Cars? Tell us about the vehicle and our service — your feedback helps other travellers in Sri Lanka.',
  },
  // Personal pages (opened from a link with booking details) — never indexed
  '/book': {
    title: 'Send Your Booking Inquiry | Ceylon Rent A Cars',
    description: 'Send a booking inquiry for your rental vehicle in Sri Lanka.',
    noindex: true,
  },
  '/alternatives': {
    title: 'Your Vehicle Options | Ceylon Rent A Cars',
    description: 'Vehicle options suggested for your rental in Sri Lanka.',
    noindex: true,
  },
};

export const ROBOTS_INDEX = 'index, follow, max-image-preview:large';
export const ROBOTS_NOINDEX = 'noindex, follow';
export const canonicalOf = (path) => `${SITE_URL}${path === '/' ? '/' : path}`;
