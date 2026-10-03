import { useState } from 'react';
import { Icon } from './Icon';
import SectionHead from './SectionHead';
import { CATEGORIES, CONTACT, FAQS, FEATURES, LOCATIONS, STATS, STEPS } from '../data/site';
import { useServiceReviews } from '../lib/fleet';
import { Price } from '../context/AppContext';

export function Categories() {
  return (
    <section className="section" id="categories">
      <div className="container">
        <SectionHead row eyebrow="Categories" title="Choose Your Ride" text="From city hatchbacks to chauffeur-driven vans for the whole family.">
          <a href="/vehicles" className="link-arrow">View all vehicles <Icon name="arrow" size="sm" /></a>
        </SectionHead>

        <div className="cat-layout">
          <div className="cats">
            {CATEGORIES.map(c => (
              <a key={c.name} href={`/vehicles${c.type ? `?type=${c.type}` : ''}`} className={`cat-card${c.featured ? ' cat-card--red' : ''}`} data-reveal>
                <div className="cat-card__img"><img src={c.img} alt="" loading="lazy" /></div>
                <h3>{c.name}</h3>
                <p>From <Price lkr={c.price} as="b" /> / day</p>
                <span className="cat-card__btn">View Cars <Icon name="arrow" size="sm" /></span>
              </a>
            ))}
          </div>

          <aside className="stats glass" data-reveal>
            {STATS.map(s => (
              <div className="stat" key={s.label}>
                <span className="stat__ic"><Icon name={s.icon} /></span>
                <div><strong>{s.value}</strong><span>{s.label}</span></div>
              </div>
            ))}
          </aside>
        </div>
      </div>
    </section>
  );
}

