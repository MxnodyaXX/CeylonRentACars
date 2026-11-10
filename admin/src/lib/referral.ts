// Resolves the rupee amount paid to a referrer.
// Fixed → the entered rupees; Percent → that % of the given amount (the booking/final total).
export function resolveReferralFee(
  feeType: 'fixed' | 'percent' | undefined,
  feeValue: number | undefined,
  amount: number,
): number {
  if (!feeValue || feeValue <= 0) return 0;
  return feeType === 'percent'
    ? Math.round(amount * (feeValue / 100))
    : Math.round(feeValue);
}

const rsN = (n: number) => `Rs ${Math.round(n).toLocaleString('en-LK')}`;
const pctText = (p: number) => (Number.isInteger(p) ? String(p) : p.toFixed(1).replace(/\.0$/, ''));

/**
 * How a booking's referral fee was worked out, for the booking details:
 *   "18% of the Rs 260,000 rental"  (saved as a percentage)
 *   "Fixed amount agreed with the referrer"
 * Older bookings only kept the final amount, so for those it shows what the fee works out to.
 */
export function referralFeeWorking(b: { referralFee?: number; referralFeeType?: 'fixed' | 'percent'; referralFeeValue?: number; totalAmount: number }) {
  const fee = b.referralFee ?? 0;
  if (fee <= 0) return undefined;
  const base = b.totalAmount;
  if (b.referralFeeType === 'percent' && b.referralFeeValue && Math.round(base * (b.referralFeeValue / 100)) === fee) {
    return `${pctText(b.referralFeeValue)}% of the ${rsN(base)} rental`;
  }
  if (b.referralFeeType === 'fixed' && b.referralFeeValue && Math.round(b.referralFeeValue) === fee) {
    return `Fixed amount agreed with the referrer${base ? ` (${pctText(Math.round((fee / base) * 1000) / 10)}% of the ${rsN(base)} rental)` : ''}`;
  }
  if (!base) return undefined;
  const p = (fee / base) * 100;
  const round = Math.abs(p - Math.round(p * 2) / 2) < 0.01;
  return `${round ? '' : 'about '}${pctText(round ? Math.round(p * 2) / 2 : Math.round(p * 10) / 10)}% of the ${rsN(base)} rental`;
}
