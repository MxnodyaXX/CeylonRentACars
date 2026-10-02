import {
  Vehicle, Owner, Booking, Inquiry, Commission,
  Expense, Driver, Notification, VehicleHandover, Customer,
} from '../types';
import cab1234Img from './CAB-1234.png';

// ─────────────────────────────────────────────────────────────────────────────
//  Reference date: 2026-06-01 (today)
//
//  Ownership map
//    o1 Sumod Pieris   (15%)  →  v1 Prius, v2 Axio
//    o2 Pavith Bimsara   (12%)  →  v3 Vezel, v6 X-Trail
//    o3 Roshan Fernando(18%) →  v4 Alto,  v8 Fit
//    o4 Priya Jayawardena(15%)→ v5 HiAce
//    o5 Ruwan Bandara (20%)  →  v7 Montero
//
//  Vehicle status
//    v1 Reserved  (bk15 Roshani – Confirmed future)
//    v2 Ongoing   (bk10 Pradeep – ends 2026-06-03)
//    v3 Ongoing   (bk11 Sanduni – ends 2026-06-04)
//    v4 Available (last booking completed)
//    v5 Ongoing   (bk12 Amila   – ends 2026-06-05)
//    v6 Reserved  (bk14 Sanjay  – Confirmed future)
//    v7 Reserved  (bk16 Chamara – Confirmed future)
//    v8 Reserved  (bk13 Thisara – Confirmed future)
//
//  Commission status
//    Completed + fully paid  → Paid
//    Completed + partial pay → Credit   (bk4 Roshani demo)
//    Ongoing / Confirmed     → Pending
//
//  bk8 (Montero) has extra-km charge: 300km × Rs70 = Rs21 000 on top of base
// ─────────────────────────────────────────────────────────────────────────────

