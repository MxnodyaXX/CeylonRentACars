import { supabase } from './supabase'
import type {
  Vehicle, Owner, Booking, Inquiry, Commission,
  Expense, Driver, Notification, VehicleHandover, Customer,
} from '../types'
import type { AppUser } from '../types/auth'

// ─────────────────────────────────────────────────────────────────────────────
// Mappers: DB row (snake_case) ↔ TS types (camelCase)
// ─────────────────────────────────────────────────────────────────────────────

// PostgREST returns `numeric`/`decimal` columns as STRINGS (to preserve precision).
// Coerce them to real numbers, or every reduce/sum becomes string concatenation.
const num    = (v: unknown): number => Number(v ?? 0);
const numOpt = (v: unknown): number | undefined => (v == null ? undefined : Number(v));

function vFromDb(r: Record<string, unknown>): Vehicle {
  return {
    id: r.id as string, vehicleNumber: r.vehicle_number as string,
    brand: r.brand as string, model: r.model as string, year: num(r.year),
    ownerId: r.owner_id as string, dailyRent: num(r.daily_rent),
    extraKmRate: numOpt(r.extra_km_rate),
    includedKmPerDay: numOpt(r.included_km_per_day),
    status: r.status as Vehicle['status'],
    insurance: r.insurance as Vehicle['insurance'],
    revenue: num(r.revenue), rentCount: num(r.rent_count),
    imageUrl: (r.image_url as string) ?? undefined,
    imageUrls: Array.isArray(r.image_urls) ? (r.image_urls as string[]) : undefined,
    heroImageUrl: (r.hero_image_url as string) ?? undefined,
    photoUrls: Array.isArray(r.photo_urls) ? (r.photo_urls as string[]) : undefined,
    color: (r.color as string) ?? undefined, seats: numOpt(r.seats),
    fuelType: (r.fuel_type as string) ?? undefined,
    transmission: (r.transmission as string) ?? undefined,
    mileage: numOpt(r.mileage), createdAt: r.created_at as string,
    fuelEfficiency: numOpt(r.fuel_efficiency),
    tankCapacity: numOpt(r.tank_capacity),
    webFeatured: r.web_featured === true,
    webOrder: numOpt(r.web_order),
    webCategory: (r.web_category as string) ?? undefined,
    webBadge: (r.web_badge as string) ?? undefined,
    webLocation: (r.web_location as string) ?? undefined,
    webPrice: numOpt(r.web_price),
  }
}

function vToDb(v: Vehicle) {
  return {
    id: v.id, vehicle_number: v.vehicleNumber, brand: v.brand, model: v.model,
    year: v.year, owner_id: v.ownerId, daily_rent: v.dailyRent,
    extra_km_rate: v.extraKmRate ?? null, included_km_per_day: v.includedKmPerDay ?? null,
    status: v.status, insurance: v.insurance, revenue: v.revenue, rent_count: v.rentCount,
    image_url: v.imageUrl ?? null, color: v.color ?? null, seats: v.seats ?? null,
    fuel_type: v.fuelType ?? null, transmission: v.transmission ?? null,
    mileage: v.mileage ?? null, created_at: v.createdAt,
    // only sent when filled, so inserts still work before website.sql adds the columns
    ...(v.fuelEfficiency != null && { fuel_efficiency: v.fuelEfficiency }),
    ...(v.tankCapacity != null && { tank_capacity: v.tankCapacity }),
  }
}

function oFromDb(r: Record<string, unknown>): Owner {
  return {
    id: r.id as string, name: r.name as string, phone: r.phone as string,
    email: r.email as string, address: (r.address as string) ?? undefined,
    bankName:          (r.bank_name           as string) ?? undefined,
    branchName:        (r.branch_name         as string) ?? undefined,
    accountNumber:     (r.account_number      as string) ?? undefined,
    accountHolderName: (r.account_holder_name as string) ?? undefined,
    nic: (r.nic as string) ?? undefined,
    username: (r.username as string) ?? undefined,
    commissionRate: num(r.commission_rate),
    totalEarnings: num(r.total_earnings), pendingPayout: num(r.pending_payout),
    smsOptIn: (r.sms_opt_in as boolean) ?? undefined,
    createdAt: r.created_at as string,
  }
}

