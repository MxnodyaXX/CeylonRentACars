import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import AccountStatement from '../components/accounts/AccountStatement';
import { useStore } from '../store/useStore';
import { useCompanyFinance } from '../lib/companyFinance';
import { useSettlements } from '../lib/settlements';
import { buildLedger, type Books } from '../lib/ledger';

/** Company accounts → Statement, as its own full-screen page (opened in a new tab) */
export default function AccountStatementPage() {
  const st = useStore();
  const fin = useCompanyFinance();
  const settle = useSettlements();
  const navigate = useNavigate();
  useEffect(() => { fin.refresh(); settle.refresh(); document.title = 'Account statement — Ceylon Rent A Cars'; }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const books: Books = useMemo(() => ({
    bookings: st.bookings, commissions: st.commissions, expenses: st.expenses, vehicles: st.vehicles, owners: st.owners,
    settlements: settle.list, accounts: fin.accounts, companyExpenses: fin.expenses, transfers: fin.transfers, settings: fin.settings, from: settle.from,
  }), [st.bookings, st.commissions, st.expenses, st.vehicles, st.owners, settle.list, settle.from, fin.accounts, fin.expenses, fin.transfers, fin.settings]);
  const ledger = useMemo(() => buildLedger(books), [books]);

  // closing the tab's statement: close the tab if it was opened from the admin, else go back to Company accounts
  const close = () => { if (window.opener) window.close(); else navigate('/accounts'); };
  if (!fin.loaded) return <p className="text-sm text-navy-400 text-center py-20">Loading…</p>;
  return <AccountStatement page books={books} ledger={ledger} onClose={close} />;
}
