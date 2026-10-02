<div align="center">

# EMRAC Management System

**A complete vehicle rental management platform built with React + TypeScript**

[![React](https://img.shields.io/badge/React-18-61DAFB?style=flat&logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=flat&logo=vite&logoColor=white)](https://vitejs.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3-06B6D4?style=flat&logo=tailwindcss&logoColor=white)](https://tailwindcss.com)
[![Zustand](https://img.shields.io/badge/Zustand-4-433e38?style=flat)](https://zustand-demo.pmnd.rs)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat)](LICENSE)

</div>

---

## Overview

EMRAC is a fully client-side vehicle rental management system designed for small-to-medium rental businesses. It covers the complete rental lifecycle — from customer inquiry through vehicle delivery, return, commission settlement, and automated email receipts — all without a backend server.

Data is persisted locally via `localStorage` using Zustand's persist middleware, making it deployable as a static site with zero infrastructure cost.

---

## Features

### Core Modules

| Module | Description |
|---|---|
| **Dashboard** | Revenue charts, booking trends, and key KPIs at a glance |
| **Vehicles** | Fleet management with status tracking, insurance records, and per-vehicle revenue |
| **Bookings** | Full booking lifecycle with card and calendar views, date conflict detection |
| **Inquiries** | Lead tracking — convert inquiries to bookings or mark as lost with reason |
| **Handovers** | Vehicle delivery and return recording with odometer and fuel level |
| **Commissions** | Auto-calculated commission splits per booking with Paid / Credit status |
| **Owners** | Vehicle owner profiles with commission rates and payout tracking |
| **Expenses** | Categorised expense log per vehicle (Service, Repair, Fuel, Insurance…) |
| **Drivers** | Driver roster with availability and daily rate management |
| **Notifications** | In-app alerts for booking reminders, insurance expiry, and overdue returns |
| **Permissions** | Granular per-owner access control (admin-only) |

### Standout Capabilities

- **Smart availability checker** — selecting a vehicle immediately shows current hire, upcoming bookings, and the next free date; blocked dates are struck through in the date picker
- **Trip cost estimator** — calculates base rent + excess km charge using per-vehicle free-km allowance and extra-km rate
- **Automated km billing** — at vehicle return, final amount is computed as `(dailyRate × days) + max(0, kmDriven − freeKm) × extraKmRate`
- **Payment settlement flow** — after return, shows owner payout vs. management commission split; advance deposits are deducted from the balance due
- **A4 invoice generation** — print-ready invoice opens in a new window with full inline styles, compatible with browser PDF export
- **Automated email receipts** — sends a branded HTML rental summary to the customer on payment confirmation via EmailJS (no backend required)
- **Role-based access** — Admin has full access; Owner accounts see only their own vehicles and bookings, with configurable feature flags

---

## Tech Stack

| Layer | Library |
|---|---|
| UI Framework | React 18 + TypeScript |
| Build Tool | Vite 5 |
| Styling | Tailwind CSS 3 |
| State Management | Zustand 4 (with `persist` middleware) |
| Routing | React Router v6 |
| Charts | Recharts |
| Calendar | react-big-calendar (date-fns localizer) |
| Date Picker | react-datepicker |
| Email | EmailJS (`@emailjs/browser`) |
| Icons | Lucide React |
| Date Utilities | date-fns v3 |

---

## Getting Started

### Prerequisites

- Node.js 18 or later
- npm 9 or later

### Installation

```bash
# Clone the repository
git clone https://github.com/MxnodyaXX/EMRACManagementSystem.git
cd EMRACManagementSystem

# Install dependencies
npm install

# Start the development server
npm run dev
```

The app will be available at `http://localhost:5173`.

### Build for Production

```bash
npm run build      # TypeScript check + Vite build
npm run preview    # Preview the production build locally
```

---

## Environment Setup

Create a `.env.local` file in the project root:

```env
VITE_EMAILJS_SERVICE_ID=your_service_id
VITE_EMAILJS_TEMPLATE_ID=your_template_id
VITE_EMAILJS_PUBLIC_KEY=your_public_key
```

If these variables are not set, the app works normally — email sending is silently skipped.

### EmailJS Setup (Optional)

EmailJS lets you send emails directly from the browser with no backend required.

1. Create a free account at [emailjs.com](https://www.emailjs.com)
2. **Add a service** — connect Gmail or Outlook → copy the **Service ID**
3. **Create a template** with the following fields:
   - **To:** `{{to_email}}`
   - **Subject:** `{{subject}}`
   - **Body** *(HTML editor)*: `{{{html_content}}}` *(triple braces renders raw HTML)*
4. Copy the **Template ID**
5. Go to **Account → General** → copy your **Public Key**
6. Paste all three values into `.env.local` and restart the dev server

---

## Project Structure

```
src/
├── components/
│   ├── layout/
│   │   ├── Header.tsx          # Page header with title and subtitle
│   │   └── Sidebar.tsx         # Navigation sidebar (collapses on mobile)
│   └── ui/
│       ├── Modal.tsx            # Reusable bottom-sheet / centred modal
│       ├── Select.tsx           # Custom styled dropdown
│       ├── StatusBadge.tsx      # Colour-coded status pill
│       └── InvoiceModal.tsx     # A4 invoice preview and print
├── pages/
│   ├── Dashboard.tsx
│   ├── Vehicles.tsx
│   ├── Bookings.tsx
│   ├── Inquiries.tsx
│   ├── Handovers.tsx
│   ├── Commissions.tsx
│   ├── commissions/
│   │   ├── AdminView.tsx        # Full commission table with charts
│   │   └── OwnerView.tsx        # Owner-scoped commission view
│   ├── Owners.tsx
│   ├── Expenses.tsx
│   ├── Drivers.tsx
│   ├── Notifications.tsx
│   ├── Permissions.tsx
│   └── Login.tsx
├── store/
│   ├── useStore.ts              # Main Zustand store (all business data)
│   └── useAuthStore.ts          # Auth store (role and permissions)
├── data/
│   └── sampleData.ts            # Seed data for first run
├── types/
│   └── index.ts                 # All TypeScript interfaces
├── utils/
│   └── email.ts                 # EmailJS integration and HTML email template
└── App.tsx                      # Route definitions and auth guard
```

---

## Role-Based Access

| Feature | Admin | Owner |
|---|:---:|:---:|
| View all vehicles and bookings | ✅ | Own only |
| Add and edit bookings | ✅ | Configurable |
| Edit vehicle details | ✅ | Configurable |
| Change vehicle status | ✅ | Configurable |
| Add expenses | ✅ | Configurable |
| Commission and owner data | ✅ | Own only |
| Manage permissions | ✅ | — |

Owner permissions (`canBook`, `canEditVehicle`, `canChangeStatus`, `canAddExpenses`) are toggled per account from the **Permissions** page (admin only).

---

## Commission Model

For each booking a commission record is automatically created:

```
Commission Amount  =  totalIncome × commissionRate%
Owner Payout       =  totalIncome − commissionAmount
```

The `commissionRate` is configured per owner. After vehicle return, the settlement screen shows the payment split and marks the commission as **Paid** or **Credit**.

---

## Data Persistence

All data is stored in the browser's `localStorage` under the key `emrac-store-v3`. There is no backend or database required. Clearing site data resets the app to the built-in sample data.

---

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/your-feature`)
3. Commit your changes (`git commit -m 'Add your feature'`)
4. Push to the branch (`git push origin feature/your-feature`)
5. Open a Pull Request

---

## Developer

**Manodya Kalhara**
Software Engineering Undergraduate · Full Stack Developer · Sri Lanka

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">
  If you find this project useful, please give it a star on GitHub.
</div>
