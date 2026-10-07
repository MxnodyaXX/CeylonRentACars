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
import Inquiries from './pages/Inquiries';
import InquiryPage from './pages/InquiryPage';
import InquiryConsultation from './pages/InquiryConsultation';
import Messages from './pages/Messages';
import WhatsAppSetup from './pages/WhatsAppSetup';
import WhatsAppTemplates from './pages/WhatsAppTemplates';
import Commissions from './pages/Commissions';
import Owners from './pages/Owners';
import Expenses from './pages/Expenses';
import Drivers from './pages/Drivers';
import Notifications from './pages/Notifications';
import Permissions from './pages/Permissions';
import Referrals from './pages/Referrals';
import CreditManagement from './pages/CreditManagement';
import Handovers from './pages/Handovers';
import Customers from './pages/Customers';
import Settings from './pages/Settings';
import Incomplete from './pages/Incomplete';
import Website from './pages/Website';
import Feedback from './pages/Feedback';

export default function App() {
  const currentUser = useAuthStore((s) => s.currentUser);
  const isAdmin     = useAuthStore((s) => s.isAdmin);
  const can         = useAuthStore((s) => s.can);
  const loadUsers   = useAuthStore((s) => s.loadUsers);
  const loadAll     = useStore((s) => s.loadAll);
  const loaded      = useStore((s) => s.loaded);
  const [minDone, setMinDone] = useState(false);

  useEffect(() => {
    loadAll();
    loadUsers();   // hydrate login profiles from the database
    const timer = setTimeout(() => setMinDone(true), 900); // keep the loader visible briefly
    const cleanup = setupRealtime(loadAll);
    return () => { clearTimeout(timer); cleanup?.(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Run insurance reminders once per session, immediately after data is loaded.
  // Uses getState() snapshot to avoid subscribing to rapidly-changing store slices.
  useEffect(() => {
    if (!loaded) return;
    const { vehicles, owners, notifications, addNotification } = useStore.getState();
    runInsuranceReminders({ vehicles, owners, notifications, addNotification });
  }, [loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Boot loading screen until data is ready (and a short minimum so it doesn't flash).
  if (!loaded || !minDone) {
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

  return (
    <>
    <Toaster />
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <main className="flex-1 min-w-0 md:ml-[var(--sidebar-w)] md:transition-[margin-left] md:duration-300 md:ease-[cubic-bezier(.16,1,.3,1)] p-4 md:p-6 overflow-auto pb-[72px] md:pb-6">
        <Routes>
          <Route path="/"              element={<Dashboard />}     />
          <Route path="/vehicles"      element={<Vehicles />}      />
          <Route path="/bookings"      element={<Bookings />}      />
          <Route path="/commissions"   element={<Commissions />}   />
          <Route path="/notifications" element={<Notifications />} />
          {/* Permission-gated pages — redirect to home if not allowed */}
          <Route path="/inquiries"  element={isAdmin() || can('canViewInquiries')   ? <Inquiries />  : <Navigate to="/" replace />} />
          <Route path="/inquiries/:id" element={isAdmin() || can('canViewInquiries') ? <InquiryPage /> : <Navigate to="/" replace />} />
          <Route path="/inquiries/:id/consultation" element={isAdmin() || can('canViewInquiries') ? <InquiryConsultation /> : <Navigate to="/" replace />} />
          <Route path="/whatsapp-templates" element={isAdmin() ? <WhatsAppTemplates /> : <Navigate to="/messages" replace />} />
          <Route path="/whatsapp-setup" element={isAdmin() ? <WhatsAppSetup /> : <Navigate to="/" replace />} />
          <Route path="/messages" element={isAdmin() || can('canViewInquiries') ? <Messages /> : <Navigate to="/" replace />} />
          <Route path="/expenses"   element={isAdmin() || can('canViewExpenses')    ? <Expenses />   : <Navigate to="/" replace />} />
          <Route path="/drivers"    element={isAdmin() || can('canViewDrivers')     ? <Drivers />    : <Navigate to="/" replace />} />
          <Route path="/handovers"  element={isAdmin() || can('canViewHandovers')   ? <Handovers />  : <Navigate to="/" replace />} />
          <Route path="/customers"  element={isAdmin() || can('canViewCustomers')   ? <Customers />  : <Navigate to="/" replace />} />
          <Route path="/referrals"  element={isAdmin() || can('canViewReferrals')   ? <Referrals />  : <Navigate to="/" replace />} />
          <Route path="/incomplete" element={isAdmin() || can('canViewIncomplete')  ? <Incomplete /> : <Navigate to="/" replace />} />
          {/* Admin-only pages */}
          <Route path="/owners"      element={isAdmin() ? <Owners />           : <Navigate to="/" replace />} />
          <Route path="/permissions" element={isAdmin() ? <Permissions />      : <Navigate to="/" replace />} />
          <Route path="/settings"    element={isAdmin() || currentUser?.role === 'owner' ? <Settings /> : <Navigate to="/" replace />} />
          <Route path="/credit"      element={isAdmin() ? <CreditManagement /> : <Navigate to="/" replace />} />
          <Route path="/website"     element={isAdmin() ? <Website />          : <Navigate to="/" replace />} />
          <Route path="/feedback"    element={isAdmin() ? <Feedback />         : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
    </>
  );
}
