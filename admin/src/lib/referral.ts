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
