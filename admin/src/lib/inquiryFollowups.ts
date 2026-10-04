import { supabase, supabaseEnabled } from './supabase';
import type { Inquiry } from '../types';

/** One contact with a customer about an inquiry (table inquiry_followups) */
export interface FollowUp {
  id: string;
  inquiryId: string;
  channel: string;
  outcome: string;
  response?: string;
  nextFollowUp?: string;   // yyyy-MM-dd
  staff?: string;
  createdAt: string;
}

export const CHANNELS = ['Call', 'WhatsApp', 'Email', 'SMS', 'In person'] as const;

/** Outcome of a contact, with the tone used for its badge */
export const OUTCOMES: { value: string; tone: 'green' | 'amber' | 'red' | 'grey' | 'blue' }[] = [
  { value: 'Confirmed — ready to book', tone: 'green' },
  { value: 'Quote sent', tone: 'blue' },
  { value: 'Interested', tone: 'blue' },
  { value: 'Requested changes', tone: 'amber' },
  { value: 'Needs more time', tone: 'amber' },
  { value: 'No answer', tone: 'grey' },
  { value: 'Not interested', tone: 'red' },
];

const fromDb = (r: Record<string, unknown>): FollowUp => ({
  id: r.id as string,
  inquiryId: r.inquiry_id as string,
  channel: r.channel as string,
  outcome: r.outcome as string,
  response: (r.response as string) ?? undefined,
  nextFollowUp: (r.next_follow_up as string) ?? undefined,
  staff: (r.staff as string) ?? undefined,
  createdAt: r.created_at as string,
});

/** All follow-ups (newest first). Returns null if the table doesn't exist yet. */
export async function loadFollowUps(): Promise<FollowUp[] | null> {
  if (!supabaseEnabled) return null;   // contact log lives in Supabase only
  const { data, error } = await supabase.from('inquiry_followups').select('*').order('created_at', { ascending: false });
  if (error) {
    if (/inquiry_followups/.test(error.message)) return null;
    throw error;
  }
  return (data ?? []).map(fromDb);
}

export async function addFollowUp(f: Omit<FollowUp, 'id' | 'createdAt'>): Promise<FollowUp> {
  const { data, error } = await supabase.from('inquiry_followups').insert({
    inquiry_id: f.inquiryId, channel: f.channel, outcome: f.outcome,
    response: f.response || null, next_follow_up: f.nextFollowUp || null, staff: f.staff || null,
  }).select().single();
  if (error) throw error;
  return fromDb(data);
}

export async function deleteFollowUp(id: string) {
  const { error } = await supabase.from('inquiry_followups').delete().eq('id', id);
  if (error) throw error;
}

/* ---------- Inquiry helpers ---------- */

export type Stage = 'New' | 'Contacted' | 'Follow-up due';

const today = () => new Date().toISOString().slice(0, 10);

/** Where a pending inquiry is in the follow-up process */
export function stageOf(inq: Inquiry, list: FollowUp[]): { stage: Stage; last?: FollowUp; due?: string } {
  const mine = list.filter((f) => f.inquiryId === inq.id);
  const last = mine[0];
  if (!last) return { stage: 'New' };
  const due = last.nextFollowUp;
  return { stage: due && due <= today() ? 'Follow-up due' : 'Contacted', last, due };
}

/**
 * Website booking requests store their details as "Key: value" lines in notes
 * (see submit_booking_request in website.sql). Pull them out for display.
 */
export function parseRequest(notes?: string) {
  const out: Record<string, string> = {};
  if (!notes) return { fields: out, reference: undefined as string | undefined, other: '' };
  const other: string[] = [];
  let reference: string | undefined;
  notes.split('\n').forEach((line) => {
    const ref = line.match(/Website booking request (CRC-[A-Z0-9]+)/);
    if (ref) { reference = ref[1]; return; }
    const m = line.match(/^(Type|Pickup|Return|Days|Email|Country|Message): (.*)$/);
    if (m) out[m[1]] = m[2];
    else if (line.trim()) other.push(line);
  });
  return { fields: out, reference, other: other.join('\n') };
}

/** International digits for wa.me / tel: (Sri Lankan 07x… → 947x…) */
export const intlDigits = (phone: string) => {
  const d = phone.replace(/\D/g, '');
  return d.startsWith('0') ? `94${d.slice(1)}` : d;
};

