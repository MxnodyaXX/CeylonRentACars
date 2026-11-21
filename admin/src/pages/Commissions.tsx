import { useAuthStore } from '../store/useAuthStore';
import Header from '../components/layout/Header';
import AdminView from './commissions/AdminView';
import OwnerView from './commissions/OwnerView';
import { useAmountsOff } from '../lib/ownerMoney';

export default function Commissions() {
  const { seesAll } = useAuthStore();
  const isAdmin = seesAll;   // admin or team: the company view
  const payoutsOnly = useAmountsOff();
  return (
    <div>
      <Header
        title={payoutsOnly ? 'My payouts' : 'Commissions & Earnings'}
        subtitle={isAdmin() ? 'Track all earnings, payouts, and lead performance' : (payoutsOnly ? 'What you are paid and when' : 'Your vehicle earnings and payout history')}
      />
      {isAdmin() ? <AdminView /> : <OwnerView />}
    </div>
  );
}
