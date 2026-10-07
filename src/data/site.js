// All page content lives here so it can later come from an API / CMS.
// Prices are in LKR; the currency context converts them for display.

export const NAV_LINKS = [
  { href: '#top', label: 'Home' },
  { href: '/vehicles', label: 'Vehicles' },
  { href: '#how', label: 'How It Works' },
  { href: '#why', label: 'Why Us' },
  { href: '#deals', label: 'Deals' },
  { href: '#faq', label: 'Support' },
];

/* Hero carousel.
   flares = headlight centres as fractions of the original image [x, y]
   pos    = CSS object-position of the photo
   night  = true for night photos; daytime photos get graded towards night */
// Hero background art, used only when no vehicles are listed in the admin panel.
// (Hero slides themselves come from the admin's Website page — see lib/fleet.js.)
export const HERO_ART = {
  img: '/img/hero-aqua.jpg', alt: 'Car on a wet city street at night',
  night: true, pos: '50% 50%', flares: [[0.629, 0.53], [0.822, 0.524]],
};

export const VEHICLE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'economy', label: 'Economy' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'suv', label: 'SUV' },
  { id: 'van', label: 'Van' },
];

export const CATEGORIES = [
  { name: 'Economy', type: 'economy', img: '/img/wagonr.jpg', price: 8500 },
  { name: 'Sedan', type: 'sedan', img: '/img/axio.jpg', price: 11000 },
  { name: 'Hybrid', type: 'hybrid', img: '/img/aqua.jpg', price: 10500 },
  { name: 'SUV', type: 'suv', img: '/img/vezel.jpg', price: 15500 },
  { name: 'Luxury', type: 'luxury', img: '/img/eclass.jpg', price: 35000 },
  { name: 'Van', type: 'van', img: '/img/kdh.jpg', price: 18500 },
  { name: 'With Driver', img: '/img/prado.jpg', price: 16000, featured: true },
];

// Placeholder figures for the design — replace with real numbers.
export const STATS = [
  { icon: 'seat', value: '12K+', label: 'Happy travellers' },
  { icon: 'car', value: '850+', label: 'Verified vehicles' },
  { icon: 'pin', value: '40+', label: 'Pickup points islandwide' },
  { icon: 'star', value: '4.8 / 5', label: 'Average owner rating' },
];

export const LOCATIONS = [
  { name: 'Bandaranaike International Airport', img: '/img/airport.jpg', count: 'Meet & greet at arrivals · 240+ vehicles', size: 'xl', tag: 'Airport' },
  { name: 'Colombo', img: '/img/colombo.jpg', count: '180+ vehicles', alt: 'Colombo skyline' },
  { name: 'Negombo', img: '/img/negombo.jpg', count: '95+ vehicles', alt: 'Negombo beach' },
  { name: 'Kandy', img: '/img/kandy.jpg', count: '70+ vehicles', alt: 'Kandy lake and Temple of the Tooth' },
  { name: 'Galle', img: '/img/galle.jpg', count: '60+ vehicles', alt: 'Galle Fort lighthouse' },
  { name: 'Ella', img: '/img/ella.jpg', count: '35+ vehicles', alt: 'Nine Arch Bridge, Ella', size: 'wide' },
  { name: 'Mirissa', img: '/img/mirissa.jpg', count: '40+ vehicles', alt: 'Mirissa beach' },
  { name: 'Jaffna', img: '/img/jaffna.jpg', count: '25+ vehicles', alt: 'Nallur temple, Jaffna' },
];

export const STEPS = [
  { icon: 'search', title: 'Search', text: 'Choose your location, dates and vehicle type.' },
  { icon: 'scale', title: 'Compare', text: 'Compare verified vehicles, prices and owner ratings.' },
  { icon: 'lock', title: 'Book Securely', text: 'Book and pay inside Ceylon Rent A Cars.' },
  { icon: 'key', title: 'Verify & Pick Up', text: 'Complete driver verification and digital handover.' },
  { icon: 'compass', title: 'Explore Sri Lanka', text: 'Start your journey with confidence.' },
];

