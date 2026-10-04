import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { Price } from '../context/AppContext';
import { fetchReviews, useCatalog, useFleet } from '../lib/fleet';
import { useRoute } from '../lib/router';
import { CONTACT } from '../data/site';

const EVENT = 'vehicle:open';

/** Open the details window: pass a vehicle object, or the id of a website-listed vehicle. */
export function openVehicle(vehicleOrId) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: vehicleOrId }));
}

const fmt = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 1 });

function Stars({ value, size = 'sm' }) {
  return (
    <span className="stars" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map(n => <Icon key={n} name="star" size={size} className={n <= Math.round(value) ? 'is-on' : ''} />)}
    </span>
  );
}

/* Customer reviews (published in the admin; reviewer shown as "First L.").
   Compact slider under the spec cards: one small card at a time, arrows + swipe. */
function Reviews({ vehicle }) {
  const [list, setList] = useState(null);
  const [index, setIndex] = useState(0);
  const trackRef = useRef(null);

  useEffect(() => {
    let live = true;
    setList(null); setIndex(0);
    fetchReviews(vehicle.id).then(r => live && setList(r));
    return () => { live = false; };
  }, [vehicle.id]);

  // Keep the counter in sync when the visitor swipes the track
  const onScroll = () => {
    const el = trackRef.current;
    if (el) setIndex(Math.round(el.scrollLeft / el.clientWidth));
  };
  const go = d => {
    const el = trackRef.current;
    if (!el || !list?.length) return;
    const next = (index + d + list.length) % list.length;
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    setIndex(next);
  };

  const count = list?.length ?? 0;
  const avg = count ? list.reduce((a, r) => a + r.rating, 0) / count : 0;

  return (
    <section className="vrevs" aria-label="Customer reviews">
      <div className="vrevs__head">
        <h3>Reviews</h3>
        {count > 0 && (
          <span className="vrevs__score"><Icon name="star" size="sm" /><b>{avg.toFixed(1)}</b><small>({count})</small></span>
        )}
        {count > 1 && (
          <div className="vrevs__nav">
            <span className="vrevs__pos">{index + 1}/{count}</span>
            <button type="button" aria-label="Previous review" onClick={() => go(-1)}><Icon name="left" size="sm" /></button>
            <button type="button" aria-label="Next review" onClick={() => go(1)}><Icon name="right" size="sm" /></button>
          </div>
        )}
      </div>

      {list === null ? (
        <p className="vrevs__empty">Loading reviews…</p>
      ) : count === 0 ? (
        <p className="vrevs__empty">No reviews yet — be one of the first to drive this {vehicle.name}.</p>
      ) : (
        <ul className="vrevs__track" ref={trackRef} onScroll={onScroll}>
          {list.map(r => (
            <li key={r.id} className="vrev">
              <div className="vrev__top">
                <span className="vrev__avatar" aria-hidden="true">{r.reviewer.slice(0, 1)}</span>
                <b>{r.reviewer}</b>
                <Stars value={r.rating} size="xs" />
                <small>{new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}</small>
              </div>
              {r.comment && <p title={r.comment}>{r.comment}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/*
 * Vehicle details: the REAL photos uploaded in the admin ("Vehicle photos"),
 * falling back to the hero image / cut-out if none were added yet.
 */
export default function VehicleModal() {
  const { vehicles } = useFleet();
  const { vehicles: fleet } = useCatalog();     // whole fleet, for shared links
  // Shared link: /vehicles?vehicle=<id> opens that vehicle's details
  const { search } = useRoute();
  const linked = new URLSearchParams(search).get('vehicle');
  // Opened with a vehicle object (popular list) or an id (hero, which uses the website list)
  const [opened, setOpened] = useState(null);
  const [index, setIndex] = useState(0);
  useEffect(() => { if (linked) { setOpened(linked); setIndex(0); } }, [linked]);
  const v = opened && typeof opened === 'object' ? opened : (vehicles.find(x => x.id === opened) ?? fleet.find(x => x.id === opened));

  const photos = v ? (v.photos.length ? v.photos : [v.heroImg, v.cutoutImg].filter(Boolean)) : [];
  const close = () => {
    setOpened(null);
    // Drop ?vehicle=… so a refresh doesn't reopen it
    const url = new URL(window.location.href);
    if (url.searchParams.has('vehicle')) { url.searchParams.delete('vehicle'); history.replaceState(null, '', url.pathname + url.search + url.hash); }
  };
  const step = d => setIndex(i => (i + d + photos.length) % photos.length);

  useEffect(() => {
    const onOpen = e => { setOpened(e.detail); setIndex(0); };
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!v) return;
    document.body.style.overflow = 'hidden';
    const onKey = e => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowRight' && photos.length > 1) step(1);
      if (e.key === 'ArrowLeft' && photos.length > 1) step(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = ''; document.removeEventListener('keydown', onKey); };
  }, [v, photos.length]);

  if (!v) return null;
  const current = photos[Math.min(index, photos.length - 1)];
  // Cut-outs sit on a lit stage; full photos fill the frame. The hero source was
  // already classified when loading; the admin-image slot is a cut-out by definition.
  const isCutout = current === v.heroSrc ? !!v.cutout : current === v.cutoutImg;

  return (
    <div className="vmodal" role="dialog" aria-modal="true" aria-label={v.name} onClick={e => e.target === e.currentTarget && close()}>
      <div className="vmodal__panel">
        <button className="vmodal__close icon-btn" aria-label="Close" onClick={close}><Icon name="x" /></button>

        {/* Gallery */}
        <div className="vmodal__gallery">
          <div className={`vmodal__main${isCutout ? ' is-cutout' : ''}`}>
            {current
              ? <img key={current} src={current} alt={`${v.name} — photo ${index + 1}`} />
              : <div className="car__noimg"><Icon name="car" /></div>}
            {photos.length > 1 && (
              <>
                <button className="vmodal__nav vmodal__nav--prev" aria-label="Previous photo" onClick={() => step(-1)}><Icon name="left" /></button>
                <button className="vmodal__nav vmodal__nav--next" aria-label="Next photo" onClick={() => step(1)}><Icon name="right" /></button>
                <span className="vmodal__count">{index + 1} / {photos.length}</span>
              </>
            )}
          </div>
          {photos.length > 1 && (
            <div className="vmodal__thumbs">
              {photos.map((p, i) => (
                <button key={p} className={`vmodal__thumb${i === index ? ' is-active' : ''}`} onClick={() => setIndex(i)} aria-label={`Photo ${i + 1}`}>
                  <img src={p} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details */}
        <div className="vmodal__info">
          <div className="vmodal__tags">
            <span className="cat">{v.catLabel}</span>
            {v.badge && <span className="vmodal__badge">{v.badge}</span>}
            <span className="verified"><Icon name="badge" size="xs" />Verified</span>
            {v.hires != null && (
              <span className={`hires${v.hires ? '' : ' hires--none'}`}><Icon name="check" size="sm" />{v.hires} completed {v.hires === 1 ? 'trip' : 'trips'}</span>
            )}
            {v.reviewCount > 0 && v.rating != null && (
              <span className="rating-tag"><Icon name="star" size="sm" />{v.rating.toFixed(1)} · {v.reviewCount} {v.reviewCount === 1 ? 'review' : 'reviews'}</span>
            )}
          </div>
          <h2 className="vmodal__name">{v.name}</h2>
          <p className="loc"><Icon name="pin" size="sm" />{v.location}</p>

          <ul className="vmodal__specs">
            {[
              ['gear', 'Transmission', v.transmission],
              [v.fuelIcon, 'Fuel', v.fuel],
              ['seat', 'Seats', v.seats],
              ['compass', 'Mileage', v.mileage != null ? `${fmt(v.mileage)} km` : null],
              ['spark', 'Fuel efficiency', v.kmpl != null ? `${fmt(v.kmpl)} km/L` : null],
              ['fuel', 'Fuel tank', v.tank != null ? `${fmt(v.tank)} L` : null],
            ].filter(([, , value]) => value != null && value !== '').map(([icon, label, value]) => (
              <li key={label}><Icon name={icon} /><span><small>{label}</small>{value}</span></li>
            ))}
          </ul>

          <Reviews vehicle={v} />

          <div className="vmodal__price">
            <small>From</small>
            <Price lkr={v.price} as="strong" /><span>/ day</span>
          </div>
          <p className="vmodal__note">Final price depends on your dates and pickup location — you'll see the full total before you pay.</p>

          <div className="vmodal__ctas">
            <a href={`/book?v=${encodeURIComponent(v.id)}`} className="btn btn--red" onClick={close}>Book Now <Icon name="arrow" size="sm" /></a>
            <a href={`tel:${CONTACT.tel}`} className="btn btn--ghost"><Icon name="phone" size="sm" />Ask about this car</a>
          </div>
        </div>

      </div>
    </div>
  );
}
