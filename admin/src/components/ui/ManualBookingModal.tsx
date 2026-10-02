import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  X, Car, User, Calendar, DollarSign, Users,
  MapPin, FileText, AlertCircle, CheckCircle2, Search, UserCheck, Lock,
} from 'lucide-react';
import { useStore } from '../../store/useStore';
import { useAuthStore } from '../../store/useAuthStore';
import Select from './Select';
import DateInput from './DateInput';
import TimePicker from './TimePicker';
import LocationInput from './LocationInput';
import { rentalDays } from '../../lib/availability';
import { resolveReferralFee } from '../../lib/referral';
import { creditResponsibilityOf } from '../../lib/credit';
import { sendSms } from '../../lib/sms';
import { sendBookingReceipt } from '../../lib/printReceipt';

const genOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const REFERRAL_SOURCES = ['WhatsApp', 'Facebook', 'Instagram', 'TikTok', 'Google', 'Word of Mouth'];
type BookingStatus = 'Confirmed' | 'Ongoing' | 'Completed' | 'Cancelled';

const emptyForm = () => ({
  vehicleId: '',
  customerId: '',
  customerName: '',
  customerPhone: '',
  customerEmail: '',
  customerNIC: '',
  customerAddress: '',
  startDate: '',
  endDate: '',
  startTime: '',
  endTime: '',
  waiveExtraDay: false,
  totalDays: 0,
  dailyRateUsed: 0,
  totalAmount: 0,
  estimatedAmount: 0,
  paidAmount: 0,
  advanceAmount: 0,
  discount: 0,
  paymentMethod: 'Cash',
  creditAmount: 0,
  status: 'Completed' as BookingStatus,
  referral: 'Direct',
  referralFeeType: 'fixed' as 'fixed' | 'percent',
  referralFeeValue: 0,
  referralAlreadyPaid: false,
  commissionAlreadyPaid: true,
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
  quotation: { startLocation: '', endLocation: '', stops: [] as string[], isRoundTrip: true, totalKm: 0 },
});

interface Props { onClose: () => void; }

