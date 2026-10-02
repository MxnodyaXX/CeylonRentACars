import { useState, useEffect } from 'react';
import { Clock } from 'lucide-react';

interface Props {
  value?: string;                 // 'HH:MM' (24-hour) or '' when unset
  onChange: (v: string) => void;
  placeholder?: string;
}

const to12 = (h24: number) => {
  const period: 'AM' | 'PM' = h24 >= 12 ? 'PM' : 'AM';
  let h = h24 % 12; if (h === 0) h = 12;
  return { h, period };
};
const to24 = (h12: number, period: 'AM' | 'PM') => {
  let h = h12 % 12; if (period === 'PM') h += 12;
  return h;
};
const pad = (n: number) => String(n).padStart(2, '0');

export default function TimePicker({ value, onChange, placeholder = 'Select time' }: Props) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [hour, setHour] = useState(7);
  const [minute, setMinute] = useState(0);
  const [period, setPeriod] = useState<'AM' | 'PM'>('AM');

  // (Re)initialise from the incoming value each time the picker opens.
  useEffect(() => {
    if (!open) return;
    if (value && /^\d{1,2}:\d{2}$/.test(value)) {
      const [hh, mm] = value.split(':').map(Number);
      const { h, period: p } = to12(hh);
      setHour(h); setMinute(mm); setPeriod(p);
    } else {
      setHour(7); setMinute(0); setPeriod('AM');
    }
    setMode('hour');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const display = value && /^\d{1,2}:\d{2}$/.test(value)
    ? (() => { const [hh, mm] = value.split(':').map(Number); const { h, period: p } = to12(hh); return `${pad(h)}:${pad(mm)} ${p}`; })()
    : '';

  const confirm = () => { onChange(`${pad(to24(hour, period))}:${pad(minute)}`); setOpen(false); };

  // Clock geometry: angle (deg from 12 o'clock, clockwise) → x/y on a 100×100 viewBox.
  const R = 38;
  const pos = (angleDeg: number) => {
    const a = (angleDeg * Math.PI) / 180;
    return { x: 50 + R * Math.sin(a), y: 50 - R * Math.cos(a) };
  };
  const numbers = mode === 'hour'
    ? Array.from({ length: 12 }, (_, i) => i + 1)        // 1..12
    : Array.from({ length: 12 }, (_, i) => i * 5);       // 0,5,…,55
  const selectedVal = mode === 'hour' ? hour : minute;
  const angleOf = (val: number) => (mode === 'hour' ? (val % 12) : (val / 5) % 12) * 30;
  const hand = pos(angleOf(selectedVal));

  const pickNumber = (val: number) => {
    if (mode === 'hour') { setHour(val); setMode('minute'); }
    else setMinute(val);
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="input flex items-center gap-2 text-left w-full"
      >
        <Clock size={14} className="text-navy-400 flex-shrink-0" />
        <span className={display ? 'text-navy-800' : 'text-navy-400'}>{display || placeholder}</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setOpen(false)}>
          <div className="bg-[#ECE9F3] rounded-3xl shadow-2xl w-full max-w-[330px] p-6" onClick={(e) => e.stopPropagation()}>
            <p className="text-xs font-medium text-navy-500 mb-4">Select time</p>

            {/* Digital display + AM/PM */}
            <div className="flex items-stretch gap-2 mb-6">
              <button
                type="button"
                onClick={() => setMode('hour')}
                className={`flex-1 rounded-xl text-4xl font-bold py-3 transition-colors ${mode === 'hour' ? 'bg-[#D6CCF7] text-[#4F3BC0]' : 'bg-[#E4E0EC] text-navy-700'}`}
              >
                {pad(hour)}
              </button>
              <span className="text-4xl font-bold text-navy-700 self-center">:</span>
              <button
                type="button"
                onClick={() => setMode('minute')}
                className={`flex-1 rounded-xl text-4xl font-bold py-3 transition-colors ${mode === 'minute' ? 'bg-[#D6CCF7] text-[#4F3BC0]' : 'bg-[#E4E0EC] text-navy-700'}`}
              >
                {pad(minute)}
              </button>
              <div className="flex flex-col rounded-xl overflow-hidden border border-[#D6CCF7] w-12">
                {(['AM', 'PM'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPeriod(p)}
                    className={`flex-1 text-xs font-semibold transition-colors ${period === p ? 'bg-[#E9B8F0] text-[#7A2E86]' : 'bg-[#E4E0EC] text-navy-500'}`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>

            {/* Clock face */}
            <div className="relative w-[230px] h-[230px] mx-auto rounded-full bg-[#E0DCEA]">
              <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none">
                <circle cx="50" cy="50" r="1.6" fill="#6D5BD0" />
                <line x1="50" y1="50" x2={hand.x} y2={hand.y} stroke="#6D5BD0" strokeWidth="1" />
                <circle cx={hand.x} cy={hand.y} r="9" fill="#6D5BD0" />
              </svg>
              {numbers.map((val) => {
                const p = pos(angleOf(val));
                const selected = val === selectedVal;
                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => pickNumber(val)}
                    className={`absolute w-8 h-8 -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${selected ? 'text-white' : 'text-navy-700 hover:bg-white/50'}`}
                    style={{ left: `${p.x}%`, top: `${p.y}%` }}
                  >
                    {mode === 'minute' ? pad(val) : val}
                  </button>
                );
              })}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-6 mt-5 text-sm font-semibold text-[#5B4BD0]">
              <button type="button" onClick={() => setOpen(false)} className="hover:opacity-70">Cancel</button>
              <button type="button" onClick={confirm} className="hover:opacity-70">OK</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