export const sampleData: {
  owners:        Owner[];
  vehicles:      Vehicle[];
  bookings:      Booking[];
  inquiries:     Inquiry[];
  commissions:   Commission[];
  expenses:      Expense[];
  drivers:       Driver[];
  notifications: Notification[];
  handovers:     VehicleHandover[];
  customers:     Customer[];
} = {

  // ── Owners ────────────────────────────────────────────────────────────────
  owners: [
    {
      id: 'o1', name: 'Sumod Pieris', phone: '0758313004',
      email: 'sumod.pieris@email.com', address: 'No. 45, Flower Road, Colombo 07',
      bankName: 'Commercial Bank', branchName: 'Colombo 07', accountNumber: '1200034567890', accountHolderName: 'Sumod Pieris',
      commissionRate: 0,
      // Paid payouts: bk1(22500)+bk7(18000)+bk2(14000) = 54500
      totalEarnings: 54500,
      // Pending payouts: bk15(18000)+bk10(14000) = 32000
      pendingPayout: 32000,
      createdAt: '2024-01-10T00:00:00Z',
    },
    {
      id: 'o2', name: 'Pavith Bimsara', phone: '0716986695',
      email: 'pavith.bimsara@email.com', address: '23/B, Lake Drive, Battaramulla',
      bankName: 'Peoples Bank', branchName: 'Battaramulla', accountNumber: '2090976543210', accountHolderName: 'Pavith Bimsara',
      commissionRate: 0,
      // Paid payouts: bk3(31000)+bk6(40000) = 71000  (both Kasun-referred, Rs 2,000 fee each)
      totalEarnings: 71000,
      // Pending: bk11(38500)+bk14(33000) = 71500
      pendingPayout: 71500,
      createdAt: '2024-02-15T00:00:00Z',
    },
    {
      id: 'o3', name: 'Roshan Fernando', phone: '0763456789',
      email: 'roshan.fernando@email.com', address: '78, Main Street, Gampaha',
      bankName: 'Bank of Ceylon', branchName: 'Gampaha', accountNumber: '3050056667778', accountHolderName: 'Roshan Fernando',
      commissionRate: 0,
      // Paid: bk4-credit not in earnings; bk9(8500, Nimesh-referred Rs 500 fee) = 8500
      totalEarnings: 8500,
      // Pending: bk13(12000) = 12000
      pendingPayout: 12000,
      createdAt: '2024-03-01T00:00:00Z',
    },
    {
      id: 'o4', name: 'Priya Jayawardena', phone: '0752345678',
      email: 'priya.j@email.com', address: '12, Temple Road, Kandy',
      bankName: 'Hatton National Bank', branchName: 'Kandy', accountNumber: '4040043332221', accountHolderName: 'Priya Jayawardena',
      commissionRate: 0,
      // Paid: bk5(37500, Kamal-referred Rs 2,500 fee)
      totalEarnings: 37500,
      // Pending: bk12(40000)
      pendingPayout: 40000,
      createdAt: '2024-04-05T00:00:00Z',
    },
    {
      id: 'o5', name: 'Ruwan Bandara', phone: '0745678901',
      email: 'ruwan.bandara@email.com', address: '55, Hill Street, Nugegoda',
      bankName: 'Sampath Bank', branchName: 'Nugegoda', accountNumber: '5070078889990', accountHolderName: 'Ruwan Bandara',
      commissionRate: 0,
      // Paid: bk8 final=66000, Kamal-referred Rs 3,000 fee → payout 63000
      totalEarnings: 63000,
      // Pending: bk16(25500, Nimal-referred Rs 1,500 fee)
      pendingPayout: 25500,
      createdAt: '2024-05-12T00:00:00Z',
    },
  ],

  // ── Vehicles ──────────────────────────────────────────────────────────────
  vehicles: [
    {
      id: 'v1', vehicleNumber: 'CAB-1234', imageUrl: cab1234Img,
      brand: 'Toyota', model: 'Prius', year: 2021, ownerId: 'o1',
      dailyRent: 4500, extraKmRate: 40, includedKmPerDay: 100,
      status: 'Reserved', color: 'Silver', seats: 5,
      fuelType: 'Hybrid', transmission: 'Automatic', mileage: 42870,
      insurance: { provider: 'Ceylinco Insurance', policyNumber: 'CEY-2024-001', expiryDate: '2027-06-30', premium: 45000 },
      // bk1(22500)+bk7(18000)+bk15(18000) = 58500, rentCount=3
      revenue: 58500, rentCount: 3,
      createdAt: '2024-01-10T00:00:00Z',
    },
    {
      id: 'v2', vehicleNumber: 'CAD-8899',
      brand: 'Toyota', model: 'Axio', year: 2019, ownerId: 'o1',
      dailyRent: 3500, extraKmRate: 35, includedKmPerDay: 100,
      status: 'Ongoing', color: 'White', seats: 5,
      fuelType: 'Hybrid', transmission: 'Automatic', mileage: 28370,
      insurance: { provider: 'AIA Insurance', policyNumber: 'AIA-2024-042', expiryDate: '2026-09-20', premium: 32000 },
      // bk2(14000)+bk10(14000) = 28000, rentCount=2
      revenue: 28000, rentCount: 2,
      createdAt: '2024-02-15T00:00:00Z',
    },
    {
      id: 'v3', vehicleNumber: 'CBF-5567',
      brand: 'Honda', model: 'Vezel', year: 2022, ownerId: 'o2',
      dailyRent: 5500, extraKmRate: 45, includedKmPerDay: 150,
      status: 'Ongoing', color: 'Grey', seats: 5,
      fuelType: 'Hybrid', transmission: 'CVT', mileage: 35840,
      insurance: { provider: 'Union Assurance', policyNumber: 'UA-2024-055', expiryDate: '2027-03-10', premium: 52000 },
      // bk3(33000)+bk11(38500) = 71500, rentCount=2
      revenue: 71500, rentCount: 2,
      createdAt: '2024-03-05T00:00:00Z',
    },
    {
      id: 'v4', vehicleNumber: 'CAA-3312',
      brand: 'Suzuki', model: 'Alto', year: 2020, ownerId: 'o3',
      dailyRent: 2500, extraKmRate: 30, includedKmPerDay: 80,
      status: 'Available', color: 'Red', seats: 4,
      fuelType: 'Petrol', transmission: 'Manual', mileage: 19230,
      insurance: { provider: 'Ceylinco Insurance', policyNumber: 'CEY-2024-099', expiryDate: '2026-08-15', premium: 22000 },
      // bk4(7500) = 7500, rentCount=1 (bk17 cancelled excluded)
      revenue: 7500, rentCount: 1,
      createdAt: '2024-04-10T00:00:00Z',
    },
    {
      id: 'v5', vehicleNumber: 'CBD-7721',
      brand: 'Toyota', model: 'HiAce', year: 2018, ownerId: 'o4',
      dailyRent: 8000, extraKmRate: 60, includedKmPerDay: 200,
      status: 'Ongoing', color: 'White', seats: 14,
      fuelType: 'Diesel', transmission: 'Manual', mileage: 104950,
      insurance: { provider: 'AIA Insurance', policyNumber: 'AIA-2024-210', expiryDate: '2027-01-20', premium: 68000 },
      // bk5(40000)+bk12(40000) = 80000, rentCount=2
      revenue: 80000, rentCount: 2,
      createdAt: '2024-01-20T00:00:00Z',
    },
    {
      id: 'v6', vehicleNumber: 'CPK-4456',
      brand: 'Nissan', model: 'X-Trail', year: 2021, ownerId: 'o2',
      dailyRent: 7000, extraKmRate: 55, includedKmPerDay: 150,
      status: 'Reserved', color: 'Silver', seats: 7,
      fuelType: 'Petrol', transmission: 'Automatic', mileage: 11880,
      insurance: { provider: 'Union Assurance', policyNumber: 'UA-2024-033', expiryDate: '2027-11-30', premium: 58000 },
      // bk6(42000)+bk14(35000) = 77000, rentCount=2
      revenue: 77000, rentCount: 2,
      createdAt: '2024-05-10T00:00:00Z',
    },
    {
      id: 'v7', vehicleNumber: 'CPC-2287',
      brand: 'Mitsubishi', model: 'Montero', year: 2020, ownerId: 'o5',
      dailyRent: 9000, extraKmRate: 70, includedKmPerDay: 150,
      status: 'Reserved', color: 'Black', seats: 7,
      fuelType: 'Diesel', transmission: 'Automatic', mileage: 68050,
      insurance: { provider: 'Ceylinco Insurance', policyNumber: 'CEY-2024-188', expiryDate: '2027-08-05', premium: 72000 },
      // bk8 finalIncome=66000; bk16(27000) = 93000, rentCount=2
      revenue: 93000, rentCount: 2,
      createdAt: '2024-06-01T00:00:00Z',
    },
    {
      id: 'v8', vehicleNumber: 'CBB-9934',
      brand: 'Honda', model: 'Fit', year: 2019, ownerId: 'o3',
      dailyRent: 3000, extraKmRate: 30, includedKmPerDay: 100,
      status: 'Reserved', color: 'Blue', seats: 5,
      fuelType: 'Petrol', transmission: 'Automatic', mileage: 79280,
      insurance: { provider: 'AIA Insurance', policyNumber: 'AIA-2024-301', expiryDate: '2026-12-31', premium: 28000 },
      // bk9(9000)+bk13(12000) = 21000, rentCount=2
      revenue: 21000, rentCount: 2,
      createdAt: '2024-07-15T00:00:00Z',
    },
  ],

  // ── Customers ─────────────────────────────────────────────────────────────
  customers: [
    {
      id: 'cust1', name: 'Amila Jayasinghe', phone: '0712345678',
      email: 'amila.j@gmail.com', nic: '901234567V',
      address: 'No. 14, Peradeniya Road, Kandy',
      notes: 'Prefers automatic transmission. Regular client.',
      createdAt: '2026-04-28T00:00:00Z',
    },
    {
      id: 'cust2', name: 'Sanjay Kumar', phone: '0723456789',
      email: 'sanjay.k@gmail.com', nic: '882345678V',
      address: '22, Galle Road, Colombo 06',
      createdAt: '2026-04-30T00:00:00Z',
    },
    {
      id: 'cust3', name: 'Thisara Madusanka', phone: '0734567890',
      email: 'thisara.m@email.com', nic: '953456789V',
      address: '88, Kandy Road, Gampaha',
      createdAt: '2026-05-08T00:00:00Z',
    },
    {
      id: 'cust4', name: 'Roshani Perera', phone: '0745678901',
      email: 'roshani.p@gmail.com', nic: '974567890V',
      address: '7, Station Road, Negombo',
      notes: 'Has outstanding balance from May booking.',
      createdAt: '2026-05-10T00:00:00Z',
    },
    {
      id: 'cust5', name: 'Dinesh Weerasinghe', phone: '0756789012',
      email: 'dinesh.w@email.com', nic: '856789012V',
      address: '45, Temple Road, Matara',
      createdAt: '2026-05-15T00:00:00Z',
    },
    {
      id: 'cust6', name: 'Chamara Silva', phone: '0767890123',
      email: 'chamara.s@gmail.com', nic: '907890123V',
      address: '33, Rajagiriya Gardens, Rajagiriya',
      createdAt: '2026-05-18T00:00:00Z',
    },
    {
      id: 'cust7', name: 'Nalini Fernando', phone: '0778901234',
      email: 'nalini.f@email.com', nic: '918901234V',
      address: 'No. 5, Wijerama Mawatha, Colombo 07',
      createdAt: '2026-05-22T00:00:00Z',
    },
    {
      id: 'cust8', name: 'Kasun Rajapaksa', phone: '0789012345',
      email: 'kasun.r@gmail.com', nic: '939012345V',
      address: '120, Highlevel Road, Maharagama',
      createdAt: '2026-05-24T00:00:00Z',
    },
    {
      id: 'cust9', name: 'Pradeep Rathnayake', phone: '0711234567',
      email: 'pradeep.r@email.com', nic: '871234567V',
      address: '67, Kurunegala Road, Kelaniya',
      createdAt: '2026-05-28T00:00:00Z',
    },
    {
      id: 'cust10', name: 'Sanduni Wickramasinghe', phone: '0722345678',
      email: 'sanduni.w@gmail.com', nic: '992345678V',
      address: '18, Park Avenue, Nugegoda',
      createdAt: '2026-05-26T00:00:00Z',
    },
  ],

  // ── Bookings ──────────────────────────────────────────────────────────────
  // totalAmount = dailyRent × totalDays  (base; extra-km settled at return for bk8)
  bookings: [
    // ── COMPLETED ────────────────────────────────────────────────
    {
      id: 'bk1', vehicleId: 'v1', customerId: 'cust1',
      customerName: 'Amila Jayasinghe', customerPhone: '0712345678',
      customerEmail: 'amila.j@gmail.com', customerNIC: '901234567V',
      startDate: '2026-05-01', endDate: '2026-05-05', totalDays: 5,
      totalAmount: 22500, paidAmount: 22500,  // 5 × 4500
      status: 'Completed', referral: 'Direct',
      pickupLocation: 'Colombo 03', dropLocation: 'Colombo 03',
      notes: 'Minor scratch noted on rear bumper at delivery.',
      createdAt: '2026-04-28T10:00:00Z',
    },
    {
      id: 'bk2', vehicleId: 'v2', customerId: 'cust2',
      customerName: 'Sanjay Kumar', customerPhone: '0723456789',
      customerEmail: 'sanjay.k@gmail.com', customerNIC: '882345678V',
      startDate: '2026-05-03', endDate: '2026-05-06', totalDays: 4,
      totalAmount: 14000, paidAmount: 14000,  // 4 × 3500
      status: 'Completed', referral: 'WhatsApp',
      pickupLocation: 'Kandy City Hotel', dropLocation: 'Kandy City Hotel',
      createdAt: '2026-04-30T09:00:00Z',
    },
    {
      id: 'bk3', vehicleId: 'v3', customerId: 'cust3',
      customerName: 'Thisara Madusanka', customerPhone: '0734567890',
      customerEmail: 'thisara.m@email.com', customerNIC: '953456789V',
      startDate: '2026-05-10', endDate: '2026-05-15', totalDays: 6,
      totalAmount: 33000, paidAmount: 33000,  // 6 × 5500
      status: 'Completed', referral: 'Sumod Pieris',
      referralFeeType: 'fixed', referralFeeValue: 2000, referralFee: 2000,
      pickupLocation: 'Galle Road, Colombo 03', dropLocation: 'Galle Road, Colombo 03',
      createdAt: '2026-05-08T08:00:00Z',
    },
    {
      id: 'bk4', vehicleId: 'v4', customerId: 'cust4',
      customerName: 'Roshani Perera', customerPhone: '0745678901',
      customerEmail: 'roshani.p@gmail.com', customerNIC: '974567890V',
      startDate: '2026-05-12', endDate: '2026-05-14', totalDays: 3,
      totalAmount: 7500, paidAmount: 5000,  // 3 × 2500 – partial payment (Credit commission)
      status: 'Completed', referral: 'Direct',
      pickupLocation: 'Gampaha', dropLocation: 'Gampaha',
      notes: 'Customer requested payment by instalments. Rs 2500 outstanding.',
      createdAt: '2026-05-10T11:00:00Z',
    },
    {
      id: 'bk5', vehicleId: 'v5', customerId: 'cust5',
      customerName: 'Dinesh Weerasinghe', customerPhone: '0756789012',
      customerEmail: 'dinesh.w@email.com', customerNIC: '856789012V',
      startDate: '2026-05-18', endDate: '2026-05-22', totalDays: 5,
      totalAmount: 40000, paidAmount: 40000,  // 5 × 8000
      status: 'Completed', referral: 'Sumod Pieris',
      referralFeeType: 'fixed', referralFeeValue: 2500, referralFee: 2500,
      pickupLocation: 'Colombo Fort', dropLocation: 'Colombo Fort',
      notes: 'Group of 12 passengers. Event transport.',
      createdAt: '2026-05-15T08:00:00Z',
    },
    {
      id: 'bk6', vehicleId: 'v6', customerId: 'cust6',
      customerName: 'Chamara Silva', customerPhone: '0767890123',
      customerEmail: 'chamara.s@gmail.com', customerNIC: '907890123V',
      startDate: '2026-05-20', endDate: '2026-05-25', totalDays: 6,
      totalAmount: 42000, paidAmount: 42000,  // 6 × 7000
      status: 'Completed', referral: 'Sumod Pieris',
      referralFeeType: 'fixed', referralFeeValue: 2000, referralFee: 2000,
      pickupLocation: 'Rajagiriya', dropLocation: 'Rajagiriya',
      createdAt: '2026-05-18T09:00:00Z',
    },
    {
      id: 'bk7', vehicleId: 'v1', customerId: 'cust7',
      customerName: 'Nalini Fernando', customerPhone: '0778901234',
      customerEmail: 'nalini.f@email.com', customerNIC: '918901234V',
      startDate: '2026-05-25', endDate: '2026-05-28', totalDays: 4,
      totalAmount: 18000, paidAmount: 18000,  // 4 × 4500
      status: 'Completed', referral: 'Instagram',
      pickupLocation: 'Colombo 03', dropLocation: 'Colombo 03',
      createdAt: '2026-05-22T10:00:00Z',
    },
    {
      id: 'bk8', vehicleId: 'v7', customerId: 'cust8',
      customerName: 'Kasun Rajapaksa', customerPhone: '0789012345',
      customerEmail: 'kasun.r@gmail.com', customerNIC: '939012345V',
      startDate: '2026-05-26', endDate: '2026-05-30', totalDays: 5,
      // base=45000; 1050km driven, 750km free, 300 extra × 70 = 21000; final=66000
      totalAmount: 45000, paidAmount: 66000,
      status: 'Completed', referral: 'Sumod Pieris',
      referralFeeType: 'fixed', referralFeeValue: 3000, referralFee: 3000,
      pickupLocation: 'Bambalapitiya', dropLocation: 'Bambalapitiya',
      notes: 'Overran included km — extra charge Rs 21,000 settled at return.',
      createdAt: '2026-05-24T08:00:00Z',
    },
    {
      id: 'bk9', vehicleId: 'v8', customerId: 'cust2',
      customerName: 'Sanjay Kumar', customerPhone: '0723456789',
      customerEmail: 'sanjay.k@gmail.com', customerNIC: '882345678V',
      startDate: '2026-05-28', endDate: '2026-05-30', totalDays: 3,
      totalAmount: 9000, paidAmount: 9000,  // 3 × 3000
      status: 'Completed', referral: 'Pavith Bimsara',
      referralFeeType: 'fixed', referralFeeValue: 500, referralFee: 500,
      pickupLocation: 'Wattala', dropLocation: 'Wattala',
      createdAt: '2026-05-26T09:00:00Z',
    },

    // ── ONGOING ──────────────────────────────────────────────────
    {
      id: 'bk10', vehicleId: 'v2', customerId: 'cust9',
      customerName: 'Pradeep Rathnayake', customerPhone: '0711234567',
      customerEmail: 'pradeep.r@email.com', customerNIC: '871234567V',
      startDate: '2026-05-31', endDate: '2026-06-03', totalDays: 4,
      totalAmount: 14000, paidAmount: 5000,  // 4 × 3500 – advance paid
      status: 'Ongoing', referral: 'Direct',
      pickupLocation: 'Kelaniya', dropLocation: 'Kelaniya',
      createdAt: '2026-05-28T10:00:00Z',
    },
    {
      id: 'bk11', vehicleId: 'v3', customerId: 'cust10',
      customerName: 'Sanduni Wickramasinghe', customerPhone: '0722345678',
      customerEmail: 'sanduni.w@gmail.com', customerNIC: '992345678V',
      startDate: '2026-05-29', endDate: '2026-06-04', totalDays: 7,
      totalAmount: 38500, paidAmount: 10000,  // 7 × 5500
      status: 'Ongoing', referral: 'Facebook',
      pickupLocation: 'Nugegoda', dropLocation: 'Nugegoda',
      driverId: 'd1',
      createdAt: '2026-05-26T11:00:00Z',
    },
    {
      id: 'bk12', vehicleId: 'v5', customerId: 'cust1',
      customerName: 'Amila Jayasinghe', customerPhone: '0712345678',
      customerEmail: 'amila.j@gmail.com', customerNIC: '901234567V',
      startDate: '2026-06-01', endDate: '2026-06-05', totalDays: 5,
      totalAmount: 40000, paidAmount: 20000,  // 5 × 8000
      status: 'Ongoing', referral: 'TikTok',
      pickupLocation: 'Colombo Fort', dropLocation: 'Colombo Fort',
      driverId: 'd2',
      notes: 'Corporate event transport for 12 pax.',
      createdAt: '2026-05-29T07:00:00Z',
    },

    // ── CONFIRMED ────────────────────────────────────────────────
    {
      id: 'bk13', vehicleId: 'v8', customerId: 'cust3',
      customerName: 'Thisara Madusanka', customerPhone: '0734567890',
      customerEmail: 'thisara.m@email.com', customerNIC: '953456789V',
      startDate: '2026-06-05', endDate: '2026-06-08', totalDays: 4,
      totalAmount: 12000, paidAmount: 5000,  // 4 × 3000
      status: 'Confirmed', referral: 'Google',
      pickupLocation: 'Gampaha', dropLocation: 'Gampaha',
      createdAt: '2026-05-31T09:00:00Z',
    },
    {
      id: 'bk14', vehicleId: 'v6', customerId: 'cust2',
      customerName: 'Sanjay Kumar', customerPhone: '0723456789',
      customerEmail: 'sanjay.k@gmail.com', customerNIC: '882345678V',
      startDate: '2026-06-08', endDate: '2026-06-12', totalDays: 5,
      totalAmount: 35000, paidAmount: 10000,  // 5 × 7000
      status: 'Confirmed', referral: 'Sumod Pieris',
      referralFeeType: 'fixed', referralFeeValue: 2000, referralFee: 2000,
      pickupLocation: 'Colombo 06', dropLocation: 'Colombo 06',
      createdAt: '2026-06-01T10:00:00Z',
    },
    {
      id: 'bk15', vehicleId: 'v1', customerId: 'cust4',
      customerName: 'Roshani Perera', customerPhone: '0745678901',
      customerEmail: 'roshani.p@gmail.com', customerNIC: '974567890V',
      startDate: '2026-06-10', endDate: '2026-06-13', totalDays: 4,
      totalAmount: 18000, paidAmount: 0,  // 4 × 4500
      status: 'Confirmed', referral: 'Word of Mouth',
      pickupLocation: 'Negombo', dropLocation: 'Negombo',
      createdAt: '2026-06-01T14:00:00Z',
    },
    {
      id: 'bk16', vehicleId: 'v7', customerId: 'cust6',
      customerName: 'Chamara Silva', customerPhone: '0767890123',
      customerEmail: 'chamara.s@gmail.com', customerNIC: '907890123V',
      startDate: '2026-06-15', endDate: '2026-06-17', totalDays: 3,
      totalAmount: 27000, paidAmount: 10000,  // 3 × 9000
      status: 'Confirmed', referral: 'Pavith Bimsara',
      referralFeeType: 'fixed', referralFeeValue: 1500, referralFee: 1500,
      pickupLocation: 'Rajagiriya', dropLocation: 'Rajagiriya',
      createdAt: '2026-06-01T15:00:00Z',
    },

    // ── CANCELLED ────────────────────────────────────────────────
    {
      id: 'bk17', vehicleId: 'v4', customerId: 'cust5',
      customerName: 'Dinesh Weerasinghe', customerPhone: '0756789012',
      startDate: '2026-05-22', endDate: '2026-05-24', totalDays: 3,
      totalAmount: 7500, paidAmount: 0,
      status: 'Cancelled', referral: 'Direct',
      notes: 'Customer cancelled — family emergency.',
      createdAt: '2026-05-19T10:00:00Z',
    },
    {
      id: 'bk18', vehicleId: 'v2', customerId: 'cust8',
      customerName: 'Kasun Rajapaksa', customerPhone: '0789012345',
      startDate: '2026-06-06', endDate: '2026-06-07', totalDays: 2,
      totalAmount: 7000, paidAmount: 0,
      status: 'Cancelled', referral: 'Direct',
      notes: 'Vehicle already booked — overlapped with bk10.',
      createdAt: '2026-05-30T16:00:00Z',
    },
  ],

  // ── Payout records (one per non-cancelled booking) ─────────────────────────
  // No company commission. Owner keeps the full income; an owner/third-party
  // referral fee (coordinatorFee) is the only deduction. Marketing sources
  commissions: [],

  // ── Handovers ─────────────────────────────────────────────────────────────
  // Delivery + Return for all Completed; Delivery-only for Ongoing
  // bk8 return: extra 300km × Rs70 = Rs21 000 → finalAmount = 66 000
  handovers: [
    // bk1 – Amila / Prius / Completed
    { id: 'h1',  bookingId: 'bk1',  vehicleId: 'v1', type: 'delivery',
      location: 'Colombo 03', dateTime: '2026-05-01T10:00', mileage: 42000,
      fuelLevel: 'Full', notes: 'Minor scratch on rear bumper noted.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-01T10:05:00Z' },
    { id: 'h2',  bookingId: 'bk1',  vehicleId: 'v1', type: 'return',
      location: 'Colombo 03', dateTime: '2026-05-05T16:00', mileage: 42480,
      fuelLevel: 'Full', notes: '480km driven (500 free) — no extra charge.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 22500, createdAt: '2026-05-05T16:10:00Z' },

    // bk2 – Sanjay / Axio / Completed
    { id: 'h3',  bookingId: 'bk2',  vehicleId: 'v2', type: 'delivery',
      location: 'Kandy City Hotel', dateTime: '2026-05-03T09:00', mileage: 28000,
      fuelLevel: '3/4', notes: '',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-03T09:05:00Z' },
    { id: 'h4',  bookingId: 'bk2',  vehicleId: 'v2', type: 'return',
      location: 'Kandy City Hotel', dateTime: '2026-05-06T11:00', mileage: 28370,
      fuelLevel: '3/4', notes: '370km driven (400 free) — no extra charge.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 14000, createdAt: '2026-05-06T11:10:00Z' },

    // bk3 – Thisara / Vezel / Completed
    { id: 'h5',  bookingId: 'bk3',  vehicleId: 'v3', type: 'delivery',
      location: 'Galle Road, Colombo 03', dateTime: '2026-05-10T08:00', mileage: 35000,
      fuelLevel: 'Full', notes: 'Full inspection done — no damage.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-10T08:05:00Z' },
    { id: 'h6',  bookingId: 'bk3',  vehicleId: 'v3', type: 'return',
      location: 'Galle Road, Colombo 03', dateTime: '2026-05-15T18:00', mileage: 35840,
      fuelLevel: '1/2', notes: '840km driven (900 free) — no extra charge. Fuel level low.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 33000, createdAt: '2026-05-15T18:10:00Z' },

    // bk4 – Roshani / Alto / Completed (partial pay / Credit commission)
    { id: 'h7',  bookingId: 'bk4',  vehicleId: 'v4', type: 'delivery',
      location: 'Gampaha', dateTime: '2026-05-12T10:00', mileage: 19000,
      fuelLevel: 'Full', notes: '',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-12T10:05:00Z' },
    { id: 'h8',  bookingId: 'bk4',  vehicleId: 'v4', type: 'return',
      location: 'Gampaha', dateTime: '2026-05-14T15:00', mileage: 19230,
      fuelLevel: '3/4', notes: '230km driven (240 free) — no extra charge.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 7500, createdAt: '2026-05-14T15:10:00Z' },

    // bk5 – Dinesh / HiAce / Completed
    { id: 'h9',  bookingId: 'bk5',  vehicleId: 'v5', type: 'delivery',
      location: 'Colombo Fort', dateTime: '2026-05-18T07:00', mileage: 104000,
      fuelLevel: 'Full', notes: 'Group of 12 pax — all seats inspected.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-18T07:05:00Z' },
    { id: 'h10', bookingId: 'bk5',  vehicleId: 'v5', type: 'return',
      location: 'Colombo Fort', dateTime: '2026-05-22T20:00', mileage: 104950,
      fuelLevel: 'Full', notes: '950km driven (1000 free) — no extra charge.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 40000, createdAt: '2026-05-22T20:10:00Z' },

    // bk6 – Chamara / X-Trail / Completed
    { id: 'h11', bookingId: 'bk6',  vehicleId: 'v6', type: 'delivery',
      location: 'Rajagiriya', dateTime: '2026-05-20T09:00', mileage: 11000,
      fuelLevel: 'Full', notes: '',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-20T09:05:00Z' },
    { id: 'h12', bookingId: 'bk6',  vehicleId: 'v6', type: 'return',
      location: 'Rajagiriya', dateTime: '2026-05-25T17:00', mileage: 11880,
      fuelLevel: '3/4', notes: '880km driven (900 free) — no extra charge.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 42000, createdAt: '2026-05-25T17:10:00Z' },

    // bk7 – Nalini / Prius / Completed
    { id: 'h13', bookingId: 'bk7',  vehicleId: 'v1', type: 'delivery',
      location: 'Colombo 03', dateTime: '2026-05-25T10:00', mileage: 42480,
      fuelLevel: 'Full', notes: '',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-25T10:05:00Z' },
    { id: 'h14', bookingId: 'bk7',  vehicleId: 'v1', type: 'return',
      location: 'Colombo 03', dateTime: '2026-05-28T14:00', mileage: 42870,
      fuelLevel: 'Full', notes: '390km driven (400 free) — no extra charge.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 18000, createdAt: '2026-05-28T14:10:00Z' },

    // bk8 – Kasun / Montero / Completed — EXTRA KM DEMO
    { id: 'h15', bookingId: 'bk8',  vehicleId: 'v7', type: 'delivery',
      location: 'Bambalapitiya', dateTime: '2026-05-26T08:00', mileage: 67000,
      fuelLevel: 'Full', notes: 'Full tank confirmed at delivery.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-26T08:05:00Z' },
    { id: 'h16', bookingId: 'bk8',  vehicleId: 'v7', type: 'return',
      location: 'Bambalapitiya', dateTime: '2026-05-30T19:00', mileage: 68050,
      fuelLevel: '1/2', notes: '1050km driven — 750km free, 300km extra × Rs 70 = Rs 21,000.',
      extraKm: 300, extraKmCharge: 21000, finalAmount: 66000, createdAt: '2026-05-30T19:10:00Z' },

    // bk9 – Sanjay / Fit / Completed
    { id: 'h17', bookingId: 'bk9',  vehicleId: 'v8', type: 'delivery',
      location: 'Wattala', dateTime: '2026-05-28T09:00', mileage: 79000,
      fuelLevel: 'Full', notes: '',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-28T09:05:00Z' },
    { id: 'h18', bookingId: 'bk9',  vehicleId: 'v8', type: 'return',
      location: 'Wattala', dateTime: '2026-05-30T16:00', mileage: 79280,
      fuelLevel: '3/4', notes: '280km driven (300 free) — no extra charge.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 9000, createdAt: '2026-05-30T16:10:00Z' },

    // bk10 – Pradeep / Axio / Ongoing (delivery only)
    { id: 'h19', bookingId: 'bk10', vehicleId: 'v2', type: 'delivery',
      location: 'Kelaniya', dateTime: '2026-05-31T08:00', mileage: 28370,
      fuelLevel: 'Full', notes: '',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-31T08:05:00Z' },

    // bk11 – Sanduni / Vezel / Ongoing (delivery only)
    { id: 'h20', bookingId: 'bk11', vehicleId: 'v3', type: 'delivery',
      location: 'Nugegoda', dateTime: '2026-05-29T09:00', mileage: 35840,
      fuelLevel: 'Full', notes: 'Driver Chaminda assigned.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-05-29T09:05:00Z' },

    // bk12 – Amila / HiAce / Ongoing (delivery only)
    { id: 'h21', bookingId: 'bk12', vehicleId: 'v5', type: 'delivery',
      location: 'Colombo Fort', dateTime: '2026-06-01T07:30', mileage: 104950,
      fuelLevel: 'Full', notes: 'Driver Lasantha assigned. 12 passengers.',
      extraKm: 0, extraKmCharge: 0, finalAmount: 0, createdAt: '2026-06-01T07:35:00Z' },
  ],

  // ── Expenses ──────────────────────────────────────────────────────────────
  expenses: [
    { id: 'ex1',  vehicleId: 'v1', category: 'Service',   amount: 6500,  date: '2026-04-10', description: '5000km oil change + filter replacement',              createdAt: '2026-04-10T00:00:00Z' },
    { id: 'ex2',  vehicleId: 'v1', category: 'Tire',      amount: 14000, date: '2026-03-15', description: 'Front tyre replacement (2 pcs) — Yokohama',           createdAt: '2026-03-15T00:00:00Z' },
    { id: 'ex3',  vehicleId: 'v2', category: 'Service',   amount: 4500,  date: '2026-04-20', description: 'Routine service + coolant top-up',                    createdAt: '2026-04-20T00:00:00Z' },
    { id: 'ex4',  vehicleId: 'v3', category: 'Repair',    amount: 28000, date: '2026-05-01', description: 'AC compressor replacement',                           createdAt: '2026-05-01T00:00:00Z' },
    { id: 'ex5',  vehicleId: 'v3', category: 'Fuel',      amount: 4500,  date: '2026-05-29', description: 'Pre-rental full tank fill for Sanduni',               createdAt: '2026-05-29T00:00:00Z' },
    { id: 'ex6',  vehicleId: 'v4', category: 'Fine',      amount: 3000,  date: '2026-05-18', description: 'Speed camera fine — Kaduwela',                        createdAt: '2026-05-18T00:00:00Z' },
    { id: 'ex7',  vehicleId: 'v4', category: 'Service',   amount: 3500,  date: '2026-04-05', description: 'Engine service + spark plug replacement',             createdAt: '2026-04-05T00:00:00Z' },
    { id: 'ex8',  vehicleId: 'v5', category: 'Tire',      amount: 32000, date: '2026-03-20', description: 'Full tyre set replacement (4 pcs) — BF Goodrich',     createdAt: '2026-03-20T00:00:00Z' },
    { id: 'ex9',  vehicleId: 'v5', category: 'Insurance', amount: 68000, date: '2026-01-15', description: 'Annual insurance premium renewal',                    createdAt: '2026-01-15T00:00:00Z' },
    { id: 'ex10', vehicleId: 'v6', category: 'Service',   amount: 7500,  date: '2026-04-28', description: 'Scheduled 10 000km service + transmission check',     createdAt: '2026-04-28T00:00:00Z' },
    { id: 'ex11', vehicleId: 'v7', category: 'Damage',    amount: 15000, date: '2026-05-31', description: 'Customer-caused dent repair — front door (Kasun)',     createdAt: '2026-05-31T00:00:00Z' },
    { id: 'ex12', vehicleId: 'v8', category: 'Service',   amount: 3800,  date: '2026-05-05', description: 'Oil change + spark plug + air filter',                createdAt: '2026-05-05T00:00:00Z' },
  ],

  // ── Drivers ───────────────────────────────────────────────────────────────
  drivers: [
    {
      id: 'd1', name: 'Chaminda Rajapaksa', phone: '0712233111',
      licenseNumber: 'B1234567', licenseExpiry: '2028-06-30',
      status: 'On Duty', dailyRate: 1500, totalEarnings: 67500,
      currentBookingId: 'bk11',
      joinedAt: '2024-02-01T00:00:00Z',
      address: '34, Main Street, Moratuwa', nic: '890123456789',
    },
    {
      id: 'd2', name: 'Lasantha Wickrama', phone: '0776655443',
      licenseNumber: 'B9876543', licenseExpiry: '2027-09-15',
      status: 'On Duty', dailyRate: 1800, totalEarnings: 45000,
      currentBookingId: 'bk12',
      joinedAt: '2023-08-15T00:00:00Z',
      address: '88, Flower Road, Piliyandala', nic: '870456789012',
    },
    {
      id: 'd3', name: 'Rohan Mendis', phone: '0762211334',
      licenseNumber: 'B5556789', licenseExpiry: '2026-12-01',
      status: 'Available', dailyRate: 1500, totalEarnings: 28500,
      joinedAt: '2024-05-01T00:00:00Z',
      address: '12, Lake Road, Dehiwala', nic: '950789012345',
    },
    {
      id: 'd4', name: 'Kaveesha Rathnayake', phone: '0754433221',
      licenseNumber: 'B7778899', licenseExpiry: '2029-03-20',
      status: 'Available', dailyRate: 2000, totalEarnings: 12000,
      joinedAt: '2025-01-10T00:00:00Z',
      address: '5, Hill Street, Kotte', nic: '200078901234',
    },
  ],

  // ── Inquiries ─────────────────────────────────────────────────────────────
  inquiries: [
    {
      id: 'inq1', customerName: 'Amila Bandara', customerPhone: '0712233445',
      requestedVehicle: 'Prius or Axio', preferredBrand: 'Toyota',
      startDate: '2026-06-05', endDate: '2026-06-07',
      referral: 'WhatsApp', status: 'Pending',
      notes: 'Needs AC. Prefers silver or white.',
      createdAt: '2026-05-31T09:00:00Z',
    },
    {
      id: 'inq2', customerName: 'Kavindi Rathnayake', customerPhone: '0779988776',
      requestedVehicle: 'Prius', preferredBrand: 'Toyota',
      startDate: '2026-06-15', endDate: '2026-06-19',
      referral: 'Instagram', status: 'Pending',
      notes: 'Honeymoon trip — wants decorated vehicle.',
      createdAt: '2026-06-01T10:00:00Z',
    },
    {
      id: 'inq3', customerName: 'Nalinda Dissanayake', customerPhone: '0765544332',
      requestedVehicle: 'KDH Van', preferredBrand: '',
      startDate: '2026-05-30', endDate: '2026-06-01',
      referral: 'Facebook', status: 'Lost',
      lostReason: 'No vehicle available',
      notes: 'Wanted 14-seater KDH — we only have HiAce.',
      createdAt: '2026-05-28T11:00:00Z',
    },
    {
      id: 'inq4', customerName: 'Tharaka Seneviratne', customerPhone: '0712987654',
      requestedVehicle: 'Alto or small car', preferredBrand: 'Suzuki',
      startDate: '2026-05-25', endDate: '2026-05-27',
      referral: 'Google', status: 'Converted',
      notes: 'Converted to booking — bk4.',
      createdAt: '2026-05-22T08:00:00Z',
    },
    {
      id: 'inq5', customerName: 'Priyantha Kumara', customerPhone: '0781122334',
      requestedVehicle: 'Montero or SUV', preferredBrand: 'Mitsubishi',
      startDate: '2026-06-20', endDate: '2026-06-25',
      referral: 'Word of Mouth', status: 'Pending',
      notes: 'Wildlife safari — 4WD essential.',
      createdAt: '2026-06-01T14:00:00Z',
    },
    {
      id: 'inq6', customerName: 'Nadeeka Perera', customerPhone: '0758877665',
      requestedVehicle: 'Fit or Alto', preferredBrand: '',
      startDate: '2026-06-08', endDate: '2026-06-10',
      referral: 'Direct', status: 'Pending',
      createdAt: '2026-06-01T15:00:00Z',
    },
    {
      id: 'inq7', customerName: 'Sajith Fernando', customerPhone: '0734455667',
      requestedVehicle: 'Vezel', preferredBrand: 'Honda',
      startDate: '2026-05-29', endDate: '2026-06-04',
      referral: 'Pavith Bimsara', status: 'Converted',
      notes: 'Converted to booking — bk11.',
      createdAt: '2026-05-26T10:00:00Z',
    },
  ],

  // ── Notifications ─────────────────────────────────────────────────────────
  notifications: [
    {
      id: 'n1', type: 'ReturnReminder', read: false,
      title: 'Return Due Tomorrow — Axio CAD-8899',
      message: "Pradeep Rathnayake's Axio (bk10) is due for return on 2026-06-03.",
      relatedId: 'bk10', createdAt: '2026-06-01T07:00:00Z',
    },
    {
      id: 'n2', type: 'ReturnReminder', read: false,
      title: 'Return Due in 3 Days — Vezel CBF-5567',
      message: "Sanduni Wickramasinghe's Vezel (bk11) is due for return on 2026-06-04.",
      relatedId: 'bk11', createdAt: '2026-06-01T07:05:00Z',
    },
    {
      id: 'n3', type: 'BookingReminder', read: false,
      title: 'Upcoming Pickup — Fit CBB-9934',
      message: 'Thisara Madusanka picks up the Fit on 2026-06-05 from Gampaha.',
      relatedId: 'bk13', createdAt: '2026-06-01T08:00:00Z',
    },
    {
      id: 'n4', type: 'BookingReminder', read: false,
      title: 'Upcoming Pickup — Prius CAB-1234',
      message: 'Roshani Perera picks up the Prius on 2026-06-10 from Negombo.',
      relatedId: 'bk15', createdAt: '2026-06-01T08:05:00Z',
    },
    {
      id: 'n5', type: 'InsuranceExpiry', read: false,
      title: 'Insurance Expiring — Alto CAA-3312',
      message: 'Alto CAA-3312 insurance expires 2026-08-15 (75 days). Renew soon.',
      relatedId: 'v4', createdAt: '2026-06-01T09:00:00Z',
    },
    {
      id: 'n6', type: 'InsuranceExpiry', read: true,
      title: 'Insurance Expiring — Axio CAD-8899',
      message: 'Axio CAD-8899 insurance expires 2026-09-20 (111 days). Plan ahead.',
      relatedId: 'v2', createdAt: '2026-05-30T09:00:00Z',
    },
    {
      id: 'n7', type: 'General', read: true,
      title: 'Extra Km Charge Settled — Montero CPC-2287',
      message: 'Kasun Rajapaksa drove 300km over the free allowance. Rs 21,000 extra collected.',
      relatedId: 'bk8', createdAt: '2026-05-30T19:30:00Z',
    },
  ],
};
