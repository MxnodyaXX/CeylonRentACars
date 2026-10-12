import { LogOut, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../store/useAuthStore';
import ChangePasswordForm from '../components/ui/ChangePasswordForm';

/** Shown after signing in with a temporary password — nothing else opens until it is changed. */
export default function ChangePasswordScreen() {
  const { currentUser, logout } = useAuthStore();
  return (
    <div className="min-h-screen flex items-center justify-center bg-navy-50/60 p-4">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-card border border-gray-100 p-6">
        <div className="w-11 h-11 rounded-xl bg-navy-800 flex items-center justify-center mb-4">
          <ShieldCheck size={20} className="text-white" />
        </div>
        <h1 className="text-lg font-semibold text-navy-800">Choose your own password</h1>
        <p className="text-xs text-navy-400 mt-1 mb-5 leading-relaxed">
          Hi {currentUser?.name?.split(' ')[0] ?? 'there'} — you signed in with a temporary password.
          Enter it below as the current password, then choose a new one only you know.
        </p>
        <ChangePasswordForm compact />
        <button type="button" onClick={() => logout()} className="mt-4 w-full inline-flex items-center justify-center gap-1.5 text-xs font-semibold text-navy-400 hover:text-navy-700">
          <LogOut size={13} /> Sign out
        </button>
      </div>
    </div>
  );
}
