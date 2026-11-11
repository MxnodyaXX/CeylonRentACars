import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import { useStore } from './store/useStore';
import { setupRealtime } from './lib/realtime';
import { runInsuranceReminders } from './lib/insuranceReminder';
import Sidebar from './components/layout/Sidebar';
import Toaster from './components/ui/Toaster';
import LoadingScreen from './components/ui/LoadingScreen';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Vehicles from './pages/Vehicles';
import Bookings from './pages/Bookings';
import BookingPage from './pages/BookingPage';
import Inquiries from './pages/Inquiries';
import InquiryPage from './pages/InquiryPage';
import InquiryConsultation from './pages/InquiryConsultation';
import Messages from './pages/Messages';
import WhatsAppSetup from './pages/WhatsAppSetup';
import WhatsAppTemplates from './pages/WhatsAppTemplates';
import Commissions from './pages/Commissions';
import Owners from './pages/Owners';
import PartnerApplications from './pages/PartnerApplications';
import Expenses from './pages/Expenses';
import Drivers from './pages/Drivers';
import Notifications from './pages/Notifications';
import Permissions from './pages/Permissions';
import Referrals from './pages/Referrals';
import CreditManagement from './pages/CreditManagement';
import Handovers from './pages/Handovers';
import Customers from './pages/Customers';
import Settings from './pages/Settings';
import Breakdowns from './pages/Breakdowns';
import BreakdownIncident from './pages/BreakdownIncident';
import ChangePasswordScreen from './pages/ChangePasswordScreen';
import Incomplete from './pages/Incomplete';
import Website from './pages/Website';
import Feedback from './pages/Feedback';
import { canOpen } from './lib/access';
import Settlements from './pages/Settlements';
import AccountStatementPage from './pages/AccountStatementPage';
import CompanyAccounts from './pages/CompanyAccounts';

export default function App() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin     = useAuthStore((s) => s.isAdmin);
  const initAuth    = useAuthStore((s) => s.initAuth);
  const authReady   = useAuthStore((s) => s.ready);
  const loadAll     = useStore((s) => s.loadAll);
  const loaded      = useStore((s) => s.loaded);
  const [minDone, setMinDone] = useState(false);

  useEffect(() => {
    initAuth();   // restore the saved Supabase session (if any)
    const timer = setTimeout(() => setMinDone(true), 900); // keep the loader visible briefly
    return () => clearTimeout(timer);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The database only answers signed-in staff, so data and live updates start after sign-in
  // (and after a temporary password has been replaced)
  useEffect(() => {
    if (!currentUser || currentUser.mustChangePassword) return;
    loadAll();
    const cleanup = setupRealtime(loadAll);
    return () => { cleanup?.(); };
  }, [currentUser?.id, currentUser?.mustChangePassword]); // eslint-disable-line react-hooks/exhaustive-deps

  // Weekly insurance reminders, once per session after data is loaded. Only an admin session sends them
  // (owner logins would each send their own round), and never an SMS from local development or tests.
  useEffect(() => {
    if (!loaded || currentUser?.role !== 'admin') return;
    const { vehicles, owners, notifications, addNotification } = useStore.getState();
    const automated = navigator.userAgent.includes('Playwright') || (window as unknown as Record<string, unknown>).__playwright != null;
    runInsuranceReminders({ vehicles, owners, notifications, addNotification, sendTexts: !import.meta.env.DEV && !automated });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boot loading screen while the saved session is checked (and a short minimum so it doesn't flash).
  if (!authReady || !minDone) {
    return (
      <>
        <Toaster />
        <LoadingScreen />
      </>
    );
  }

  if (!currentUser) {
    return (
      <>
        <Toaster />
        <Login />
      </>
    );
  }

  // Signed in with a temporary password — choose a real one before anything else
  if (currentUser.mustChangePassword) {
    return (
      <>
        <Toaster />
        <ChangePasswordScreen />
      </>
    );
  }

  // Signed in — wait for the data
  if (!loaded) {
    return (
      <>
        <Toaster />
        <LoadingScreen />
      </>
    );
  }

  const allow = (path: string, page: JSX.Element) => (canOpen(path) ? page : <Navigate to="/" replace />);

  return (
    <>
    <Toaster />
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="flex-1 min-w-0 md:ml-[var(--sidebar-w)] md:transition-[margin-left] md:duration-300 md:ease-[cubic-bezier(.16,1,.3,1)] p-4 md:p-6 overflow-auto pb-28 md:pb-6">
        <Routes>
          {/* Who may open which page: src/lib/access.ts (the database enforces the same rules) */}
          <Route path="/"              element={<Dashboard />}     />
          <Route path="/vehicles"      element={<Vehicles />}      />
          <Route path="/bookings"      element={<Bookings />}      />
          <Route path="/bookings/:id"  element={<BookingPage />}   />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/commissions"   element={allow('/commissions', <Commissions />)} />
          <Route path="/inquiries"     element={allow('/inquiries', <Inquiries />)} />
          <Route path="/inquiries/:id" element={allow('/inquiries', <InquiryPage />)} />
          <Route path="/inquiries/:id/consultation" element={allow('/inquiries', <InquiryConsultation />)} />
          <Route path="/whatsapp-templates" element={isAdmin() ? <WhatsAppTemplates /> : <Navigate to="/messages" replace />} />
          <Route path="/whatsapp-setup" element={allow('/whatsapp-setup', <WhatsAppSetup />)} />
          <Route path="/messages"      element={allow('/messages', <Messages />)} />
          <Route path="/expenses"      element={allow('/expenses', <Expenses />)} />
          <Route path="/drivers"       element={allow('/drivers', <Drivers />)} />
          <Route path="/handovers"     element={allow('/handovers', <Handovers />)} />
          <Route path="/customers"     element={allow('/customers', <Customers />)} />
          <Route path="/referrals"     element={allow('/referrals', <Referrals />)} />
          <Route path="/incomplete"    element={allow('/incomplete', <Incomplete />)} />
          <Route path="/owners"        element={allow('/owners', <Owners />)} />
          <Route path="/partners"      element={allow('/partners', <PartnerApplications />)} />
          <Route path="/permissions"   element={allow('/permissions', <Permissions />)} />
          <Route path="/settings"      element={allow('/settings', <Settings />)} />
          <Route path="/credit"        element={allow('/credit', <CreditManagement />)} />
          <Route path="/settlements"   element={allow('/settlements', <Settlements />)} />
          <Route path="/accounts"      element={allow('/accounts', <CompanyAccounts />)} />
          <Route path="/accounts/statement" element={allow('/accounts', <AccountStatementPage />)} />
          <Route path="/breakdowns"    element={allow('/breakdowns', <Breakdowns />)} />
          <Route path="/breakdowns/:id" element={allow('/breakdowns', <BreakdownIncident />)} />
          <Route path="/website"       element={allow('/website', <Website />)} />
          <Route path="/feedback"      element={allow('/feedback', <Feedback />)} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
    </>
  );
}
