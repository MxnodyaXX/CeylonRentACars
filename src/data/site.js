// All page content lives here so it can later come from an API / CMS.
// Prices are in LKR; the currency context converts them for display.

export const NAV_LINKS = [
  { href: '#top', label: 'Home' },
  { href: '#vehicles', label: 'Vehicles' },
  { href: '#how', label: 'How It Works' },
  { href: '#why', label: 'Why Us' },
  { href: '#deals', label: 'Deals' },
  { href: '#faq', label: 'Support' },
];

/* Hero carousel.
   flares = headlight centres as fractions of the original image [x, y]
   pos    = CSS object-position of the photo
   night  = true for night photos; daytime photos get graded towards night */
export const HERO_SLIDES = [
  {
    name: 'Toyota Aqua', tag: 'Eco Favourite', meta: 'Hybrid • Automatic • 5 Seats', rating: '4.8', price: 10500,
    img: '/img/hero-aqua.jpg', alt: 'White Toyota Aqua hybrid on a wet city street at night',
    night: true, pos: '50% 50%', flares: [[0.629, 0.53], [0.822, 0.524]],
  },
  { name: 'Toyota Prius 2019', tag: 'Popular Choice', meta: 'Hybrid • Automatic • 5 Seats', rating: '4.9', price: 12500, img: '/img/prius.jpg', alt: 'Silver Toyota Prius 2019 hybrid' },
  { name: 'Suzuki Wagon R', tag: 'Best Value', meta: 'Economy • Automatic • 4 Seats', rating: '4.7', price: 8500, img: '/img/wagonr.jpg', alt: 'White Suzuki Wagon R' },
  { name: 'Honda Vezel', tag: 'Family SUV', meta: 'SUV • Hybrid • 5 Seats', rating: '4.8', price: 15500, img: '/img/vezel.jpg', alt: 'White Honda Vezel SUV' },
  { name: 'Toyota KDH', tag: 'Group Travel', meta: 'Van • Diesel • 14 Seats', rating: '4.9', price: 18500, img: '/img/kdh.jpg', alt: 'White Toyota KDH van' },
];

export const VEHICLES = [
  { id: 'wagonr', name: 'Suzuki Wagon R', cat: 'economy', catLabel: 'Economy', img: '/img/wagonr.jpg', rating: 4.7, reviews: 212, location: 'Colombo', transmission: 'Automatic', fuel: 'Petrol', fuelIcon: 'fuel', seats: 4, price: 8500 },
  { id: 'aqua', name: 'Toyota Aqua', cat: 'hybrid', catLabel: 'Hybrid', img: '/img/aqua.jpg', rating: 4.8, reviews: 186, location: 'Negombo', transmission: 'Automatic', fuel: 'Hybrid', fuelIcon: 'leaf', seats: 5, price: 10500 },
  { id: 'prius', name: 'Toyota Prius', cat: 'hybrid', catLabel: 'Hybrid', img: '/img/prius.jpg', rating: 4.9, reviews: 324, location: 'Katunayake Airport', transmission: 'Automatic', fuel: 'Hybrid', fuelIcon: 'leaf', seats: 5, price: 12500, badge: 'Most booked' },
  { id: 'vezel', name: 'Honda Vezel', cat: 'suv', catLabel: 'SUV', img: '/img/vezel.jpg', rating: 4.8, reviews: 147, location: 'Kandy', transmission: 'Automatic', fuel: 'Hybrid', fuelIcon: 'leaf', seats: 5, price: 15500 },
  { id: 'kdh', name: 'Toyota KDH', cat: 'van', catLabel: 'Van', img: '/img/kdh.jpg', rating: 4.9, reviews: 98, location: 'Negombo', transmission: 'Manual', fuel: 'Diesel', fuelIcon: 'fuel', seats: 14, price: 18500 },
  { id: 'prado', name: 'Toyota Prado', cat: 'suv', catLabel: 'Premium SUV', img: '/img/prado.jpg', rating: 5.0, reviews: 64, location: 'Colombo', transmission: 'Automatic', fuel: 'Diesel', fuelIcon: 'fuel', seats: 7, price: 30000, badge: 'Premium', badgeLight: true },
];

export const VEHICLE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'economy', label: 'Economy' },
  { id: 'hybrid', label: 'Hybrid' },
  { id: 'suv', label: 'SUV' },
  { id: 'van', label: 'Van' },
];

export const CATEGORIES = [
  { name: 'Economy', img: '/img/wagonr.jpg', price: 8500 },
  { name: 'Sedan', img: '/img/axio.jpg', price: 11000 },
  { name: 'Hybrid', img: '/img/aqua.jpg', price: 10500 },
  { name: 'SUV', img: '/img/vezel.jpg', price: 15500 },
  { name: 'Luxury', img: '/img/eclass.jpg', price: 35000 },
  { name: 'Van', img: '/img/kdh.jpg', price: 18500 },
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
export const REVIEWS = [
  { initials: 'EW', hue: 350, name: 'Emma W.', country: 'United Kingdom', vehicle: 'Toyota Prius', text: 'The Prius was waiting at arrivals and the handover took ten minutes. Total price was exactly what we saw online. Made our two-week loop to Ella and Galle so easy.' },
  { initials: 'LM', hue: 10, name: 'Lukas M.', country: 'Germany', vehicle: 'Toyota KDH with driver', text: 'We booked a KDH with a driver for six of us. Our driver knew every tea estate and the van was spotless. Support answered on WhatsApp within minutes.' },
  { initials: 'SD', hue: 0, name: 'Sophie & Dan', country: 'Australia', vehicle: 'Honda Vezel', text: 'Clear advice on the driving permit before we flew in, and the deposit was back in our account two days after drop-off. Would rent again in a heartbeat.' },
];

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
  { title: 'Renters', links: [['Browse Vehicles', '#vehicles'], ['Airport Rentals', '#locations'], ['With Driver', '#categories'], ['FAQs', '#faq']] },
  { title: 'Vehicle Owners', links: [['List Your Vehicle', '#'], ['Owner Portal', '#'], ['Owner Help', '#'], ['Insurance Requirements', '#']] },
  { title: 'Support', links: [['Help Centre', '#faq'], ['Emergency Support', '#'], ['Terms', '#'], ['Privacy', '#']] },
];

export const CONTACT = { email: 'hello@ceylonrentacars.lk', phone: '+94 11 234 5678', tel: '+94112345678' };