function oToDb(o: Owner) {
  return {
    id: o.id, name: o.name, phone: o.phone, email: o.email,
    address: o.address ?? null,
    bank_name:           o.bankName          ?? null,
    branch_name:         o.branchName        ?? null,
    account_number:      o.accountNumber     ?? null,
    account_holder_name: o.accountHolderName ?? null,
    nic: o.nic ?? null, username: o.username ?? null,
    commission_rate: o.commissionRate, total_earnings: o.totalEarnings,
    pending_payout: o.pendingPayout, sms_opt_in: o.smsOptIn ?? true, created_at: o.createdAt,
  }
}

function bFromDb(r: Record<string, unknown>): Booking {
  return {
    id: r.id as string, vehicleId: r.vehicle_id as string,
    customerId: r.customer_id as string, customerName: r.customer_name as string,
    customerPhone: r.customer_phone as string,
    customerEmail: (r.customer_email as string) ?? undefined,
    customerNIC: (r.customer_nic as string) ?? undefined,
    startDate: r.start_date as string, endDate: r.end_date as string,
    startTime: (r.start_time as string) ?? undefined,
    endTime: (r.end_time as string) ?? undefined,
    waiveExtraDay: (r.waive_extra_day as boolean) ?? undefined,
    totalDays: num(r.total_days), totalAmount: num(r.total_amount),
    estimatedAmount: numOpt(r.estimated_amount),
    paidAmount: num(r.paid_amount),
    status: r.status as Booking['status'],
    referral: (r.referral as string) ?? undefined,
    referralFee: numOpt(r.referral_fee),
    referralPaid: (r.referral_paid as boolean) ?? undefined,
    referralPaidAt: (r.referral_paid_at as string) ?? undefined,
    notes: (r.notes as string) ?? undefined, createdAt: r.created_at as string,
    pickupLocation: (r.pickup_location as string) ?? undefined,
    dropLocation: (r.drop_location as string) ?? undefined,
    driverId: (r.driver_id as string) ?? undefined,
    quotation: (r.quotation as Booking['quotation']) ?? undefined,
    depositType: (r.deposit_type as Booking['depositType']) ?? undefined,
    depositAssetDescription: (r.deposit_asset_description as string) ?? undefined,
    depositAmount: numOpt(r.deposit_amount),
    depositReturned: numOpt(r.deposit_returned),
    depositDeduction: numOpt(r.deposit_deduction),
    depositNotes: (r.deposit_notes as string) ?? undefined,
    pickupAt: (r.pickup_at as string) ?? undefined,
    returnAt: (r.return_at as string) ?? undefined,
    advanceAmount: numOpt(r.advance_amount),
    discount: numOpt(r.discount),
    extraCharges: numOpt(r.extra_charges),
    paymentMethod: (r.payment_method as string) ?? undefined,
    creditAmount: numOpt(r.credit_amount),
    creditSettled: (r.credit_settled as boolean) ?? undefined,
    creditResponsibility: (r.credit_responsibility as Booking['creditResponsibility']) ?? undefined,
  }
}

