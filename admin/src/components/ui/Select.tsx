import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';
import clsx from 'clsx';

export interface SelectOption {
  value: string | number;
  label: string;
  sub?: string;
  group?: string; // when set, a group header appears before the first option of each group
}

interface SelectProps {
  value: string | number;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** When true, the placeholder row acts as a "clear" option; default false */
  nullable?: boolean;
  disabled?: boolean;
  className?: string;
  error?: boolean;
}

export default function Select({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  nullable = false,
  disabled = false,
  className,
  error,
}: SelectProps) {
  const [open, setOpen]         = useState(false);
  const [focusedIdx, setFocused] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef      = useRef<HTMLDivElement>(null);

  const strValue = String(value ?? '');
  const selected  = options.find((o) => String(o.value) === strValue);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFocused(-1);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Scroll focused option into view
  useEffect(() => {
    if (!open || focusedIdx < 0) return;
    const items = listRef.current?.querySelectorAll<HTMLElement>('[data-opt]');
    items?.[focusedIdx]?.scrollIntoView({ block: 'nearest' });
  }, [focusedIdx, open]);

  const pick = (opt: SelectOption) => {
    onChange(String(opt.value));
    setOpen(false);
    setFocused(-1);
  };

  const clear = () => {
    onChange('');
    setOpen(false);
    setFocused(-1);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        setOpen(true);
        setFocused(options.findIndex((o) => String(o.value) === strValue));
      }
      return;
    }
    switch (e.key) {
      case 'Escape':
        setOpen(false);
        setFocused(-1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        setFocused((i) => Math.min(i + 1, options.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocused((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (focusedIdx >= 0 && focusedIdx < options.length) pick(options[focusedIdx]);
        break;
    }
  };

  // Build option list, injecting group headers where the group label changes
  const renderOptions = () => {
    const items: React.ReactNode[] = [];
    let lastGroup: string | undefined = undefined;
    options.forEach((opt, idx) => {
      if (opt.group !== undefined && opt.group !== lastGroup) {
        lastGroup = opt.group;
        items.push(
          <div key={`__group__${opt.group}`}
            className="px-3.5 py-1 text-[10px] font-bold uppercase tracking-widest text-navy-400 bg-navy-50/80 border-t border-navy-100 first:border-t-0">
            {opt.group}
          </div>,
        );
      }
      const active   = String(opt.value) === strValue;
      const focused  = idx === focusedIdx;
      items.push(
        <div
          key={String(opt.value)}
          data-opt
          onClick={() => pick(opt)}
          onMouseEnter={() => setFocused(idx)}
          className={clsx(
            'px-3.5 py-2.5 cursor-pointer flex items-center justify-between gap-2 transition-colors border-t border-navy-50',
            active   ? 'bg-navy-700'  :
            focused  ? 'bg-navy-50'   : 'hover:bg-navy-50',
          )}
        >
          <div className="flex-1 min-w-0">
            <p className={clsx('text-sm font-medium truncate', active ? 'text-white' : 'text-navy-800')}>
              {opt.label}
            </p>
            {opt.sub && (
              <p className={clsx('text-xs truncate mt-0.5', active ? 'text-white/70' : 'text-navy-400')}>
                {opt.sub}
              </p>
            )}
          </div>
          {active && <Check size={13} className="text-white flex-shrink-0" />}
        </div>,
      );
    });
    return items;
  };

  return (
    <div ref={containerRef} className={clsx('relative', className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => { if (!disabled) { setOpen((o) => !o); setFocused(-1); } }}
        onKeyDown={handleKeyDown}
        className={clsx(
          'input w-full flex items-center justify-between gap-2 text-left',
          open    && 'border-navy-400 ring-2 ring-navy-100',
          error   && 'border-red-400',
          !selected && 'text-navy-300',
          disabled  && 'opacity-50 cursor-not-allowed',
        )}
      >
        <span className="truncate flex-1">
          {selected
            ? <span className="text-navy-800">{selected.label}</span>
            : placeholder}
        </span>
        <ChevronDown
          size={15}
          className={clsx('flex-shrink-0 text-navy-400 transition-transform duration-200', open && 'rotate-180')}
        />
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute z-50 top-full mt-1.5 left-0 right-0 bg-white rounded-xl border border-navy-100 shadow-[0_8px_32px_rgba(17,17,20,0.12),0_2px_8px_rgba(17,17,20,0.06)] overflow-hidden">
          {nullable && (
            <div
              onClick={clear}
              className={clsx(
                'px-3.5 py-2.5 text-sm cursor-pointer transition-colors',
                !strValue ? 'bg-navy-700 text-white' : 'text-navy-400 hover:bg-navy-50',
              )}
            >
              {placeholder}
            </div>
          )}
          <div ref={listRef} className="max-h-52 overflow-y-auto">
            {renderOptions()}
          </div>
        </div>
      )}
    </div>
  );
}
