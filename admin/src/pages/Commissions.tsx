import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import AdminView from './commissions/AdminView';
import OwnerView from './commissions/OwnerView';

export default function Commissions() {
  const { isAdmin } = useAuthStore();
  return (
    <div>
      <Header
        title="Commissions & Earnings"
        subtitle={isAdmin() ? 'Track all earnings, payouts, and lead performance' : 'Your vehicle earnings and payout history'}
      />
      {isAdmin() ? <AdminView /> : <OwnerView />}
    </div>
  );
}
