import { useMemo, useState } from 'react';
import { Users, Wand2 } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Select from '../../components/ui/Select';
import { useStore } from '../../store/useStore';
import { bestSpelling, nameKey, referrerOf } from '../../lib/channels';

/*
 * Commissions → "Fix names": every spelling typed as a referrer, with how many bookings use it.
 * Pick the right person for a spelling and every booking and payout line with it is changed
 * (kept in each booking's history). Names that differ only in capitals are suggested together.
 */
export default function ReferralNamesFix({ onClose }: { onClose: () => void }) {
  const { bookings, owners, renameReferral } = useStore();
  const [target, setTarget] = useState<Record<string, string>>({});

  const spellings = useMemo(() => {
    const m = new Map<string, number>();
    bookings.forEach((b) => { const r = referrerOf(b.referral); if (r) m.set(r, (m.get(r) ?? 0) + 1); });
    return [...m.entries()].map(([name, count]) => ({ name, count, owner: owners.find((o) => o.name === name) }))
      .sort((a, b) => nameKey(a.name).localeCompare(nameKey(b.name)) || b.count - a.count);
  }, [bookings, owners]);

  // same letters, different capitals (or extra spaces): one suggested name each
  const groups = useMemo(() => {
    const g = new Map<string, typeof spellings>();
    spellings.forEach((s) => g.set(nameKey(s.name), [...(g.get(nameKey(s.name)) ?? []), s]));
    return [...g.values()].filter((x) => x.length > 1).map((x) => {
      const owner = owners.find((o) => nameKey(o.name) === nameKey(x[0].name));
      const best = owner?.name ?? bestSpelling(x.map((s) => [s.name, s.count] as [string, number]));
      return { best, others: x.filter((s) => s.name !== best) };
    }).filter((g) => g.others.length);
  }, [spellings, owners]);

  const choices = [
    ...owners.map((o) => ({ value: o.name, label: o.name, sub: 'Vehicle owner' })),
    ...spellings.filter((s) => !s.owner).map((s) => ({ value: s.name, label: s.name, sub: `${s.count} booking${s.count === 1 ? '' : 's'}` })),
  ];
  const merge = (from: string[], to: string) => {
    if (!confirm(`Change "${from.join('", "')}" to "${to}" on every booking and payout line?`)) return;
    renameReferral(from, to);
  };

  return (
    <Modal open onClose={onClose} title="Fix referrer names" width="max-w-2xl">
      <div className="space-y-5">
        <p className="text-sm text-navy-500">Referrers were typed by hand, so one person can appear under several spellings and their totals and referral fees get split. Merge each wrong spelling into the right person.</p>

        {groups.length > 0 && (
          <section className="space-y-2">
            <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide flex items-center gap-1.5"><Wand2 size={13} /> Suggested — same name, different capitals</p>
            {groups.map((g) => (
              <div key={g.best} className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 px-3 py-2 text-sm">
                <span className="text-navy-700">{g.others.map((o) => <b key={o.name}>"{o.name}" ({o.count}) </b>)} → <b>{g.best}</b></span>
                <button type="button" onClick={() => merge(g.others.map((o) => o.name), g.best)} className="btn-primary !py-1.5 text-xs flex-shrink-0">Merge</button>
              </div>
            ))}
          </section>
        )}

        <section className="space-y-2">
          <p className="text-xs font-semibold text-navy-400 uppercase tracking-wide flex items-center gap-1.5"><Users size={13} /> Every referrer name</p>
          {spellings.length === 0 && <p className="text-sm text-navy-400">No referrers yet.</p>}
          {spellings.map((s) => (
            <div key={s.name} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_14rem_auto] gap-2 items-center rounded-xl bg-navy-50/60 px-3 py-2">
              <span className="text-sm min-w-0">
                <span className="font-medium text-navy-800">{s.name}</span>
                <span className="text-xs text-navy-400"> · {s.count} booking{s.count === 1 ? '' : 's'}{s.owner ? ' · owner' : ''}</span>
              </span>
              <Select className="col-span-2 sm:col-span-1 order-last sm:order-none" value={target[s.name] ?? ''} placeholder="Merge into…" searchable
                onChange={(v) => setTarget((t) => ({ ...t, [s.name]: v }))}
                options={choices.filter((c) => c.value !== s.name)} />
              <button type="button" disabled={!target[s.name]} onClick={() => merge([s.name], target[s.name])}
                      className="btn-secondary !py-1.5 text-xs disabled:opacity-40">Merge</button>
            </div>
          ))}
        </section>
      </div>
    </Modal>
  );
}
