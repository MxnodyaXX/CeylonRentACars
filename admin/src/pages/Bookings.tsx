import { useState, useCallback, useEffect, useMemo } from 'react';
import { useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import StatusBadge from '../components/ui/StatusBadge';
import Modal from '../components/ui/Modal';
import Select from '../components/ui/Select';
import TripCalculatorModal from '../components/ui/TripCalculatorModal';
import { Calendar, dateFnsLocalizer, SlotInfo } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { enUS } from 'date-fns/locale/en-US';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  Plus, CalendarDays, List, AlertTriangle, CheckCircle,
  XCircle, Calculator, MessageCircle, Shield, PlayCircle,
  ChevronDown, Search as SearchIcon, ClipboardEdit, Printer,
  MapPin, Car, ChevronRight, LayoutGrid, Rows3,
} from 'lucide-react';
import VehicleImage from '../components/ui/VehicleImage';
import { vehicleBodyColor } from '../components/ui/CarSVG';
import { printBookingConfirmation, sendBookingReceipt } from '../lib/printReceipt';
import AvailabilityModal from '../components/ui/AvailabilityModal';
import AdminBookingModal from '../components/ui/AdminBookingModal';
import LocationInput from '../components/ui/LocationInput';
import { buildBookingWhatsAppMsg, openWhatsApp } from '../lib/whatsapp';
import { blocksAvailability, bookingStartMs, bookingEndMs, rangesOverlap, rentalDays } from '../lib/availability';
import TimePicker from '../components/ui/TimePicker';
import { Booking } from '../types';
import {
  parseISO, addDays,
  endOfWeek, startOfMonth, endOfMonth,
  startOfQuarter, endOfQuarter, startOfYear, endOfYear,
} from 'date-fns';

type DatePreset = 'all' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
const DATE_PRESETS: { key: DatePreset; label: string }[] = [
  { key: 'all',     label: 'All Time'     },
  { key: 'week',    label: 'This Week'    },
  { key: 'month',   label: 'This Month'   },
  { key: 'quarter', label: 'This Quarter' },
  { key: 'year',    label: 'This Year'    },
  { key: 'custom',  label: 'Custom'       },
];

/* ── Calendar setup ─────────────────────────────────────────── */
const localizer = dateFnsLocalizer({ format, parse, startOfWeek, getDay, locales: { 'en-US': enUS } });

type BookingStatus = 'Confirmed' | 'Ongoing' | 'Completed' | 'Cancelled';
const STATUS_TABS: (BookingStatus | 'All')[] = ['All', 'Confirmed', 'Ongoing', 'Completed', 'Cancelled'];

const STATUS_COLORS: Record<string, string> = {
  Confirmed: '#111114',
  Ongoing:   '#10B981',
  Completed: '#6B7280',
  Cancelled: '#EF4444',
};

const LOST_REASONS = [
  'No vehicle available',
  'Dates not available',
  'Budget mismatch',
  'Customer cancelled',
  'Found elsewhere',
  'Other',
];

// Marketing channels the customer can come through — these do NOT earn a referral fee.
// Only owner referrals or a named third party are paid a fee.
const REFERRAL_SOURCES = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Google', 'Word of Mouth'];

