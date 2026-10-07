export type VehicleStatus = 'Available' | 'Reserved' | 'Ongoing' | 'Maintenance';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  email?: string;
  nic?: string;
  address?: string;
  notes?: string;
  smsOptIn?: boolean;   // SMS consent (defaults to true when undefined)
  createdAt: string;
}

export interface Insurance {
  provider: string;
  policyNumber: string;
  expiryDate: string;
  premium: number;
}

export interface Vehicle {
  id: string;
  vehicleNumber: string;
  brand: string;
  model: string;
  year: number;
  ownerId: string;
  dailyRent: number;
  extraKmRate?: number;      // Rs per km beyond included km
  includedKmPerDay?: number; // free km per rental day (default 100)
  status: VehicleStatus;
  insurance: Insurance;
  revenue: number;
  rentCount: number;
  imageUrl?: string;
  imageUrls?: string[];      // legacy local-only list; superseded by the three image kinds below
  // imageUrl (above) = ADMIN image: transparent cut-out shown on the admin cards
  heroImageUrl?: string;     // HERO image: wide polished photo for the website hero
  photoUrls?: string[];      // VEHICLE photos: real photos customers browse in the details
  color?: string;
  seats?: number;
  fuelType?: string;
  transmission?: string;
  mileage?: number;
  fuelEfficiency?: number | null;   // km per litre
  tankCapacity?: number | null;     // litres
  hillSuitable?: boolean | null;    // OK for steep hill-country roads (Kandy, Nuwara Eliya, Ella…); null = not set
  createdAt: string;
  // Ceylon Rent A Cars website listing (managed on the Website page)
  webFeatured?: boolean;
  webOrder?: number;
  webCategory?: string;
  webBadge?: string;
  webLocation?: string;
  webPrice?: number;
}

/** Customer review of a vehicle, recorded in the admin and shown on the website when published */
export interface VehicleReview {
  id: string;
  vehicleId: string;
  bookingId?: string;
  customerName: string;
  rating: number;            // 1–5
  comment?: string;
  published: boolean;
  createdAt: string;
}

export interface Owner {
  id: string;
  name: string;
  phone: string;
  email: string;
  address?: string;
  bankName?: string;
  branchName?: string;
  accountNumber?: string;
  accountHolderName?: string;
  nic?: string;         // captured during login-profile setup
  username?: string;    // the owner's login username
  commissionRate: number;
  totalEarnings: number;
  pendingPayout: number;
  smsOptIn?: boolean;   // SMS consent (defaults to true when undefined)
  createdAt: string;
}

export interface BookingQuotation {
  startLocation: string;
  endLocation: string;
  stops: string[];
  isRoundTrip: boolean;
  totalKm: number;          // manually entered estimated km
}

export interface VehicleHandover {
  id: string;
  bookingId: string;
  vehicleId: string;
  type: 'delivery' | 'return';
  location: string;
  dateTime: string;
  mileage: number;
  fuelLevel: string;
  notes?: string;
  extraKm?: number;
  extraKmCharge?: number;
  finalAmount?: number;
  createdAt: string;
}

export interface Booking {
  id: string;
  vehicleId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerNIC?: string;
  startDate: string;
  endDate: string;
  startTime?: string;        // 'HH:mm' scheduled pickup time (for same-day turnaround availability)
  endTime?: string;          // 'HH:mm' scheduled return time
  waiveExtraDay?: boolean;   // owner-approved: don't bill a partial day past a whole 24h multiple
  totalDays: number;
  totalAmount: number;
  estimatedAmount?: number;  // from quotation calculator
  paidAmount: number;
  status: 'Confirmed' | 'Ongoing' | 'Completed' | 'Cancelled';
  referral?: string;         // owner name / third-party name / 'Direct'
  referralFeeType?: 'fixed' | 'percent'; // how the referral fee is entered
  referralFeeValue?: number; // raw input: rupees (fixed) or percent (percent)
  referralFee?: number;      // resolved rupee amount paid to the referrer
  referralPaid?: boolean;    // has the referral fee been paid out to the referrer
  referralPaidAt?: string;   // ISO timestamp when the referral fee was settled
  notes?: string;
  createdAt: string;
  pickupLocation?: string;
  dropLocation?: string;
  driverId?: string;
  quotation?: BookingQuotation;
  depositType?: 'cash' | 'vehicle' | 'other';
  depositAssetDescription?: string;        // vehicle: "Model | Color | VehicleNo"; other: free text
  depositAmount?: number;
  depositReturned?: number;
  depositDeduction?: number;
  depositNotes?: string;

