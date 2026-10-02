import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { Price } from '../context/AppContext';
import { useFleet } from '../lib/fleet';
import { CONTACT } from '../data/site';

const EVENT = 'vehicle:open';

/** Open the details window for a listed vehicle (from a card, the hero, …). */
export function openVehicle(id) {
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}

/*
 * Vehicle details: the REAL photos uploaded in the admin ("Vehicle photos"),
 * falling back to the hero image / cut-out if none were added yet.
 */
export default function VehicleModal() {
  const { vehicles } = useFleet();
  const [id, setId] = useState(null);
  const [index, setIndex] = useState(0);
  const v = vehicles.find(x => x.id === id);

  const photos = v ? (v.photos.length ? v.photos : [v.heroImg, v.cutoutImg].filter(Boolean)) : [];
  const close = () => setId(null);
  const step = d => setIndex(i => (i + d + photos.length) % photos.length);

  useEffect(() => {
    const onOpen = e => { setId(e.detail); setIndex(0); };
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
          </div>
          <h2 className="vmodal__name">{v.name}</h2>
          <p className="loc"><Icon name="pin" size="sm" />{v.location}</p>

          <ul className="vmodal__specs">
            <li><Icon name="gear" /><span><small>Transmission</small>{v.transmission}</span></li>
            <li><Icon name={v.fuelIcon} /><span><small>Fuel</small>{v.fuel}</span></li>
            <li><Icon name="seat" /><span><small>Seats</small>{v.seats}</span></li>
          </ul>

          <div className="vmodal__price">
            <small>From</small>
            <Price lkr={v.price} as="strong" /><span>/ day</span>
          </div>
          <p className="vmodal__note">Final price depends on your dates and pickup location — you'll see the full total before you pay.</p>

          <div className="vmodal__ctas">
            <a href="#search" className="btn btn--red" onClick={close}>Book Now <Icon name="arrow" size="sm" /></a>
            <a href={`tel:${CONTACT.tel}`} className="btn btn--ghost"><Icon name="phone" size="sm" />Ask about this car</a>
          </div>
        </div>
      </div>
    </div>
  );
}