function bToDb(b: Booking) {
  // Required columns that every row must have.
  const row: Record<string, unknown> = {
    id: b.id, vehicle_id: b.vehicleId, customer_id: b.customerId,
    customer_name: b.customerName, customer_phone: b.customerPhone,
    start_date: b.startDate, end_date: b.endDate, total_days: b.totalDays,
    total_amount: b.totalAmount, paid_amount: b.paidAmount,
    status: b.status, created_at: b.createdAt,
  };
  // Optional columns: only included when they carry a real value so that rows
  // inserted into an older schema (missing these columns) don't throw an error.
  // Supabase uses the column's DEFAULT when the key is absent.
  if (b.startTime          != null) row.start_time          = b.startTime;
  if (b.endTime            != null) row.end_time            = b.endTime;
  if (b.waiveExtraDay)              row.waive_extra_day     = b.waiveExtraDay;  // skip when false (DB default)
  if (b.customerEmail      != null) row.customer_email      = b.customerEmail;
  if (b.customerNIC        != null) row.customer_nic        = b.customerNIC;
  if (b.estimatedAmount    != null) row.estimated_amount    = b.estimatedAmount;
  if (b.referral           != null) row.referral            = b.referral;
  if (b.referralFee        != null) row.referral_fee        = b.referralFee;
  if (b.referralPaid)               row.referral_paid       = b.referralPaid;   // skip when false (DB default)
  if (b.referralPaidAt     != null) row.referral_paid_at    = b.referralPaidAt;
  if (b.notes              != null) row.notes               = b.notes;
  if (b.pickupLocation     != null) row.pickup_location     = b.pickupLocation;
  if (b.dropLocation       != null) row.drop_location       = b.dropLocation;
  if (b.driverId           != null && b.driverId !== '') row.driver_id = b.driverId;
  if (b.quotation          != null) row.quotation           = b.quotation;
  if (b.depositType             != null) row.deposit_type              = b.depositType;
  if (b.depositAssetDescription != null) row.deposit_asset_description = b.depositAssetDescription;
  if (b.depositAmount           != null) row.deposit_amount             = b.depositAmount;
  if (b.depositReturned         != null) row.deposit_returned           = b.depositReturned;
  if (b.depositDeduction        != null) row.deposit_deduction          = b.depositDeduction;
  if (b.depositNotes            != null) row.deposit_notes              = b.depositNotes;
  if (b.pickupAt           != null) row.pickup_at           = b.pickupAt;
  if (b.returnAt           != null) row.return_at           = b.returnAt;
  if (b.advanceAmount      != null) row.advance_amount      = b.advanceAmount;
  if (b.discount           != null) row.discount            = b.discount;
  if (b.extraCharges       != null) row.extra_charges       = b.extraCharges;
  if (b.paymentMethod      != null) row.payment_method      = b.paymentMethod;
  if (b.creditAmount       != null) row.credit_amount       = b.creditAmount;
  if (b.creditSettled)              row.credit_settled      = b.creditSettled;
  if (b.creditResponsibility != null) row.credit_responsibility = b.creditResponsibility;
  return row;
}

function iFromDb(r: Record<string, unknown>): Inquiry {
  return {
    id: r.id as string, customerName: r.customer_name as string,
    customerPhone: r.customer_phone as string,
    requestedVehicle: r.requested_vehicle as string,
    preferredBrand: (r.preferred_brand as string) ?? undefined,
    startDate: r.start_date as string, endDate: r.end_date as string,
    referral: r.referral as string, status: r.status as Inquiry['status'],
    lostReason: (r.lost_reason as string) ?? undefined,
    notes: (r.notes as string) ?? undefined, createdAt: r.created_at as string,
    vehicleId: (r.vehicle_id as string) ?? undefined,
    checklist: (r.checklist as Record<string, boolean>) ?? undefined,
    quote: (r.quote as Inquiry['quote']) ?? undefined,
    alternativeOf: (r.alternative_of as string) ?? undefined,
    alternativeChosen: (r.alternative_chosen as string) ?? undefined,
    alternativesOffered: Array.isArray(r.alternatives_offered) ? (r.alternatives_offered as string[]) : undefined,
    vehicleHistory: Array.isArray(r.vehicle_history) ? (r.vehicle_history as Inquiry['vehicleHistory']) : undefined,
  }
}

