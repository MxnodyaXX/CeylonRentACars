import { useEffect, useState, useMemo } from 'react';
import Modal from './Modal';
import {
  MapPin, Navigation, RotateCcw, AlertTriangle,
  Calculator, CheckCircle, ArrowLeft, Loader2,
  Share2, MessageCircle, Smartphone, FileDown, Phone,
} from 'lucide-react';
import { Vehicle } from '../../types';
import LocationInput from './LocationInput';

/* ── Google Maps lazy loader ──────────────────────────────────── */
import { loadGoogleMaps, MAPS_KEY } from '../../lib/googleMaps';

/* ── Types ────────────────────────────────────────────────────── */
interface QuotationForm {
  startLocation: string;
  endLocation: string;
  isRoundTrip: boolean;
  totalKm: number;
  stops: string[];
}
interface BookingForm {
  vehicleId: string;
  customerName: string;
  customerPhone?: string;
  startDate: string;
  endDate: string;
  totalDays: number;
  totalAmount: number;
  paidAmount: number;
  depositAmount: number;
  quotation: QuotationForm;
}
interface Props {
  open: boolean;
  onBack: () => void;
  onConfirm: () => void;
  form: BookingForm;
  vehicle: Vehicle | undefined;
  updateQuotation: (updates: Partial<QuotationForm>) => void;
}

