import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';
import { usePopover } from './Dropdown';

const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];
const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return { y, m: m - 1, d }; };
const pretty = s => new Date(s + 'T00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

/**
 * Styled calendar date picker.
 * value / min: 'YYYY-MM-DD'. busy: [{ start_date, end_date }] — shown crossed out and not selectable.
 * rangeStart / rangeEnd highlight the trip on the calendar.
 */
export function DatePicker({ value, onChange, min, busy = [], rangeStart, rangeEnd, ariaLabel }) {
  const { open, setOpen, ref } = usePopover();
  const [view, setView] = useState(() => parse(value || min));

  useEffect(() => { if (open && value) setView(parse(value)); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const isBusy = d => busy.some(b => b.start_date <= d && b.end_date >= d);

  const cells = useMemo(() => {
    const first = new Date(view.y, view.m, 1);
    const lead = (first.getDay() + 6) % 7; // Monday first
    const days = new Date(view.y, view.m + 1, 0).getDate();
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => iso(view.y, view.m, i + 1))];
  }, [view]);

  const minMonth = min ? parse(min) : null;
  const canPrev = !minMonth || view.y > minMonth.y || (view.y === minMonth.y && view.m > minMonth.m);
  const shift = n => setView(v => { const d = new Date(v.y, v.m + n, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const title = new Date(view.y, view.m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div className={`dd dp${open ? ' is-open' : ''}`} ref={ref}>
      <button type="button" className="dd__btn" aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}>
        <Icon name="calendar" size="sm" className="dd__lead" />
        <span className="dd__value">{value ? pretty(value) : 'Choose date'}</span>
        <Icon name="down" size="sm" className="dd__chev" />
      </button>

      {open && (
        <div className="dd__pop dp__pop" role="dialog" aria-label="Calendar">
          <div className="dp__head">
            <button type="button" className="dp__nav" onClick={() => shift(-1)} disabled={!canPrev} aria-label="Previous month"><Icon name="left" size="sm" /></button>
            <b>{title}</b>
            <button type="button" className="dp__nav" onClick={() => shift(1)} aria-label="Next month"><Icon name="right" size="sm" /></button>
          </div>
          <div className="dp__grid">
            {WEEKDAYS.map(w => <span key={w} className="dp__wd">{w}</span>)}
            {cells.map((d, i) => {
              if (!d) return <span key={`e${i}`} />;
              const past = min && d < min;
              const taken = isBusy(d);
              const inRange = rangeStart && rangeEnd && d > rangeStart && d < rangeEnd;
              const cls = ['dp__day',
                d === value && 'is-selected', (d === rangeStart || d === rangeEnd) && 'is-edge', inRange && 'is-range',
                taken && 'is-busy', past && 'is-past', d === iso(new Date().getFullYear(), new Date().getMonth(), new Date().getDate()) && 'is-today',
              ].filter(Boolean).join(' ');
              return (
                <button key={d} type="button" className={cls} disabled={past || taken}
                        title={taken ? 'Already booked' : undefined}
                        onClick={() => { onChange(d); setOpen(false); }}>
                  {Number(d.slice(8))}
                </button>
              );
            })}
          </div>
          {busy.length > 0 && <p className="dp__legend"><i />Already booked</p>}
        </div>
      )}
    </div>
  );
}

/* 12-hour helpers */
const to12 = v => {
  const [h, m] = (v || '10:00').split(':').map(Number);
  return { h12: ((h + 11) % 12) + 1, m, pm: h >= 12 };
};
const to24 = (h12, m, pm) => `${pad((h12 % 12) + (pm ? 12 : 0))}:${pad(m)}`;
export const label12 = v => { const t = to12(v); return `${t.h12}:${pad(t.m)} ${t.pm ? 'PM' : 'AM'}`; };

const DIAL = 220;            // dial size (px)
const R = 84;                // radius the numbers sit on
const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
const MINUTES = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55];

/* Analog clock face: tap or drag the hand to a number */
function ClockDial({ mode, value, onPick, onRelease }) {
  const items = mode === 'hour' ? HOURS : MINUTES;
  const index = mode === 'hour' ? value % 12 : Math.round(value / 5) % 12;
  const angle = index * 30; // degrees, 0 = 12 o'clock
  const dragging = useRef(false);

  const pickFrom = e => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    const deg = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
    const i = Math.round(deg / 30) % 12;
    onPick(mode === 'hour' ? HOURS[i] : MINUTES[i]);
  };

  return (
    <div className="clock" style={{ width: DIAL, height: DIAL }}
         onPointerDown={e => { dragging.current = true; e.currentTarget.setPointerCapture(e.pointerId); pickFrom(e); }}
         onPointerMove={e => dragging.current && pickFrom(e)}
         onPointerUp={() => { if (dragging.current) { dragging.current = false; onRelease(); } }}>
      <span className="clock__hand" style={{ height: R, transform: `rotate(${angle}deg)` }}><i /></span>
      <span className="clock__pin" />
      {items.map((n, i) => {
        const a = (i * 30 - 90) * Math.PI / 180;
        return (
          <span key={n} className={`clock__num${i === index ? ' is-on' : ''}`}
                style={{ left: DIAL / 2 + R * Math.cos(a), top: DIAL / 2 + R * Math.sin(a) }}>
            {mode === 'hour' ? n : pad(n)}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Time picker: AM / PM first, then the hour on a clock face, then the minutes (5-minute steps).
 * value / onChange use 24-hour 'HH:mm'.
 */
export function TimePicker({ value, onChange, ariaLabel }) {
  const { open, setOpen, ref } = usePopover();
  const [draft, setDraft] = useState(() => to12(value));
  const [mode, setMode] = useState('hour');

  useEffect(() => { if (open) { setDraft(to12(value)); setMode('hour'); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const minute = Math.round(draft.m / 5) * 5 % 60;
  const commit = () => { onChange(to24(draft.h12, minute, draft.pm)); setOpen(false); };

  return (
    <div className={`dd tp${open ? ' is-open' : ''}`} ref={ref}>
      <button type="button" className="dd__btn" aria-haspopup="dialog" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}>
        <Icon name="clock" size="sm" className="dd__lead" />
        <span className="dd__value">{label12(value)}</span>
        <Icon name="down" size="sm" className="dd__chev" />
      </button>

      {open && (
        <div className="dd__pop tp__pop" role="dialog" aria-label="Choose time">
          {/* Live readout — tap the hour or minutes to edit that part */}
          <div className="tp__readout">
            <button type="button" className={mode === 'hour' ? 'is-on' : ''} onClick={() => setMode('hour')}>{draft.h12}</button>
            <span>:</span>
            <button type="button" className={mode === 'minute' ? 'is-on' : ''} onClick={() => setMode('minute')}>{pad(minute)}</button>
            <div className="tp__ampm" role="radiogroup" aria-label="AM or PM">
              {[false, true].map(isPm => (
                <button key={String(isPm)} type="button" role="radio" aria-checked={draft.pm === isPm}
                        className={draft.pm === isPm ? 'is-on' : ''} onClick={() => setDraft(d => ({ ...d, pm: isPm }))}>
                  {isPm ? 'PM' : 'AM'}
                </button>
              ))}
            </div>
          </div>

          {(() => {
            const h24 = (draft.h12 % 12) + (draft.pm ? 12 : 0);
            return (h24 >= 23 || h24 < 5) && (
              <p className="tp__warn">⚠ {draft.h12 === 12 && !draft.pm ? '12 AM is midnight. ' : ''}Late-night time — did you mean {draft.pm ? 'AM' : 'PM'}?</p>
            );
          })()}
          <p className="tp__step">{mode === 'hour' ? 'Select the hour' : 'Select the minutes'}</p>
          <ClockDial
            mode={mode}
            value={mode === 'hour' ? draft.h12 : minute}
            onPick={n => setDraft(d => (mode === 'hour' ? { ...d, h12: n } : { ...d, m: n }))}
            onRelease={() => mode === 'hour' && setMode('minute')}
          />

          <div className="tp__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setOpen(false)}>Cancel</button>
            <button type="button" className="btn btn--red btn--sm" onClick={commit}>Set {draft.h12}:{pad(minute)} {draft.pm ? 'PM' : 'AM'}</button>
          </div>
        </div>
      )}
    </div>
  );
}
