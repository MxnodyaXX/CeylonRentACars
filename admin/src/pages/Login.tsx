import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { LogIn, Eye, EyeOff, ShieldCheck, Globe, Car } from 'lucide-react';

const POINTS = [
  { icon: Car,         text: 'Fleet, bookings, handovers and payouts in one place' },
  { icon: Globe,       text: 'Choose which vehicles appear on the website' },
  { icon: ShieldCheck, text: 'Owner accounts only see their own vehicles' },
];

export default function Login() {
  const login = useAuthStore((s) => s.login);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show,     setShow]     = useState(false);
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    setTimeout(() => {
      const ok = login(username.trim(), password);
      if (!ok) setError('Invalid credentials or account disabled.');
      setLoading(false);
    }, 400);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.1fr_1fr] bg-white">
      {/* ── Brand panel (same night photo + red glow as the customer site hero) ── */}
      <aside className="relative hidden lg:flex flex-col justify-between overflow-hidden bg-[#0B0B0D] p-12 text-white">
        <img src="/brand/hero.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-60" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0B0B0D] via-[#0B0B0D]/40 to-[#0B0B0D]/70" />
        <div className="absolute -bottom-40 -left-40 w-[520px] h-[520px] rounded-full bg-brand-500/25 blur-[120px]" />

        <img src="/brand/logo-dark.png" alt="Ceylon Rent A Cars" className="relative w-40 h-auto anim-fade-up" />

        <div className="relative max-w-md anim-fade-up" style={{ animationDelay: '.12s' }}>
          <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.18em] text-brand-400 mb-4">
            <span className="w-5 h-[2px] bg-brand-500 rounded-full" /> Admin panel
          </span>
          <h1 className="text-4xl xl:text-5xl font-extrabold leading-[1.05] tracking-tight">
            Run the fleet behind <span className="text-brand-500">Ceylon Rent A Cars</span>.
          </h1>
          <ul className="mt-8 space-y-3">
            {POINTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sm text-white/75">
                <span className="w-8 h-8 rounded-lg bg-white/10 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Icon size={15} className="text-white" />
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-white/35">© {new Date().getFullYear()} Ceylon Rent A Cars</p>
      </aside>

      {/* ── Sign-in form ── */}
      <main className="flex items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-sm anim-fade-up">
          <img src="/brand/logo-light.png" alt="Ceylon Rent A Cars" className="w-36 h-auto mx-auto mb-8 lg:hidden" />

          <span className="eyebrow">Welcome back</span>
          <h2 className="text-3xl font-extrabold tracking-tight text-navy-800 mt-2">Sign in</h2>
          <p className="text-sm text-navy-400 mt-1 mb-8">Use your admin or owner account to continue.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="label block" htmlFor="login-user">Username</label>
              <input
                id="login-user"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Your username"
                className="input !py-3"
                autoComplete="username"
              />
            </div>

            <div>
              <label className="label block" htmlFor="login-pass">Password</label>
              <div className="relative">
                <input
                  id="login-pass"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input !py-3 pr-10"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? 'Hide password' : 'Show password'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-navy-300 hover:text-navy-700 transition-colors"
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <p className="text-brand-600 text-xs bg-brand-50 border border-brand-100 rounded-xl px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="btn-primary w-full flex items-center justify-center gap-2 !py-3 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn size={16} />
              )}
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>

          <p className="text-[11px] text-navy-300 text-center mt-6 leading-relaxed">
            Demo — Admin: <span className="text-navy-500 font-medium">admin / admin123</span> · Owner: <span className="text-navy-500 font-medium">kasun / owner123</span>
          </p>
        </div>
      </main>
    </div>
  );
}
