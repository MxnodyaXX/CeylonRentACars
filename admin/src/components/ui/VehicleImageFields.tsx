import { useRef } from 'react';
import { Camera, Upload, X, ImagePlus, RefreshCw, Trash2, CheckCircle2, Eye } from 'lucide-react';

export type ImageSlot = 'admin' | 'hero' | 'photos';

/** Crop shape per image kind (width / height) */
export const SLOT_ASPECT: Record<ImageSlot, number> = {
  admin: 16 / 7,  // matches the admin card platform
  hero: 16 / 9,   // website vehicle cards + homepage banner (keep the car in the middle 60%)
  photos: 4 / 3,  // gallery photos
};

interface Single { url: string | null; isNew: boolean }

export const MAX_HEROES = 3;

interface Props {
  enabled: boolean;                 // Supabase Storage configured
  admin: Single;
  heroes: Single[];                 // up to MAX_HEROES
  heroShown: string | null;         // url (or new preview) the website shows
  onShowHero: (url: string) => void;
  onRemoveHero: (url: string) => void;
  photos: { saved: string[]; pending: string[] };
  onPick: (slot: ImageSlot, files: FileList | null) => void;
  onClear: (slot: 'admin') => void;
  onRemoveSaved: (url: string) => void;
  onRemovePending: (index: number) => void;
}

/* One image (admin cut-out or hero photo) with a preview that mimics where it is shown */
function SingleSlot({
  slot, title, hint, value, enabled, onPick, onClear,
}: {
  slot: 'admin'; title: string; hint: string; value: Single; enabled: boolean;
  onPick: Props['onPick']; onClear: Props['onClear'];
}) {
  const input = useRef<HTMLInputElement>(null);
  const isHero = false;
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

/* Up to 3 hero images (16:9) — one is shown on the website, the admin picks which */
function HeroSlots({ heroes, shown, enabled, onPick, onShow, onRemove }: {
  heroes: Single[]; shown: string | null; enabled: boolean;
  onPick: Props['onPick']; onShow: (url: string) => void; onRemove: (url: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const free = MAX_HEROES - heroes.length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-bold text-navy-700">Hero images <span className="font-normal text-navy-400">({heroes.length}/{MAX_HEROES})</span></p>
        {heroes.length > 1 && <p className="text-[10.5px] text-navy-400">Tap <b>Show this one</b> to change what customers see</p>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {heroes.map((h) => {
          const on = h.url === shown;
          return (
            <div key={h.url ?? ''} className={`relative rounded-xl overflow-hidden bg-[#0B0B0D] ${on ? 'ring-2 ring-emerald-500' : 'ring-1 ring-navy-200'}`} style={{ aspectRatio: '16 / 9' }}>
              <img src={h.url ?? ''} alt="" className="w-full h-full object-cover" />
              {/* where the 4:3 vehicle-details crop cuts — keep the car inside */}
              <div className="pointer-events-none absolute inset-y-0 left-0 w-[12.5%] bg-black/35" />
              <div className="pointer-events-none absolute inset-y-0 right-0 w-[12.5%] bg-black/35" />
              <div className="absolute top-1.5 left-1.5 flex gap-1">
                {on
                  ? <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-600 text-white px-1.5 py-0.5 rounded"><CheckCircle2 size={11} /> Shown on website</span>
                  : <button type="button" onClick={() => h.url && onShow(h.url)} className="inline-flex items-center gap-1 text-[10px] font-semibold bg-black/60 text-white px-1.5 py-0.5 rounded hover:bg-black/80"><Eye size={11} /> Show this one</button>}
                {h.isNew && <span className="text-[10px] font-semibold bg-amber-600/90 text-white px-1.5 py-0.5 rounded">New</span>}
              </div>
              {enabled && (
                <button type="button" onClick={() => h.url && onRemove(h.url)} title="Remove"
                        className="absolute top-1.5 right-1.5 w-6 h-6 rounded-lg bg-black/55 text-white flex items-center justify-center hover:bg-brand-600">
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })}
        {enabled && free > 0 && (
          <button type="button" onClick={() => input.current?.click()}
                  onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onPick('hero', e.dataTransfer.files); }}
                  className="rounded-xl border-2 border-dashed border-navy-200 bg-[#0B0B0D]/[0.03] flex flex-col items-center justify-center gap-1 text-navy-400 hover:border-navy-700 hover:text-navy-700 transition-colors"
                  style={{ aspectRatio: '16 / 9' }}>
            <ImagePlus size={18} />
            <span className="text-[11px] font-semibold">Add hero image</span>
            <span className="text-[10px]">{free} more allowed</span>
          </button>
        )}
      </div>
      <p className="text-[10.5px] text-navy-400 leading-relaxed">
        Wide 16:9 photo (1920×1080). The one marked <b>Shown on website</b> is the cover on the website's vehicle cards and the homepage banner.
        Keep the car inside the clear middle area — the shaded edges get cut off in the vehicle details.
      </p>
      <input ref={input} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { onPick('hero', e.target.files); e.target.value = ''; }} />
    </div>
  );
}

export default function VehicleImageFields({
  enabled, admin, heroes, heroShown, onShowHero, onRemoveHero, photos, onPick, onClear, onRemoveSaved, onRemovePending,
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

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-4">
        <SingleSlot
          slot="admin" title="Admin image" value={admin} enabled={enabled} onPick={onPick} onClear={onClear}
          hint="Transparent PNG cut-out (car only). Shown on the admin vehicle cards. Used on the website only if there is no hero image."
        />
        <HeroSlots heroes={heroes} shown={heroShown} enabled={enabled} onPick={onPick} onShow={onShowHero} onRemove={onRemoveHero} />
      </div>

      {/* Real photos for the customer's vehicle details */}
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-xs font-bold text-navy-700">Vehicle photos <span className="font-normal text-navy-400">({count})</span></p>
          <p className="text-[10.5px] text-navy-400">Shown in the vehicle details on the website</p>
        </div>

        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
          {photos.saved.map((url, i) => (
            <div key={url} className="relative group aspect-[4/3] rounded-xl overflow-hidden ring-1 ring-navy-100">
              <img src={url} alt="" className="w-full h-full object-cover" />
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
