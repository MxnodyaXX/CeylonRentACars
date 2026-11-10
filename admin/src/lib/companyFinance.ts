import { create } from 'zustand';
import { supabase, supabaseEnabled } from './supabase';
import { useAuthStore } from '../store/useAuthStore';
import type { AccountTransfer, CompanyAccount, CompanyExpense, MonthClose } from '../types';

/*
 * Company accounts (security/18_company_accounts.sql): the cash box and bank accounts, company
 * running costs (approved by Brian above the approval amount), transfers between accounts, and
 * closed months. The database enforces who may do what; this store reads and saves.
 */

export const EXPENSE_CATEGORIES = [
  'Office rent', 'Electricity & water', 'Phone & internet', 'Salaries & staff', 'Marketing & ads', 'Software & subscriptions',
  'Office fuel & transport', 'Repairs (company)', 'Bank charges', 'Taxes & licences', 'Stationery & printing', 'Other',
];
export const PAY_METHODS = ['Cash', 'Bank transfer', 'Card', 'Online', 'Cheque'];

export interface FinanceSettings {
  /** company expenses above this wait for an admin */
  approvalAbove: number;
  /** the usual account for each payment method — used when a payment doesn't name one */
  methodAccounts: Record<string, string>;
}
const DEFAULT_SETTINGS: FinanceSettings = { approvalAbove: 25000, methodAccounts: {} };

const accFrom = (r: Record<string, unknown>): CompanyAccount => ({
  id: r.id as string, name: r.name as string, kind: r.kind as CompanyAccount['kind'], bankName: (r.bank_name as string) ?? undefined,
  accountNo: (r.account_no as string) ?? undefined, openingBalance: Number(r.opening_balance ?? 0), openingDate: String(r.opening_date ?? '2026-10-01'), active: r.active !== false,
});
const expFrom = (r: Record<string, unknown>): CompanyExpense => ({
  id: r.id as string, date: String(r.date), category: r.category as string, amount: Number(r.amount), description: r.description as string,
  accountId: (r.account_id as string) ?? undefined, receiptPath: (r.receipt_path as string) ?? undefined, private: !!r.private,
  status: r.status as CompanyExpense['status'], requestedBy: (r.requested_by as string) ?? undefined, approvedBy: (r.approved_by as string) ?? undefined,
  approvedAt: (r.approved_at as string) ?? undefined, reviewNote: (r.review_note as string) ?? undefined, paidOn: (r.paid_on as string) ?? undefined,
  paidBy: (r.paid_by as string) ?? undefined, createdAt: (r.created_at as string) ?? undefined,
});
const trFrom = (r: Record<string, unknown>): AccountTransfer => ({
  id: r.id as string, date: String(r.date), fromAccount: r.from_account as string, toAccount: r.to_account as string,
  amount: Number(r.amount), note: (r.note as string) ?? undefined, byName: (r.by_name as string) ?? undefined,
});
const closeFrom = (r: Record<string, unknown>): MonthClose => ({
  period: r.period as string, closedBy: (r.closed_by as string) ?? undefined, closedAt: (r.closed_at as string) ?? undefined,
  summary: (r.summary as Record<string, number>) ?? {}, note: (r.note as string) ?? undefined,
});

const uid = (p: string) => p + Math.random().toString(36).slice(2, 10);
const me = () => useAuthStore.getState().currentUser?.name ?? 'Admin';
const isAdmin = () => useAuthStore.getState().currentUser?.role === 'admin';
const check = (r: { error: { message: string } | null }) => { if (r.error) throw new Error(r.error.message); };

// Offline demo: everything lives in this browser, with the same rules as the database
const DEMO = 'crac-demo-company-finance';
type DemoData = { accounts: CompanyAccount[]; expenses: CompanyExpense[]; transfers: AccountTransfer[]; closes: MonthClose[]; settings: FinanceSettings };
const demoRead = (): DemoData => {
  try { return { accounts: [], expenses: [], transfers: [], closes: [], settings: DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(DEMO) ?? '{}') }; }
  catch { return { accounts: [], expenses: [], transfers: [], closes: [], settings: DEFAULT_SETTINGS }; }
};
const demoWrite = (d: DemoData) => { try { localStorage.setItem(DEMO, JSON.stringify(d)); } catch { /* private mode */ } };
const demoClosed = (date: string) => demoRead().closes.some((c) => c.period === date.slice(0, 7));

