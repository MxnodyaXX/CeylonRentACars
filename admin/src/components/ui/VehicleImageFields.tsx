import { useRef } from 'react';
import { Camera, Upload, X, ImagePlus, RefreshCw, Trash2 } from 'lucide-react';

export type ImageSlot = 'admin' | 'hero' | 'photos';

/** Crop shape per image kind (width / height) */
export const SLOT_ASPECT: Record<ImageSlot, number> = {
  admin: 16 / 7,  // matches the admin card platform
  hero: 2 / 1,    // the website hero frame
  photos: 4 / 3,  // gallery photos
};

interface Single { url: string | null; isNew: boolean }

interface Props {
  enabled: boolean;                 // Supabase Storage configured
  admin: Single;
  hero: Single;
  photos: { saved: string[]; pending: string[] };
  onPick: (slot: ImageSlot, files: FileList | null) => void;
  onClear: (slot: 'admin' | 'hero') => void;
  onRemoveSaved: (url: string) => void;
  onRemovePending: (index: number) => void;
}

/* One image (admin cut-out or hero photo) with a preview that mimics where it is shown */
function SingleSlot({
  slot, title, hint, value, enabled, onPick, onClear,
}: {
  slot: 'admin' | 'hero'; title: string; hint: string; value: Single; enabled: boolean;
  onPick: Props['onPick']; onClear: Props['onClear'];
}) {
  const input = useRef<HTMLInputElement>(null);
  const isHero = slot === 'hero';
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-navy-700">{title}</p>
        {value.isNew && <span className="text-[10px] font-semibold text-amber-600">New — saved on Save</span>}
      </div>

      <div
        className={`relative w-full rounded-2xl overflow-hidden ring-1 ${isHero ? 'ring-navy-800 bg-[#0B0B0D]' : 'ring-navy-100'}`}
        style={{
          aspectRatio: isHero ? '2 / 1' : '16 / 7',
          ...(!isHero && { background: 'linear-gradient(180deg,#D6D6DB 0%,#E2E2E6 50%,#ECECEF 100%)' }),
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (enabled) onPick(slot, e.dataTransfer.files); }}
      >
        {value.url ? (
          <img
            src={value.url}
            alt=""
            className={`w-full h-full ${isHero ? 'object-cover' : 'object-contain object-bottom'}`}
            style={!isHero ? { filter: 'drop-shadow(0 6px 10px rgba(17,17,20,0.25))' } : undefined}
          />
        ) : (
          <button
            type="button"
            disabled={!enabled}
            onClick={() => input.current?.click()}
            className={`absolute inset-0 flex flex-col items-center justify-center gap-1 transition-colors disabled:cursor-not-allowed
              ${isHero ? 'text-white/40 hover:text-white/80' : 'text-navy-400 hover:text-navy-700'}`}
          >
            <ImagePlus size={20} />
            <span className="text-[11px] font-semibold">Upload {isHero ? 'hero image' : 'admin image'}</span>
          </button>
        )}

        {value.url && enabled && (
          <div className="absolute top-2 right-2 flex gap-1">
            <button type="button" onClick={() => input.current?.click()} title="Replace"
                    className="w-7 h-7 rounded-lg bg-black/55 text-white flex items-center justify-center hover:bg-black/75">
              <RefreshCw size={13} />
            </button>
            <button type="button" onClick={() => onClear(slot)} title="Remove"
                    className="w-7 h-7 rounded-lg bg-black/55 text-white flex items-center justify-center hover:bg-brand-600">
              <Trash2 size={13} />
            </button>
          </div>
        )}
      </div>

      <p className="text-[10.5px] text-navy-400 leading-relaxed">{hint}</p>
      <input ref={input} type="file" accept="image/*" className="hidden"
             onChange={(e) => { onPick(slot, e.target.files); e.target.value = ''; }} />
    </div>
  );
}

export default function VehicleImageFields({
  enabled, admin, hero, photos, onPick, onClear, onRemoveSaved, onRemovePending,
}: Props) {
  const photoInput = useRef<HTMLInputElement>(null);
  const count = photos.saved.length + photos.pending.length;

  return (
    <div className="sm:col-span-2 flex flex-col gap-5">
      <div className="flex items-center gap-2 mt-1">
        <Camera size={14} className="text-navy-400" />
        <p className="text-xs font-semibold text-navy-500 uppercase tracking-wide">Vehicle Images</p>
      </div>

      {!enabled && (
        <div className="flex items-center gap-2 bg-navy-50 rounded-xl px-3 py-2.5 text-xs text-navy-400">
          <Camera size={13} className="flex-shrink-0" />
          Image upload requires Supabase Storage to be configured.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <SingleSlot
          slot="admin" title="Admin image" value={admin} enabled={enabled} onPick={onPick} onClear={onClear}
          hint="Transparent PNG cut-out (car only). Shown on the admin vehicle cards; used in the website hero if no hero image is set."
        />
        <SingleSlot
          slot="hero" title="Hero image" value={hero} enabled={enabled} onPick={onPick} onClear={onClear}
          hint="Wide, polished photo (about 1600px+). Shown in the big banner on the website when this vehicle is listed."
        />
      </div>

      {/* Real photos for the customer's vehicle details */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-bold text-navy-700">Vehicle photos <span className="font-normal text-navy-400">({count})</span></p>
          <p className="text-[10.5px] text-navy-400">The first photo is the website card cover</p>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {photos.saved.map((url, i) => (
            <div key={url} className="relative group aspect-[4/3] rounded-xl overflow-hidden ring-1 ring-navy-100">
              <img src={url} alt="" className="w-full h-full object-cover" />
              {i === 0 && <span className="absolute bottom-1 left-1 text-[9px] font-semibold bg-navy-700/85 text-white px-1.5 py-0.5 rounded">Cover</span>}
              <button type="button" onClick={() => onRemoveSaved(url)} title="Remove"
                      className="absolute top-1 right-1 w-5 h-5 bg-brand-500 text-white rounded-full items-center justify-center hidden group-hover:flex">
                <X size={10} />
              </button>
            </div>
          ))}
          {photos.pending.map((preview, i) => (
            <div key={i} className="relative group aspect-[4/3] rounded-xl overflow-hidden ring-2 ring-amber-300">
              <img src={preview} alt="" className="w-full h-full object-cover opacity-80" />
              <span className="absolute bottom-1 left-1 text-[9px] font-semibold bg-amber-600/90 text-white px-1.5 py-0.5 rounded">New</span>
              <button type="button" onClick={() => onRemovePending(i)} title="Remove"
                      className="absolute top-1 right-1 w-5 h-5 bg-brand-500 text-white rounded-full items-center justify-center hidden group-hover:flex">
                <X size={10} />
              </button>
            </div>
          ))}

          {enabled && (
            <label
              className="aspect-[4/3] flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-navy-200 cursor-pointer text-navy-400 hover:border-navy-700 hover:text-navy-700 transition-colors"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); onPick('photos', e.dataTransfer.files); }}
            >
              <input ref={photoInput} type="file" accept="image/*" multiple className="hidden"
                     onChange={(e) => { onPick('photos', e.target.files); e.target.value = ''; }} />
              <Upload size={16} />
              <span className="text-[10.5px] font-semibold text-center leading-tight px-1">Add photos</span>
            </label>
          )}
        </div>
        <p className="text-[10.5px] text-navy-400">Real photos of this exact vehicle — outside, inside, boot. Customers browse them in the vehicle details. JPEG · PNG · WebP, several at once.</p>
      </div>
    </div>
  );
}