export const FEATURES = [
  { icon: 'user', title: 'Verified Owners', text: 'ID and ownership checked for every host.' },
  { icon: 'badge', title: 'Verified Vehicles', text: 'Registration, condition and photos reviewed.' },
  { icon: 'shield-plus', title: 'Rental-Eligible Insurance Checks', text: 'Cover confirmed as valid for rental use.' },
  { icon: 'tag', title: 'Transparent Pricing', text: 'Full total shown upfront. No surprises.' },
  { icon: 'lock', title: 'Secure Booking', text: 'Encrypted payments held until pickup.' },
  { icon: 'file', title: 'Digital Handover Records', text: 'Timestamped photos, fuel and mileage.' },
  { icon: 'headset', title: 'Customer Support', text: 'Real people, 24/7, in English.' },
  { icon: 'map', title: 'Islandwide Availability', text: 'From Jaffna to Galle and everywhere between.' },
];

// Sample reviews for the design — replace with real customer reviews before launch.
export const FAQS = [
  { q: 'Can foreigners rent a car in Sri Lanka?', a: 'Yes. Visitors aged 21+ with a valid national driving licence can rent self-drive vehicles. You can also book any vehicle with a driver — no licence needed.' },
  { q: 'Do I need a Sri Lankan driving permit?', a: 'For self-drive you’ll need your home licence plus an International Driving Permit, which must be endorsed locally with a temporary Sri Lankan permit. We help arrange this on arrival so you can start driving the same day.' },
  { q: 'Is insurance included?', a: 'Every listed vehicle must carry insurance that is valid for rental use, and we check this before a vehicle goes live. The cover details and excess are shown on each vehicle page before you book.' },
  { q: 'Can vehicles be delivered to the airport?', a: 'Yes. Choose “Airport Pickup” and your owner will meet you at Bandaranaike International Airport arrivals, at any time of day.' },
  { q: 'Is the security deposit refundable?', a: 'Yes. The deposit is held securely and released after drop-off once the digital handover record confirms there’s no new damage, usually within 2–5 working days.' },
  { q: 'Can I rent with a driver?', a: 'Absolutely. Select “With Driver” in the search. Experienced, English-speaking drivers are available for day trips and multi-day tours, with driver meals and lodging clearly priced.' },
  { q: 'How do cancellations work?', a: 'Most vehicles offer free cancellation up to 48 hours before pickup. The exact policy is shown on every vehicle page and in your booking confirmation.' },
];

export const PICKUP_LOCATIONS = [
  'Bandaranaike International Airport (CMB)', 'Colombo', 'Negombo', 'Kandy', 'Galle', 'Ella', 'Mirissa', 'Jaffna',
];

export const VEHICLE_TYPES = ['Any type', 'Economy', 'Sedan', 'Hybrid', 'SUV', 'Luxury', 'Van'];

export const FOOTER_COLUMNS = [
  { title: 'Company', links: [['About Us', '#'], ['How It Works', '#how'], ['Careers', '#'], ['Contact', '#']] },
  { title: 'Renters', links: [['Browse Vehicles', '/vehicles'], ['Airport Rentals', '#locations'], ['With Driver', '#categories'], ['FAQs', '#faq']] },
  { title: 'Vehicle Owners', links: [['List Your Vehicle', '#'], ['Owner Portal', '#'], ['Owner Help', '#'], ['Insurance Requirements', '#']] },
  { title: 'Support', links: [['Help Centre', '#faq'], ['Leave Feedback', '/feedback'], ['Emergency Support', '#'], ['Terms', '#'], ['Privacy', '#']] },
];

// phone/tel = phone calls; whatsapp/waTel = the company WhatsApp Business number (chats, WhatsApp calls)
export const CONTACT = {
  email: 'hello@ceylonrentacars.lk',
  phone: '077 972 6761', tel: '+94779726761',
  whatsapp: '071 733 3313', waTel: '+94717333313',
};

/** wa.me link to the company WhatsApp, optionally with a pre-filled message */
export const waLink = (text) =>
  `https://wa.me/${CONTACT.waTel.replace(/\D/g, '')}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
