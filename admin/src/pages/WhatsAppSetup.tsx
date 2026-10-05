import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, CheckCircle2, XCircle, Loader2, Copy, AlertTriangle, ExternalLink, Smartphone } from 'lucide-react';
import Header from '../components/layout/Header';
import { supabase, supabaseEnabled } from '../lib/supabase';
import { toast } from '../store/useToast';

/*
 * Connect the company's EXISTING WhatsApp Business app number to the Cloud API ("coexistence"):
 * the number keeps working in the WhatsApp Business app on the phone (calls too), and every chat
 * is also available in the admin. Uses Meta's Embedded Signup with
 * featureType "whatsapp_business_app_onboarding". See admin/supabase/WHATSAPP.md.
 */
const APP_ID = import.meta.env.VITE_META_APP_ID as string | undefined;
const CONFIG_ID = import.meta.env.VITE_META_WA_CONFIG_ID as string | undefined;
const GRAPH_VERSION = 'v23.0';

type FB = {
  init: (o: Record<string, unknown>) => void;
  login: (cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void, o: Record<string, unknown>) => void;
};
declare global { interface Window { FB?: FB; fbAsyncInit?: () => void } }

function loadSdk(): Promise<FB> {
  return new Promise((resolve, reject) => {
    if (window.FB) { resolve(window.FB); return; }
    window.fbAsyncInit = () => {
      window.FB!.init({ appId: APP_ID, autoLogAppEvents: true, xfbml: false, version: GRAPH_VERSION });
      resolve(window.FB!);
    };
    const s = document.createElement('script');
    s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.onerror = () => reject(new Error('Could not load the Facebook SDK (check your connection / ad blocker).'));
    document.body.appendChild(s);
  });
}

interface OnboardResult {
  ok: boolean; waba_id: string; phone_number_id: string; display_phone_number?: string; verified_name?: string;
  is_on_biz_app?: boolean | null; platform_type?: string | null;
  steps: { step: string; ok: boolean; detail?: string }[];
  error?: string;
}

