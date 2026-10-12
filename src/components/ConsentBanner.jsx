import { useEffect, useState } from 'react';
import { CONSENT_OPEN_EVENT, analyticsEnabled, denyConsent, getConsent, grantConsent } from '../lib/analytics';

/**
 * Asks before any analytics runs. Shown on the live site until the visitor chooses;
 * "Cookie settings" in the footer opens it again. Declining loads nothing from Google.
 */
export default function ConsentBanner() {
  const [open, setOpen] = useState(() => analyticsEnabled() && !getConsent());

  useEffect(() => {
    const reopen = () => { if (analyticsEnabled()) setOpen(true); };
    window.addEventListener(CONSENT_OPEN_EVENT, reopen);
    return () => window.removeEventListener(CONSENT_OPEN_EVENT, reopen);
  }, []);

  if (!open) return null;
  const choose = (accept) => { (accept ? grantConsent : denyConsent)(); setOpen(false); };

  return (
    <div className="consent" role="dialog" aria-live="polite" aria-label="Cookie preferences">
      <p className="consent__text">
        We'd like to use Google Analytics cookies to see which pages and vehicles are most useful, so we can improve the site.
        No advertising, and we never share your name or contact details.
      </p>
      <div className="consent__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => choose(false)}>Decline</button>
        <button type="button" className="btn btn--red btn--sm" onClick={() => choose(true)}>Accept</button>
      </div>
    </div>
  );
}