function iToDb(i: Inquiry) {
  return {
    id: i.id, customer_name: i.customerName, customer_phone: i.customerPhone,
    requested_vehicle: i.requestedVehicle, preferred_brand: i.preferredBrand ?? null,
    start_date: i.startDate, end_date: i.endDate, referral: i.referral,
    status: i.status, lost_reason: i.lostReason ?? null, notes: i.notes ?? null,
    created_at: i.createdAt,
  }
}

function cFromDb(r: Record<string, unknown>): Commission {
  return {
    id: r.id as string, bookingId: r.booking_id as string,
    vehicleId: r.vehicle_id as string, ownerId: r.owner_id as string,
    referral: r.referral as string, totalIncome: num(r.total_income),
    commissionRate: num(r.commission_rate),
    commissionAmount: num(r.commission_amount),
    ownerPayout: num(r.owner_payout),
    coordinatorFee: numOpt(r.coordinator_fee),
    status: r.status as Commission['status'], createdAt: r.created_at as string,
  }
}

function cToDb(c: Commission) {
  return {
    id: c.id, booking_id: c.bookingId, vehicle_id: c.vehicleId, owner_id: c.ownerId,
    referral: c.referral, total_income: c.totalIncome, commission_rate: c.commissionRate,
    commission_amount: c.commissionAmount, owner_payout: c.ownerPayout,
    coordinator_fee: c.coordinatorFee ?? null, status: c.status, created_at: c.createdAt,
  }
}

function eFromDb(r: Record<string, unknown>): Expense {
  return {
    id: r.id as string, vehicleId: r.vehicle_id as string,
    category: r.category as Expense['category'], amount: num(r.amount),
    description: r.description as string, date: r.date as string,
    receipt: (r.receipt as string) ?? undefined, createdAt: r.created_at as string,
  }
}

function eToDb(e: Expense) {
  return {
    id: e.id, vehicle_id: e.vehicleId, category: e.category, amount: e.amount,
    description: e.description, date: e.date, receipt: e.receipt ?? null,
    created_at: e.createdAt,
  }
}

function dFromDb(r: Record<string, unknown>): Driver {
  return {
    id: r.id as string, name: r.name as string, phone: r.phone as string,
    licenseNumber: r.license_number as string, licenseExpiry: r.license_expiry as string,
    status: r.status as Driver['status'], dailyRate: num(r.daily_rate),
    totalEarnings: num(r.total_earnings),
    currentBookingId: (r.current_booking_id as string) ?? undefined,
    joinedAt: r.joined_at as string, address: (r.address as string) ?? undefined,
    nic: (r.nic as string) ?? undefined,
  }
}

function dToDb(d: Driver) {
  return {
    id: d.id, name: d.name, phone: d.phone, license_number: d.licenseNumber,
    license_expiry: d.licenseExpiry, status: d.status, daily_rate: d.dailyRate,
    total_earnings: d.totalEarnings, current_booking_id: d.currentBookingId ?? null,
    joined_at: d.joinedAt, address: d.address ?? null, nic: d.nic ?? null,
  }
}

function nFromDb(r: Record<string, unknown>): Notification {
  return {
    id: r.id as string, type: r.type as Notification['type'],
    title: r.title as string, message: r.message as string,
    relatedId: (r.related_id as string) ?? undefined,
    ownerId: (r.owner_id as string) ?? undefined,
    read: r.read as boolean, createdAt: r.created_at as string,
  }
}

function nToDb(n: Notification) {
  return {
    id: n.id, type: n.type, title: n.title, message: n.message,
    related_id: n.relatedId ?? null, owner_id: n.ownerId ?? null,
    read: n.read, created_at: n.createdAt,
  }
}

function custFromDb(r: Record<string, unknown>): Customer {
  return {
    id: r.id as string, name: r.name as string, phone: r.phone as string,
    email: (r.email as string) ?? undefined, nic: (r.nic as string) ?? undefined,
    address: (r.address as string) ?? undefined, notes: (r.notes as string) ?? undefined,
    smsOptIn: (r.sms_opt_in as boolean) ?? undefined, createdAt: r.created_at as string,
  }
}

