import { Icon } from './Icon';
import { CurrencySelect, Logo } from './Header';
import { CONTACT, FOOTER_COLUMNS, waLink } from '../data/site';

const SOCIALS = [
  { icon: 'fb', label: 'Facebook' },
  { icon: 'ig', label: 'Instagram' },
  { icon: 'yt', label: 'YouTube' },
  { icon: 'chat', label: 'WhatsApp' },
];

const PAYMENTS = ['VISA', 'Mastercard', 'AMEX', 'Apple Pay', 'Google Pay'];

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer__lion" aria-hidden="true" />
      <div className="container">
        <div className="footer__cta">
          <div>
            <h2>Ready to explore the island?</h2>
            <p>Browse hundreds of verified vehicles — no account needed until you book.</p>
          </div>
          <div className="footer__cta-btns">
            <a href="#search" className="btn btn--red btn--lg">Find a Vehicle</a>
            <a href="#" className="btn btn--ghost btn--lg">List Your Vehicle</a>
          </div>
        </div>

        <div className="footer__grid">
          <div className="footer__brand">
            <Logo variant="full" />
            <p>The trusted marketplace for verified vehicle rentals across Sri Lanka.</p>
            <ul className="contact">
              <li><Icon name="mail" size="sm" /><a href={`mailto:${CONTACT.email}`}>{CONTACT.email}</a></li>
              <li><Icon name="phone" size="sm" /><a href={`tel:${CONTACT.tel}`}>{CONTACT.phone}</a></li>
              <li><Icon name="chat" size="sm" /><a href={waLink()} target="_blank" rel="noreferrer">WhatsApp {CONTACT.whatsapp}</a></li>
            </ul>
            <div className="socials">
              {SOCIALS.map(s => s.icon === 'chat'
                ? <a key={s.icon} href={waLink()} target="_blank" rel="noreferrer" aria-label={s.label}><Icon name={s.icon} /></a>
                : <a key={s.icon} href="#" aria-label={s.label}><Icon name={s.icon} /></a>)}
            </div>
          </div>

          {FOOTER_COLUMNS.map(col => (
            <div className="footer__col" key={col.title}>
              <h4>{col.title}</h4>
              {col.links.map(([label, href]) => <a key={label} href={href}>{label}</a>)}
            </div>
          ))}
        </div>

        <div className="footer__bar">
          <div className="payments" aria-label="Accepted payments">
            {PAYMENTS.map(p => <span key={p} className="pay">{p}</span>)}
          </div>
          <CurrencySelect long className="currency--footer" />
        </div>

        <p className="footer__legal">© {new Date().getFullYear()} Ceylon Rent A Cars — Vehicle Rentals Across Sri Lanka</p>
      </div>
    </footer>
  );
}