  // ── Return / payment details ──────────────────────────────────────────────
  pickupAt?: string;          // ISO datetime the vehicle was handed over
  returnAt?: string;          // ISO datetime the vehicle was returned
  advanceAmount?: number;     // advance paid up-front (separate from paidAmount)
  discount?: number;          // discount given off the bill
  extraCharges?: number;      // extra charges added to the bill (e.g. extra km, damage)
  paymentMethod?: string;     // Cash / Card / Bank Transfer / Online
  // ── Credit (due transferred to the customer's account) ────────────────────
  creditAmount?: number;      // outstanding balance recorded as customer credit
  creditSettled?: boolean;    // true once the credit has been collected
  creditResponsibility?: 'self' | 'owner' | 'company'; // who is liable for the credit
  badDebt?: number;           // amount written off as unrecoverable
  insertedByAdmin?: boolean;  // true when admin entered this booking on behalf of an owner
}

export interface Inquiry {
  id: string;
  customerName: string;
  customerPhone: string;
  requestedVehicle: string;
  preferredBrand?: string;
  startDate: string;
  endDate: string;
  referral: string;
  status: 'Pending' | 'Converted' | 'Lost';
  lostReason?: string;
  notes?: string;
  createdAt: string;
  vehicleId?: string;                       // set for website booking requests
  checklist?: Record<string, boolean>;      // qualification checklist (inquiry page)
  quote?: InquiryQuote;                     // price quote sent to the customer
  alternativeOf?: string;                   // this inquiry is the customer's alternative choice for that inquiry
  alternativeChosen?: string;               // the customer moved from this inquiry to that one
  alternativesOffered?: string[];           // vehicle ids offered to the customer as alternatives
  vehicleHistory?: VehicleChange[];         // earlier vehicles of this inquiry (oldest first); requestedVehicle is the current one
  consultation?: Consultation;              // what staff confirmed with the customer — the original fields above are never overwritten
  stage?: InquiryStage;                     // pipeline stage (status stays Pending / Converted / Lost)
}

export type InquiryStage =
  | 'NEW' | 'CONTACTING' | 'CONSULTATION' | 'OPTIONS_SENT' | 'QUOTATION_SENT' | 'CUSTOMER_DECISION' | 'CONFIRMED' | 'BOOKED'
  | 'FOLLOW_UP_REQUIRED' | 'LOST' | 'CANCELLED' | 'NO_RESPONSE';

/** Every time the customer picks (or changes to) a vehicle — so changes of mind stay on record */
export interface VehicleChoice {
  vehicleId: string;
  vehicle: string;
  at: string;
  by: string;
  source: 'Staff' | 'Website';
  note?: string;
}

/** What the customer finally agreed to — the basis of the booking */
export interface BookingAgreement {
  vehicleId: string;
  vehicle: string;
  pickupAt?: string;
  returnAt?: string;
  pickupLocation?: string;
  returnLocation?: string;
  mode?: string;
  distanceKm?: number;
  dailyRate: number;
  days: number;
  extraKmCost: number;
  extras: number;            // driver, child seat, airport fee… (from the quote)
  discount: number;
  total: number;
  advanceAmount: number;     // paid now to secure the booking
  paymentMethod: string;     // Cash / Card / Bank transfer / Online
  balanceDue: string;        // Before pickup / At pickup / At return
  depositAmount: number;     // refundable security deposit
  depositType: 'cash' | 'vehicle' | 'other';
  confirmedVia: string;      // Call / WhatsApp / Email / In person
  confirmedAt: string;
  confirmedBy: string;
  notes?: string;
  supersededAt?: string;     // set when the customer later changed their mind
  supersededReason?: string;
}