export default function WhatsAppSetup() {
  const [wabaId, setWabaId] = useState(() => localStorage.getItem('crc-wa-waba') ?? '');
  const [event, setEvent] = useState('');
  const [launching, setLaunching] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [result, setResult] = useState<OnboardResult | null>(null);

  // Embedded Signup reports its outcome with a postMessage from facebook.com
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      try {
        if (!/(^|\.)facebook\.com$/.test(new URL(e.origin).hostname)) return;
        const d = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
        if (d?.type !== 'WA_EMBEDDED_SIGNUP') return;
        setEvent(d.event ?? '');
        if (d.data?.waba_id) {
          setWabaId(d.data.waba_id);
          localStorage.setItem('crc-wa-waba', d.data.waba_id);
          toast.success('WhatsApp connected', 'Now finish the setup within 24 hours.');
        }
        if (d.event === 'CANCEL') toast.warning('Signup cancelled', d.data?.current_step ? `Stopped at: ${d.data.current_step}` : '');
        if (d.event === 'ERROR') toast.error('Meta reported an error', d.data?.error_message ?? '');
      } catch { /* not ours */ }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const launch = async () => {
    setLaunching(true);
    try {
      const FB = await loadSdk();
      FB.login(() => setLaunching(false), {
        config_id: CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding', sessionInfoVersion: '3' },
      });
    } catch (e) {
      setLaunching(false);
      toast.error('Could not open Meta signup', (e as Error).message);
    }
  };

  const finish = async () => {
    setFinishing(true); setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke('whatsapp-onboard', { body: { waba_id: wabaId.trim() } });
      if (error) {
        let msg = error.message;
        try { const ctx = (error as { context?: Response }).context; if (ctx) { const j = await ctx.json(); msg = j.error ?? msg; setResult(j); } } catch { /* keep */ }
        throw new Error(msg);
      }
      setResult(data);
      if (data?.ok) toast.success('Setup finished', 'Messages will now appear in the admin.');
    } catch (e) {
      toast.error('Could not finish setup', (e as Error).message);
    } finally { setFinishing(false); }
  };

  const copy = (t: string) => navigator.clipboard.writeText(t).then(() => toast.success('Copied', t));
  const missing = [!APP_ID && 'VITE_META_APP_ID', !CONFIG_ID && 'VITE_META_WA_CONFIG_ID'].filter(Boolean) as string[];
  const step = 'w-7 h-7 rounded-full bg-navy-700 text-white text-xs font-bold flex items-center justify-center flex-shrink-0';

  return (
    <div className="max-w-3xl">
      <Header title="Connect WhatsApp" subtitle="Link your WhatsApp Business app number to the admin — the phone keeps working" />

      <div className="card !p-4 mb-4 flex gap-3 text-sm text-navy-600">
        <Smartphone size={18} className="text-emerald-600 flex-shrink-0 mt-0.5" />
        <p>
          This connects the number you already use in the <b>WhatsApp Business app</b>. After connecting, the phone keeps
          working (including <b>calls</b>), and every chat also appears in <Link to="/messages" className="text-brand-500 font-semibold">Messages</Link> and on each inquiry.
          Follow <code>admin/supabase/WHATSAPP.md</code> for the Meta settings first.
        </p>
      </div>

      {missing.length > 0 && (
        <div className="card !p-4 mb-4 border border-amber-200 bg-amber-50 text-sm text-amber-800 flex gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <p>Add {missing.map((m) => <code key={m} className="mx-1">{m}</code>)} to <code>admin/.env.local</code> and restart the admin (WHATSAPP.md, step 2).</p>
        </div>
      )}

      <section className="card !p-5 space-y-5">
        <div className="flex gap-3">
          <span className={step}>1</span>
          <div className="flex-1">
            <p className="font-semibold text-navy-800">Connect your WhatsApp Business app number</p>
            <p className="text-sm text-navy-500 mt-1">
              Meta's window opens. Choose your business → <b>“Connect your existing WhatsApp Business app”</b> → enter the
              number → open the WhatsApp Business app on the phone, tap <b>Connect to the Business Platform</b> in the message from Facebook,
              allow sharing chat history, and enter the code.
            </p>
            <button type="button" onClick={launch} disabled={launching || missing.length > 0}
                    className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-[#1877F2] text-white hover:bg-[#166fe0] disabled:opacity-50">
              {launching ? <Loader2 size={16} className="animate-spin" /> : <MessageCircle size={16} />} Connect with Meta
            </button>
            {event && <p className="text-xs text-navy-400 mt-2">Meta: {event}</p>}
          </div>
        </div>

        <div className="flex gap-3">
          <span className={step}>2</span>
          <div className="flex-1">
            <p className="font-semibold text-navy-800">Finish setup <span className="text-amber-700 font-normal text-sm">(within 24 hours of step 1)</span></p>
            <p className="text-sm text-navy-500 mt-1">
              Needs the <code>WHATSAPP_TOKEN</code> secret (system-user token with access to this account — WHATSAPP.md step 4).
              This subscribes the webhooks and copies your contacts and chat history into the admin.
            </p>
            <div className="flex flex-wrap gap-2 mt-3">
              <input className="input !py-2 flex-1 min-w-[220px] font-mono" placeholder="WhatsApp Business Account ID (filled automatically)"
                     value={wabaId} onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ''))} />
              <button type="button" onClick={finish} disabled={!wabaId || finishing || !supabaseEnabled} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
                {finishing ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />} Finish setup
              </button>
            </div>
          </div>
        </div>

        {result && (
          <div className="rounded-xl border border-navy-100 p-4 space-y-3">
            <ul className="space-y-1.5">
              {result.steps.map((s) => (
                <li key={s.step} className="flex items-start gap-2 text-sm">
                  {s.ok ? <CheckCircle2 size={16} className="text-emerald-600 mt-0.5" /> : <XCircle size={16} className="text-red-500 mt-0.5" />}
                  <span><b className="text-navy-800">{s.step}</b>{s.detail && <span className="text-red-600"> — {s.detail}</span>}</span>
                </li>
              ))}
            </ul>
            {result.phone_number_id && (
              <div className="grid sm:grid-cols-2 gap-2 text-sm">
                {[['Number', result.display_phone_number], ['Name', result.verified_name], ['Phone number ID', result.phone_number_id], ['Account (WABA) ID', result.waba_id],
                  ['On WhatsApp Business app', String(result.is_on_biz_app)], ['Platform', result.platform_type]].map(([k, v]) => (
                  <div key={k} className="bg-navy-50/60 rounded-lg px-3 py-2">
                    <p className="text-[11px] text-navy-400">{k}</p>
                    <p className="font-semibold text-navy-800 font-mono break-all flex items-center gap-2">{v ?? '—'}
                      {k === 'Phone number ID' && v && <button type="button" onClick={() => copy(String(v))} title="Copy"><Copy size={13} /></button>}
                    </p>
                  </div>
                ))}
              </div>
            )}
            {result.ok && (
              <p className="text-sm text-emerald-800 bg-emerald-50 rounded-lg px-3 py-2">
                Done! Set the secret <code>WHATSAPP_PHONE_NUMBER_ID={result.phone_number_id}</code> (WHATSAPP.md step 6), add
                {' '}<code>VITE_WHATSAPP_ENABLED=true</code> and open <Link to="/messages" className="font-semibold underline">Messages</Link>.
                {result.is_on_biz_app === true && result.platform_type === 'CLOUD_API' && ' The number is live on both the phone app and the admin.'}
              </p>
            )}
          </div>
        )}
      </section>

      <p className="text-xs text-navy-400 mt-4 flex items-center gap-1">
        Meta docs: <a className="text-brand-500 inline-flex items-center gap-0.5" href="https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users/" target="_blank" rel="noreferrer">Onboarding WhatsApp Business app users <ExternalLink size={11} /></a>
      </p>
    </div>
  );
}