interface FinanceState extends DemoData {
  loaded: boolean;
  refresh: () => Promise<void>;
  saveAccount: (a: Omit<CompanyAccount, 'id'> & { id?: string }) => Promise<void>;
  saveSettings: (s: FinanceSettings) => Promise<void>;
  addExpense: (e: Pick<CompanyExpense, 'date' | 'category' | 'amount' | 'description' | 'accountId' | 'receiptPath' | 'private'>) => Promise<void>;
  reviewExpense: (id: string, approve: boolean, note?: string) => Promise<void>;
  payExpense: (id: string, accountId: string, paidOn: string) => Promise<void>;
  deleteExpense: (id: string) => Promise<void>;
  addTransfer: (t: Omit<AccountTransfer, 'id' | 'byName'>) => Promise<void>;
  closeMonth: (period: string, summary: Record<string, number>, note?: string) => Promise<void>;
  reopenMonth: (period: string) => Promise<void>;
  setPayoutAccount: (settlementId: string, accountId: string) => Promise<void>;
}

export const useCompanyFinance = create<FinanceState>()((set, get) => ({
  accounts: [], expenses: [], transfers: [], closes: [], settings: DEFAULT_SETTINGS, loaded: false,

  refresh: async () => {
    if (!supabaseEnabled) { set({ ...demoRead(), loaded: true }); return; }
    const [a, e, t, c, s] = await Promise.all([
      supabase.from('company_accounts').select('*').order('created_at'),
      supabase.from('company_expenses').select('*').order('date', { ascending: false }),
      supabase.from('account_transfers').select('*').order('date', { ascending: false }),
      supabase.from('month_closes').select('*').order('period', { ascending: false }),
      supabase.from('app_settings').select('value').eq('key', 'company_finance').maybeSingle(),
    ]);
    // before 18_company_accounts.sql is run the tables don't exist — the page still shows what it can
    [a, e, t, c].forEach((r) => r.error && console.warn('[company finance]', r.error.message));
    const v = (s.data?.value ?? {}) as { approval_above?: number; method_accounts?: Record<string, string> };
    set({
      accounts: (a.data ?? []).map(accFrom), expenses: (e.data ?? []).map(expFrom), transfers: (t.data ?? []).map(trFrom), closes: (c.data ?? []).map(closeFrom),
      settings: { approvalAbove: Number(v.approval_above ?? 25000), methodAccounts: v.method_accounts ?? {} }, loaded: true,
    });
  },

  saveAccount: async (acc) => {
    const row = { name: acc.name.trim(), kind: acc.kind, bank_name: acc.bankName || null, account_no: acc.accountNo || null,
      opening_balance: acc.openingBalance, opening_date: acc.openingDate, active: acc.active };
    if (!supabaseEnabled) {
      const d = demoRead(); const id = acc.id ?? uid('ac');
      d.accounts = [...d.accounts.filter((x) => x.id !== id), { ...acc, id }];
      demoWrite(d); return get().refresh();
    }
    check(acc.id ? await supabase.from('company_accounts').update(row).eq('id', acc.id) : await supabase.from('company_accounts').insert({ id: uid('ac'), ...row }));
    return get().refresh();
  },

  saveSettings: async (st) => {
    if (!supabaseEnabled) { const d = demoRead(); d.settings = st; demoWrite(d); return get().refresh(); }
    check(await supabase.from('app_settings').upsert({ key: 'company_finance', value: { approval_above: st.approvalAbove, method_accounts: st.methodAccounts }, updated_at: new Date().toISOString() }, { onConflict: 'key' }));
    return get().refresh();
  },

  addExpense: async (e) => {
    if (!supabaseEnabled) {
      if (demoClosed(e.date)) throw new Error('That month is closed — use a date in an open month.');
      const d = demoRead();
      const auto = isAdmin() || e.amount <= d.settings.approvalAbove;
      d.expenses = [{ ...e, id: uid('ce'), status: auto ? 'approved' : 'pending', requestedBy: me(), approvedBy: auto ? (isAdmin() ? me() : 'Auto (under the approval limit)') : undefined, approvedAt: auto ? new Date().toISOString() : undefined, createdAt: new Date().toISOString() }, ...d.expenses];
      demoWrite(d); return get().refresh();
    }
    check(await supabase.from('company_expenses').insert({ id: uid('ce'), date: e.date, category: e.category, amount: e.amount, description: e.description.trim(),
      account_id: e.accountId || null, receipt_path: e.receiptPath || null, private: !!e.private }));
    return get().refresh();
  },

  reviewExpense: async (id, approve, note) => {
    if (!supabaseEnabled) {
      const d = demoRead();
      d.expenses = d.expenses.map((x) => (x.id === id ? { ...x, status: approve ? 'approved' : 'rejected', approvedBy: me(), approvedAt: new Date().toISOString(), reviewNote: note } : x));
      demoWrite(d); return get().refresh();
    }
    check(await supabase.rpc('review_company_expense', { p_id: id, p_approve: approve, p_note: note ?? null }));
    return get().refresh();
  },

  payExpense: async (id, accountId, paidOn) => {
    if (!supabaseEnabled) {
      if (demoClosed(paidOn)) throw new Error('That month is closed.');
      const d = demoRead();
      d.expenses = d.expenses.map((x) => (x.id === id ? { ...x, status: 'paid', accountId, paidOn, paidBy: me() } : x));
      demoWrite(d); return get().refresh();
    }
    check(await supabase.from('company_expenses').update({ status: 'paid', account_id: accountId, paid_on: paidOn }).eq('id', id));
    return get().refresh();
  },

  deleteExpense: async (id) => {
    if (!supabaseEnabled) { const d = demoRead(); d.expenses = d.expenses.filter((x) => x.id !== id); demoWrite(d); return get().refresh(); }
    check(await supabase.from('company_expenses').delete().eq('id', id));
    return get().refresh();
  },

  addTransfer: async (t) => {
    if (t.fromAccount === t.toAccount) throw new Error('Choose two different accounts.');
    if (!supabaseEnabled) {
      if (demoClosed(t.date)) throw new Error('That month is closed — use a date in an open month.');
      const d = demoRead(); d.transfers = [{ ...t, id: uid('tr'), byName: me() }, ...d.transfers]; demoWrite(d); return get().refresh();
    }
    check(await supabase.from('account_transfers').insert({ id: uid('tr'), date: t.date, from_account: t.fromAccount, to_account: t.toAccount, amount: t.amount, note: t.note || null }));
    return get().refresh();
  },

  closeMonth: async (period, summary, note) => {
    if (!supabaseEnabled) { const d = demoRead(); d.closes = [{ period, closedBy: me(), closedAt: new Date().toISOString(), summary, note }, ...d.closes.filter((c) => c.period !== period)]; demoWrite(d); return get().refresh(); }
    check(await supabase.from('month_closes').insert({ period, closed_by: me(), summary, note: note || null }));
    return get().refresh();
  },

  reopenMonth: async (period) => {
    if (!supabaseEnabled) { const d = demoRead(); d.closes = d.closes.filter((c) => c.period !== period); demoWrite(d); return get().refresh(); }
    check(await supabase.from('month_closes').delete().eq('period', period));
    return get().refresh();
  },

  setPayoutAccount: async (settlementId, accountId) => {
    if (!supabaseEnabled) {
      const key = 'crac-demo-settlements';
      try { const l = JSON.parse(localStorage.getItem(key) ?? '[]'); localStorage.setItem(key, JSON.stringify(l.map((s: { id: string }) => (s.id === settlementId ? { ...s, payAccountId: accountId } : s)))); } catch { /* */ }
      return;
    }
    check(await supabase.rpc('set_settlement_account', { p_id: settlementId, p_account: accountId }));
  },
}));

/** The account a payment went to: the one recorded, else the method's usual account */
export const accountFor = (method: string | undefined, accountId: string | undefined, s: FinanceSettings) =>
  accountId || (method ? s.methodAccounts[method] : undefined) || undefined;
