import { supabase, supabaseEnabled } from './supabase';

/**
 * App-wide settings stored in the app_settings table (one row per key).
 * 'sms' — { enabled, note, updated_by }: pause every SMS (the send-sms Edge Function
 * enforces it for the reminder run too; the app checks it so it doesn't even try).
 */
export interface SmsSetting { enabled: boolean; note?: string; updated_by?: string; updated_at?: string }

const DEFAULT: SmsSetting = { enabled: true };
let cache: { value: SmsSetting; at: number } | null = null;
const TTL = 30_000;

/** Current SMS setting. Missing table / offline → enabled (the server still has the final say). */
export async function getSmsSetting(force = false): Promise<SmsSetting> {
  if (!supabaseEnabled) return DEFAULT;
  if (!force && cache && Date.now() - cache.at < TTL) return cache.value;
  const { data, error } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'sms').maybeSingle();
  if (error) throw error;
  const value: SmsSetting = data ? { ...DEFAULT, ...(data.value as SmsSetting), updated_at: data.updated_at as string } : DEFAULT;
  cache = { value, at: Date.now() };
  return value;
}

/** Is SMS paused? Never throws — if the setting can't be read, sending goes ahead as before. */
export async function smsPaused(): Promise<boolean> {
  try { return (await getSmsSetting()).enabled === false; } catch { return false; }
}

export async function saveSmsSetting(enabled: boolean, note: string, by: string): Promise<SmsSetting> {
  const value: SmsSetting = { enabled, note: note.trim() || undefined, updated_by: by };
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'sms', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  cache = null;
  return getSmsSetting(true);
}

/*
 * 'owner_amounts' — { show, note, updated_by }: may owner logins see rental amounts (rent, bills, revenue,
 * the company's commission)? Off → an owner sees only their own payouts and whether each is pending or received.
 * Enforced in the database too (security/32_owner_amounts_switch.sql). Missing row → shown (as before).
 */
export interface OwnerAmountsSetting { show: boolean; note?: string; updated_by?: string; updated_at?: string }

export async function getOwnerAmountsSetting(): Promise<OwnerAmountsSetting> {
  if (!supabaseEnabled) return { show: true };
  const { data, error } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'owner_amounts').maybeSingle();
  if (error) throw error;
  const v = (data?.value ?? {}) as Partial<OwnerAmountsSetting>;
  return { ...v, show: v.show !== false, updated_at: data?.updated_at as string | undefined };
}

export async function saveOwnerAmountsSetting(show: boolean, note: string, by: string): Promise<OwnerAmountsSetting> {
  const value: OwnerAmountsSetting = { show, note: note.trim() || undefined, updated_by: by };
  const { error } = await supabase.from('app_settings')
    .upsert({ key: 'owner_amounts', value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  return getOwnerAmountsSetting();
}