function custToDb(c: Customer) {
  return {
    id: c.id, name: c.name, phone: c.phone, email: c.email ?? null,
    nic: c.nic ?? null, address: c.address ?? null, notes: c.notes ?? null,
    sms_opt_in: c.smsOptIn ?? true, created_at: c.createdAt,
  }
}

function userFromDb(r: Record<string, unknown>): AppUser {
  return {
    id: r.id as string, username: r.username as string, password: r.password as string,
    name: r.name as string, role: r.role as AppUser['role'],
    ownerId: (r.owner_id as string) ?? undefined,
    email: (r.email as string) ?? undefined, nic: (r.nic as string) ?? undefined,
  }
}

function userToDb(u: AppUser) {
  return {
    id: u.id, username: u.username, password: u.password, name: u.name,
    role: u.role, owner_id: u.ownerId ?? null, email: u.email ?? null,
    nic: u.nic ?? null, created_at: new Date().toISOString(),
  }
}

function hFromDb(r: Record<string, unknown>): VehicleHandover {
  return {
    id: r.id as string, bookingId: r.booking_id as string,
    vehicleId: r.vehicle_id as string, type: r.type as VehicleHandover['type'],
    location: r.location as string, dateTime: r.date_time as string,
    mileage: num(r.mileage), fuelLevel: r.fuel_level as string,
    notes: (r.notes as string) ?? undefined, extraKm: numOpt(r.extra_km),
    extraKmCharge: numOpt(r.extra_km_charge),
    finalAmount: numOpt(r.final_amount), createdAt: r.created_at as string,
  }
}