export function Locations() {
  return (
    <section className="section" id="locations">
      <div className="container">
        <SectionHead row eyebrow="Pickup points" title="Popular Pickup Locations" text="Collect your vehicle where your trip begins — airport, city or coast." />
        <div className="places">
          {LOCATIONS.map(l => (
            <a key={l.name} href="#search" className={`place${l.size ? ` place--${l.size}` : ''}`} data-reveal>
              <img src={l.img} alt={l.alt || l.name} loading="lazy" />
              <div className="place__info">
                {l.tag && <span className="place__tag"><Icon name="plane" size="xs" />{l.tag}</span>}
                <h3>{l.name}</h3>
                <p>{l.count}</p>
              </div>
              <span className="place__go"><Icon name="arrow" /></span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className="section" id="how">
      <div className="container">
        <SectionHead center eyebrow="Simple & secure" title="How It Works" text="From search to the open road in five easy steps." />
        <ol className="steps">
          {STEPS.map((s, i) => (
            <li className="step" key={s.title} data-reveal>
              <span className="step__ic"><Icon name={s.icon} /><i>{i + 1}</i></span>
              <h3>{s.title}</h3>
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function WhyUs() {
  return (
    <section className="section why" id="why">
      <div className="why__lion" aria-hidden="true" />
      <div className="container why__inner">
        <div className="why__intro" data-reveal>
          <span className="eyebrow">Why Ceylon Rent A Cars</span>
          <h2>Travel with total<br /><span className="text-red">peace of mind.</span></h2>
          <p>Every owner and every vehicle is checked before it appears on the site, and every booking is protected from payment to drop-off.</p>
          <a href="#how" className="btn btn--red">See how we verify <Icon name="arrow" /></a>
        </div>
        <div className="features">
          {FEATURES.map(f => (
            <div className="feature" key={f.title} data-reveal>
              <span className="feature__ic"><Icon name={f.icon} /></span>
              <h3>{f.title}</h3>
              <p>{f.text}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export function Promo() {
  return (
    <section className="section section--tight" id="deals">
      <div className="container">
        <div className="promo" data-reveal>
          <img src="/img/sigiriya.jpg" alt="" className="promo__bg" loading="lazy" />
          <div className="promo__content">
            <span className="pill pill--light"><Icon name="spark" size="sm" />Weekly Deals</span>
            <h2>Explore Sri Lanka for Longer</h2>
            <p>Save more on weekly rentals. Book 7 days or more and get up to <b>20% off</b> the daily rate.</p>
            <a href="#search" className="btn btn--white btn--lg">View Weekly Deals <Icon name="arrow" /></a>
          </div>
          <div className="promo__badge"><strong>-20%</strong><span>7+ days</span></div>
        </div>
      </div>
    </section>
  );
}

export function Reviews() {
  // Real, admin-approved reviews from past customers (feedback page → admin Feedback → published)
  const { reviews, status } = useServiceReviews();
  const avg = reviews.length ? reviews.reduce((a, r) => a + r.rating, 0) / reviews.length : 0;
  const shown = reviews.slice(0, 6);

  return (
    <section className="section" id="reviews">
      <div className="container">
        <SectionHead
          row
          eyebrow="Reviews"
          title="What Our Customers Say"
          text={reviews.length
            ? `Rated ${avg.toFixed(1)} out of 5 by ${reviews.length} ${reviews.length === 1 ? 'customer' : 'customers'}.`
            : 'Honest feedback from travellers who rented with us.'}
        >
          <a href="/feedback" className="btn btn--ghost">Rented with us? Leave a review <Icon name="arrow" size="sm" /></a>
        </SectionHead>

        {status === 'ready' && reviews.length === 0 && (
          <div className="fleet-empty" data-reveal>
            <span className="fleet-empty__icon"><Icon name="star" /></span>
            <h3>Be the first to review us</h3>
            <p>Travelled with Ceylon Rent A Cars? Rate our service and your vehicle — it takes a minute.</p>
            <div className="fleet-empty__ctas"><a href="/feedback" className="btn btn--red">Share your feedback <Icon name="arrow" size="sm" /></a></div>
          </div>
        )}

        {shown.length > 0 && (
          <div className="reviews">
            {shown.map((r, i) => (
              <figure className="review" key={r.id} data-reveal>
                <div className="review__stars" aria-label={`${r.rating} out of 5 stars`}>
                  {Array.from({ length: 5 }, (_, n) => <Icon key={n} name="star" className={n < r.rating ? '' : 'is-off'} />)}
                </div>
                <blockquote>{r.comment ? `“${r.comment}”` : `Rated our service ${r.rating} out of 5.`}</blockquote>
                <figcaption>
                  <span className="avatar" style={{ '--h': [350, 10, 0, 355, 5, 345][i % 6] }}>
                    {r.reviewer.split(' ').map(p => p[0]).join('').slice(0, 2).toUpperCase()}
                  </span>
                  <span><b>{r.reviewer}</b><small>{[r.country, r.vehicle].filter(Boolean).join(' · ') || 'Verified customer'}</small></span>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function Faq() {
  const [open, setOpen] = useState(0);
  return (
    <section className="section" id="faq">
      <div className="container faq-layout">
        <div className="section-head" data-reveal>
          <span className="eyebrow">Support</span>
          <h2>Frequently Asked Questions</h2>
          <p>Everything visitors usually ask before renting a vehicle in Sri Lanka.</p>
          <div className="help-card glass">
            <span className="feature__ic"><Icon name="headset" /></span>
            <div>
              <b>Still have questions?</b>
              <p>Our team is available 24/7.</p>
              <a href={`tel:${CONTACT.tel}`} className="link-arrow">{CONTACT.phone} <Icon name="arrow" size="sm" /></a>
            </div>
          </div>
        </div>

        <div className="faq" data-reveal>
          {FAQS.map((f, i) => (
            <details key={f.q} open={open === i}>
              <summary onClick={e => { e.preventDefault(); setOpen(open === i ? -1 : i); }}>
                {f.q}<span className="faq__ic"><Icon name="plus" /></span>
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
