/** A payout statement's rental line without the rental figures ("CRC-… · 1–5 Oct · final bill Rs …" → "CRC-… · 1–5 Oct"),
 *  for owners when Settings → "Show rental amounts to owners" is off */
export const detailWithoutAmounts = (detail?: string) => (detail ?? '').split(' · ').slice(0, 2).join(' · ');
