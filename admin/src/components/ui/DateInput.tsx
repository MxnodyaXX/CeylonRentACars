import { forwardRef } from 'react';
import ReactDatePicker from 'react-datepicker';
import { parseISO, format, isValid } from 'date-fns';
import { CalendarDays } from 'lucide-react';
import clsx from 'clsx';

interface Props {
  value: string;           // 'YYYY-MM-DD' or ''
  onChange: (v: string) => void;
  placeholder?: string;
  minDate?: string;        // 'YYYY-MM-DD'
  maxDate?: string;        // 'YYYY-MM-DD'
  disabled?: boolean;
  className?: string;
}

const strToDate = (s?: string): Date | null => {
  if (!s) return null;
  const d = parseISO(s);
  return isValid(d) ? d : null;
};

// react-datepicker passes value/onClick/placeholder/ref down via cloneElement.
const Trigger = forwardRef<
  HTMLButtonElement,
  { value?: string; onClick?: () => void; placeholder?: string; disabled?: boolean }
>(({ value, onClick, placeholder, disabled }, ref) => (
  <button
    ref={ref}
    type="button"
    onClick={onClick}
    disabled={disabled}
    className={clsx(
      'input w-full flex items-center gap-2 text-left',
      disabled && 'opacity-50 cursor-not-allowed',
    )}
  >
    <CalendarDays size={14} className="text-navy-400 flex-shrink-0" />
    <span className={value ? 'text-navy-800' : 'text-navy-300'}>
      {value || placeholder || 'Select date'}
    </span>
  </button>
));
Trigger.displayName = 'DateTrigger';

export default function DateInput({
  value,
  onChange,
  placeholder = 'Select date',
  minDate,
  maxDate,
  disabled,
  className,
}: Props) {
  return (
    <div className={clsx('relative', className)}>
      <ReactDatePicker
        selected={strToDate(value)}
        onChange={(d: Date | null) => onChange(d ? format(d, 'yyyy-MM-dd') : '')}
        calendarClassName="emrac-datepicker"
        showMonthDropdown
        showYearDropdown
        dropdownMode="select"
        placeholderText={placeholder}
        minDate={strToDate(minDate) ?? undefined}
        maxDate={strToDate(maxDate) ?? undefined}
        disabled={disabled}
        dateFormat="dd MMM yyyy"
        popperPlacement="bottom-start"
        popperProps={{ strategy: 'fixed' }}
        customInput={<Trigger disabled={disabled} placeholder={placeholder} />}
      />
    </div>
  );
}