/** 'HH:mm' (24h) → '8:00 AM' for display; '' when unset/invalid. */
const fmt12 = (t?: string) => {
  if (!t || !/^\d{1,2}:\d{2}$/.test(t)) return '';
  const [hh, mm] = t.split(':').map(Number);
  const period = hh >= 12 ? 'PM' : 'AM';
  const h = hh % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${period}`;
};

/** 'yyyy-MM-dd' → '7 Feb, Friday' for the booking-card timeline. */
const fmtDateLong = (d?: string) => {
  if (!d) return '';
  const t = parseISO(d);
  return isNaN(t.getTime()) ? d : format(t, 'd MMM, EEEE');
};

/** 'yyyy-MM-dd' → '7 Feb' for compact grid cards. */
const fmtDateShort = (d?: string) => {
  if (!d) return '';
  const t = parseISO(d);
  return isNaN(t.getTime()) ? d : format(t, 'd MMM');
};

const isTimeStr = (t?: string) => !!t && /^\d{1,2}:\d{2}$/.test(t);

/** First day the vehicle is free again for a NEW hire: the return day itself
 *  when a return time is recorded (it comes back that day, e.g. 7am), otherwise
 *  the day after (it's out for the whole return day). */
const freeFromDay = (b: Booking) =>
  isTimeStr(b.endTime) ? b.endDate : addDays(parseISO(b.endDate), 1).toISOString().slice(0, 10);

/** Is a calendar day blocked by this booking? The vehicle is taken from the
 *  pickup day up to — but not including — the day it's free again. So a
 *  23 → 24 (with a return time) booking blocks the 23rd but leaves the 24th
 *  open for the next hire; the exact return/pickup times are then validated
 *  separately so a same-day handover only goes through if the hours fit. */
const dayBlocked = (b: Booking, d: string) => d >= b.startDate && d < freeFromDay(b);

const emptyForm = () => ({
  vehicleId: '',
  customerId: 'c_' + Math.random().toString(36).slice(2, 6),
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerNIC: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  waiveExtraDay: false,
  totalDays: 0,
  totalAmount: 0,
  estimatedAmount: 0,
  paidAmount: 0,
  status: 'Confirmed' as BookingStatus,
  referral: 'Direct',
  referralFeeType: 'fixed' as 'fixed' | 'percent',
  referralFeeValue: 0,
  notes: '',
  pickupLocation: '',
  dropLocation: '',
  driverId: '',
  depositType: undefined as 'cash' | 'vehicle' | 'other' | undefined,
  depositVehicleModel: '',
  depositVehicleColor: '',
  depositVehicleNumber: '',
  depositAssetDescription: '',
  depositAmount: 0,
  depositReturned: 0,
  depositDeduction: 0,
  depositNotes: '',
  quotation: {
    startLocation: '',
    endLocation: '',
    stops: [] as string[],
    isRoundTrip: true,
    totalKm: 0,
  },
});

export default function Bookings() {
  const { vehicles, bookings, drivers, owners, customers, addBooking, updateBooking, cancelBooking, startBooking, completeBooking, isVehicleAvailable } = useStore();
  const { currentUser, isAdmin, can } = useAuthStore();
  const location = useLocation();

  const [tab,               setTab]               = useState<BookingStatus | 'All'>('All');
  const [datePreset,        setDatePreset]        = useState<DatePreset>('all');
  const [customFrom,        setCustomFrom]        = useState<Date | null>(null);
  const [customTo,          setCustomTo]          = useState<Date | null>(null);
  const [viewMode,          setViewMode]          = useState<'cards' | 'calendar'>('cards');
  const [cardLayout,        setCardLayout]        = useState<'grid' | 'rows'>(
    () => (localStorage.getItem('emrac-booking-layout') as 'grid' | 'rows') || 'grid',
  );
  useEffect(() => { localStorage.setItem('emrac-booking-layout', cardLayout); }, [cardLayout]);
  const [modal,             setModal]             = useState<'add' | 'view' | 'calculator' | null>(null);
  const [adminBookingOpen,  setAdminBookingOpen]  = useState(false);
  const [completedOpen,     setCompletedOpen]     = useState(true);
  const [availabilityOpen,  setAvailabilityOpen]  = useState(false);
  const [selected,     setSelected]     = useState<Booking | null>(null);
  const [form,         setForm]         = useState(emptyForm());
  const [availability, setAvailability] = useState<boolean | null>(null);
  const [error,        setError]        = useState('');
  const [startWarn,       setStartWarn]       = useState('');
  const [endWarn,         setEndWarn]         = useState('');
  const [customerMode,    setCustomerMode]    = useState<'new' | 'existing'>('new');
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [referralCustom,   setReferralCustom]   = useState(false);

  // Auto-open booking form when navigated from an inquiry conversion
  useEffect(() => {
    const inq = (location.state as { fromInquiry?: {
      customerName: string; customerPhone: string; startDate: string; endDate: string; notes: string; vehicleId?: string;
      startTime?: string; endTime?: string; pickupLocation?: string; dropLocation?: string; customerEmail?: string; totalAmount?: number;
      // from the agreed booking terms (inquiry consultation)
      paidAmount?: number; depositAmount?: number; depositType?: 'cash' | 'vehicle' | 'other'; totalKm?: number;
    } } | null)?.fromInquiry;
    if (!inq) return;
    const f = emptyForm();
    f.customerName  = inq.customerName  ?? '';
    f.customerPhone = inq.customerPhone ?? '';
    f.startDate     = inq.startDate     ?? '';
    f.endDate       = inq.endDate       ?? '';
    f.notes         = inq.notes         ?? '';
    if (inq.vehicleId)      f.vehicleId      = inq.vehicleId;
    if (inq.startTime)      f.startTime      = inq.startTime;
    if (inq.endTime)        f.endTime        = inq.endTime;
    if (inq.pickupLocation) f.pickupLocation = inq.pickupLocation;
    if (inq.dropLocation)   f.dropLocation   = inq.dropLocation;
    if (inq.customerEmail)  f.customerEmail  = inq.customerEmail;
    if (inq.totalAmount)    f.totalAmount    = inq.totalAmount;
    if (inq.paidAmount)     f.paidAmount     = inq.paidAmount;
    if (inq.depositAmount)  { f.depositAmount = inq.depositAmount; f.depositType = inq.depositType ?? 'cash'; }
    if (inq.totalKm)        f.quotation = { ...f.quotation, totalKm: inq.totalKm };
    setForm(f);
    setModal('add');
    setAvailability(null);
    setError('');
    // Clear navigation state so refreshing doesn't re-open the modal
    window.history.replaceState({}, '');
  }, [location.state]);

  // Deep-link from dashboard analytics: /bookings?status=Ongoing focuses that tab
  useEffect(() => {
    const status = new URLSearchParams(location.search).get('status');
    if (status && ['All', 'Confirmed', 'Ongoing', 'Completed', 'Cancelled'].includes(status)) {
      setTab(status as BookingStatus | 'All');
    }
  }, [location.search]);

  // Owner sees only their vehicle bookings
  const myVehicleIds = currentUser?.role === 'owner'
    ? vehicles.filter((v) => v.ownerId === currentUser.ownerId).map((v) => v.id)
    : null;

  const visibleBookings = myVehicleIds
    ? bookings.filter((b) => myVehicleIds.includes(b.vehicleId))
    : bookings;

  // Date window (filters on the booking's start date). Strings are yyyy-MM-dd so
  // lexicographic comparison is also chronological.
  const dateWindow = useMemo(() => {
    const now = new Date();
    const fmt = (d: Date) => format(d, 'yyyy-MM-dd');
    switch (datePreset) {
      case 'week':    return { from: fmt(startOfWeek(now, { weekStartsOn: 1 })), to: fmt(endOfWeek(now, { weekStartsOn: 1 })) };
      case 'month':   return { from: fmt(startOfMonth(now)),   to: fmt(endOfMonth(now))   };
      case 'quarter': return { from: fmt(startOfQuarter(now)), to: fmt(endOfQuarter(now)) };
      case 'year':    return { from: fmt(startOfYear(now)),    to: fmt(endOfYear(now))    };
      case 'custom':  return { from: customFrom ? fmt(customFrom) : null, to: customTo ? fmt(customTo) : null };
      default:        return null;
    }
  }, [datePreset, customFrom, customTo]);

  const inDateWindow = (b: Booking) => {
    if (!dateWindow) return true;
    if (dateWindow.from && b.startDate < dateWindow.from) return false;
    if (dateWindow.to   && b.startDate > dateWindow.to)   return false;
    return true;
  };
  const dateScopedBookings = visibleBookings.filter(inDateWindow);
  const filtered = dateScopedBookings.filter((b) => tab === 'All' || b.status === tab);
  const sorted   = [...filtered].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  // Vehicles available to book — owner sees only their own
  const bookableVehicles = myVehicleIds
    ? vehicles.filter((v) => myVehicleIds.includes(v.id))
    : vehicles;

  // Only an owner referral or a named third party earns a fee — not Direct or a marketing source.
  const isPersonReferral =
    !!form.referral && form.referral !== 'Direct' && !REFERRAL_SOURCES.includes(form.referral);

  // A vehicle's own owner can't be the referrer for their vehicle — they'd be
  // paying a referral fee to themselves. When that happens the booking is blocked
  // until the referral is changed to Direct.
  const bookedVehicleOwner = owners.find((o) => o.id === vehicles.find((v) => v.id === form.vehicleId)?.ownerId);
  const selfReferral = isPersonReferral && !!bookedVehicleOwner &&
    form.referral.trim().toLowerCase() === bookedVehicleOwner.name.trim().toLowerCase();

  const set = (field: string, value: unknown) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      // Dates, times and the vehicle all affect both the billed duration and
      // availability — recompute on any of them. Times change the cost because
      // billing is by actual hours held (24h = 1 day), not inclusive calendar days.
      const affects = field === 'startDate' || field === 'endDate' || field === 'vehicleId'
        || field === 'startTime' || field === 'endTime' || field === 'waiveExtraDay';
      if (affects) {
        const { startDate: s, endDate: e, vehicleId: vid } = updated;
        if (s && e && s <= e) {
          const days    = rentalDays(s, e, updated.startTime, updated.endTime, updated.waiveExtraDay);
          const vehicle = vehicles.find((v) => v.id === vid);
          updated.totalDays   = days;
          updated.totalAmount = days * (vehicle?.dailyRent ?? 0);
          recalcEstimate(updated);
        }
        if (s && e && vid) setAvailability(isVehicleAvailable(vid, s, e, undefined, updated.startTime, updated.endTime));
      }
      return updated;
    });
  };

  const setQ = (field: string, value: unknown) =>
    setForm((f) => {
      const q = { ...f.quotation, [field]: value };
      const updated = { ...f, quotation: q };
      recalcEstimate(updated);
      return updated;
    });

  const recalcEstimate = (f: ReturnType<typeof emptyForm>) => {
    const vehicle = vehicles.find((v) => v.id === f.vehicleId);
    if (!vehicle || !f.totalDays || !f.quotation.totalKm) return;
    const includedKm = (vehicle.includedKmPerDay ?? 100) * f.totalDays;
    const extraKm    = Math.max(0, f.quotation.totalKm - includedKm);
    const extraCost  = extraKm * (vehicle.extraKmRate ?? 50);
    f.estimatedAmount = f.totalAmount + extraCost;
  };

  // Returns true if this date is NOT blocked by an existing booking for the selected vehicle
  const isDateAvailable = (date: Date): boolean => {
    if (!form.vehicleId) return true;
    const dateStr = format(date, 'yyyy-MM-dd');
    return !bookings.some(
      (b) => b.vehicleId === form.vehicleId &&
             blocksAvailability(b) &&
             dayBlocked(b, dateStr)
    );
  };

  const handleStartDate = (date: Date | null) => {
    if (!date) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    if (!isDateAvailable(date)) {
      setStartWarn('This date is not available — vehicle is already booked on this day.');
    } else {
      setStartWarn('');
    }
    set('startDate', dateStr);
    setEndWarn('');
  };

  const handleEndDate = (date: Date | null) => {
    if (!date) return;
    const dateStr = format(date, 'yyyy-MM-dd');
    if (!isDateAvailable(date)) {
      setEndWarn('This date is not available — vehicle is already booked on this day.');
    } else {
      setEndWarn('');
    }
    set('endDate', dateStr);
  };

  const openAdd = (startDate = '') => {
    const f = emptyForm();
    if (startDate) { f.startDate = startDate; f.endDate = startDate; }
    setForm(f);
    setModal('add');
    setAvailability(null);
    setError('');
    setStartWarn('');
    setEndWarn('');
    setCustomerMode('new');
    setSelectedCustomer('');
    setReferralCustom(false);
  };

  const handleCreate = () => {
    setError('');
    if (!form.vehicleId || !form.customerName || !form.startDate || !form.endDate) {
      setError('Please fill in all required fields.');
      return;
    }
    if (!isVehicleAvailable(form.vehicleId, form.startDate, form.endDate, undefined, form.startTime, form.endTime)) {
      setError('Vehicle is not available for the selected dates and times.');
      return;
    }
    if (selfReferral) {
      setError(`${bookedVehicleOwner!.name} owns this vehicle and can't be its own referrer. Change the referral to Direct to continue.`);
      return;
    }
    const { depositVehicleModel, depositVehicleColor, depositVehicleNumber, ...bookingData } = form;
    const bookingId = addBooking({
      ...bookingData,
      depositAssetDescription: form.depositType === 'vehicle'
        ? [depositVehicleModel, depositVehicleColor, depositVehicleNumber].filter(Boolean).join(' | ')
        : form.depositAssetDescription,
    });
    // Send SMS + email receipt automatically on confirmation
    const newBooking = useStore.getState().bookings.find((b) => b.id === bookingId);
    const receiptVehicle = vehicles.find((v) => v.id === form.vehicleId);
    const receiptDriver  = drivers.find((d) => d.id === form.driverId) ?? undefined;
    if (newBooking) sendBookingReceipt(newBooking, receiptVehicle, receiptDriver).catch(console.error);
    setModal(null);
    setForm(emptyForm());
    setAvailability(null);
  };

  // Vehicle availability status — computed safely outside the render tree
  const vehicleStatus = useMemo(() => {
    if (!form.vehicleId) return null;
    try {
      const today = new Date().toISOString().slice(0, 10);
      const vBookings = bookings
        .filter((b) => b.vehicleId === form.vehicleId && blocksAvailability(b))
        .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));

      const currentHire   = vBookings.find((b) => b.startDate && b.endDate && b.startDate <= today && b.endDate >= today);
      const upcomingHires = vBookings.filter((b) => b.startDate && b.startDate > today);

      // Chain-walk to find first truly free date
      let nextFree = today;
      let iterations = 0;
      let changed = true;
      while (changed && iterations++ < 200) {
        changed = false;
        for (const b of vBookings) {
          if (b.startDate && b.endDate && b.startDate <= nextFree && nextFree < freeFromDay(b)) {
            nextFree = freeFromDay(b);
            changed = true;
            break;
          }
        }
      }

      return { currentHire, upcomingHires, nextFree };
    } catch {
      return null;
    }
  }, [form.vehicleId, bookings]);

  // Calendar events
  const calEvents = visibleBookings
    .filter((b) => b.status !== 'Cancelled')
    .map((b) => ({
      id:    b.id,
      title: `${vehicles.find((v) => v.id === b.vehicleId)?.brand ?? ''} — ${b.customerName}`,
      start: new Date(b.startDate),
      end:   new Date(b.endDate),
      resource: b,
    }));

  const eventStyleGetter = (ev: typeof calEvents[0]) => ({
    style: {
      backgroundColor: STATUS_COLORS[(ev.resource as Booking).status] ?? '#111114',
      borderRadius: 6,
      border: 'none',
      fontSize: 11,
      padding: '2px 6px',
    },
  });

  const onSelectSlot = useCallback((slot: SlotInfo) => {
    if (!can('canBook') && !isAdmin()) return;
    const d = format(slot.start, 'yyyy-MM-dd');
    openAdd(d);
  }, [can, isAdmin]);

  return (
    <div>
      <Header title="Bookings" subtitle="Manage all vehicle reservations" />

      {/* Tabs + view toggle + Add */}
      <div className="flex items-center justify-between mb-5 gap-3">
        <div className="flex gap-2 overflow-x-auto no-scrollbar">
          {STATUS_TABS.map((s) => (
            <button
              key={s}
              onClick={() => setTab(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-colors flex-shrink-0 ${
                tab === s ? 'bg-navy-700 text-white' : 'bg-white text-navy-500 hover:bg-navy-50 shadow-card'
              }`}
            >
              {s}
              {s !== 'All' && (
                <span className="ml-1.5 opacity-70">{dateScopedBookings.filter((b) => b.status === s).length}</span>
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* View toggle */}
          <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
            <button
              onClick={() => setViewMode('cards')}
              className={`w-8 h-8 rounded-[10px] flex items-center justify-center transition-all ${
                viewMode === 'cards' ? 'bg-white shadow-sm text-navy-700' : 'text-navy-400'
              }`}
              title="Card view"
            >
              <List size={15} />
            </button>
            <button
              onClick={() => setViewMode('calendar')}
              className={`w-8 h-8 rounded-[10px] flex items-center justify-center transition-all ${
                viewMode === 'calendar' ? 'bg-white shadow-sm text-navy-700' : 'text-navy-400'
              }`}
              title="Calendar view"
            >
              <CalendarDays size={15} />
            </button>
          </div>

          {/* Layout toggle: compact grid (columns) vs full-width rows */}
          {viewMode === 'cards' && (
            <div className="flex bg-navy-50 rounded-xl p-0.5 gap-0.5">
              <button
                onClick={() => setCardLayout('grid')}
                className={`w-8 h-8 rounded-[10px] flex items-center justify-center transition-all ${
                  cardLayout === 'grid' ? 'bg-white shadow-sm text-navy-700' : 'text-navy-400'
                }`}
                title="Grid view (columns)"
              >
                <LayoutGrid size={15} />
              </button>
              <button
                onClick={() => setCardLayout('rows')}
                className={`w-8 h-8 rounded-[10px] flex items-center justify-center transition-all ${
                  cardLayout === 'rows' ? 'bg-white shadow-sm text-navy-700' : 'text-navy-400'
                }`}
                title="Row view (full width)"
              >
                <Rows3 size={15} />
              </button>
            </div>
          )}

          <button
            onClick={() => setAvailabilityOpen(true)}
            className="btn-secondary flex items-center gap-2"
          >
            <SearchIcon size={15} /> Check Availability
          </button>
          {(isAdmin() || can('canBook')) && (
            <button
              onClick={() => openAdd()}
              className="btn-primary flex items-center gap-2"
            >
              <Plus size={15} /> New Booking
            </button>
          )}
          {isAdmin() && (
            <button
              onClick={() => setAdminBookingOpen(true)}
              className="btn-secondary flex items-center gap-2 border-amber-300 text-amber-700 hover:bg-amber-50"
              title="Enter a booking on behalf of an owner"
            >
              <ClipboardEdit size={15} /> Owner Entry
            </button>
          )}
        </div>
      </div>

      {/* ── Date period filter ── */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        <span className="text-xs text-navy-400 font-medium flex items-center gap-1 flex-shrink-0">
          <CalendarDays size={13} /> Period:
        </span>
        {DATE_PRESETS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setDatePreset(key)}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors flex-shrink-0 ${
              datePreset === key ? 'bg-navy-700 text-white' : 'bg-white text-navy-500 hover:bg-navy-50 shadow-card'
            }`}
          >
            {label}
          </button>
        ))}

        {datePreset === 'custom' && (
          <div className="flex items-center gap-2 flex-shrink-0">
            <DatePicker
              selected={customFrom}
              onChange={setCustomFrom}
              selectsStart
              startDate={customFrom}
              endDate={customTo}
              dateFormat="yyyy-MM-dd"
              placeholderText="From"
              className="input !py-1.5 !w-36 text-xs"
              calendarClassName="emrac-datepicker"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              isClearable
            />
            <span className="text-navy-300 text-xs">→</span>
            <DatePicker
              selected={customTo}
              onChange={setCustomTo}
              selectsEnd
              startDate={customFrom}
              endDate={customTo}
              minDate={customFrom ?? undefined}
              dateFormat="yyyy-MM-dd"
              placeholderText="To"
              className="input !py-1.5 !w-36 text-xs"
              calendarClassName="emrac-datepicker"
              showMonthDropdown
              showYearDropdown
              dropdownMode="select"
              isClearable
            />
          </div>
        )}

        {datePreset !== 'all' && (
          <span className="text-xs text-navy-400 flex-shrink-0 ml-auto">
            {filtered.length} {filtered.length === 1 ? 'booking' : 'bookings'}
            {dateWindow?.from && dateWindow?.to && (
              <span className="text-navy-300"> · {dateWindow.from} → {dateWindow.to}</span>
            )}
          </span>
        )}
      </div>

      {/* ── Calendar View ── */}
      {viewMode === 'calendar' && (
        <div className="card" style={{ height: 620 }}>
          <style>{`
            /* ── Toolbar ──────────────────────────────── */
            .rbc-toolbar { margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
            .rbc-toolbar-label { font-size: 15px; font-weight: 700; color: #111114; }
            .rbc-btn-group { display: flex; gap: 4px; }
            .rbc-btn-group button {
              font-size: 12px; border-radius: 8px !important; border: 1px solid #F4F4F5 !important;
              color: #111114; padding: 5px 13px; background: #fff; font-weight: 500;
              transition: background 0.15s, color 0.15s;
            }
            .rbc-btn-group button:hover { background: #F4F4F5; }
            .rbc-btn-group button.rbc-active {
              background: #111114 !important; color: #fff !important;
              border-color: #111114 !important;
              box-shadow: 0 2px 8px rgba(17,17,20,0.25);
            }
            /* ── Month grid ───────────────────────────── */
            .rbc-month-view { border: 1px solid #F4F4F5; border-radius: 12px; overflow: hidden; }
            .rbc-month-row { border-color: #F4F4F5; }
            .rbc-day-bg + .rbc-day-bg { border-color: #F4F4F5; }
            .rbc-header {
              font-size: 11px; font-weight: 600; color: #71717A; letter-spacing: 0.04em;
              padding: 8px 0; background: #FAFAFA; border-bottom: 1px solid #F4F4F5 !important;
              text-transform: uppercase;
            }
            .rbc-header + .rbc-header { border-color: #F4F4F5; }
            .rbc-off-range-bg { background: #FAFAFA; }
            .rbc-today { background: rgba(75,123,229,0.04) !important; }
            .rbc-date-cell { padding: 5px 8px; }
            .rbc-date-cell > a { font-size: 12px; color: #111114; font-weight: 500; }
            .rbc-date-cell.rbc-off-range > a { color: #C4C4CC; }
            .rbc-date-cell.rbc-now > a { color: #E11D2A; font-weight: 700; }
            /* ── Events ───────────────────────────────── */
            .rbc-event {
              cursor: pointer; font-size: 11px; font-weight: 500;
              border: none !important; padding: 2px 7px !important;
            }
            .rbc-event:focus { outline: none; }
            .rbc-event-label { font-size: 10px; opacity: 0.85; }
            .rbc-show-more { font-size: 11px; color: #E11D2A; font-weight: 600; padding: 1px 6px; }
            /* ── Week / Day ───────────────────────────── */
            .rbc-time-view { border: 1px solid #F4F4F5; border-radius: 12px; overflow: hidden; }
            .rbc-time-header { border-color: #F4F4F5; background: #FAFAFA; }
            .rbc-time-header-content { border-color: #F4F4F5; }
            .rbc-timeslot-group { border-color: #F4F4F5; }
            .rbc-time-slot { font-size: 10px; color: #A1A1AA; }
            .rbc-current-time-indicator { background: #E11D2A; height: 2px; }
            .rbc-slot-selection { background: rgba(75,123,229,0.12) !important; }
            /* ── Agenda ───────────────────────────────── */
            .rbc-agenda-view table { border: none; }
            .rbc-agenda-date-cell, .rbc-agenda-time-cell { font-size: 12px; color: #71717A; }
            .rbc-agenda-event-cell { font-size: 12px; }
          `}</style>
          <Calendar
            localizer={localizer}
            events={calEvents}
            startAccessor="start"
            endAccessor="end"
            style={{ height: '100%' }}
            eventPropGetter={eventStyleGetter}
            onSelectEvent={(ev) => { setSelected((ev as typeof calEvents[0]).resource as Booking); setModal('view'); }}
            onSelectSlot={onSelectSlot}
            selectable
            popup
          />
        </div>
      )}

      {/* ── Cards View ── */}
      {viewMode === 'cards' && (() => {
        const activeList    = sorted.filter((b) => b.status !== 'Completed');
        const completedList = sorted.filter((b) => b.status === 'Completed');

        /* Compact vertical card — fits a 3-column grid, saves space */
        const renderGridCard = (b: Booking) => {
          const vehicle = vehicles.find((v) => v.id === b.vehicleId);
          const balance = b.totalAmount - (b.discount ?? 0) - b.paidAmount;
          return (
            <div
              key={b.id}
              className="bg-white rounded-2xl border border-navy-100 shadow-card hover:shadow-card-hover hover:border-blue-200 transition-all cursor-pointer overflow-hidden flex flex-col"
              onClick={() => { setSelected(b); setModal('view'); }}
            >
              <div className="h-1 w-full flex-shrink-0" style={{ background: STATUS_COLORS[b.status] ?? '#F4F4F5' }} />
              <div className="p-4 flex flex-col gap-3 flex-1">
                {/* vehicle + status */}
                <div className="flex items-center gap-3">
                  <div className="w-14 h-10 rounded-lg overflow-hidden bg-navy-50 border border-navy-100 flex-shrink-0">
                    <VehicleImage
                      brand={vehicle?.brand ?? ''} model={vehicle?.model ?? ''}
                      color={vehicle?.color} imageUrl={vehicle?.imageUrl}
                      bodyColor={vehicleBodyColor(vehicle?.color)} className="w-full h-full"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-navy-800 truncate">{vehicle?.brand} {vehicle?.model}</p>
                    <p className="text-[11px] text-navy-400 truncate">{vehicle?.vehicleNumber}</p>
                  </div>
                  <StatusBadge status={b.status} />
                </div>

                {/* customer */}
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-navy-700 truncate">{b.customerName}</p>
                  <p className="text-[11px] text-navy-400 truncate">{b.customerPhone}</p>
                </div>

                {/* compact timeline */}
                <div className="bg-navy-50/60 rounded-xl px-3 py-2 flex items-center gap-2">
                  <div className="min-w-0 flex-1 text-center">
                    <p className="text-sm font-black text-navy-800 leading-none">{fmt12(b.startTime) || '—'}</p>
                    <p className="text-[10px] text-navy-500 mt-0.5 whitespace-nowrap">{fmtDateShort(b.startDate)}</p>
                  </div>
                  <div className="flex flex-col items-center flex-shrink-0">
                    <span className="text-[9px] text-navy-400 whitespace-nowrap">{b.totalDays}d</span>
                    <Car size={12} className="text-blue-400" />
                  </div>
                  <div className="min-w-0 flex-1 text-center">
                    <p className="text-sm font-black text-navy-800 leading-none">{fmt12(b.endTime) || '—'}</p>
                    <p className="text-[10px] text-navy-500 mt-0.5 whitespace-nowrap">{fmtDateShort(b.endDate)}</p>
                  </div>
                </div>

                {/* price + action */}
                <div className="flex items-end justify-between gap-2 mt-auto">
                  <div className="min-w-0">
                    <p className="text-lg font-black text-navy-800 leading-none">Rs {b.totalAmount.toLocaleString()}</p>
                    {balance > 0
                      ? <p className="text-[11px] text-red-500 font-semibold mt-0.5">Rs {balance.toLocaleString()} due</p>
                      : <p className="text-[11px] text-emerald-600 font-semibold mt-0.5">Fully paid</p>}
                  </div>
                  {b.status === 'Confirmed' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); startBooking(b.id); }}
                      className="flex items-center gap-1 bg-navy-700 hover:bg-navy-600 text-white text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors flex-shrink-0"
                    >
                      <PlayCircle size={13} /> Start
                    </button>
                  ) : b.status === 'Ongoing' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); completeBooking(b.id); }}
                      className="flex items-center gap-1 bg-navy-700 hover:bg-navy-600 text-white text-xs font-semibold rounded-lg px-3 py-1.5 transition-colors flex-shrink-0"
                    >
                      <CheckCircle size={13} /> Complete
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-xs font-semibold text-blue-600 flex-shrink-0">
                      Details <ChevronRight size={13} />
                    </span>
                  )}
                </div>
              </div>

              {/* footer strip */}
              <div className="flex items-center justify-between gap-2 px-4 py-2 border-t border-navy-50">
                <span className="text-[10px] text-navy-500 bg-navy-50 border border-navy-100 rounded-full px-2 py-0.5 truncate">
                  {b.referral ?? 'Direct'}
                </span>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {b.insertedByAdmin && (
                    <span className="flex items-center gap-1 text-[9px] font-semibold bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">
                      <ClipboardEdit size={8} /> Admin
                    </span>
                  )}
                  {b.status === 'Confirmed' && (
                    <button
                      className="text-[11px] text-red-400 hover:text-red-600 font-medium"
                      onClick={(e) => { e.stopPropagation(); cancelBooking(b.id); }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        };

        /* Full-width horizontal "flight-style" card */
        const renderRowCard = (b: Booking) => {
          const vehicle = vehicles.find((v) => v.id === b.vehicleId);
          const owner   = owners.find((o) => o.id === vehicle?.ownerId);
          const balance = b.totalAmount - (b.discount ?? 0) - b.paidAmount;
          return (
            <div
              key={b.id}
              className="bg-white rounded-2xl border border-navy-100 shadow-card hover:shadow-card-hover hover:border-blue-200 transition-all cursor-pointer overflow-hidden"
              onClick={() => { setSelected(b); setModal('view'); }}
            >
              <div className="flex flex-col lg:flex-row lg:items-stretch">
                {/* status accent rail */}
                <div
                  className="h-1 w-full lg:h-auto lg:w-1.5 flex-shrink-0"
                  style={{ background: STATUS_COLORS[b.status] ?? '#F4F4F5' }}
                />

                {/* vehicle + customer + pickup→return timeline */}
                <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-4 p-4 lg:p-5 min-w-0">
                  {/* Vehicle */}
                  <div className="flex items-center gap-3 sm:w-48 flex-shrink-0">
                    <div className="w-16 h-11 rounded-lg overflow-hidden bg-navy-50 border border-navy-100 flex-shrink-0">
                      <VehicleImage
                        brand={vehicle?.brand ?? ''} model={vehicle?.model ?? ''}
                        color={vehicle?.color} imageUrl={vehicle?.imageUrl}
                        bodyColor={vehicleBodyColor(vehicle?.color)} className="w-full h-full"
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-bold text-navy-800 truncate">{vehicle?.brand} {vehicle?.model}</p>
                      <p className="text-[11px] text-navy-400 truncate">{vehicle?.vehicleNumber}</p>
                      <p className="text-[11px] font-medium text-navy-500 truncate mt-0.5">{b.customerName}</p>
                    </div>
                  </div>

                  {/* Timeline */}
                  <div className="flex items-start gap-2 sm:gap-4 flex-1 min-w-0">
                    {/* pickup */}
                    <div className="min-w-0">
                      <p className="text-lg font-black text-navy-800 leading-none">{fmt12(b.startTime) || '—'}</p>
                      <p className="text-[11px] text-navy-500 mt-1 whitespace-nowrap">{fmtDateLong(b.startDate)}</p>
                      <p className="text-[11px] text-navy-400 mt-0.5 flex items-center gap-0.5 truncate">
                        <MapPin size={9} className="flex-shrink-0" />{b.pickupLocation || 'Pickup'}
                      </p>
                    </div>
                    {/* connector */}
                    <div className="flex-1 flex flex-col items-center pt-1 min-w-[64px]">
                      <span className="text-[11px] text-navy-400 mb-1 whitespace-nowrap">
                        {b.totalDays} day{b.totalDays !== 1 ? 's' : ''}
                      </span>
                      <div className="w-full flex items-center">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                        <span className="flex-1 h-px bg-navy-200" />
                        <Car size={13} className="text-blue-400 mx-1 flex-shrink-0" />
                        <span className="flex-1 h-px bg-navy-200" />
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 flex-shrink-0" />
                      </div>
                      <span className="text-[10px] text-navy-400 mt-1 truncate max-w-full">{b.referral ?? 'Direct'}</span>
                    </div>
                    {/* return */}
                    <div className="min-w-0 text-right">
                      <p className="text-lg font-black text-navy-800 leading-none">{fmt12(b.endTime) || '—'}</p>
                      <p className="text-[11px] text-navy-500 mt-1 whitespace-nowrap">{fmtDateLong(b.endDate)}</p>
                      <p className="text-[11px] text-navy-400 mt-0.5 flex items-center justify-end gap-0.5 truncate">
                        <MapPin size={9} className="flex-shrink-0" />{b.dropLocation || 'Return'}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Price + primary action */}
                <div className="flex flex-row lg:flex-col items-center justify-between lg:justify-center gap-3 px-4 py-3 lg:px-5 lg:py-5 lg:w-44 flex-shrink-0 bg-navy-50/40 border-t lg:border-t-0 lg:border-l border-navy-100">
                  <div className="lg:text-center">
                    <p className="text-xl font-black text-navy-800 leading-none">Rs {b.totalAmount.toLocaleString()}</p>
                    {balance > 0
                      ? <p className="text-[11px] text-red-500 font-semibold mt-1">Rs {balance.toLocaleString()} due</p>
                      : <p className="text-[11px] text-emerald-600 font-semibold mt-1">Fully paid</p>}
                  </div>
                  {b.status === 'Confirmed' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); startBooking(b.id); }}
                      className="flex items-center gap-1 bg-navy-700 hover:bg-navy-600 text-white text-sm font-semibold rounded-xl px-4 py-2 transition-colors shadow-sm"
                      title="Mark vehicle as On Rent"
                    >
                      <PlayCircle size={14} /> Start
                    </button>
                  ) : b.status === 'Ongoing' ? (
                    <button
                      onClick={(e) => { e.stopPropagation(); completeBooking(b.id); }}
                      className="flex items-center gap-1 bg-navy-700 hover:bg-navy-600 text-white text-sm font-semibold rounded-xl px-4 py-2 transition-colors shadow-sm"
                    >
                      <CheckCircle size={14} /> Complete
                    </button>
                  ) : (
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelected(b); setModal('view'); }}
                      className="flex items-center gap-1 bg-white border border-navy-200 hover:bg-navy-50 text-navy-700 text-sm font-semibold rounded-xl px-3.5 py-2 transition-colors"
                    >
                      Details <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>

              {/* tag strip */}
              <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-t border-navy-50 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <StatusBadge status={b.status} />
                  {owner && (
                    <span className="text-[10px] text-navy-500 bg-navy-50 border border-navy-100 rounded-full px-2 py-0.5">
                      {owner.name}
                    </span>
                  )}
                  {b.insertedByAdmin && (
                    <span className="flex items-center gap-1 text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">
                      <ClipboardEdit size={9} /> Admin
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  {b.status === 'Confirmed' && (
                    <button
                      className="text-xs text-red-400 hover:text-red-600 font-medium transition-colors"
                      onClick={(e) => { e.stopPropagation(); cancelBooking(b.id); }}
                    >
                      Cancel
                    </button>
                  )}
                  <span className="flex items-center gap-1 text-xs font-semibold text-blue-600">
                    View Details <ChevronDown size={13} />
                  </span>
                </div>
              </div>
            </div>
          );
        };

        const renderCompactCard = (b: Booking) => {
          const vehicle = vehicles.find((v) => v.id === b.vehicleId);
          const balance = b.totalAmount - (b.discount ?? 0) - b.paidAmount;
          return (
            <div
              key={b.id}
              className="card !p-2.5 hover:shadow-card-hover transition-shadow cursor-pointer"
              onClick={() => { setSelected(b); setModal('view'); }}
            >
              <div
                className="h-1 rounded-full mb-2 -mt-0.5"
                style={{ background: STATUS_COLORS[b.status] ?? '#F4F4F5' }}
              />
              <p className="text-xs font-bold text-navy-800 truncate">{b.customerName}</p>
              <p className="text-[10px] text-navy-400 truncate mb-1.5">
                {vehicle?.brand} {vehicle?.model} · {vehicle?.vehicleNumber}
              </p>
              <p className="text-[10px] text-navy-500 truncate">{b.startDate} → {b.endDate}</p>
              <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-navy-50">
                <span className="text-[11px] font-bold text-navy-800">Rs {b.totalAmount.toLocaleString()}</span>
                {b.insertedByAdmin
                  ? <span className="text-[9px] font-semibold bg-amber-100 text-amber-700 rounded-full px-1.5 py-0.5">Admin</span>
                  : balance > 0 && <span className="text-[10px] font-semibold text-red-500">-{balance.toLocaleString()}</span>
                }
              </div>
            </div>
          );
        };

        const isGrid       = cardLayout === 'grid';
        const renderCard   = isGrid ? renderGridCard : renderRowCard;
        const listClass    = isGrid ? 'grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4' : 'space-y-3';

        return (
          <>
            {/* Active bookings */}
            {activeList.length > 0 && (
              <div className={listClass}>
                {activeList.map(renderCard)}
              </div>
            )}
            {activeList.length === 0 && completedList.length === 0 && (
              <div className="text-center py-16 text-navy-400 text-sm">No bookings found.</div>
            )}

            {/* Completed bookings — full cards when:
                  (a) viewing the Completed tab, or
                  (b) no active bookings in the current view (e.g. all-Completed filter, or
                      a past-date window where every result is Completed).
                In case (b) the accordion would be the only thing on screen and users
                wouldn't realise there's content behind it. */}
            {(tab === 'Completed' || activeList.length === 0) && completedList.length > 0 && (
              <div className={listClass}>
                {completedList.map(renderCard)}
              </div>
            )}

            {/* Completed bookings accordion (compact tiles) — only shown when active bookings
                are also visible, so completed ones don't drown out the active feed */}
            {tab !== 'Completed' && activeList.length > 0 && completedList.length > 0 && (
              <div className="mt-4">
                <button
                  onClick={() => setCompletedOpen((v) => !v)}
                  className="w-full flex items-center gap-3 px-4 py-3 bg-white rounded-xl border border-navy-100 hover:bg-navy-50/60 transition-colors shadow-card"
                >
                  <div className="w-2.5 h-2.5 rounded-full bg-gray-400 flex-shrink-0" />
                  <span className="text-sm font-semibold text-navy-700 flex-1 text-left">
                    Completed Bookings
                  </span>
                  <span className="text-xs text-navy-400 bg-navy-50 px-2.5 py-0.5 rounded-full">
                    {completedList.length}
                  </span>
                  <ChevronDown
                    size={16}
                    className={`text-navy-400 transition-transform duration-300 flex-shrink-0 ${completedOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {completedOpen && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-10 gap-2.5 mt-4">
                    {completedList.map(renderCompactCard)}
                  </div>
                )}
              </div>
            )}
          </>
        );
      })()}

      {/* ── Add Booking Modal ── */}
      <Modal open={modal === 'add'} onClose={() => setModal(null)} title="New Booking" width="max-w-2xl">
        {error && (
          <div className="flex items-center gap-2 bg-red-50 text-red-700 text-sm px-4 py-3 rounded-xl mb-4">
            <AlertTriangle size={15} /> {error}
          </div>
        )}

        <div className="space-y-5">
          {/* Customer mode toggle */}
          <div className="flex gap-2 p-1 bg-navy-50 rounded-xl">
            <button
              type="button"
              onClick={() => { setCustomerMode('new'); setSelectedCustomer(''); setForm((f) => ({ ...f, customerName: '', customerPhone: '', customerEmail: '', customerNIC: '' })); }}
              className={`flex-1 py-2 rounded-[10px] text-xs font-semibold transition-all ${
                customerMode === 'new'
                  ? 'bg-navy-700 text-white shadow-sm'
                  : 'text-navy-500 hover:text-navy-700'
              }`}
            >
              New Customer
            </button>
            <button
              type="button"
              onClick={() => { setCustomerMode('existing'); setSelectedCustomer(''); }}
              className={`flex-1 py-2 rounded-[10px] text-xs font-semibold transition-all ${
                customerMode === 'existing'
                  ? 'bg-navy-700 text-white shadow-sm'
                  : 'text-navy-500 hover:text-navy-700'
              }`}
            >
              Existing Customer
            </button>
          </div>

          {/* Vehicle select */}
          <div>
            <p className="label">Select Vehicle *</p>
            <Select
              value={form.vehicleId}
              onChange={(val) => { set('vehicleId', val); setStartWarn(''); setEndWarn(''); }}
              placeholder="Choose a vehicle"
              options={bookableVehicles.map((v) => ({
                value: v.id,
                label: `${v.brand} ${v.model} · ${v.vehicleNumber}`,
                sub: `Rs ${v.dailyRent.toLocaleString()} / day · ${v.status}`,
              }))}
            />
          </div>

          {/* Vehicle status — shows immediately after vehicle is selected */}
          {vehicleStatus && (
            !vehicleStatus.currentHire && vehicleStatus.upcomingHires.length === 0 ? (
              <div className="flex items-center gap-2.5 bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-2.5">
                <CheckCircle size={14} className="text-emerald-500 flex-shrink-0" />
                <p className="text-sm font-medium text-emerald-700">Vehicle is available — select your dates below</p>
              </div>
            ) : (
              <div className="border border-red-200 rounded-xl overflow-hidden text-xs">
                {vehicleStatus.currentHire && (
                  <div className="bg-red-50 px-4 py-3">
                    <p className="font-bold text-red-700 uppercase tracking-wide text-[10px] mb-2">Currently in Hire</p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                      <div>
                        <p className="text-red-400 mb-0.5">Customer</p>
                        <p className="font-semibold text-red-800">{vehicleStatus.currentHire.customerName}</p>
                      </div>
                      <div>
                        <p className="text-red-400 mb-0.5">Phone</p>
                        <p className="font-semibold text-red-800">{vehicleStatus.currentHire.customerPhone || '—'}</p>
                      </div>
                      <div>
                        <p className="text-red-400 mb-0.5">Hire Period</p>
                        <p className="font-semibold text-red-800">{vehicleStatus.currentHire.startDate} → {vehicleStatus.currentHire.endDate}</p>
                      </div>
                      <div>
                        <p className="text-red-400 mb-0.5">Next Free</p>
                        <p className="font-bold text-emerald-700">{vehicleStatus.nextFree}</p>
                      </div>
                    </div>
                  </div>
                )}
                {vehicleStatus.upcomingHires.length > 0 && (
                  <div className={`px-4 py-3 ${vehicleStatus.currentHire ? 'border-t border-amber-200 bg-amber-50/70' : 'bg-amber-50/70'}`}>
                    <p className="font-bold text-amber-700 uppercase tracking-wide text-[10px] mb-2">Upcoming Bookings</p>
                    <div className="space-y-1">
                      {vehicleStatus.upcomingHires.map((b) => (
                        <div key={b.id} className="flex justify-between">
                          <span className="text-amber-800 font-medium">{b.customerName}</span>
                          <span className="text-amber-700">{b.startDate} → {b.endDate}</span>
                        </div>
                      ))}
                    </div>
                    {!vehicleStatus.currentHire && (
                      <p className="text-emerald-700 font-semibold mt-2">Next free: {vehicleStatus.nextFree}</p>
                    )}
                  </div>
                )}
              </div>
            )
          )}

          {/* Date pickers — blocked dates are greyed out in the calendar */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="label">Start Date *</p>
              <DatePicker
                selected={form.startDate ? parseISO(form.startDate) : null}
                onChange={handleStartDate}
                minDate={new Date()}
                filterDate={isDateAvailable}
                dateFormat="yyyy-MM-dd"
                placeholderText="Select start date"
                className={`input w-full ${startWarn ? 'border-red-400 focus:border-red-500' : ''}`}
                calendarClassName="emrac-datepicker"
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
              />
              {startWarn && (
                <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5">
                  <XCircle size={12} /> {startWarn}
                </p>
              )}
            </div>
            <div>
              <p className="label">End Date *</p>
              <DatePicker
                selected={form.endDate ? parseISO(form.endDate) : null}
                onChange={handleEndDate}
                minDate={form.startDate ? parseISO(form.startDate) : new Date()}
                filterDate={isDateAvailable}
                dateFormat="yyyy-MM-dd"
                placeholderText="Select end date"
                className={`input w-full ${endWarn ? 'border-red-400 focus:border-red-500' : ''}`}
                calendarClassName="emrac-datepicker"
                showMonthDropdown
                showYearDropdown
                dropdownMode="select"
              />
              {endWarn && (
                <p className="flex items-center gap-1.5 text-xs text-red-600 mt-1.5">
                  <XCircle size={12} /> {endWarn}
                </p>
              )}
            </div>
          </div>

          {/* Pickup / return times — recorded per booking so a vehicle returned
              in the morning can be re-hired later the same day */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="label">Pickup Time</p>
              <TimePicker value={form.startTime} onChange={(v) => set('startTime', v)} placeholder="Pickup time" />
            </div>
            <div>
              <p className="label">Return Time</p>
              <TimePicker value={form.endTime} onChange={(v) => set('endTime', v)} placeholder="Return time" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
            <input type="checkbox" className="rounded" checked={form.waiveExtraDay} onChange={(e) => set('waiveExtraDay', e.target.checked)} />
            Don't charge extra days (owner approved) — a partial day past a full 24h period won't be billed as another day
          </label>

          {/* Full date-range conflict banner — shown after both dates are picked */}
          {form.vehicleId && form.startDate && form.endDate && availability !== null && (
            availability ? (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm px-4 py-3 rounded-xl">
                <CheckCircle size={15} className="flex-shrink-0" />
                <span>
                  Available · <span className="font-semibold">{form.totalDays} day{form.totalDays !== 1 ? 's' : ''}</span>
                  {' · '}Base cost: <span className="font-semibold">Rs {form.totalAmount.toLocaleString()}</span>
                </span>
              </div>
            ) : (() => {
              const candS = bookingStartMs({ startDate: form.startDate, startTime: form.startTime });
              const candE = bookingEndMs({ endDate: form.endDate, endTime: form.endTime });
              const conflict = bookings.find(
                (b) => b.vehicleId === form.vehicleId && blocksAvailability(b)
                  && rangesOverlap(candS, candE, bookingStartMs(b), bookingEndMs(b))
              );
              const allVB = bookings
                .filter((b) => b.vehicleId === form.vehicleId && blocksAvailability(b))
                .sort((a, b) => (a.startDate ?? '').localeCompare(b.startDate ?? ''));
              let nextFree: string | null = null;
              try {
                if (conflict?.endDate) {
                  nextFree = freeFromDay(conflict);
                  let changed = true;
                  let iter = 0;
                  while (changed && iter++ < 200) {
                    changed = false;
                    for (const b of allVB) {
                      if (b.startDate && b.endDate && b.startDate <= nextFree! && nextFree! < freeFromDay(b)) {
                        nextFree = freeFromDay(b);
                        changed = true;
                        break;
                      }
                    }
                  }
                }
              } catch { /* leave nextFree null */ }
              return (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    <XCircle size={14} className="text-red-500 flex-shrink-0" />
                    <span className="text-sm font-bold text-red-700">Selected dates not available</span>
                  </div>
                  {conflict && (
                    <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs pl-1">
                      <span className="text-red-400">Booked by</span><span className="font-semibold text-red-800">{conflict.customerName}</span>
                      <span className="text-red-400">Booked period</span><span className="font-semibold text-red-800">{conflict.startDate}{conflict.startTime ? ` ${fmt12(conflict.startTime)}` : ''} → {conflict.endDate}{conflict.endTime ? ` ${fmt12(conflict.endTime)}` : ''}</span>
                      {nextFree && <><span className="text-red-400">Next free date</span><span className="font-bold text-emerald-700">{nextFree}</span></>}
                    </div>
                  )}
                </div>
              );
            })()
          )}

          {/* Customer info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* ── Existing customer picker ── */}
            {customerMode === 'existing' ? (
              <div className="sm:col-span-2">
                <p className="label">Select Customer *</p>
                <Select
                  value={selectedCustomer}
                  onChange={(id) => {
                    const c = customers.find((x) => x.id === id);
                    if (!c) return;
                    setSelectedCustomer(id);
                    setForm((f) => ({
                      ...f,
                      customerName:  c.name,
                      customerPhone: c.phone,
                      customerEmail: c.email  ?? '',
                      customerNIC:   c.nic    ?? '',
                    }));
                  }}
                  placeholder="Search and select a customer…"
                  options={customers.map((c) => ({
                    value: c.id,
                    label: c.name,
                    sub:   c.phone + (c.nic ? ` · ${c.nic}` : ''),
                  }))}
                />
                {selectedCustomer && (() => {
                  const c = customers.find((x) => x.id === selectedCustomer);
                  if (!c) return null;
                  return (
                    <div className="mt-2 bg-navy-50/70 border border-navy-100 rounded-xl px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                      <div>
                        <p className="text-navy-400">Phone</p>
                        <p className="font-semibold text-navy-800">{c.phone}</p>
                      </div>
                      {c.email && (
                        <div>
                          <p className="text-navy-400">Email</p>
                          <p className="font-semibold text-navy-800">{c.email}</p>
                        </div>
                      )}
                      {c.nic && (
                        <div>
                          <p className="text-navy-400">NIC</p>
                          <p className="font-semibold text-navy-800">{c.nic}</p>
                        </div>
                      )}
                      {c.address && (
                        <div>
                          <p className="text-navy-400">Address</p>
                          <p className="font-semibold text-navy-800">{c.address}</p>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            ) : (
              /* ── New customer fields ── */
              <>
                <div>
                  <p className="label">Customer Name *</p>
                  <input className="input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} placeholder="Full name" />
                </div>
                <div>
                  <p className="label">Phone</p>
                  <input className="input" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} placeholder="07X XXXXXXX" />
                </div>
                <div>
                  <p className="label">Email <span className="text-navy-400 font-normal">(for receipt)</span></p>
                  <input className="input" type="email" value={form.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} placeholder="customer@email.com" />
                </div>
                <div>
                  <p className="label">NIC</p>
                  <input className="input" value={form.customerNIC} onChange={(e) => set('customerNIC', e.target.value)} placeholder="NIC number" />
                </div>
              </>
            )}

            {/* Referral — pick a registered owner, or enter a third party */}
            <div className="sm:col-span-2">
              <p className="label">Referral <span className="text-navy-400 font-normal">(who sent this hire)</span></p>
              {referralCustom ? (
                <div className="flex gap-2">
                  <input
                    className="input flex-1"
                    value={form.referral === 'Direct' ? '' : form.referral}
                    onChange={(e) => set('referral', e.target.value || 'Direct')}
                    placeholder="Third-party name (e.g. a friend not in the system)"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => { setReferralCustom(false); set('referral', 'Direct'); }}
                    className="btn-secondary flex-shrink-0 text-xs"
                  >
                    Pick from list
                  </button>
                </div>
              ) : (
                <Select
                  value={form.referral}
                  onChange={(val) => {
                    if (val === '__custom__') { setReferralCustom(true); setForm((f) => ({ ...f, referral: '', referralFeeValue: 0 })); return; }
                    // Marketing sources & Direct never carry a fee — clear any entered fee.
                    const isSource = REFERRAL_SOURCES.includes(val);
                    setForm((f) => ({
                      ...f,
                      referral: val || 'Direct',
                      ...((val === 'Direct' || val === '' || isSource) ? { referralFeeValue: 0 } : {}),
                    }));
                  }}
                  placeholder="Direct"
                  options={[
                    { value: 'Direct', label: 'Direct' },
                    ...owners.map((o) => ({ value: o.name, label: o.name, sub: 'Owner referral · earns a fee' })),
                    ...REFERRAL_SOURCES.map((s) => ({ value: s, label: s, sub: 'Marketing source' })),
                    { value: '__custom__', label: 'Other / third party…', sub: 'Type a name · earns a fee' },
                  ]}
                />
              )}
            </div>

            {/* Self-referral block — the vehicle owner can't refer their own vehicle */}
            {selfReferral && (
              <div className="sm:col-span-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                <div className="flex items-start gap-2">
                  <XCircle size={15} className="text-red-500 flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-bold text-red-700">{bookedVehicleOwner?.name} owns this vehicle</p>
                    <p className="text-xs text-red-600 mt-0.5">
                      A vehicle owner can't be the referrer for their own vehicle — they'd be paying a fee to themselves.
                      Change the referral to Direct to continue.
                    </p>
                    <button
                      type="button"
                      onClick={() => { setReferralCustom(false); setForm((f) => ({ ...f, referral: 'Direct', referralFeeValue: 0 })); }}
                      className="mt-2 text-xs font-semibold text-white bg-red-500 hover:bg-red-600 rounded-lg px-3 py-1.5 transition-colors"
                    >
                      Set referral to Direct
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Referral fee — only owner / third-party referrals are paid; deducted from the owner payout */}
            {isPersonReferral && !selfReferral && (
              <div className="sm:col-span-2 bg-navy-50/60 rounded-xl p-3">
                <p className="label">Referral Fee for {form.referral}</p>
                <div className="flex gap-2 items-center">
                  <div className="flex bg-white rounded-xl p-0.5 gap-0.5 border border-navy-100 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => set('referralFeeType', 'fixed')}
                      className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${form.referralFeeType === 'fixed' ? 'bg-navy-700 text-white' : 'text-navy-500'}`}
                    >
                      Rs
                    </button>
                    <button
                      type="button"
                      onClick={() => set('referralFeeType', 'percent')}
                      className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${form.referralFeeType === 'percent' ? 'bg-navy-700 text-white' : 'text-navy-500'}`}
                    >
                      %
                    </button>
                  </div>
                  <input
                    className="input flex-1"
                    type="number"
                    min={0}
                    value={form.referralFeeValue || ''}
                    onChange={(e) => set('referralFeeValue', +e.target.value)}
                    placeholder={form.referralFeeType === 'percent' ? 'e.g. 5' : 'e.g. 2000'}
                  />
                </div>
                {form.referralFeeValue > 0 && (
                  <p className="text-xs text-navy-500 mt-2">
                    Referrer gets <span className="font-semibold text-navy-800">Rs {(
                      form.referralFeeType === 'percent'
                        ? Math.round(form.totalAmount * (form.referralFeeValue / 100))
                        : Math.round(form.referralFeeValue)
                    ).toLocaleString()}</span>
                    {form.referralFeeType === 'percent' && ` (${form.referralFeeValue}% of Rs ${form.totalAmount.toLocaleString()})`}
                    {' · '}deducted from owner payout
                  </p>
                )}
              </div>
            )}

            <div>
              <p className="label">Pickup Location</p>
              <LocationInput value={form.pickupLocation} onChange={(v) => set('pickupLocation', v)} placeholder="Pickup location…" />
            </div>
            <div>
              <p className="label">Drop Location</p>
              <LocationInput value={form.dropLocation} onChange={(v) => set('dropLocation', v)} placeholder="Drop location…" />
            </div>
            <div>
              <p className="label">Paid Amount (Rs)</p>
              <input className="input" type="number" value={form.paidAmount} onChange={(e) => set('paidAmount', +e.target.value)} />
            </div>
            <div>
              <p className="label">Assign Driver</p>
              <Select
                value={form.driverId}
                onChange={(val) => set('driverId', val)}
                placeholder="No driver"
                options={drivers
                  .filter((d) => d.status === 'Available')
                  .map((d) => ({ value: d.id, label: d.name, sub: `Rs ${d.dailyRate.toLocaleString()} / day` }))}
              />
            </div>

            {/* Security Deposit */}
            <div className="sm:col-span-2">
              <p className="label flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 inline-block flex-shrink-0" />
                Security Deposit
              </p>
              <div className="flex items-center gap-2 flex-wrap">
                  <Select
                    className="w-36 flex-shrink-0"
                    value={form.depositType ?? ''}
                    nullable
                    placeholder="None"
                    options={[
                      { value: 'cash',    label: 'Cash' },
                      { value: 'vehicle', label: 'Vehicle' },
                      { value: 'other',   label: 'Other' },
                    ]}
                    onChange={(val) => {
                      const v = val as 'cash' | 'vehicle' | 'other' | '';
                      set('depositType', v || undefined);
                      if (v !== 'cash')    set('depositAmount', 0);
                      if (v !== 'vehicle') { set('depositVehicleModel', ''); set('depositVehicleColor', ''); set('depositVehicleNumber', ''); }
                      if (v !== 'other')   set('depositAssetDescription', '');
                    }}
                  />
                {form.depositType === 'cash' && (
                  <input className="input flex-1" type="number" min="0" value={form.depositAmount || ''} onChange={(e) => set('depositAmount', +e.target.value)} placeholder="Amount (Rs)" />
                )}
                {form.depositType === 'vehicle' && (
                  <>
                    <input className="input flex-1" type="text" value={form.depositVehicleModel}  onChange={(e) => set('depositVehicleModel', e.target.value)}  placeholder="Model (e.g. Honda CB150R)" />
                    <input className="input w-28"   type="text" value={form.depositVehicleColor}  onChange={(e) => set('depositVehicleColor', e.target.value)}  placeholder="Color" />
                    <input className="input w-32"   type="text" value={form.depositVehicleNumber} onChange={(e) => set('depositVehicleNumber', e.target.value)} placeholder="Vehicle No." />
                  </>
                )}
                {form.depositType === 'other' && (
                  <input className="input flex-1" type="text" value={form.depositAssetDescription} onChange={(e) => set('depositAssetDescription', e.target.value)} placeholder="Describe the item held as deposit" />
                )}
              </div>
            </div>

            <div className="sm:col-span-2">
              <p className="label">Notes</p>
              <textarea className="input resize-none" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Additional notes..." />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setModal(null)} className="btn-secondary">Cancel</button>
          <button
            onClick={() => setModal('calculator')}
            className="btn-secondary flex items-center gap-2 border-blue-200 text-blue-700 hover:bg-blue-50"
          >
            <Calculator size={14} /> Calculate Total Bill
          </button>
          <button
            onClick={handleCreate}
            disabled={selfReferral}
            className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            title={selfReferral ? "The vehicle owner can't refer their own vehicle — set the referral to Direct." : undefined}
          >
            Confirm Booking
          </button>
        </div>
      </Modal>

      {/* ── Availability Check Modal ── */}
      <AvailabilityModal open={availabilityOpen} onClose={() => setAvailabilityOpen(false)} />

      {/* ── Admin — enter booking on behalf of owner ── */}
      <AdminBookingModal open={adminBookingOpen} onClose={() => setAdminBookingOpen(false)} />

      {/* ── Trip Bill Calculator Modal ── */}
      <TripCalculatorModal
        open={modal === 'calculator'}
        onBack={() => setModal('add')}
        onConfirm={() => { handleCreate(); }}
        form={form}
        vehicle={vehicles.find((v) => v.id === form.vehicleId)}
        updateQuotation={(updates) =>
          setForm((f) => {
            const q = { ...f.quotation, ...updates };
            const updated = { ...f, quotation: q };
            recalcEstimate(updated);
            return updated;
          })
        }
      />

      {/* ── View Modal ── */}
      <Modal open={modal === 'view'} onClose={() => setModal(null)} title="Booking Details">
        {selected && (() => {
          const vehicle = vehicles.find((v) => v.id === selected.vehicleId);
          const owner   = owners.find((o) => o.id === vehicle?.ownerId);
          const driver  = drivers.find((d) => d.id === selected.driverId);
          const balance = selected.totalAmount - (selected.discount ?? 0) - selected.paidAmount;
          return (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-bold text-navy-800">{selected.customerName}</p>
                  <p className="text-sm text-navy-400">
                    {selected.customerPhone}
                    {selected.customerNIC && ` · ${selected.customerNIC}`}
                    {selected.customerEmail && ` · ${selected.customerEmail}`}
                  </p>
                </div>
                <StatusBadge status={selected.status} size="md" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                {[
                  ['Vehicle',    `${vehicle?.brand} ${vehicle?.model}`],
                  ['Reg. No.',   vehicle?.vehicleNumber ?? '—'],
                  ['Owner',      owner?.name ?? '—'],
                  ['Owner Phone',owner?.phone ?? '—'],
                  ['Start Date', selected.startDate],
                  ['End Date',   selected.endDate],
                  ['Duration',   `${selected.totalDays} days`],
                  ['Referral',   selected.referral ?? 'Direct'],
                  ...((selected.referralFee ?? 0) > 0
                    ? [['Referral Fee', `Rs ${(selected.referralFee ?? 0).toLocaleString()}`] as [string, string]]
                    : []),
                  ['Pickup',     selected.pickupLocation || '—'],
                  ['Drop',       selected.dropLocation || '—'],
                ].map(([l, v]) => (
                  <div key={l} className="bg-navy-50/60 rounded-xl p-3">
                    <p className="text-xs text-navy-400">{l}</p>
                    <p className="text-sm font-semibold text-navy-800">{v}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="bg-navy-700 rounded-xl p-3 text-white">
                  <p className="text-xs opacity-70">Total</p>
                  <p className="text-base font-bold">Rs {selected.totalAmount.toLocaleString()}</p>
                </div>
                <div className="bg-emerald-50 rounded-xl p-3">
                  <p className="text-xs text-emerald-600">Paid</p>
                  <p className="text-base font-bold text-emerald-700">Rs {selected.paidAmount.toLocaleString()}</p>
                </div>
                <div className={`rounded-xl p-3 ${balance > 0 ? 'bg-red-50' : 'bg-navy-50'}`}>
                  <p className={`text-xs ${balance > 0 ? 'text-red-500' : 'text-navy-400'}`}>Balance</p>
                  <p className={`text-base font-bold ${balance > 0 ? 'text-red-700' : 'text-navy-700'}`}>
                    Rs {balance.toLocaleString()}
                  </p>
                </div>
              </div>

              {/* Security Deposit section */}
              {(selected.depositType || (selected.depositAmount ?? 0) > 0) && (
                <div className="border border-amber-200 rounded-xl p-3 space-y-2">
                  <p className="text-xs font-semibold text-amber-700 flex items-center gap-1.5">
                    <Shield size={12} /> Security Deposit
                  </p>

                  {/* Deposit type badge + details */}
                  {selected.depositType && (
                    <div className="space-y-1.5">
                      <span className={`inline-block text-xs font-semibold px-2 py-0.5 rounded-full ${
                        selected.depositType === 'cash'    ? 'bg-amber-100 text-amber-800' :
                        selected.depositType === 'vehicle' ? 'bg-blue-100 text-blue-800' :
                                                             'bg-navy-100 text-navy-700'
                      }`}>
                        {selected.depositType === 'cash' ? 'Cash' : selected.depositType === 'vehicle' ? 'Vehicle' : 'Other'}
                      </span>
                      {selected.depositType === 'vehicle' && selected.depositAssetDescription && (() => {
                        const [vModel, vColor, vNumber] = selected.depositAssetDescription.split(' | ');
                        return (
                          <div className="grid grid-cols-3 gap-2 text-xs">
                            {vModel  && <div className="bg-navy-50 rounded-lg p-2"><p className="text-navy-400">Model</p><p className="font-semibold text-navy-800">{vModel}</p></div>}
                            {vColor  && <div className="bg-navy-50 rounded-lg p-2"><p className="text-navy-400">Color</p><p className="font-semibold text-navy-800">{vColor}</p></div>}
                            {vNumber && <div className="bg-navy-50 rounded-lg p-2"><p className="text-navy-400">Vehicle No.</p><p className="font-semibold text-navy-800">{vNumber}</p></div>}
                          </div>
                        );
                      })()}
                      {selected.depositType === 'other' && selected.depositAssetDescription && (
                        <p className="text-xs text-navy-700">{selected.depositAssetDescription}</p>
                      )}
                    </div>
                  )}

                  {/* Cash amounts grid — only when cash deposit */}
                  {selected.depositType === 'cash' && (
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div className="bg-amber-50 rounded-lg p-2">
                        <p className="text-amber-500">Collected</p>
                        <p className="font-bold text-amber-800">Rs {(selected.depositAmount ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="bg-emerald-50 rounded-lg p-2">
                        <p className="text-emerald-500">Returned</p>
                        <p className="font-bold text-emerald-700">Rs {(selected.depositReturned ?? 0).toLocaleString()}</p>
                      </div>
                      <div className="bg-red-50 rounded-lg p-2">
                        <p className="text-red-400">Deducted</p>
                        <p className="font-bold text-red-700">Rs {(selected.depositDeduction ?? 0).toLocaleString()}</p>
                      </div>
                    </div>
                  )}
                  {selected.depositNotes && (
                    <p className="text-xs text-amber-600 pl-1">{selected.depositNotes}</p>
                  )}
                  {(selected.status === 'Completed' || selected.status === 'Ongoing') && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {selected.depositType === 'cash' && (
                        <>
                          <div>
                            <p className="label text-[11px]">Return Amount</p>
                            <input className="input text-xs py-1" type="number"
                              defaultValue={selected.depositReturned ?? ''}
                              onBlur={(e) => updateBooking(selected.id, { depositReturned: +e.target.value })}
                              placeholder="0"
                            />
                          </div>
                          <div>
                            <p className="label text-[11px]">Deduction</p>
                            <input className="input text-xs py-1" type="number"
                              defaultValue={selected.depositDeduction ?? ''}
                              onBlur={(e) => updateBooking(selected.id, { depositDeduction: +e.target.value })}
                              placeholder="0"
                            />
                          </div>
                        </>
                      )}
                      <div className="sm:col-span-2">
                        <p className="label text-[11px]">{selected.depositType === 'vehicle' || selected.depositType === 'other' ? 'Return / Condition Notes' : 'Deduction Notes'}</p>
                        <input className="input text-xs py-1"
                          defaultValue={selected.depositNotes ?? ''}
                          onBlur={(e) => updateBooking(selected.id, { depositNotes: e.target.value })}
                          placeholder={selected.depositType === 'vehicle' || selected.depositType === 'other' ? 'Item returned, scratched, missing, etc.' : 'Damage, cleaning fee, etc.'}
                        />
                      </div>
                    </div>
                  )}
                </div>
              )}

              {driver && (
                <div className="bg-blue-50 rounded-xl p-3">
                  <p className="text-xs text-blue-500">Assigned Driver</p>
                  <p className="text-sm font-semibold text-blue-700">{driver.name} · {driver.phone}</p>
                </div>
              )}
              {selected.notes && (
                <div className="bg-navy-50/60 rounded-xl p-3">
                  <p className="text-xs text-navy-400">Notes</p>
                  <p className="text-sm text-navy-700">{selected.notes}</p>
                </div>
              )}

              {/* Action footer */}
              <div className="flex items-center gap-2 pt-2 border-t border-navy-100">
                {/* WhatsApp button — always shown */}
                <button
                  className="flex items-center gap-1.5 text-xs bg-emerald-500 hover:bg-emerald-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                  onClick={() => {
                    const v = vehicles.find((vv) => vv.id === selected.vehicleId);
                    openWhatsApp(selected.customerPhone, buildBookingWhatsAppMsg(selected, v));
                  }}
                >
                  <MessageCircle size={13} /> WhatsApp
                </button>

                {/* Print confirmation */}
                <button
                  className="flex items-center gap-1.5 text-xs bg-navy-100 hover:bg-navy-200 text-navy-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
                  onClick={() => {
                    const v = vehicles.find((vv) => vv.id === selected.vehicleId);
                    const d = drivers.find((dr) => dr.id === selected.driverId);
                    printBookingConfirmation(selected, v, d);
                  }}
                >
                  <Printer size={13} /> Print
                </button>

                <div className="flex-1" />

                {selected.status === 'Confirmed' && (
                  <>
                    <button
                      className="flex items-center gap-1.5 text-xs bg-navy-700 hover:bg-navy-600 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                      onClick={() => { startBooking(selected.id); setModal(null); }}
                    >
                      <PlayCircle size={13} /> Start Trip
                    </button>
                    <button
                      className="text-xs text-red-500 hover:bg-red-50 border border-red-200 px-3 py-1.5 rounded-lg transition-colors"
                      onClick={() => { cancelBooking(selected.id); setModal(null); }}
                    >
                      Cancel Booking
                    </button>
                  </>
                )}
                {selected.status === 'Ongoing' && (
                  <button
                    className="text-xs bg-navy-700 hover:bg-navy-800 text-white px-3 py-1.5 rounded-lg font-medium transition-colors"
                    onClick={() => { completeBooking(selected.id); setModal(null); }}
                  >
                    Complete Trip
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