/** One attempt to reach the customer from "Start inquiry" */
export interface ContactAttempt {
  at: string;
  by: string;
  method: string;            // WhatsApp call / Normal call / WhatsApp chat / Other
  status: string;            // Connected / No answer / Busy / Call back requested / Wrong number
  note?: string;
}

/**
 * Inquiry Consultation — the customer's CONFIRMED requirement, the company's proposal
 * and the outcome. Kept beside (never instead of) what the customer originally submitted.
 */
export interface Consultation {
  startedAt: string;
  startedBy: string;
  completedAt?: string;
  attempts: ContactAttempt[];
  // 1 + 3. Confirmed requirement & pickup / return
  pickupLocation?: string;
  pickupAt?: string;           // yyyy-MM-ddTHH:mm
  returnLocation?: string;
  returnAt?: string;
  differentReturn?: boolean;
  airportDelivery?: boolean;
  requirement?: string;        // e.g. "Vehicle for 7 passengers + luggage"
  // 2. Travel purpose (changes what a "good" vehicle is), passengers & travel
  purpose?: string;            // one of PURPOSES in lib/consultation
  companyName?: string;        // business / company rentals
  invoiceRequired?: boolean;   // company needs a tax invoice
  adults?: number;
  children?: number;
  infants?: number;
  largeBags?: number;
  smallBags?: number;
  childSeats?: number;
  distanceKm?: number;         // customer's estimate of the total km for the whole rental (asked before the budget)
  areas?: string;
  usage?: 'City' | 'Long distance' | 'Mixed';
  highway?: boolean;
  hillCountry?: boolean;       // trip includes hill country; undefined = detect from the route
  // 4. Priorities
  priorities?: string[];
  // 8. Budget
  budgetPerDay?: number;
  budgetMaxPerDay?: number;
  budgetFlexible?: boolean;
  // 9. Driving
  mode?: 'Self drive' | 'With driver' | 'Airport pickup';
  nationality?: string;
  licence?: 'Sri Lankan' | 'Foreign' | 'None';
  idp?: boolean;
  driverAge?: number;
  // 10. Special requirements
  special?: string[];
  specialNotes?: string;
  // 11. Notes
  customerNotes?: string;
  internalNotes?: string;
  // 6. Proposal
  suggested?: string[];        // vehicle ids sent to the customer
  manualIds?: string[];        // vehicles staff added to the send list by hand
  excludedIds?: string[];      // system suggestions staff unticked
  selectedVehicleId?: string;  // what the customer chose (latest)
  choiceLog?: VehicleChoice[]; // every pick / change of mind, oldest first
  // 15. Decision & booking
  agreement?: BookingAgreement;           // current confirmed terms
  agreementHistory?: BookingAgreement[];  // earlier terms the customer later changed
  // 12–14. Outcome
  leadQuality?: 'Hot' | 'Warm' | 'Cold' | 'Follow-up required' | 'Not interested';
  nextAction?: string;
  nextFollowUpAt?: string;     // yyyy-MM-ddTHH:mm
  summary?: string;            // generated when the consultation is finished
}

/** A vehicle the inquiry had before it moved to another one */
export interface VehicleChange {
  vehicle: string;
  vehicleId?: string;
  replacedAt: string;
  reason?: string;
  quote?: InquiryQuote | null;
}

export interface InquiryQuote {
  dailyRate: number;
  days: number;
  discount: number;
  extras: { label: string; amount: number }[];   // driver, airport pickup, child seat…
  deposit: number;
  total: number;
  status: 'draft' | 'sent' | 'accepted';
  sentAt?: string;
  sentVia?: string;
}

export interface Commission {
  id: string;
  bookingId: string;
  vehicleId: string;
  ownerId: string;
  referral: string;
  totalIncome: number;
  commissionRate: number;
  commissionAmount: number;
  ownerPayout: number;
  coordinatorFee?: number;
  status: 'Pending' | 'Paid' | 'Credit';
  createdAt: string;
}

export type ExpenseCategory = 'Service' | 'Repair' | 'Fine' | 'Damage' | 'Tire' | 'Insurance' | 'Fuel' | 'Other';