function Field({ label, children, required }: { label: string; children: React.ReactNode; required?: boolean }) {
  return (
    <div>
      <label className="block text-xs font-medium text-navy-500 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function ManualBookingModal({ onClose }: Props) {
  const { vehicles, owners, drivers, customers, addManualBooking, saveDraft, discardDraft, drafts } = useStore();
  const currentUser = useAuthStore((s) => s.currentUser);
  // Owners can only record bookings against their own vehicles; admins see the full fleet.
  const selectableVehicles = currentUser?.role === 'owner'
    ? vehicles.filter((v) => v.ownerId === currentUser.ownerId)
    : vehicles;
  const [form, setForm]           = useState(emptyForm());
  const [error, setError]         = useState('');
  const [customerMode, setCustomerMode] = useState<'new' | 'existing'>('new');
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [custFound, setCustFound] = useState<null | 'found' | 'new'>(null);
  const [referralCustom, setReferralCustom] = useState(false);
  const [creditChoice, setCreditChoice] = useState<'discount' | 'credit'>('credit');
  const [creditAck, setCreditAck] = useState(false);
  const [otp, setOtp] = useState<{ sent: boolean; code: string; input: string; verified: boolean; fallback?: string }>({ sent: false, code: '', input: '', verified: false });

  const savedRef = useRef(false);  // true once handleSave succeeds — suppresses draft on close
  const [searchParams, setSearchParams] = useSearchParams();

  // Restore from draft when opened via ?resume=draftId
  useEffect(() => {
    const resumeId = searchParams.get('resume');
    if (!resumeId) return;
    const draft = drafts.find((d) => d.id === resumeId && d.type === 'booking');
    if (draft) {
      setForm(draft.formData as ReturnType<typeof emptyForm>);
      discardDraft(resumeId);
    }
    setSearchParams({}, { replace: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDiscardClose = () => {
    if (!savedRef.current && (form.customerName !== '' || form.vehicleId !== '')) {
      const veh = vehicles.find((v) => v.id === form.vehicleId);
      saveDraft({
        type: 'booking',
        label: form.customerName ? `Booking: ${form.customerName}` : 'Incomplete Booking',
        sublabel: veh ? `${veh.brand} ${veh.model}` : 'No vehicle selected yet',
        vehicleId: form.vehicleId || undefined,
        formData: { ...form },
      });
    }
    onClose();
  };

  const vehicle     = vehicles.find((v) => v.id === form.vehicleId);
  const vehicleOwner = owners.find((o) => o.id === vehicle?.ownerId);
  const referralFee = resolveReferralFee(form.referralFeeType, form.referralFeeValue, form.totalAmount);
  const ownerPayout = Math.max(0, form.totalAmount - referralFee);
  const billAmount  = Math.max(0, form.totalAmount - (form.discount || 0));
  const paidTotal   = (form.paidAmount || 0) + (form.advanceAmount || 0);
  const due         = Math.max(0, billAmount - paidTotal);

  const isOwnerReferral = !!form.referral && form.referral !== 'Direct' && !REFERRAL_SOURCES.includes(form.referral);
  const isSocialReferral = REFERRAL_SOURCES.includes(form.referral);
  const companyResponsible = form.referral === 'Company';
  // A credit on another party's vehicle needs that owner's OTP approval (Company is exempt).
  const needsOwnerOtp = creditChoice === 'credit' && due > 0 && !isSocialReferral && !companyResponsible && !!vehicleOwner;

  const sendOwnerOtp = async () => {
    if (!vehicleOwner) return;
    const code = genOtp();
    const ok = await sendSms(
      vehicleOwner.phone,
      `EMRAC: A credit of Rs ${due.toLocaleString()} for ${form.customerName || 'a customer'} is being recorded against your vehicle. Approve with code ${code}.`,
      { category: 'creditOtp', role: 'owner', transactional: true },
    );
    setOtp({ sent: true, code, input: '', verified: false, fallback: ok ? undefined : code });
  };
  const verifyOwnerOtp = () => setOtp((s) => ({ ...s, verified: s.input.trim() === s.code }));
  const referralOwner   = isOwnerReferral
    ? owners.find((o) => o.name.trim().toLowerCase() === form.referral.trim().toLowerCase())
    : undefined;

  const set = (field: string, value: unknown) => {
    setForm((f) => {
      const updated = { ...f, [field]: value };
      // Recalculate days + amount when dates, times, the waive-extra-day toggle,
      // or vehicle/rate change. Billing follows actual hours held (24h = 1 day),
      // not inclusive calendar days — see rentalDays() in lib/availability.ts.
      const affects = ['startDate', 'endDate', 'startTime', 'endTime', 'waiveExtraDay', 'vehicleId', 'dailyRateUsed'].includes(field);
      if (affects) {
        const s   = updated.startDate;
        const e   = updated.endDate;
        const v   = vehicles.find((x) => x.id === updated.vehicleId);
        if (s && e && s <= e) {
          const days = rentalDays(s, e, updated.startTime, updated.endTime, updated.waiveExtraDay);
          const rate = field === 'dailyRateUsed' ? (value as number) : (updated.dailyRateUsed || v?.dailyRent || 0);
          updated.totalDays   = days;
          updated.dailyRateUsed = rate;
          updated.totalAmount = days * rate;
        }
        if (field === 'vehicleId' && v) updated.dailyRateUsed = v.dailyRent;
      }
      return updated;
    });
  };

  // Customer phone lookup
  useEffect(() => {
    if (form.customerPhone.length < 7) { setCustFound(null); return; }
    const existing = customers.find((c) => c.phone === form.customerPhone);
    if (existing) {
      setCustFound('found');
      setForm((f) => ({ ...f, customerName: existing.name, customerEmail: existing.email ?? '', customerNIC: existing.nic ?? '', customerAddress: existing.address ?? '' }));
    } else {
      setCustFound('new');
    }
  }, [form.customerPhone, customers]);

  const handleSave = () => {
    setError('');
    if (!form.vehicleId)      { setError('Please select a vehicle.'); return; }
    if (!form.customerName)   { setError('Customer name is required.'); return; }
    if (!form.customerPhone)  { setError('Customer phone is required.'); return; }
    if (!form.startDate || !form.endDate) { setError('Start and end dates are required.'); return; }
    if (form.startDate > form.endDate)    { setError('End date must be after start date.'); return; }
    if (form.totalAmount <= 0)            { setError('Total amount must be greater than 0.'); return; }

    // Resolve the remaining balance into either a discount or a customer credit due.
    let discount = form.discount || 0;
    let creditAmount = 0;
    if (due > 0) {
      if (isSocialReferral) {
        setError('Social-media referral bookings must be fully paid — credit is not allowed. Add the balance as a discount or record full payment.');
        if (creditChoice === 'credit') return;
      }
      if (creditChoice === 'discount') {
        discount += due;                 // waive the remaining balance
      } else {
        if (!creditAck) { setError('Please acknowledge the credit responsibility notice before adding a credit due.'); return; }
        if (needsOwnerOtp && !otp.verified) { setError(`Owner approval (OTP) is required before recording this credit on ${vehicleOwner?.name}'s vehicle.`); return; }
        creditAmount = due;              // record as customer credit
      }
    }
    const creditResponsibility = creditResponsibilityOf(form.referral, isOwnerReferral);

    // Combine date + time into precise handover/return timestamps.
    const pickupAt = form.startTime ? `${form.startDate}T${form.startTime}` : undefined;
    const returnAt = form.endTime ? `${form.endDate}T${form.endTime}` : undefined;

    savedRef.current = true;
    const { depositVehicleModel, depositVehicleColor, depositVehicleNumber, ...formData } = form;
    const bookingId = addManualBooking({
      ...formData,
      discount, creditAmount, creditResponsibility, pickupAt, returnAt,
      depositAssetDescription: form.depositType === 'vehicle'
        ? [depositVehicleModel, depositVehicleColor, depositVehicleNumber].filter(Boolean).join(' | ')
        : form.depositAssetDescription,
    } as Parameters<typeof addManualBooking>[0]);
    // Send SMS + email receipt automatically (only for Confirmed bookings)
    if (form.status === 'Confirmed' || !form.status) {
      const newBooking = useStore.getState().bookings.find((b) => b.id === bookingId);
      const receiptVehicle = useStore.getState().vehicles.find((v) => v.id === form.vehicleId);
      const receiptDriver  = useStore.getState().drivers.find((d) => d.id === form.driverId) ?? undefined;
      if (newBooking) sendBookingReceipt(newBooking, receiptVehicle, receiptDriver).catch(console.error);
    }
    onClose();
  };

  const allReferralOptions = [
    'Direct',
    ...REFERRAL_SOURCES,
    ...owners.map((o) => o.name),
  ];

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-navy-700 flex items-center justify-center">
              <FileText size={17} className="text-white" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-navy-800">Add Manual Booking</h2>
              <p className="text-xs text-navy-400">Record a past booking — all related tables will be updated</p>
            </div>
          </div>
          <button onClick={handleDiscardClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X size={18} />
          </button>
        </div>

        {/* Body — two-column layout */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 divide-x divide-gray-100">

            {/* ── LEFT: Form ── */}
            <div className="lg:col-span-2 p-6 space-y-6 overflow-y-auto">

              {/* Vehicle & Dates */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Car size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Vehicle & Dates</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <Field label="Vehicle" required>
                      <Select value={form.vehicleId} onChange={(v) => set('vehicleId', v)} placeholder="Select vehicle…" nullable
                        options={selectableVehicles.map((v) => ({ value: v.id, label: `${v.vehicleNumber} — ${v.brand} ${v.model}`, sub: `Rs ${v.dailyRent.toLocaleString()}/day` }))} />
                    </Field>
                  </div>
                  <Field label="Start Date" required>
                    <DateInput value={form.startDate} onChange={(v) => set('startDate', v)} />
                  </Field>
                  <Field label="Start Time">
                    <TimePicker value={form.startTime} onChange={(t) => set('startTime', t)} placeholder="Handover time" />
                  </Field>
                  <Field label="End Date" required>
                    <DateInput value={form.endDate} onChange={(v) => set('endDate', v)} minDate={form.startDate} />
                  </Field>
                  <Field label="End Time">
                    <TimePicker value={form.endTime} onChange={(t) => set('endTime', t)} placeholder="Return time" />
                  </Field>
                  <div className="sm:col-span-2">
                    <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
                      <input type="checkbox" className="rounded" checked={form.waiveExtraDay} onChange={(e) => set('waiveExtraDay', e.target.checked)} />
                      Don't charge extra days (owner approved) — a partial day past a full 24h period won't be billed as another day
                    </label>
                  </div>
                  <Field label="Daily Rate Used (Rs)" required>
                    <input className="input" type="number" min="0" value={form.dailyRateUsed || ''} onChange={(e) => set('dailyRateUsed', +e.target.value)} />
                  </Field>
                  <Field label="Booking Status" required>
                    <Select value={form.status} onChange={(v) => set('status', v as BookingStatus)}
                      options={['Completed', 'Confirmed', 'Ongoing', 'Cancelled'].map((s) => ({ value: s, label: s }))} />
                  </Field>
                </div>
              </section>

              {/* Customer */}
              <section>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <User size={15} className="text-navy-500" />
                    <h3 className="text-sm font-semibold text-navy-700">Customer</h3>
                  </div>
                  {/* New / Existing toggle */}
                  <div className="flex items-center bg-navy-50 rounded-xl p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => { setCustomerMode('new'); setSelectedCustomerId(''); setForm((f) => ({ ...f, customerName: '', customerPhone: '', customerEmail: '', customerNIC: '', customerAddress: '' })); setCustFound(null); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${customerMode === 'new' ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}
                    >
                      <User size={12} /> New
                    </button>
                    <button
                      type="button"
                      onClick={() => { setCustomerMode('existing'); setSelectedCustomerId(''); setCustFound(null); }}
                      className={`flex items-center gap-1 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition-all ${customerMode === 'existing' ? 'bg-navy-700 text-white shadow-sm' : 'text-navy-500 hover:text-navy-700'}`}
                    >
                      <UserCheck size={12} /> Existing
                    </button>
                  </div>
                </div>

                {customerMode === 'existing' ? (
                  <div className="space-y-3">
                    <Field label="Select Customer" required>
                      <Select
                        value={selectedCustomerId}
                        onChange={(id) => {
                          const c = customers.find((x) => x.id === id);
                          if (!c) return;
                          setSelectedCustomerId(id);
                          setForm((f) => ({ ...f, customerId: c.id, customerName: c.name, customerPhone: c.phone, customerEmail: c.email ?? '', customerNIC: c.nic ?? '', customerAddress: c.address ?? '' }));
                        }}
                        placeholder="Search customer…"
                        options={customers.map((c) => ({ value: c.id, label: c.name, sub: c.phone + (c.nic ? ` · ${c.nic}` : '') }))}
                      />
                    </Field>
                    {selectedCustomerId && (() => {
                      const c = customers.find((x) => x.id === selectedCustomerId);
                      if (!c) return null;
                      return (
                        <div className="bg-navy-50 border border-navy-100 rounded-xl px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                          <div><span className="text-navy-400">Phone: </span><span className="font-medium text-navy-700">{c.phone}</span></div>
                          {c.email && <div><span className="text-navy-400">Email: </span><span className="font-medium text-navy-700">{c.email}</span></div>}
                          {c.nic && <div><span className="text-navy-400">NIC: </span><span className="font-medium text-navy-700">{c.nic}</span></div>}
                          {c.address && <div><span className="text-navy-400">Address: </span><span className="font-medium text-navy-700">{c.address}</span></div>}
                        </div>
                      );
                    })()}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="sm:col-span-2">
                      <Field label="Phone Number (auto-detects existing customer)" required>
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                          <input className="input pl-8" placeholder="+94 71 234 5678" value={form.customerPhone} onChange={(e) => set('customerPhone', e.target.value)} />
                        </div>
                        {custFound === 'found' && (
                          <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
                            <CheckCircle2 size={12} /> Existing customer found — details pre-filled
                          </p>
                        )}
                        {custFound === 'new' && (
                          <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                            <AlertCircle size={12} /> New customer — will be added to Customers table
                          </p>
                        )}
                      </Field>
                    </div>
                    <Field label="Full Name" required>
                      <input className="input" value={form.customerName} onChange={(e) => set('customerName', e.target.value)} />
                    </Field>
                    <Field label="NIC / Passport">
                      <input className="input" value={form.customerNIC} onChange={(e) => set('customerNIC', e.target.value)} />
                    </Field>
                    <Field label="Email">
                      <input className="input" type="email" value={form.customerEmail} onChange={(e) => set('customerEmail', e.target.value)} />
                    </Field>
                    <Field label="Address">
                      <input className="input" value={form.customerAddress} onChange={(e) => set('customerAddress', e.target.value)} />
                    </Field>
                  </div>
                )}
              </section>

              {/* Payment */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <DollarSign size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Payment</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Field label="Total Amount (Rs)" required>
                    <input className="input" type="number" min="0" value={form.totalAmount || ''} onChange={(e) => set('totalAmount', +e.target.value)} />
                  </Field>
                  <Field label="Discount (Rs)">
                    <input className="input" type="number" min="0" value={form.discount || ''} onChange={(e) => set('discount', +e.target.value)} />
                  </Field>
                  <Field label="Payment Method">
                    <Select value={form.paymentMethod} onChange={(v) => set('paymentMethod', v)}
                      options={['Cash', 'Card', 'Bank Transfer', 'Online', 'Cheque'].map((s) => ({ value: s, label: s }))} />
                  </Field>
                  <Field label="Amount Paid (Rs)">
                    <input className="input" type="number" min="0" value={form.paidAmount || ''} onChange={(e) => set('paidAmount', +e.target.value)} />
                  </Field>
                  <Field label="Advance (Rs)">
                    <input className="input" type="number" min="0" value={form.advanceAmount || ''} onChange={(e) => set('advanceAmount', +e.target.value)} />
                  </Field>
                </div>
                {/* Security Deposit — spans full width */}
                <div className="mt-3">
                  <p className="label mb-1 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-amber-400 inline-block flex-shrink-0" />
                    Security Deposit
                  </p>
                  <div className="flex items-center gap-2">
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

                {/* Remaining balance → discount or credit */}
                {due > 0 && (
                  <div className="mt-4 border border-amber-200 bg-amber-50/60 rounded-xl p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-semibold text-navy-700">Remaining balance</span>
                      <span className="text-base font-bold text-red-600">Rs {due.toLocaleString()}</span>
                    </div>
                    {isSocialReferral ? (
                      <p className="text-xs text-red-600 flex items-start gap-1.5">
                        <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
                        Social-media referral — credit is not allowed. Record full payment, or waive the balance as a discount.
                      </p>
                    ) : (
                      <div className="flex gap-2">
                        <button type="button" onClick={() => setCreditChoice('discount')}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${creditChoice === 'discount' ? 'bg-navy-700 text-white' : 'bg-white text-navy-600 border border-navy-200'}`}>
                          Add as Discount
                        </button>
                        <button type="button" onClick={() => setCreditChoice('credit')}
                          className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all ${creditChoice === 'credit' ? 'bg-amber-500 text-white' : 'bg-white text-navy-600 border border-navy-200'}`}>
                          Add as Credit Due
                        </button>
                      </div>
                    )}
                    {due > 0 && creditChoice === 'credit' && !isSocialReferral && (
                      <div className="space-y-2">
                        <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 text-xs text-red-700">
                          <strong>The company is not responsible for credit payments.</strong> You are responsible for handling credit payments with your customers.
                        </div>
                        <p className="text-[11px] text-navy-500">
                          Liability: {isOwnerReferral
                            ? <>the <strong>referring owner ({form.referral})</strong> is responsible (owner approval / OTP required — coming in the next update).</>
                            : form.referral === 'Company'
                              ? <>the <strong>company</strong> is responsible.</>
                              : <>this booking is <strong>yours</strong> — you are fully responsible for collecting it.</>}
                        </p>
                        <label className="flex items-center gap-2 text-xs text-navy-700 cursor-pointer">
                          <input type="checkbox" className="rounded" checked={creditAck} onChange={(e) => setCreditAck(e.target.checked)} />
                          I understand and accept responsibility for this credit.
                        </label>

                        {/* Owner OTP approval (required when the credit sits on another owner's vehicle) */}
                        {needsOwnerOtp && (
                          <div className="bg-white border border-navy-200 rounded-lg p-3 space-y-2">
                            <p className="text-xs font-semibold text-navy-700 flex items-center gap-1.5">
                              <Lock size={12} /> Owner approval required — {vehicleOwner?.name}
                              {otp.verified && <span className="text-green-600 flex items-center gap-1 font-normal"><CheckCircle2 size={11} /> Approved</span>}
                            </p>
                            {!otp.verified && (
                              <>
                                {!otp.sent ? (
                                  <button type="button" onClick={sendOwnerOtp} className="btn btn-secondary text-xs w-full">
                                    Send approval OTP to {vehicleOwner?.name}
                                  </button>
                                ) : (
                                  <>
                                    {otp.fallback && (
                                      <div className="bg-amber-50 border border-amber-200 rounded px-2 py-1 text-[11px] text-amber-800">
                                        SMS not configured — dev OTP: <strong className="font-mono">{otp.fallback}</strong>
                                      </div>
                                    )}
                                    <div className="flex gap-2">
                                      <input
                                        className="input flex-1 font-mono tracking-widest text-center"
                                        placeholder="000000" maxLength={6}
                                        value={otp.input}
                                        onChange={(e) => setOtp((s) => ({ ...s, input: e.target.value.replace(/\D/g, '') }))}
                                      />
                                      <button type="button" onClick={verifyOwnerOtp} className="btn btn-primary flex-shrink-0">Verify</button>
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                        {companyResponsible && (
                          <p className="text-[11px] text-blue-600">Company referral — the company is responsible; no owner approval needed.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                <div className="mt-3">
                  <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
                    <input type="checkbox" className="rounded" checked={form.commissionAlreadyPaid} onChange={(e) => set('commissionAlreadyPaid', e.target.checked)} />
                    Owner payout already settled (marks commission as Paid)
                  </label>
                </div>
              </section>

              {/* Referral */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <Users size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Referral</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <Field label="Referred By">
                      {referralCustom ? (
                        <div className="flex gap-2">
                          <input className="input flex-1" placeholder="Custom referral name…" value={form.referral === 'Direct' ? '' : form.referral} onChange={(e) => set('referral', e.target.value || 'Direct')} />
                          <button className="text-xs text-navy-500 underline whitespace-nowrap" onClick={() => { setReferralCustom(false); set('referral', 'Direct'); }}>
                            Use list
                          </button>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Select
                            className="flex-1"
                            value={allReferralOptions.includes(form.referral) ? form.referral : 'Direct'}
                            onChange={(v) => set('referral', v)}
                            options={[
                              { value: 'Direct', label: 'Direct' },
                              ...REFERRAL_SOURCES.map((s) => ({ value: s, label: s, group: 'Marketing Channels' })),
                              ...owners.map((o) => ({ value: o.name, label: o.name, group: 'Owners', sub: 'earns referral fee' })),
                            ]}
                          />
                          <button className="text-xs text-navy-500 underline whitespace-nowrap" onClick={() => setReferralCustom(true)}>
                            Custom
                          </button>
                        </div>
                      )}
                      {referralOwner && (
                        <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                          <CheckCircle2 size={12} /> Owner found — referral fee will update {referralOwner.name}'s profile
                        </p>
                      )}
                    </Field>
                  </div>
                  {isOwnerReferral && (
                    <>
                      <Field label="Referral Fee Type">
                        <Select value={form.referralFeeType} onChange={(v) => set('referralFeeType', v as 'fixed' | 'percent')}
                          options={[{ value: 'fixed', label: 'Fixed (Rs)' }, { value: 'percent', label: 'Percentage (%)' }]} />
                      </Field>
                      <Field label={form.referralFeeType === 'fixed' ? 'Referral Fee (Rs)' : 'Referral Fee (%)'}>
                        <input className="input" type="number" min="0" value={form.referralFeeValue || ''} onChange={(e) => set('referralFeeValue', +e.target.value)} />
                      </Field>
                      <div className="sm:col-span-2">
                        <label className="flex items-center gap-2 text-sm text-navy-700 cursor-pointer">
                          <input type="checkbox" className="rounded" checked={form.referralAlreadyPaid} onChange={(e) => set('referralAlreadyPaid', e.target.checked)} />
                          Referral fee already paid to {form.referral}
                        </label>
                      </div>
                    </>
                  )}
                </div>
              </section>

              {/* Additional */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <MapPin size={15} className="text-navy-500" />
                  <h3 className="text-sm font-semibold text-navy-700">Additional Details</h3>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Pickup Location">
                    <LocationInput value={form.pickupLocation} onChange={(v) => set('pickupLocation', v)} placeholder="Pickup location…" />
                  </Field>
                  <Field label="Drop Location">
                    <LocationInput value={form.dropLocation} onChange={(v) => set('dropLocation', v)} placeholder="Drop location…" />
                  </Field>
                  <Field label="Driver (optional)">
                    <Select value={form.driverId} onChange={(v) => set('driverId', v)} placeholder="No driver" nullable
                      options={drivers.map((d) => ({ value: d.id, label: d.name }))} />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Notes">
                      <textarea className="input resize-none" rows={2} value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Any additional notes about this past booking…" />
                    </Field>
                  </div>
                </div>
              </section>
            </div>

            {/* ── RIGHT: Rent Summary ── */}
            <div className="p-6 bg-gray-50 flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Calendar size={15} className="text-navy-500" />
                <h3 className="text-sm font-semibold text-navy-700">Booking Summary</h3>
              </div>

              {/* Vehicle card */}
              {vehicle ? (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-1">
                  <p className="text-xs text-navy-400">Vehicle</p>
                  <p className="font-semibold text-navy-800">{vehicle.brand} {vehicle.model}</p>
                  <p className="text-xs text-navy-500">{vehicle.vehicleNumber}</p>
                  {vehicleOwner && <p className="text-xs text-navy-400 mt-1">Owner: <span className="font-medium text-navy-600">{vehicleOwner.name}</span></p>}
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-dashed border-gray-200 p-4 text-center text-xs text-navy-400">
                  Select a vehicle to see summary
                </div>
              )}

              {/* Duration */}
              {form.totalDays > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2">
                  <p className="text-xs text-navy-400">Duration</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-navy-600">Days</span>
                    <span className="font-semibold text-navy-800">{form.totalDays}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-navy-600">Daily Rate</span>
                    <span className="font-semibold text-navy-800">Rs {form.dailyRateUsed.toLocaleString()}</span>
                  </div>
                </div>
              )}

              {/* Financial breakdown */}
              {form.totalAmount > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-2 text-sm">
                  <p className="text-xs text-navy-400 mb-2">Financial Breakdown</p>

                  <div className="flex justify-between">
                    <span className="text-navy-600">Total Rental</span>
                    <span className="font-semibold text-navy-800">Rs {form.totalAmount.toLocaleString()}</span>
                  </div>

                  {referralFee > 0 && (
                    <div className="flex justify-between text-amber-700">
                      <span>Referral Fee → <span className="font-medium">{form.referral}</span></span>
                      <span>− Rs {referralFee.toLocaleString()}</span>
                    </div>
                  )}

                  <div className="flex justify-between border-t pt-2 mt-1">
                    <span className="text-navy-600">Owner Payout{vehicleOwner ? ` → ${vehicleOwner.name}` : ''}</span>
                    <span className="font-semibold text-green-700">Rs {ownerPayout.toLocaleString()}</span>
                  </div>

                  <div className="border-t pt-2 mt-1 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-navy-600">Paid{form.advanceAmount > 0 ? ' + Advance' : ''}</span>
                      <span className="font-semibold text-blue-700">Rs {paidTotal.toLocaleString()}</span>
                    </div>
                    {due > 0 && (
                      <div className="flex justify-between">
                        <span className={creditChoice === 'credit' ? 'text-amber-600' : 'text-red-600'}>
                          {creditChoice === 'credit' ? 'Credit Due' : 'To Discount'}
                        </span>
                        <span className={`font-semibold ${creditChoice === 'credit' ? 'text-amber-600' : 'text-red-600'}`}>Rs {due.toLocaleString()}</span>
                      </div>
                    )}
                    {due === 0 && paidTotal > 0 && (
                      <p className="text-xs text-green-600 flex items-center gap-1">
                        <CheckCircle2 size={12} /> Fully paid
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* What will be updated */}
              <div className="bg-navy-50 rounded-xl border border-navy-100 p-4 text-xs space-y-1.5">
                <p className="font-semibold text-navy-700 mb-2">Records that will be updated:</p>
                <p className="text-navy-600">✓ Bookings table (new entry)</p>
                <p className={custFound === 'found' ? 'text-navy-600' : 'text-amber-700'}>
                  {custFound === 'found' ? '✓ Customer profile (updated)' : '✓ Customers table (new entry)'}
                </p>
                <p className="text-navy-600">✓ Commissions table (new entry)</p>
                {form.vehicleId && <p className="text-navy-600">✓ Vehicle rent count & revenue</p>}
                {vehicleOwner && <p className="text-navy-600">✓ {vehicleOwner.name}'s earnings</p>}
                {referralOwner && <p className="text-amber-700">✓ {referralOwner.name}'s referral profile</p>}
              </div>

              {/* Status badge */}
              <div className="mt-auto">
                <p className="text-xs text-navy-400 mb-1">Booking Status</p>
                <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                  form.status === 'Completed' ? 'bg-gray-100 text-gray-700' :
                  form.status === 'Confirmed' ? 'bg-blue-100 text-blue-700' :
                  form.status === 'Ongoing'   ? 'bg-green-100 text-green-700' :
                  'bg-red-100 text-red-700'
                }`}>
                  {form.status}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        {error && (
          <div className="px-6 py-2 bg-red-50 border-t border-red-100 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle size={15} /> {error}
          </div>
        )}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button onClick={handleSave} className="btn btn-primary">
            Save Manual Booking
          </button>
        </div>
      </div>
    </div>
  );
}
