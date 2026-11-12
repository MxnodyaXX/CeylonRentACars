import { useRef, useState } from 'react';
import { Camera, ImagePlus, RefreshCw, Trash2, Upload, X, ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';

/*
 * The wedding car's own pictures (Vehicles → Add / Edit → Wedding car images):
 *   • showroom image — the decorated car, cut out (transparent PNG); the Wedding Cars page shows it
 *     (without one, the page uses the rental admin image)
 *   • wedding photos — the decorated car, in order; visitors open them from the Wedding Cars page
 * Uploaded as they are (no crop), so a cut-out keeps its transparency.
 */
export interface WedPhoto { key: string; preview: string; isNew: boolean }

interface Props {
  enabled: boolean;                                        // Supabase Storage configured
  cutout: { url: string | null; isNew: boolean };
  fallback?: string | null;                                // the rental admin image, used when there's no cut-out
  photos: WedPhoto[];
  onPickCutout: (file: File) => void;
  onClearCutout: () => void;
  onAddPhotos: (files: File[]) => void;
  onRemovePhoto: (key: string) => void;
  onMovePhoto: (from: number, to: number) => void;
}

const images = (files: FileList | null) => Array.from(files ?? []).filter((f) => f.type.startsWith('image/'));

export default function WeddingImageFields({ enabled, cutout, fallback, photos, onPickCutout, onClearCutout, onAddPhotos, onRemovePhoto, onMovePhoto }: Props) {
  const cutInput = useRef<HTMLInputElement>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const shown = cutout.url ?? fallback ?? null;

  return (
    <div className="flex flex-col gap-5">
      {!enabled && (
        <div className="flex items-center gap-2 bg-navy-50 rounded-xl px-3 py-2.5 text-xs text-navy-400">
          <Camera size={13} className="flex-shrink-0" />
          Image upload requires Supabase Storage to be configured.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-4 items-start">
        {/* the showroom image, previewed on the dark stage it is shown on */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-bold text-navy-700">Showroom image</p>
            {cutout.isNew && <span className="text-[10px] font-semibold text-amber-600">New — saved on Save</span>}
          </div>
          <div className="relative w-full rounded-2xl overflow-hidden ring-1 ring-navy-800"
               style={{ aspectRatio: '16 / 9', background: 'radial-gradient(60% 50% at 50% 70%, rgba(255,255,255,.12), transparent 70%), radial-gradient(40% 20% at 50% 85%, rgba(225,29,42,.25), transparent 75%), #0b0b0d' }}
               onDragOver={(e) => e.preventDefault()}
               onDrop={(e) => { e.preventDefault(); const [f] = images(e.dataTransfer.files); if (enabled && f) onPickCutout(f); }}>
            {shown ? (
              <img src={shown} alt="" className={`absolute inset-x-[6%] bottom-[8%] w-[88%] h-[80%] object-contain object-bottom ${cutout.url ? '' : 'opacity-40'}`}
                   style={{ filter: 'drop-shadow(0 10px 12px rgba(0,0,0,.6))' }} />
            ) : null}
            {!cutout.url && (
              <button type="button" disabled={!enabled} onClick={() => cutInput.current?.click()}
                      className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-white/60 hover:text-white transition-colors disabled:cursor-not-allowed">
                <ImagePlus size={20} />
                <span className="text-[11px] font-semibold">Upload the decorated car</span>
                {fallback && <span className="text-[10px] text-white/50">(the rental image is used until then)</span>}
              </button>
            )}
            {cutout.url && enabled && (
              <div className="absolute top-2 right-2 flex gap-1">
                <button type="button" onClick={() => cutInput.current?.click()} title="Replace"
                        className="w-7 h-7 rounded-lg bg-white/15 text-white flex items-center justify-center hover:bg-white/30"><RefreshCw size={13} /></button>
                <button type="button" onClick={onClearCutout} title="Remove"
                        className="w-7 h-7 rounded-lg bg-white/15 text-white flex items-center justify-center hover:bg-brand-600"><Trash2 size={13} /></button>
              </div>
            )}
          </div>
          <p className="text-[10.5px] text-navy-400 leading-relaxed">Transparent PNG cut-out of the car <b>with its wedding decoration</b> (side-front view). It stands on the Wedding Cars page.</p>
          <input ref={cutInput} type="file" accept="image/*" className="hidden"
                 onChange={(e) => { const [f] = images(e.target.files); if (f) onPickCutout(f); e.target.value = ''; }} />
        </div>

        {/* the wedding photos */}
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs font-bold text-navy-700">Wedding photos <span className="font-normal text-navy-400">({photos.length})</span></p>
            {photos.length > 1 && <p className="text-[10.5px] text-navy-400">Drag to change the order</p>}
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
            {photos.map((p, i) => (
              <div key={p.key} draggable={enabled}
                   onDragStart={(e) => { setDragFrom(i); e.dataTransfer.effectAllowed = 'move'; }}
                   onDragOver={(e) => { if (dragFrom !== null) { e.preventDefault(); setDragOver(i); } }}
                   onDragLeave={() => setDragOver((x) => (x === i ? null : x))}
                   onDrop={(e) => { if (dragFrom !== null) { e.preventDefault(); e.stopPropagation(); onMovePhoto(dragFrom, i); } setDragFrom(null); setDragOver(null); }}
                   onDragEnd={() => { setDragFrom(null); setDragOver(null); }}
                   className={`relative group aspect-[4/3] rounded-xl overflow-hidden transition-all ${p.isNew ? 'ring-2 ring-amber-300' : 'ring-1 ring-navy-100'}
                     ${dragFrom === i ? 'opacity-40' : ''} ${dragOver === i && dragFrom !== i ? 'ring-2 ring-navy-900 scale-[1.03]' : ''} ${enabled ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                <img src={p.preview} alt="" className="w-full h-full object-cover pointer-events-none" />
                {p.isNew && <span className="absolute top-1 left-1 text-[9px] font-semibold bg-amber-600/90 text-white px-1.5 py-0.5 rounded">New</span>}
                {enabled && (<>
                  <button type="button" onClick={() => onRemovePhoto(p.key)} title="Remove"
                          className="absolute top-1 right-1 w-6 h-6 bg-brand-500 text-white rounded-md flex items-center justify-center hover:bg-brand-600 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"><X size={11} /></button>
                  <span className="absolute bottom-1 right-1 flex gap-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button type="button" disabled={i === 0} onClick={() => onMovePhoto(i, i - 1)} title="Move left"
                            className="w-6 h-6 bg-black/60 text-white rounded-md flex items-center justify-center hover:bg-black/80 disabled:opacity-30"><ChevronLeft size={12} /></button>
                    <button type="button" disabled={i === photos.length - 1} onClick={() => onMovePhoto(i, i + 1)} title="Move right"
                            className="w-6 h-6 bg-black/60 text-white rounded-md flex items-center justify-center hover:bg-black/80 disabled:opacity-30"><ChevronRight size={12} /></button>
                  </span>
                  <GripVertical size={14} className="absolute bottom-1.5 left-1 text-white drop-shadow hidden sm:block sm:opacity-0 sm:group-hover:opacity-90" />
                </>)}
              </div>
            ))}
            {enabled && (
              <label className="aspect-[4/3] flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-navy-200 cursor-pointer text-navy-400 hover:border-navy-700 hover:text-navy-700 transition-colors"
                     onDragOver={(e) => e.preventDefault()}
                     onDrop={(e) => { e.preventDefault(); const f = images(e.dataTransfer.files); if (f.length) onAddPhotos(f); }}>
                <input type="file" accept="image/*" multiple className="hidden"
                       onChange={(e) => { const f = images(e.target.files); if (f.length) onAddPhotos(f); e.target.value = ''; }} />
                <Upload size={16} />
                <span className="text-[10.5px] font-semibold text-center leading-tight px-1">Add wedding photos</span>
              </label>
            )}
          </div>
          <p className="text-[10.5px] text-navy-400">The decorated car at weddings and homecomings — ribbons, flowers, inside. Visitors open them with <b>Photos</b> on the Wedding Cars page. Several at once.</p>
        </div>
      </div>
    </div>
  );
}