function hToDb(h: VehicleHandover) {
  return {
    id: h.id, booking_id: h.bookingId, vehicle_id: h.vehicleId, type: h.type,
    location: h.location, date_time: h.dateTime, mileage: h.mileage,
    fuel_level: h.fuelLevel, notes: h.notes ?? null, extra_km: h.extraKm ?? null,
    extra_km_charge: h.extraKmCharge ?? null, final_amount: h.finalAmount ?? null,
    created_at: h.createdAt,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic fetch helper
// ─────────────────────────────────────────────────────────────────────────────

async function fetchTable<T>(
  table: string,
  mapper: (r: Record<string, unknown>) => T,
  ascending = true,
  orderColumn = 'created_at',   // drivers has no created_at — uses joined_at
): Promise<T[]> {
  const { data, error } = await supabase
    .from(table)
    .select('*')
    .order(orderColumn, { ascending })
  if (error) throw error
  return (data ?? []).map(mapper)
}

// ─────────────────────────────────────────────────────────────────────────────
// DB API
// ─────────────────────────────────────────────────────────────────────────────

export async function dbFetchAll() {
  const [vehicles, owners, bookings, inquiries, commissions, expenses, drivers, notifications, handovers, customers] =
    await Promise.all([
      fetchTable<Vehicle>('vehicles', vFromDb),
      fetchTable<Owner>('owners', oFromDb),
      fetchTable<Booking>('bookings', bFromDb),
      fetchTable<Inquiry>('inquiries', iFromDb),
      fetchTable<Commission>('commissions', cFromDb),
      fetchTable<Expense>('expenses', eFromDb),
      fetchTable<Driver>('drivers', dFromDb, true, 'joined_at'),
      fetchTable<Notification>('notifications', nFromDb, false),
      fetchTable<VehicleHandover>('handovers', hFromDb),
      fetchTable<Customer>('customers', custFromDb),
    ])
  return { vehicles, owners, bookings, inquiries, commissions, expenses, drivers, notifications, handovers, customers }
}

/** Login profiles — fetched by the auth store (not part of dbFetchAll). */
export async function dbFetchUsers(): Promise<AppUser[]> {
  return fetchTable<AppUser>('users', userFromDb)
}

export const db = {
  // ── Vehicles ──────────────────────────────────────────────────────────────
  insertVehicle: (v: Vehicle) => supabase.from('vehicles').insert(vToDb(v)),
  updateVehicle: (id: string, u: Partial<Vehicle>) => {
    const row: Record<string, unknown> = {}
    if (u.vehicleNumber !== undefined) row.vehicle_number = u.vehicleNumber
    if (u.brand !== undefined) row.brand = u.brand
    if (u.model !== undefined) row.model = u.model
    if (u.year !== undefined) row.year = u.year
    if (u.ownerId !== undefined) row.owner_id = u.ownerId
    if (u.dailyRent !== undefined) row.daily_rent = u.dailyRent
    if (u.extraKmRate !== undefined) row.extra_km_rate = u.extraKmRate
    if (u.includedKmPerDay !== undefined) row.included_km_per_day = u.includedKmPerDay
    if (u.status !== undefined) row.status = u.status
    if (u.insurance !== undefined) row.insurance = u.insurance
    if (u.revenue !== undefined) row.revenue = u.revenue
    if (u.rentCount !== undefined) row.rent_count = u.rentCount
    if ('imageUrl' in u) row.image_url = u.imageUrl ?? null
    if ('heroImageUrl' in u) row.hero_image_url = u.heroImageUrl ?? null
    if (u.photoUrls !== undefined) row.photo_urls = u.photoUrls
    if (u.color !== undefined) row.color = u.color
    if (u.seats !== undefined) row.seats = u.seats
    if (u.fuelType !== undefined) row.fuel_type = u.fuelType
    if (u.transmission !== undefined) row.transmission = u.transmission
    if (u.mileage !== undefined) row.mileage = u.mileage
    // undefined = untouched (skip); null = cleared
    if (u.fuelEfficiency !== undefined) row.fuel_efficiency = u.fuelEfficiency
    if (u.tankCapacity !== undefined) row.tank_capacity = u.tankCapacity
    if (u.webFeatured !== undefined) row.web_featured = u.webFeatured
    if ('webOrder' in u) row.web_order = u.webOrder ?? null
    if ('webCategory' in u) row.web_category = u.webCategory || null
    if ('webBadge' in u) row.web_badge = u.webBadge || null
    if ('webLocation' in u) row.web_location = u.webLocation || null
    if ('webPrice' in u) row.web_price = u.webPrice ?? null
    return supabase.from('vehicles').update(row).eq('id', id)
  },
  deleteVehicle: (id: string) => supabase.from('vehicles').delete().eq('id', id),

  // ── Owners ────────────────────────────────────────────────────────────────
  insertOwner: (o: Owner) => supabase.from('owners').insert(oToDb(o)),
  updateOwner: (id: string, u: Partial<Owner>) => {
    const row: Record<string, unknown> = {}
    if (u.name !== undefined) row.name = u.name
    if (u.phone !== undefined) row.phone = u.phone
    if (u.email !== undefined) row.email = u.email
    if (u.address            !== undefined) row.address             = u.address
    if (u.bankName           !== undefined) row.bank_name           = u.bankName
    if (u.branchName         !== undefined) row.branch_name         = u.branchName
    if (u.accountNumber      !== undefined) row.account_number      = u.accountNumber
    if (u.accountHolderName  !== undefined) row.account_holder_name = u.accountHolderName
    if (u.nic !== undefined) row.nic = u.nic
    if (u.username !== undefined) row.username = u.username
    if (u.commissionRate !== undefined) row.commission_rate = u.commissionRate
    if (u.totalEarnings !== undefined) row.total_earnings = u.totalEarnings
    if (u.pendingPayout !== undefined) row.pending_payout = u.pendingPayout
    if (u.smsOptIn !== undefined) row.sms_opt_in = u.smsOptIn
    return supabase.from('owners').update(row).eq('id', id)
  },

  // ── Bookings ──────────────────────────────────────────────────────────────
  insertBooking: (b: Booking) => supabase.from('bookings').insert(bToDb(b)),
  updateBooking: (id: string, u: Partial<Booking>) => {
    const row: Record<string, unknown> = {}
    if (u.status !== undefined) row.status = u.status
    if (u.paidAmount !== undefined) row.paid_amount = u.paidAmount
    if (u.totalAmount !== undefined) row.total_amount = u.totalAmount
    if (u.estimatedAmount !== undefined) row.estimated_amount = u.estimatedAmount
    if (u.notes !== undefined) row.notes = u.notes
    if (u.driverId !== undefined) row.driver_id = u.driverId
    if (u.pickupLocation !== undefined) row.pickup_location = u.pickupLocation
    if (u.dropLocation !== undefined) row.drop_location = u.dropLocation
    if (u.quotation !== undefined) row.quotation = u.quotation
    if (u.depositType             !== undefined) row.deposit_type              = u.depositType
    if (u.depositAssetDescription !== undefined) row.deposit_asset_description = u.depositAssetDescription
    if (u.depositAmount           !== undefined) row.deposit_amount             = u.depositAmount
    if (u.depositReturned         !== undefined) row.deposit_returned           = u.depositReturned
    if (u.depositDeduction        !== undefined) row.deposit_deduction          = u.depositDeduction
    if (u.depositNotes            !== undefined) row.deposit_notes              = u.depositNotes
    if (u.referralPaid !== undefined) row.referral_paid = u.referralPaid
    if (u.referralPaidAt !== undefined) row.referral_paid_at = u.referralPaidAt
    if (u.startTime !== undefined) row.start_time = u.startTime
    if (u.endTime !== undefined) row.end_time = u.endTime
    if (u.pickupAt !== undefined) row.pickup_at = u.pickupAt
    if (u.returnAt !== undefined) row.return_at = u.returnAt
    if (u.advanceAmount !== undefined) row.advance_amount = u.advanceAmount
    if (u.discount !== undefined) row.discount = u.discount
    if (u.extraCharges !== undefined) row.extra_charges = u.extraCharges
    if (u.paymentMethod !== undefined) row.payment_method = u.paymentMethod
    if (u.creditAmount !== undefined) row.credit_amount = u.creditAmount
    if (u.creditSettled !== undefined) row.credit_settled = u.creditSettled
    if (u.creditResponsibility !== undefined) row.credit_responsibility = u.creditResponsibility
    return supabase.from('bookings').update(row).eq('id', id)
  },

  // ── Inquiries ─────────────────────────────────────────────────────────────
  insertInquiry: (i: Inquiry) => supabase.from('inquiries').insert(iToDb(i)),
  updateInquiry: (id: string, u: Partial<Inquiry>) => {
    const row: Record<string, unknown> = {}
    if (u.status !== undefined) row.status = u.status
    if (u.notes !== undefined) row.notes = u.notes
    if (u.lostReason !== undefined) row.lost_reason = u.lostReason
    if (u.customerName !== undefined) row.customer_name = u.customerName
    if (u.customerPhone !== undefined) row.customer_phone = u.customerPhone
    if (u.requestedVehicle !== undefined) row.requested_vehicle = u.requestedVehicle
    if (u.startDate !== undefined) row.start_date = u.startDate
    if (u.endDate !== undefined) row.end_date = u.endDate
    if (u.vehicleId !== undefined) row.vehicle_id = u.vehicleId
    if (u.checklist !== undefined) row.checklist = u.checklist
    if (u.quote !== undefined) row.quote = u.quote
    if (u.alternativesOffered !== undefined) row.alternatives_offered = u.alternativesOffered
    return supabase.from('inquiries').update(row).eq('id', id)
  },

  // ── Commissions ───────────────────────────────────────────────────────────
  insertCommission: (c: Commission) => supabase.from('commissions').insert(cToDb(c)),
  updateCommission: (id: string, u: Partial<Commission>) => {
    const row: Record<string, unknown> = {}
    if (u.status !== undefined) row.status = u.status
    if (u.coordinatorFee !== undefined) row.coordinator_fee = u.coordinatorFee
    return supabase.from('commissions').update(row).eq('id', id)
  },

  // ── Expenses ──────────────────────────────────────────────────────────────
  insertExpense: (e: Expense) => supabase.from('expenses').insert(eToDb(e)),
  deleteExpense: (id: string) => supabase.from('expenses').delete().eq('id', id),

  // ── Drivers ───────────────────────────────────────────────────────────────
  insertDriver: (d: Driver) => supabase.from('drivers').insert(dToDb(d)),
  updateDriver: (id: string, u: Partial<Driver>) => {
    const row: Record<string, unknown> = {}
    if (u.name !== undefined) row.name = u.name
    if (u.phone !== undefined) row.phone = u.phone
    if (u.status !== undefined) row.status = u.status
    if (u.licenseNumber !== undefined) row.license_number = u.licenseNumber
    if (u.licenseExpiry !== undefined) row.license_expiry = u.licenseExpiry
    if (u.dailyRate !== undefined) row.daily_rate = u.dailyRate
    if (u.totalEarnings !== undefined) row.total_earnings = u.totalEarnings
    if (u.currentBookingId !== undefined) row.current_booking_id = u.currentBookingId ?? null
    if (u.address !== undefined) row.address = u.address
    return supabase.from('drivers').update(row).eq('id', id)
  },

  // ── Notifications ─────────────────────────────────────────────────────────
  insertNotification: (n: Notification) => supabase.from('notifications').insert(nToDb(n)),
  updateNotification: (id: string, u: Partial<Notification>) => {
    const row: Record<string, unknown> = {}
    if (u.read !== undefined) row.read = u.read
    return supabase.from('notifications').update(row).eq('id', id)
  },

  // ── Handovers ─────────────────────────────────────────────────────────────
  insertHandover: (h: VehicleHandover) => supabase.from('handovers').insert(hToDb(h)),

  // ── Customers ─────────────────────────────────────────────────────────────
  insertCustomer: (c: Customer) => supabase.from('customers').insert(custToDb(c)),
  updateCustomer: (id: string, u: Partial<Customer>) => {
    const row: Record<string, unknown> = {}
    if (u.name !== undefined) row.name = u.name
    if (u.phone !== undefined) row.phone = u.phone
    if (u.email !== undefined) row.email = u.email
    if (u.nic !== undefined) row.nic = u.nic
    if (u.address !== undefined) row.address = u.address
    if (u.notes !== undefined) row.notes = u.notes
    if (u.smsOptIn !== undefined) row.sms_opt_in = u.smsOptIn
    return supabase.from('customers').update(row).eq('id', id)
  },
  deleteCustomer: (id: string) => supabase.from('customers').delete().eq('id', id),

  // ── Users (login profiles) ──────────────────────────────────────────────────
  insertUser: (u: AppUser) => supabase.from('users').insert(userToDb(u)),
  updateUser: (id: string, u: Partial<AppUser>) => {
    const row: Record<string, unknown> = {}
    if (u.username !== undefined) row.username = u.username
    if (u.password !== undefined) row.password = u.password
    if (u.name !== undefined) row.name = u.name
    if (u.role !== undefined) row.role = u.role
    if (u.ownerId !== undefined) row.owner_id = u.ownerId
    if (u.email !== undefined) row.email = u.email
    if (u.nic !== undefined) row.nic = u.nic
    return supabase.from('users').update(row).eq('id', id)
  },
  deleteUser: (id: string) => supabase.from('users').delete().eq('id', id),
}