/* ── PDF generator ────────────────────────────────────────────── */
function printEstimate(
  form: BookingForm,
  vehicle: Vehicle | undefined,
  breakdown: { tripKm: number; baseRent: number; includedKm: number; extraKm: number; extraRate: number; extraCharge: number; total: number },
  roundTrip: boolean,
  kmResult: { km: number; duration: string },
  origin: string,
  dest: string,
) {
  const ref = `MRAC-${Date.now().toString(36).toUpperCase()}`;
  const date = new Date().toLocaleDateString('en-LK', { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>MRAC Trip Estimate — ${ref}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:'Segoe UI',Arial,sans-serif;color:#18181B;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .page{max-width:780px;margin:0 auto;padding:0}
  /* Header */
  .header{background:linear-gradient(135deg,#111114 0%,#E11D2A 100%);color:#fff;padding:32px 40px 24px}
  .header-top{display:flex;justify-content:space-between;align-items:flex-start}
  .logo{font-size:28px;font-weight:900;letter-spacing:3px}
  .logo span{color:rgba(255,255,255,0.55);font-size:11px;font-weight:500;display:block;letter-spacing:2px;margin-top:2px}
  .quote-title{text-align:right}
  .quote-title h2{font-size:18px;font-weight:700;opacity:0.9}
  .quote-title p{font-size:12px;opacity:0.65;margin-top:3px}
  .ref-bar{margin-top:16px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.2);display:flex;gap:32px}
  .ref-item label{font-size:10px;text-transform:uppercase;letter-spacing:1.5px;opacity:0.6;display:block}
  .ref-item span{font-size:13px;font-weight:600}
  /* Body */
  .body{padding:28px 40px}
  .section{margin-bottom:22px}
  .section-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:#A1A1AA;border-bottom:1px solid #F4F4F5;padding-bottom:6px;margin-bottom:12px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 32px}
  .info-item label{font-size:11px;color:#A1A1AA;display:block;margin-bottom:2px}
  .info-item span{font-size:13px;font-weight:600;color:#111114}
  /* Bill table */
  table{width:100%;border-collapse:collapse;margin-top:4px}
  td{padding:9px 14px;font-size:13px;border-bottom:1px solid #F4F4F5;vertical-align:top}
  td.desc{color:#52525B;width:60%}
  td.amt{text-align:right;font-weight:600;color:#111114;white-space:nowrap}
  td.free{color:#059669;text-align:right;font-weight:500}
  tr.extra td{color:#D97706}
  tr.subtotal td{border-top:2px solid #F4F4F5;border-bottom:none;padding-top:14px;font-size:13px;color:#52525B}
  tr.total td{background:#111114;color:#fff;font-size:17px;font-weight:800;border-radius:10px;border:none}
  tr.total td.desc{border-radius:10px 0 0 10px}
  tr.total td.amt{border-radius:0 10px 10px 0}
  /* Route */
  .route-box{background:#FAFAFA;border:1px solid #ECECEF;border-radius:10px;padding:14px 18px;display:flex;align-items:center;gap:18px;flex-wrap:wrap}
  .route-box .point{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#111114}
  .route-box .point .dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
  .route-box .arrow{color:#A1A1AA;font-size:18px}
  .route-meta{display:flex;gap:16px;margin-top:10px}
  .route-meta span{font-size:12px;background:#F4F4F5;color:#E11D2A;padding:3px 10px;border-radius:20px;font-weight:600}
  /* Disclaimer */
  .disclaimer{background:#FFFBEB;border:1px solid #FCD34D;border-radius:10px;padding:13px 16px;display:flex;gap:10px;margin-top:8px}
  .disclaimer p{font-size:12px;color:#92400E;line-height:1.6}
  /* Footer */
  .footer{border-top:1px solid #F4F4F5;padding:18px 40px;display:flex;justify-content:space-between;align-items:center;font-size:11px;color:#A1A1AA}
  @media print{.no-print{display:none}tr.total td{-webkit-print-color-adjust:exact}}
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div class="header-top">
      <div class="logo">MRAC<span>Car Rental Management</span></div>
      <div class="quote-title">
        <h2>Trip Cost Estimate</h2>
        <p>This is not a final invoice</p>
      </div>
    </div>
    <div class="ref-bar">
      <div class="ref-item"><label>Reference</label><span>${ref}</span></div>
      <div class="ref-item"><label>Date</label><span>${date}</span></div>
      <div class="ref-item"><label>Valid for</label><span>48 hours</span></div>
    </div>
  </div>

  <div class="body">
    <div class="section">
      <div class="section-label">Customer &amp; Vehicle</div>
      <div class="info-grid">
        <div class="info-item"><label>Customer Name</label><span>${form.customerName || '—'}</span></div>
        <div class="info-item"><label>Phone</label><span>${form.customerPhone || '—'}</span></div>
        <div class="info-item"><label>Vehicle</label><span>${vehicle ? `${vehicle.brand} ${vehicle.model}` : '—'}</span></div>
        <div class="info-item"><label>Registration</label><span>${vehicle?.vehicleNumber ?? '—'}</span></div>
        <div class="info-item"><label>Rental Period</label><span>${form.startDate} → ${form.endDate}</span></div>
        <div class="info-item"><label>Duration</label><span>${form.totalDays} day${form.totalDays !== 1 ? 's' : ''}</span></div>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Route Details</div>
      <div class="route-box">
        <div class="point"><div class="dot" style="background:#10B981"></div>${origin}</div>
        <div class="arrow">→</div>
        <div class="point"><div class="dot" style="background:#EF4444"></div>${dest}</div>
      </div>
      <div class="route-meta" style="margin-top:10px">
        <span>${roundTrip ? 'Round Trip' : 'One Way'}</span>
        <span>${kmResult.km} km one way${roundTrip ? ` · ${kmResult.km * 2} km total` : ''}</span>
        <span>~${kmResult.duration} drive time</span>
      </div>
    </div>

    <div class="section">
      <div class="section-label">Estimated Bill</div>
      <table>
        <tr>
          <td class="desc">Base Rent &nbsp;(${form.totalDays} day${form.totalDays !== 1 ? 's' : ''} × Rs ${vehicle?.dailyRent.toLocaleString()})</td>
          <td class="amt">Rs ${breakdown.baseRent.toLocaleString()}</td>
        </tr>
        <tr>
          <td class="desc" style="color:#059669">Free KM included &nbsp;(${breakdown.includedKm} km)</td>
          <td class="free">No charge</td>
        </tr>
        <tr>
          <td class="desc">Trip distance &nbsp;(${roundTrip ? 'round trip' : 'one way'}): &nbsp;${breakdown.tripKm} km</td>
          <td class="amt" style="color:#A1A1AA">—</td>
        </tr>
        ${breakdown.extraKm > 0 ? `
        <tr class="extra">
          <td class="desc">Extra KM &nbsp;(${breakdown.extraKm} km × Rs ${breakdown.extraRate} / km)</td>
          <td class="amt" style="color:#D97706">Rs ${breakdown.extraCharge.toLocaleString()}</td>
        </tr>` : `
        <tr>
          <td class="desc" style="color:#059669">Trip is within free KM limit — no extra charge</td>
          <td class="free">Rs 0</td>
        </tr>`}
        <tr class="total">
          <td class="desc">Estimated Total</td>
          <td class="amt">Rs ${breakdown.total.toLocaleString()}</td>
        </tr>
      </table>
    </div>

    <div class="disclaimer">
      <span style="font-size:18px;flex-shrink:0">⚠️</span>
      <p><strong>Important Note:</strong> This is only a cost estimation and is not a final invoice. The actual bill will be calculated based on the exact kilometers recorded at the end of the trip. The final amount may vary due to the driver's driving style, road detours, traffic conditions, or any additional stops made during the trip.</p>
    </div>
  </div>

  <div class="footer">
    <span>MRAC Car Rental Management System</span>
    <span>Estimate Ref: ${ref} · Generated ${date}</span>
  </div>
</div>
<script>window.onload = () => { window.print(); }</script>
</body>
</html>`;

  const w = window.open('', '_blank', 'width=860,height=700');
  if (w) { w.document.write(html); w.document.close(); }
}

/* ── WhatsApp message builder ─────────────────────────────────── */
function buildWhatsAppMsg(
  form: BookingForm,
  vehicle: Vehicle | undefined,
  breakdown: { tripKm: number; baseRent: number; includedKm: number; extraKm: number; extraRate: number; extraCharge: number; total: number },
  roundTrip: boolean,
  kmResult: { km: number; duration: string },
  origin: string,
  dest: string,
): string {
  const lines = [
    `🚗 *MRAC Car Rental — Trip Estimate*`,
    ``,
    `Hello ${form.customerName || 'there'},`,
    `Here is your estimated trip cost:`,
    ``,
    `*📋 Booking Details*`,
    `Vehicle: ${vehicle ? `${vehicle.brand} ${vehicle.model} · ${vehicle.vehicleNumber}` : '—'}`,
    `Period: ${form.startDate} → ${form.endDate} (${form.totalDays} day${form.totalDays !== 1 ? 's' : ''})`,
    ``,
    `*📍 Route*`,
    `From: ${origin}`,
    `To: ${dest}`,
    `Type: ${roundTrip ? 'Round Trip' : 'One Way'} · ${breakdown.tripKm} km`,
    `Drive time: ~${kmResult.duration} one way`,
    ``,
    `*💰 Bill Breakdown*`,
    `Base Rent (${form.totalDays}d × Rs ${vehicle?.dailyRent.toLocaleString()}): *Rs ${breakdown.baseRent.toLocaleString()}*`,
    `Free KM (${breakdown.includedKm} km): No charge`,
    ...(breakdown.extraKm > 0
      ? [`Extra KM (${breakdown.extraKm} km × Rs ${breakdown.extraRate}): *Rs ${breakdown.extraCharge.toLocaleString()}*`]
      : [`No extra KM charge (within free limit)`]),
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `*Estimated Total: Rs ${breakdown.total.toLocaleString()}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `⚠️ _Note: This is an estimate only. The final bill is based on actual km at trip end._`,
    ``,
    `Thank you for choosing MRAC! 🙏`,
  ];
  return lines.join('\n');
}

/* ── Component ────────────────────────────────────────────────── */
export default function TripCalculatorModal({
  open, onBack, onConfirm, form, vehicle, updateQuotation,
}: Props) {
  const [originValue, setOriginValue] = useState(form.quotation.startLocation);
  const [destValue,   setDestValue]   = useState(form.quotation.endLocation);

  const [mapsReady,   setMapsReady]   = useState(false);
  const [mapsError,   setMapsError]   = useState('');
  const [roundTrip,   setRoundTrip]   = useState(form.quotation.isRoundTrip ?? true);
  const [kmResult,    setKmResult]    = useState<{ km: number; duration: string } | null>(null);
  const [calcError,   setCalcError]   = useState('');
  const [calculating, setCalculating] = useState(false);

  /* Share panel state */
  const [showShare,  setShowShare]  = useState(false);
  const [sharePhone, setSharePhone] = useState(form.customerPhone ?? '');

  /* Load Maps API on first open */
  useEffect(() => {
    if (!open) return;
    setShowShare(false);
    if (!MAPS_KEY) {
      setMapsError('VITE_GOOGLE_MAPS_API_KEY not set. Add your key to .env.local to enable auto-distance.');
      return;
    }
    if ((window as any).google?.maps) { setMapsReady(true); return; }
    loadGoogleMaps()
      .then(() => setMapsReady(true))
      .catch(() => setMapsError('Google Maps could not be loaded. Check your API key.'));
  }, [open]);

  /* Bill breakdown */
  const breakdown = useMemo(() => {
    if (!vehicle || !kmResult) return null;
    const tripKm      = roundTrip ? kmResult.km * 2 : kmResult.km;
    const baseRent    = form.totalAmount;
    const includedKm  = (vehicle.includedKmPerDay ?? 100) * form.totalDays;
    const extraKm     = Math.max(0, tripKm - includedKm);
    const extraRate   = vehicle.extraKmRate ?? 50;
    const extraCharge = extraKm * extraRate;
    const total       = baseRent + extraCharge;
    return { tripKm, baseRent, includedKm, extraKm, extraRate, extraCharge, total };
  }, [vehicle, kmResult, roundTrip, form]);

  const handleCalculate = () => {
    const origin = originValue.trim();
    const dest   = destValue.trim();
    if (!origin || !dest) { setCalcError('Please enter both start and end locations.'); return; }
    setCalculating(true);
    setCalcError('');
    setKmResult(null);
    setShowShare(false);

    const gm = (window as any).google.maps;
    new gm.DistanceMatrixService().getDistanceMatrix(
      { origins: [origin], destinations: [dest], travelMode: 'DRIVING', unitSystem: 0 },
      (res: any, status: string) => {
        setCalculating(false);
        const el = res?.rows?.[0]?.elements?.[0];
        if (status === 'OK' && el?.status === 'OK') {
          const km = Math.ceil(el.distance.value / 1000);
          setKmResult({ km, duration: el.duration.text });
          updateQuotation({ startLocation: origin, endLocation: dest, isRoundTrip: roundTrip, totalKm: roundTrip ? km * 2 : km });
        } else {
          setCalcError('Could not calculate route. Please enter full addresses.');
        }
      }
    );
  };

  /* Share handlers */
  const handleWhatsApp = () => {
    if (!breakdown || !kmResult) return;
    const origin = originValue.trim() || form.quotation.startLocation;
    const dest   = destValue.trim()   || form.quotation.endLocation;
    const msg    = buildWhatsAppMsg(form, vehicle, breakdown, roundTrip, kmResult, origin, dest);
    const phone  = sharePhone.replace(/[^0-9]/g, '');
    const intl   = phone.startsWith('0') ? '94' + phone.slice(1) : phone;
    window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, '_blank');
  };

  const handleSMS = () => {
    if (!breakdown || !kmResult) return;
    const msg = [
      `MRAC Trip Estimate`,
      `Customer: ${form.customerName}`,
      `Vehicle: ${vehicle?.brand} ${vehicle?.model} (${vehicle?.vehicleNumber})`,
      `Period: ${form.startDate} - ${form.endDate} (${form.totalDays} days)`,
      `Route: ${originValue} → ${destValue} (${breakdown.tripKm} km)`,
      `Base Rent: Rs ${breakdown.baseRent.toLocaleString()}`,
      ...(breakdown.extraKm > 0 ? [`Extra KM (${breakdown.extraKm}km): Rs ${breakdown.extraCharge.toLocaleString()}`] : []),
      `ESTIMATED TOTAL: Rs ${breakdown.total.toLocaleString()}`,
      `Note: Estimate only. Final bill based on actual km.`,
    ].join('\n');
    const phone = sharePhone.replace(/[^0-9]/g, '');
    window.open(`sms:${phone}?body=${encodeURIComponent(msg)}`);
  };

  const handlePDF = () => {
    if (!breakdown || !kmResult) return;
    const origin = originValue.trim() || form.quotation.startLocation;
    const dest   = destValue.trim()   || form.quotation.endLocation;
    printEstimate(form, vehicle, breakdown, roundTrip, kmResult, origin, dest);
  };

  const includedKmTotal = (vehicle?.includedKmPerDay ?? 100) * form.totalDays;

  return (
    <Modal open={open} onClose={onBack} title="Trip Bill Calculator" width="max-w-xl">
      <div className="space-y-4">

        {/* Booking summary */}
        <div className="bg-navy-50/70 rounded-xl p-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-xs">
          {([
            ['Customer',      form.customerName || '—'],
            ['Vehicle',       vehicle ? `${vehicle.brand} ${vehicle.model} · ${vehicle.vehicleNumber}` : '—'],
            ['Period',        form.startDate && form.endDate ? `${form.startDate} → ${form.endDate}` : '—'],
            ['Duration',      `${form.totalDays} day${form.totalDays !== 1 ? 's' : ''}`],
            ['Daily Rate',    vehicle ? `Rs ${vehicle.dailyRent.toLocaleString()} / day` : '—'],
            ['Included KM',   `${vehicle?.includedKmPerDay ?? 100} km/day × ${form.totalDays} days = ${includedKmTotal} km`],
            ['Extra KM Rate', `Rs ${vehicle?.extraKmRate ?? 50} / km beyond ${includedKmTotal} km`],
          ] as [string, string][]).map(([l, v]) => (
            <div key={l} className="contents">
              <span className="text-navy-400">{l}</span>
              <span className="font-semibold text-navy-800 truncate">{v}</span>
            </div>
          ))}
        </div>

        {/* Location inputs */}
        {mapsError ? (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-700">
            <AlertTriangle size={13} className="flex-shrink-0 mt-0.5" />
            <div><p className="font-semibold mb-0.5">Google Maps not configured</p><p>{mapsError}</p></div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-navy-600 uppercase tracking-wide">Enter Trip Locations</p>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <MapPin size={13} className="text-emerald-500 flex-shrink-0" />
                <div className="flex-1"><LocationInput value={originValue} onChange={setOriginValue} placeholder="Start location — e.g. Colombo Fort" /></div>
              </div>
              <div className="flex items-center gap-2">
                <Navigation size={13} className="text-red-500 flex-shrink-0" />
                <div className="flex-1"><LocationInput value={destValue} onChange={setDestValue} placeholder="Destination — e.g. Katharagama" /></div>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <button type="button" onClick={() => setRoundTrip((r) => !r)} className="flex items-center gap-2">
                <div className={`w-9 h-5 rounded-full transition-colors relative flex-shrink-0 ${roundTrip ? 'bg-navy-700' : 'bg-navy-200'}`}>
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${roundTrip ? 'left-4' : 'left-0.5'}`} />
                </div>
                <span className="flex items-center gap-1 text-xs text-navy-600 font-medium"><RotateCcw size={11} /> Round Trip</span>
              </button>

              <button
                onClick={handleCalculate}
                disabled={!mapsReady || calculating}
                className="flex items-center gap-1.5 text-xs bg-navy-700 hover:bg-navy-800 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded-xl font-medium transition-colors"
              >
                {calculating ? <><Loader2 size={12} className="animate-spin" /> Calculating…</> : <><Calculator size={12} /> Calculate Distance</>}
              </button>
            </div>

            {calcError && <p className="flex items-center gap-1.5 text-xs text-red-600"><AlertTriangle size={12} /> {calcError}</p>}

            {kmResult && (
              <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-2.5 text-xs">
                <p className="font-semibold text-blue-700 flex items-center gap-1.5 mb-1"><CheckCircle size={13} /> Distance Calculated</p>
                <p className="text-blue-800">
                  One way: <strong>{kmResult.km} km</strong>&nbsp;·&nbsp;Drive time: <strong>{kmResult.duration}</strong>
                  {roundTrip && <>&nbsp;·&nbsp;Round trip: <strong>{kmResult.km * 2} km</strong></>}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Bill breakdown */}
        {breakdown && (
          <div className="border border-navy-100 rounded-xl overflow-hidden">
            <div className="bg-navy-50 px-4 py-2.5">
              <p className="text-xs font-bold text-navy-600 uppercase tracking-wide">Estimated Bill Breakdown</p>
            </div>
            <div className="px-4 py-3 space-y-2 text-sm">
              <div className="flex justify-between text-navy-700">
                <span>Base Rent &nbsp;({form.totalDays}d × Rs {vehicle?.dailyRent.toLocaleString()})</span>
                <span className="font-semibold">Rs {breakdown.baseRent.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-emerald-600 text-xs">
                <span>Free KM included: {breakdown.includedKm} km</span>
                <span className="font-medium">No charge</span>
              </div>
              <div className="flex justify-between text-navy-600">
                <span>Trip distance ({roundTrip ? 'round trip' : 'one way'}): {breakdown.tripKm} km</span>
                <span />
              </div>
              {breakdown.extraKm > 0 ? (
                <div className="flex justify-between text-amber-700 font-medium">
                  <span>Extra KM: {breakdown.extraKm} km × Rs {breakdown.extraRate}</span>
                  <span>Rs {breakdown.extraCharge.toLocaleString()}</span>
                </div>
              ) : (
                <div className="flex justify-between text-emerald-700 text-xs">
                  <span>Trip is within free km — no extra charge</span>
                  <span className="font-medium">Rs 0</span>
                </div>
              )}
              <div className="flex justify-between font-black text-navy-800 text-base border-t border-navy-100 pt-2.5">
                <span>Estimated Total</span>
                <span>Rs {breakdown.total.toLocaleString()}</span>
              </div>
            </div>

            <div className="bg-amber-50 border-t border-amber-100 px-4 py-2.5 flex items-start gap-2">
              <AlertTriangle size={13} className="text-amber-500 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 leading-relaxed">
                <strong>Note:</strong> This is only an estimation. The final bill may vary based on the driver's driving style, road conditions, detours, and actual kilometers traveled at trip end.
              </p>
            </div>

            {/* Share section */}
            <div className="border-t border-navy-100 px-4 py-3">
              {!showShare ? (
                <button
                  onClick={() => { setSharePhone(form.customerPhone ?? ''); setShowShare(true); }}
                  className="flex items-center gap-2 text-xs font-semibold text-navy-600 hover:text-navy-800 transition-colors"
                >
                  <Share2 size={13} className="text-blue-500" /> Share Estimate
                </button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-navy-600 flex items-center gap-1.5">
                      <Share2 size={12} className="text-blue-500" /> Share Estimate
                    </p>
                    <button onClick={() => setShowShare(false)} className="text-xs text-navy-400 hover:text-navy-600">✕</button>
                  </div>

                  {/* Phone input */}
                  <div className="relative">
                    <Phone size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-navy-400 pointer-events-none" />
                    <input
                      className="input pl-8 text-sm py-2"
                      value={sharePhone}
                      onChange={(e) => setSharePhone(e.target.value)}
                      placeholder="Phone number (07X XXXXXXX)"
                    />
                  </div>

                  {/* Channel buttons */}
                  <div className="flex gap-2">
                    <button
                      onClick={handleWhatsApp}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-semibold py-2.5 rounded-xl transition-colors"
                    >
                      <MessageCircle size={14} />
                      WhatsApp
                    </button>
                    <button
                      onClick={handleSMS}
                      className="flex-1 flex items-center justify-center gap-2 bg-navy-700 hover:bg-navy-600 text-white text-xs font-semibold py-2.5 rounded-xl transition-colors"
                    >
                      <Smartphone size={14} />
                      Text / SMS
                    </button>
                    <button
                      onClick={handlePDF}
                      className="flex-1 flex items-center justify-center gap-2 bg-navy-700 hover:bg-navy-800 text-white text-xs font-semibold py-2.5 rounded-xl transition-colors"
                    >
                      <FileDown size={14} />
                      Download PDF
                    </button>
                  </div>
                  <p className="text-[10px] text-navy-400">WhatsApp and SMS open on your device. PDF opens a print dialog — choose "Save as PDF".</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center gap-3 pt-1 border-t border-navy-100">
          <button onClick={onBack} className="flex items-center gap-1.5 text-xs text-navy-500 hover:text-navy-700 font-medium transition-colors">
            <ArrowLeft size={13} /> Back to Form
          </button>
          <div className="flex-1" />
          <button onClick={onBack} className="btn-secondary">Cancel</button>
          <button onClick={onConfirm} className="btn-primary">Confirm Booking</button>
        </div>

      </div>
    </Modal>
  );
}