export interface Expense {
  id: string;
  vehicleId: string;
  category: ExpenseCategory;
  amount: number;
  description: string;
  date: string;
  receipt?: string;
  createdAt: string;
}

export interface Driver {
  id: string;
  name: string;
  phone: string;
  licenseNumber: string;
  licenseExpiry: string;
  status: 'Available' | 'On Duty' | 'Off';
  dailyRate: number;
  totalEarnings: number;
  currentBookingId?: string;
  joinedAt: string;
  address?: string;
  nic?: string;
}

export interface Notification {
  id: string;
  type: 'BookingReminder' | 'ReturnReminder' | 'Overdue' | 'ServiceReminder' | 'InsuranceExpiry' | 'ReferralPayout' | 'General';
  title: string;
  message: string;
  relatedId?: string;
  ownerId?: string;   // when set, the alert is addressed to this owner (else global/admin)
  read: boolean;
  createdAt: string;
}

export interface ProcessDraft {
  id: string;
  type: 'return' | 'booking' | 'payment';
  label: string;
  sublabel: string;
  bookingId?: string;
  vehicleId?: string;
  formData: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface AppState {
  vehicles: Vehicle[];
  owners: Owner[];
  bookings: Booking[];
  inquiries: Inquiry[];
  commissions: Commission[];
  expenses: Expense[];
  drivers: Driver[];
  notifications: Notification[];
  handovers: VehicleHandover[];
  customers: Customer[];

  loaded: boolean;
  loadAll: () => Promise<void>;

  addHandover: (h: Omit<VehicleHandover, 'id' | 'createdAt'>) => void;

  addCustomer: (c: Omit<Customer, 'id' | 'createdAt'>) => void;
  updateCustomer: (id: string, updates: Partial<Customer>) => void;
  deleteCustomer: (id: string) => void;

  addVehicle: (v: Omit<Vehicle, 'id' | 'createdAt' | 'revenue' | 'rentCount'>) => string;
  updateVehicle: (id: string, updates: Partial<Vehicle>) => void;
  updateWebsiteListing: (id: string, updates: Partial<Vehicle>) => void;
  deleteVehicle: (id: string) => void;

  addOwner: (o: Omit<Owner, 'id' | 'createdAt' | 'totalEarnings' | 'pendingPayout'>) => void;
  updateOwner: (id: string, updates: Partial<Owner>) => void;

  addBooking: (b: Omit<Booking, 'id' | 'createdAt'>) => string;
  updateBooking: (id: string, updates: Partial<Booking>) => void;
  cancelBooking: (id: string) => void;
  startBooking: (id: string) => void;
  completeBooking: (id: string) => void;
  markReferralPaid: (bookingId: string, paid: boolean) => void;

  addInquiry: (i: Omit<Inquiry, 'id' | 'createdAt'>) => void;
  updateInquiry: (id: string, updates: Partial<Inquiry>) => void;
  patchInquiry: (id: string, updates: Partial<Inquiry>) => void;

  addExpense: (e: Omit<Expense, 'id' | 'createdAt'>) => void;
  deleteExpense: (id: string) => void;

  addDriver: (d: Omit<Driver, 'id' | 'joinedAt' | 'totalEarnings'>) => void;
  updateDriver: (id: string, updates: Partial<Driver>) => void;

  markNotificationRead: (id: string) => void;
  markAllRead: () => void;
  addNotification: (n: Omit<Notification, 'id' | 'createdAt' | 'read'>) => void;

  isVehicleAvailable: (vehicleId: string, startDate: string, endDate: string, excludeBookingId?: string, startTime?: string, endTime?: string) => boolean;
  updateCommission: (id: string, updates: Partial<Commission>) => void;
  addManualBooking: (data: Omit<Booking, 'id' | 'createdAt'> & { customerAddress?: string; dailyRateUsed?: number; referralAlreadyPaid?: boolean; commissionAlreadyPaid?: boolean }) => string;
  recomputeStats: () => void;
  settleCredit: (bookingId: string) => void;

  drafts: ProcessDraft[];
  saveDraft: (d: Omit<ProcessDraft, 'id' | 'createdAt' | 'updatedAt'>) => string;
  discardDraft: (id: string) => void;
}
