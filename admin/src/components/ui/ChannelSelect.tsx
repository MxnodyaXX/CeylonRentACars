import Select from './Select';
import { CHANNELS } from '../../lib/channels';

/** "How did the customer find us?" — one list for every booking form (see lib/channels.ts) */
export default function ChannelSelect({ value, onChange, required, className = '' }: {
  value?: string; onChange: (v: string) => void; required?: boolean; className?: string;
}) {
  return (
    <div className={className}>
      <p className="label">How did they find us?{required ? ' *' : <span className="text-navy-400 font-normal"> (optional)</span>}</p>
      <Select value={value ?? ''} onChange={(v) => onChange(v)} placeholder="Choose the channel" searchable
        options={CHANNELS.map((c) => ({ value: c.value, label: c.label, sub: c.sub }))} />
      <p className="text-[11px] text-navy-400 mt-1">For marketing reports — separate from who referred them.</p>
    </div>
  );
}
