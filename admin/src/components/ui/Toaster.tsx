import { CheckCircle2, AlertTriangle, XCircle, Info, X } from 'lucide-react';
import { useToast, ToastType } from '../../store/useToast';

const styles: Record<ToastType, { icon: typeof CheckCircle2; ring: string; bar: string; iconColor: string }> = {
  success: { icon: CheckCircle2,  ring: 'border-l-emerald-500', bar: 'bg-emerald-500', iconColor: 'text-emerald-500' },
  error:   { icon: XCircle,       ring: 'border-l-red-500',     bar: 'bg-red-500',     iconColor: 'text-red-500' },
  warning: { icon: AlertTriangle, ring: 'border-l-amber-500',   bar: 'bg-amber-500',   iconColor: 'text-amber-500' },
  info:    { icon: Info,          ring: 'border-l-blue-500',    bar: 'bg-blue-500',    iconColor: 'text-blue-500' },
};

export default function Toaster() {
  const toasts  = useToast((s) => s.toasts);
  const dismiss = useToast((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2.5 w-[calc(100%-2rem)] max-w-sm pointer-events-none">
      {toasts.map((t) => {
        const s = styles[t.type];
        const Icon = s.icon;
        return (
          <div
            key={t.id}
            className={`anim-toast-in pointer-events-auto relative overflow-hidden bg-white rounded-xl shadow-card border border-navy-50 border-l-4 ${s.ring} flex items-start gap-3 px-4 py-3`}
            role="status"
          >
            <Icon size={20} className={`${s.iconColor} flex-shrink-0 mt-0.5`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-navy-800">{t.title}</p>
              {t.message && <p className="text-xs text-navy-500 mt-0.5 leading-relaxed">{t.message}</p>}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="w-6 h-6 rounded-lg flex items-center justify-center text-navy-300 hover:bg-navy-50 hover:text-navy-600 transition-colors flex-shrink-0"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
            {/* auto-dismiss progress bar */}
            <span className={`absolute bottom-0 left-0 w-full h-0.5 origin-left ${s.bar} opacity-60`} style={{ animation: 'toast-bar 3.8s linear forwards' }} />
          </div>
        );
      })}
    </div>
  );
}
