import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Icon } from '../Icon';

/** Close a popover when clicking outside it or pressing Escape */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onDown = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('touchstart', onDown, { passive: true });
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('touchstart', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return { open, setOpen, ref };
}

/**
 * Styled dropdown replacing the native <select> (whose option list can't be themed).
 * options: [{ value, label, sub?, icon?, img?, disabled? }]
 * onInfo(option): shows a "Details" button on each option (e.g. open the vehicle's details)
 */
export default function Dropdown({
  value, onChange, options, placeholder = 'Select…', icon, disabled, searchable = false, ariaLabel, className = '', onInfo,
}) {
  const { open, setOpen, ref } = usePopover();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(-1);
  const listId = useId();
  const listRef = useRef(null);
  const searchRef = useRef(null);

  const selected = options.find(o => o.value === value);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter(o => `${o.label} ${o.sub ?? ''}`.toLowerCase().includes(q)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) { setQuery(''); return; }
    setActive(Math.max(0, shown.findIndex(o => o.value === value)));
    if (searchable) setTimeout(() => searchRef.current?.focus(), 0);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep the highlighted option in view
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = o => { if (o && !o.disabled) { onChange(o.value); setOpen(false); } };

  const onKeyDown = e => {
    if (disabled) return;
    if (!open && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) { e.preventDefault(); setOpen(true); return; }
    if (!open) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(i => Math.min(shown.length - 1, i + 1)); }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(i => Math.max(0, i - 1)); }
    if (e.key === 'Enter') { e.preventDefault(); choose(shown[active]); }
    if (e.key === 'Tab') setOpen(false);
  };

  return (
    <div className={`dd${open ? ' is-open' : ''}${disabled ? ' is-disabled' : ''} ${className}`} ref={ref} onKeyDown={onKeyDown}>
      <button type="button" className="dd__btn" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
              aria-controls={listId} aria-label={ariaLabel} onClick={() => setOpen(o => !o)}>
        {(selected?.icon || icon) && <Icon name={selected?.icon || icon} size="sm" className="dd__lead" />}
        <span className={`dd__value${selected ? '' : ' is-placeholder'}`}>
          {selected ? selected.label : placeholder}
          {selected?.sub && <small>{selected.sub}</small>}
        </span>
        <Icon name="down" size="sm" className="dd__chev" />
      </button>

      {open && (
        <div className="dd__pop">
          {searchable && (
            <div className="dd__search">
              <Icon name="search" size="sm" />
              <input ref={searchRef} value={query} placeholder="Type to search…"
                     onChange={e => { setQuery(e.target.value); setActive(0); }} />
            </div>
          )}
          <ul className="dd__list" role="listbox" id={listId} ref={listRef}>
            {shown.length === 0 && <li className="dd__empty">No matches</li>}
            {shown.map((o, i) => (
              <li key={o.value} data-i={i} role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined}
                  className={`dd__opt${o.value === value ? ' is-selected' : ''}${i === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}`}
                  onMouseEnter={() => setActive(i)} onMouseDown={e => e.preventDefault()} onClick={() => choose(o)}>
                {o.img !== undefined
                  ? <span className="dd__thumb">{o.img ? <img src={o.img} alt="" loading="lazy" /> : <Icon name={o.icon || 'car'} size="sm" />}</span>
                  : o.icon && <Icon name={o.icon} size="sm" />}
                <span>{o.label}{o.sub && <small>{o.sub}</small>}</span>
                {o.value === value && <Icon name="check" size="sm" className="dd__tick" />}
                {onInfo && !o.disabled && (
                  <button type="button" className="dd__info" aria-label={`Details of ${o.label}`}
                          onMouseDown={e => e.preventDefault()}
                          onClick={e => { e.stopPropagation(); setOpen(false); onInfo(o); }}>
                    Details
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
