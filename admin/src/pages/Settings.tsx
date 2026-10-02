import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import emailjs from '@emailjs/browser';
import {
  Settings as SettingsIcon, ClipboardList, UserPlus, CheckCircle2,
  AlertCircle, X, Mail, Phone, Eye, EyeOff, ShieldCheck, User,
  RefreshCw, Lock,
} from 'lucide-react';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import ManualBookingModal from '../components/ui/ManualBookingModal';
import LocationInput from '../components/ui/LocationInput';
import { sendSms } from '../lib/sms';
import type { Owner } from '../types';

// ─── OTP helpers ────────────────────────────────────────────────────────────

const genOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

const emailjsReady =
  typeof import.meta.env.VITE_EMAILJS_SERVICE_ID === 'string' &&
  typeof import.meta.env.VITE_EMAILJS_TEMPLATE_ID === 'string' &&
  import.meta.env.VITE_EMAILJS_TEMPLATE_ID !== 'YOUR_TEMPLATE_ID' &&
  typeof import.meta.env.VITE_EMAILJS_PUBLIC_KEY === 'string' &&
  import.meta.env.VITE_EMAILJS_PUBLIC_KEY !== 'YOUR_PUBLIC_KEY';

async function sendEmailOtp(to: string, otp: string): Promise<'sent' | 'fallback'> {
  if (!emailjsReady) return 'fallback';
  try {
    await emailjs.send(
      import.meta.env.VITE_EMAILJS_SERVICE_ID as string,
      import.meta.env.VITE_EMAILJS_TEMPLATE_ID as string,
      { to_email: to, subject: 'Ceylon Rent A Cars – Email Verification', html_content: `<p>Your verification code is: <strong>${otp}</strong></p><p>Valid for 10 minutes.</p>` },
      import.meta.env.VITE_EMAILJS_PUBLIC_KEY as string,
    );
    return 'sent';
  } catch {
    return 'fallback';
  }
}

// ─── ProfileSetupModal ───────────────────────────────────────────────────────

interface OtpState { sent: boolean; code: string; input: string; verified: boolean; fallbackCode?: string; }
const emptyOtp = (): OtpState => ({ sent: false, code: '', input: '', verified: false });

interface ProfileProps { owner: Owner; onClose: () => void; onCreated: () => void; }

function ProfileSetupModal({ owner, onClose, onCreated }: ProfileProps) {
  const { updateOwner } = useStore();
  const { users, addUser } = useAuthStore();

  const [email,   setEmail]   = useState(owner.email ?? '');
  const [phone]               = useState(owner.phone); // read-only, pre-filled
  const [nic,     setNic]     = useState('');
  const [address, setAddress] = useState(owner.address ?? '');
  const [emailOtp, setEmailOtp] = useState<OtpState>(emptyOtp());
  const [phoneOtp, setPhoneOtp] = useState<OtpState>(emptyOtp());
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm,  setConfirm]  = useState('');
  const [showPwd,  setShowPwd]  = useState(false);
  const [error,    setError]    = useState('');
  const [saving,   setSaving]   = useState(false);

  const bothVerified = emailOtp.verified && phoneOtp.verified;

  // ── Email OTP ──────────────────────────────────────────────────────────────
  const handleSendEmailOtp = async () => {
    if (!email.trim() || !email.includes('@')) { setError('Enter a valid email first.'); return; }
    setError('');
    const code = genOtp();
    const result = await sendEmailOtp(email.trim(), code);
    setEmailOtp({ sent: true, code, input: '', verified: false, fallbackCode: result === 'fallback' ? code : undefined });
  };

  const handleVerifyEmail = () => {
    if (emailOtp.input.trim() === emailOtp.code) {
      setEmailOtp((s) => ({ ...s, verified: true }));
    } else {
      setError('Incorrect email OTP — please try again.');
    }
  };

  // ── Phone OTP ──────────────────────────────────────────────────────────────
  const handleSendPhoneOtp = async () => {
    setError('');
    const code = genOtp();
    const sent = await sendSms(phone, `Your EMRAC verification code is: ${code}`, { category: 'profileOtp', transactional: true });
    setPhoneOtp({ sent: true, code, input: '', verified: false, fallbackCode: !sent ? code : undefined });
  };

  const handleVerifyPhone = () => {
    if (phoneOtp.input.trim() === phoneOtp.code) {
      setPhoneOtp((s) => ({ ...s, verified: true }));
    } else {
      setError('Incorrect phone OTP — please try again.');
    }
  };

  // ── Save ───────────────────────────────────────────────────────────────────
  const handleSave = () => {
    setError('');
    if (!bothVerified)            { setError('Both email and phone must be verified first.'); return; }
    if (!nic.trim())              { setError('NIC / Passport number is required.'); return; }
    if (!address.trim())          { setError('Address is required.'); return; }
    if (!username.trim())         { setError('Username is required.'); return; }
    if (password.length < 6)     { setError('Password must be at least 6 characters.'); return; }
    if (password !== confirm)     { setError('Passwords do not match.'); return; }
    if (users.some((u) => u.username === username.trim())) {
      setError('That username is already taken — choose another.'); return;
    }
    setSaving(true);
    // Persist the full profile to the owners table (DB): verified email, address,
    // NIC and the chosen login username.
    updateOwner(owner.id, { email: email.trim(), address: address.trim(), nic: nic.trim(), username: username.trim() });
    // Create the login profile (auth)
    addUser({ username: username.trim(), password, name: owner.name, role: 'owner', ownerId: owner.id, email: email.trim(), nic: nic.trim() });
    setSaving(false);
    onCreated();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[92vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="text-base font-semibold text-navy-800 flex items-center gap-2">
              <UserPlus size={17} className="text-navy-500" /> Create User Profile
            </h2>
            <p className="text-xs text-navy-400 mt-0.5">{owner.name}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400"><X size={16} /></button>
        </div>

        <div className="p-6 space-y-6">
          {/* Owner info banner */}
          <div className="bg-navy-50 rounded-xl border border-navy-100 p-4 flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-navy-700 flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
              {owner.name[0].toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-navy-800">{owner.name}</p>
              <p className="text-xs text-navy-500">{owner.phone}</p>
            </div>
          </div>

          {/* Step indicator */}
          <div className="flex items-center gap-2 text-xs">
            {[['1', 'Verify Email'], ['2', 'Verify Phone'], ['3', 'Set Credentials']].map(([n, label], i) => {
              const done = i === 0 ? emailOtp.verified : i === 1 ? phoneOtp.verified : false;
              const active = i === 0 ? !emailOtp.verified : i === 1 ? emailOtp.verified && !phoneOtp.verified : bothVerified;
              return (
                <div key={n} className="flex items-center gap-1.5">
                  {i > 0 && <div className="w-6 h-px bg-gray-200" />}
                  <div className={`flex items-center gap-1 px-2 py-1 rounded-full ${done ? 'bg-green-100 text-green-700' : active ? 'bg-navy-700 text-white' : 'bg-gray-100 text-gray-400'}`}>
                    {done ? <CheckCircle2 size={11} /> : <span className="text-[10px] font-bold">{n}</span>}
                    <span className="font-medium">{label}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Email Verification ── */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-navy-700 flex items-center gap-2">
              <Mail size={14} className="text-navy-400" /> Email Address
              {emailOtp.verified && <span className="text-xs text-green-600 flex items-center gap-1 font-normal"><CheckCircle2 size={12} /> Verified</span>}
            </p>
            {!emailOtp.verified && (
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  type="email"
                  placeholder="owner@email.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setEmailOtp(emptyOtp()); }}
                  disabled={emailOtp.sent}
                />
                <button
                  className="btn btn-secondary flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                  onClick={emailOtp.sent ? () => setEmailOtp(emptyOtp()) : handleSendEmailOtp}
                >
                  {emailOtp.sent ? <><RefreshCw size={13} /> Resend</> : <><Mail size={13} /> Send OTP</>}
                </button>
              </div>
            )}
            {emailOtp.sent && !emailOtp.verified && (
              <div className="space-y-2">
                {emailOtp.fallbackCode && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                    <strong>EmailJS not configured</strong> — development OTP: <strong className="font-mono text-base tracking-widest">{emailOtp.fallbackCode}</strong>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="input flex-1 font-mono tracking-widest text-center text-lg"
                    placeholder="000000"
                    maxLength={6}
                    value={emailOtp.input}
                    onChange={(e) => setEmailOtp((s) => ({ ...s, input: e.target.value.replace(/\D/g, '') }))}
                  />
                  <button className="btn btn-primary flex-shrink-0" onClick={handleVerifyEmail}>Verify</button>
                </div>
              </div>
            )}
            {emailOtp.verified && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 flex items-center gap-2">
                <CheckCircle2 size={15} /> <span><strong>{email}</strong> verified successfully</span>
              </div>
            )}
          </div>

          {/* ── Phone Verification ── */}
          <div className="space-y-3">
            <p className="text-sm font-semibold text-navy-700 flex items-center gap-2">
              <Phone size={14} className="text-navy-400" /> Mobile Number
              {phoneOtp.verified && <span className="text-xs text-green-600 flex items-center gap-1 font-normal"><CheckCircle2 size={12} /> Verified</span>}
            </p>
            {!phoneOtp.verified && (
              <div className="flex gap-2">
                <input className="input flex-1 bg-gray-50 text-navy-500" value={phone} readOnly />
                <button
                  className="btn btn-secondary flex items-center gap-1 whitespace-nowrap flex-shrink-0"
                  onClick={phoneOtp.sent ? () => setPhoneOtp(emptyOtp()) : handleSendPhoneOtp}
                >
                  {phoneOtp.sent ? <><RefreshCw size={13} /> Resend</> : <><Phone size={13} /> Send OTP</>}
                </button>
              </div>
            )}
            {phoneOtp.sent && !phoneOtp.verified && (
              <div className="space-y-2">
                {phoneOtp.fallbackCode && (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                    <strong>SMS not configured</strong> — development OTP: <strong className="font-mono text-base tracking-widest">{phoneOtp.fallbackCode}</strong>
                  </div>
                )}
                <div className="flex gap-2">
                  <input
                    className="input flex-1 font-mono tracking-widest text-center text-lg"
                    placeholder="000000"
                    maxLength={6}
                    value={phoneOtp.input}
                    onChange={(e) => setPhoneOtp((s) => ({ ...s, input: e.target.value.replace(/\D/g, '') }))}
                  />
                  <button className="btn btn-primary flex-shrink-0" onClick={handleVerifyPhone}>Verify</button>
                </div>
              </div>
            )}
            {phoneOtp.verified && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 text-sm text-green-700 flex items-center gap-2">
                <CheckCircle2 size={15} /> <span><strong>{phone}</strong> verified successfully</span>
              </div>
            )}
          </div>

          {/* ── NIC & Address (always visible) ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1">NIC / Passport <span className="text-red-500">*</span></label>
              <input className="input" placeholder="e.g. 951234567V" value={nic} onChange={(e) => setNic(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-navy-500 mb-1">Address <span className="text-red-500">*</span></label>
              <LocationInput value={address} onChange={setAddress} placeholder="Full address" />
            </div>
          </div>

          {/* ── Credentials (only after both verified) ── */}
          {bothVerified ? (
            <div className="border border-navy-200 rounded-xl p-4 bg-navy-50/40 space-y-4">
              <p className="text-sm font-semibold text-navy-700 flex items-center gap-2">
                <Lock size={14} className="text-navy-500" /> Login Credentials
              </p>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Username <span className="text-red-500">*</span></label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className="input pl-8" placeholder="e.g. manodya_k" value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, '_'))} />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Password <span className="text-red-500">*</span></label>
                <div className="relative">
                  <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                  <input className={`input pl-8 pr-10 ${showPwd ? '' : ''}`} type={showPwd ? 'text' : 'password'} placeholder="Min. 6 characters" value={password} onChange={(e) => setPassword(e.target.value)} />
                  <button className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setShowPwd((v) => !v)}>
                    {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-navy-500 mb-1">Confirm Password <span className="text-red-500">*</span></label>
                <input className="input" type="password" placeholder="Repeat password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                {confirm && password !== confirm && (
                  <p className="text-xs text-red-500 mt-1">Passwords do not match</p>
                )}
              </div>
            </div>
          ) : (
            <div className="border border-dashed border-gray-200 rounded-xl p-4 text-center text-xs text-navy-400">
              <ShieldCheck size={18} className="mx-auto mb-1 opacity-40" />
              Verify email and phone above to unlock credential setup
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="btn btn-secondary">Cancel</button>
          <button
            onClick={handleSave}
            disabled={!bothVerified || saving}
            className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Creating…' : 'Create Profile'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings page ───────────────────────────────────────────────────────────

export default function Settings() {
  const { owners, recomputeStats } = useStore();
  const { users, isAdmin }     = useAuthStore();
  const admin = isAdmin();
  const [manualOpen,  setManualOpen]  = useState(false);
  const [searchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('resume')) setManualOpen(true);
  }, [searchParams]);
  const [setupOwner,  setSetupOwner]  = useState<Owner | null>(null);
  const [successId,   setSuccessId]   = useState<string | null>(null);

  const ownerUserMap = new Map(users.filter((u) => u.ownerId).map((u) => [u.ownerId!, u]));

  const withProfile    = owners.filter((o) => ownerUserMap.has(o.id));
  const withoutProfile = owners.filter((o) => !ownerUserMap.has(o.id));

  return (
    <div>
      <Header
        title="Settings"
        subtitle={admin ? 'System configuration and user management' : 'Record past bookings for your vehicles'}
      />

      {/* ── Data Management ── */}
      <section className="mb-10">
        <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider mb-3">Data Management</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <button
            onClick={() => setManualOpen(true)}
            className="flex items-start gap-4 p-4 bg-white rounded-2xl shadow-card border border-gray-100 hover:border-navy-200 hover:shadow-md text-left transition-all"
          >
            <div className="w-11 h-11 rounded-xl bg-navy-700 flex items-center justify-center flex-shrink-0">
              <ClipboardList size={20} className="text-white" />
            </div>
            <div>
              <p className="font-semibold text-navy-800 text-sm">Add Manual Booking</p>
              <p className="text-xs text-navy-400 mt-1 leading-relaxed">Record a past booking that was missed. Updates vehicle stats, customer profile, commissions, and referral earnings.</p>
            </div>
          </button>

          {admin && (
            <button
              onClick={recomputeStats}
              className="flex items-start gap-4 p-4 bg-white rounded-2xl shadow-card border border-gray-100 hover:border-navy-200 hover:shadow-md text-left transition-all"
            >
              <div className="w-11 h-11 rounded-xl bg-emerald-600 flex items-center justify-center flex-shrink-0">
                <RefreshCw size={20} className="text-white" />
              </div>
              <div>
                <p className="font-semibold text-navy-800 text-sm">Recalculate Statistics</p>
                <p className="text-xs text-navy-400 mt-1 leading-relaxed">Rebuild every vehicle's revenue/rent count and owner earnings from the actual bookings. Fixes any inflated or incorrect totals.</p>
              </div>
            </button>
          )}
        </div>
      </section>

      {/* ── User Profiles (admin only) ── */}
      {admin && (
      <section>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold text-navy-400 uppercase tracking-wider">Owner User Profiles</p>
          <span className="text-xs text-navy-400">{withProfile.length} / {owners.length} set up</span>
        </div>

        {owners.length === 0 ? (
          <div className="card text-center py-12 text-navy-400 text-sm">No owners in the system yet.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Owners without profile first */}
            {withoutProfile.map((owner) => (
              <div key={owner.id} className="bg-white rounded-2xl shadow-card border border-amber-100 p-4 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center text-amber-700 font-bold text-sm flex-shrink-0">
                    {owner.name[0].toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-navy-800 text-sm truncate">{owner.name}</p>
                    <p className="text-xs text-navy-400 truncate">{owner.phone}</p>
                  </div>
                  <span className="ml-auto px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 text-xs font-semibold flex-shrink-0">No login</span>
                </div>
                {owner.email && <p className="text-xs text-navy-400 truncate">{owner.email}</p>}
                <button
                  onClick={() => { setSuccessId(null); setSetupOwner(owner); }}
                  className="btn btn-primary w-full flex items-center justify-center gap-2 text-sm py-2"
                >
                  <UserPlus size={14} /> Set Up Profile
                </button>
              </div>
            ))}

            {/* Owners with profile */}
            {withProfile.map((owner) => {
              const user = ownerUserMap.get(owner.id)!;
              const justCreated = successId === owner.id;
              return (
                <div key={owner.id} className={`bg-white rounded-2xl shadow-card border p-4 flex flex-col gap-3 ${justCreated ? 'border-green-300' : 'border-green-100'}`}>
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center text-green-700 font-bold text-sm flex-shrink-0">
                      {owner.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-navy-800 text-sm truncate">{owner.name}</p>
                      <p className="text-xs text-navy-500 truncate">@{user.username}</p>
                    </div>
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-semibold flex-shrink-0 flex items-center gap-1">
                      <CheckCircle2 size={11} /> Active
                    </span>
                  </div>
                  {owner.email && <p className="text-xs text-navy-400 truncate">{owner.email}</p>}
                  {justCreated && (
                    <p className="text-xs text-green-600 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Profile created successfully!
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
      )}

      {/* Modals */}
      {manualOpen && <ManualBookingModal onClose={() => setManualOpen(false)} />}
      {setupOwner && (
        <ProfileSetupModal
          owner={setupOwner}
          onClose={() => setSetupOwner(null)}
          onCreated={() => setSuccessId(setupOwner.id)}
        />
      )}
    </div>
  );
}
