import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import Modal from '../ui/Modal';
import { Vehicle } from '../../types';
import {
  WeddingStage, STAGE_IMG, STAGE_W, STAGE_H, PODIUM, defaultStage, croppedAspect,
} from '../../lib/weddingStage';
import { Crop, FlipHorizontal2, Move, RotateCcw, Scissors, Eye, AlignVerticalJustifyEnd, AlignHorizontalJustifyCenter } from 'lucide-react';

/*
 * Place one wedding car's picture on the website's stage: drag it to move, the corner dots to
 * resize, the top dot to rotate; the sliders do the same more precisely, and cut its edges off.
 * What is shown here is exactly what the wedding page shows (same stage picture, same maths).
 */
type Mode = { kind: 'move' | 'size' | 'turn'; x0: number; y0: number; s: WeddingStage; d0: number; a0: number };

export const stagePicture = (v: Vehicle) => v.wedding?.cutout || v.imageUrl || v.wedding?.photos?.[0] || v.heroImageUrl || v.photoUrls?.[0] || '';   // the wedding cut-out first (same order as the wedding page)

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

function Slider({ label, value, min, max, step, onChange, show }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; show: string }) {
  return (
    <label className="block">
      <span className="flex justify-between text-xs text-navy-500 mb-1"><span>{label}</span><span className="font-semibold text-navy-700 tabular-nums">{show}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-brand-500" />
    </label>
  );
}

export default function WeddingStageEditor({ vehicle, onClose, onSave }: {
  vehicle: Vehicle; onClose: () => void; onSave: (s: WeddingStage | null) => void;
}) {
  const src = stagePicture(vehicle);
  const [st, setSt] = useState<WeddingStage | null>(vehicle.weddingStage ?? null);
  const [tab, setTab] = useState<'place' | 'crop'>('place');
  const [preview, setPreview] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [fw, setFw] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null);
  const mode = useRef<Mode | null>(null);

  // the picture's shape decides the starting place (and corrects a saved one if the picture changed)
  useEffect(() => {
    if (!src) return;
    const im = new Image();
    im.onload = () => {
      const aspect = im.naturalWidth / im.naturalHeight;
      setSt((s) => (s ? { ...s, aspect } : defaultStage(aspect)));
    };
    im.src = src;
  }, [src]);

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!el) return undefined;
    const ro = new ResizeObserver(() => setFw(el.clientWidth));
    ro.observe(el);
    setFw(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const fh = (fw * STAGE_H) / STAGE_W;
  const W = fw * PODIUM.width;                       // one podium width, in px
  const P = { x: fw * PODIUM.x, y: fh * PODIUM.y };  // the middle of the podium's top
  const set = (u: Partial<WeddingStage>) => setSt((s) => (s ? { ...s, ...u } : s));
  const setCrop = (k: 't' | 'r' | 'b' | 'l', val: number) => setSt((s) => {
    if (!s) return s;
    const crop = { ...s.crop, [k]: val };
    // never cut away more than 90% either way
    if (crop.l + crop.r > 0.9) crop[k] = 0.9 - (k === 'l' ? crop.r : k === 'r' ? crop.l : 0);
    if (crop.t + crop.b > 0.9) crop[k] = 0.9 - (k === 't' ? crop.b : k === 'b' ? crop.t : 0);
    // keep the car the same size on screen while its sides are cut
    const keep = (1 - crop.l - crop.r) / Math.max(0.1, 1 - s.crop.l - s.crop.r);
    return { ...s, crop, scale: s.scale * keep };
  });

  const anchor = () => (st ? { x: P.x + st.x * W, y: P.y + st.y * W } : P);
  const local = (e: React.PointerEvent) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (kind: Mode['kind']) => (e: React.PointerEvent) => {
    if (!st || preview) return;
    e.preventDefault();
    e.stopPropagation();
    stageRef.current?.setPointerCapture(e.pointerId);
    const p = local(e);
    const a = anchor();
    mode.current = { kind, x0: p.x, y0: p.y, s: st, d0: Math.max(4, Math.hypot(p.x - a.x, p.y - a.y)), a0: Math.atan2(p.y - a.y, p.x - a.x) };
  };
  const move = (e: React.PointerEvent) => {
    const m = mode.current;
    if (!m || !W) return;
    const p = local(e);
    if (m.kind === 'move') {
      set({ x: round(m.s.x + (p.x - m.x0) / W), y: round(m.s.y + (p.y - m.y0) / W) });
    } else {
      const a = { x: P.x + m.s.x * W, y: P.y + m.s.y * W };
      if (m.kind === 'size') {
        set({ scale: round(clamp(m.s.scale * (Math.hypot(p.x - a.x, p.y - a.y) / m.d0), 0.15, 3)) });
      } else {
        let r = m.s.rotate + ((Math.atan2(p.y - a.y, p.x - a.x) - m.a0) * 180) / Math.PI;
        r = ((r + 540) % 360) - 180;
        if (Math.abs(r) < 1.5) r = 0;                      // snaps straight
        set({ rotate: round(r, 1) });
      }
    }
  };
  const up = () => { mode.current = null; };

  const onKey = (e: React.KeyboardEvent) => {
    if (!st || (e.target as HTMLElement).tagName === 'INPUT') return;
    const step = e.shiftKey ? 0.02 : 0.004;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return;
    e.preventDefault();
    set({ x: round(st.x + k[0]), y: round(st.y + k[1]) });
  };

  // cut off the see-through edges round a cut-out, so its wheels are the bottom of the picture
  const trim = async () => {
    if (!st) return;
    setBusy(true);
    setNote('');
    try {
      const blob = await (await fetch(src, { mode: 'cors' })).blob();
      const bmp = await createImageBitmap(blob);
      const k = Math.min(1, 700 / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * k));
      const h = Math.max(1, Math.round(bmp.height * k));
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true })!;
      g.drawImage(bmp, 0, 0, w, h);
      const d = g.getImageData(0, 0, w, h).data;
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      }
      if (x1 < 0 || (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1)) {
        setNote('This picture has no see-through edges to trim. Use the crop sliders instead.');
        return;
      }
      const crop = { t: round(y0 / h), l: round(x0 / w), r: round((w - 1 - x1) / w), b: round((h - 1 - y1) / h) };
      const keep = (1 - crop.l - crop.r) / Math.max(0.1, 1 - st.crop.l - st.crop.r);
      setSt({ ...st, crop, scale: round(st.scale * keep) });
      setNote('Trimmed. The wheels are now the bottom of the picture, so y = 0 stands the car on the podium.');
    } catch {
      setNote('Couldn’t read the picture to trim it. Use the crop sliders instead.');
    } finally {
      setBusy(false);
    }
  };

  // the box: the cropped picture, bottom-middle at the anchor
  const box = st && W ? (() => {
    const bw = W * st.scale;
    const bh = bw / croppedAspect(st);
    const a = anchor();
    return { left: a.x - bw / 2, top: a.y - bh, width: bw, height: bh };
  })() : null;
  const cw = st ? 1 - st.crop.l - st.crop.r : 1;
  const ch = st ? 1 - st.crop.t - st.crop.b : 1;
  const imgGeo = st ? {
    left: `${(-st.crop.l / cw) * 100}%`, top: `${(-st.crop.t / ch) * 100}%`,
    width: `${100 / cw}%`, height: `${100 / ch}%`,
  } : {};


  return (
    <Modal open onClose={onClose} title={`Place on stage · ${vehicle.brand} ${vehicle.model}`} width="max-w-5xl">
      <div className="p-4 sm:p-5 space-y-4" onKeyDown={onKey} tabIndex={-1}>
        {!src ? (
          <p className="text-sm text-navy-500">This car has no picture yet. Add one in Vehicles → Edit → Images first.</p>
        ) : (
          <>
            <div ref={stageRef} className="relative w-full overflow-hidden rounded-xl bg-black select-none touch-none"
                 style={{ aspectRatio: `${STAGE_W} / ${STAGE_H}`, maxWidth: `calc((92vh - 330px) * ${STAGE_W / STAGE_H})`, marginInline: 'auto' }}
                 onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
              <img src={STAGE_IMG} alt="" draggable={false} className="absolute inset-0 w-full h-full pointer-events-none" />
              {/* the podium's middle, as a guide */}
              {!preview && (
                <span className="absolute w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-amber-300/80 pointer-events-none"
                      style={{ left: P.x, top: P.y }} />
              )}
              {st && box && (
                <div className="absolute" style={{ ...box, transform: `rotate(${st.rotate}deg)`, transformOrigin: '50% 100%' }}>
                  {/* while cropping, the parts being cut away show faintly */}
                  {tab === 'crop' && !preview && (
                    <img src={src} alt="" draggable={false} className="absolute max-w-none opacity-25 pointer-events-none"
                         style={{ ...imgGeo, transform: st.flip ? 'scaleX(-1)' : undefined }} />
                  )}
                  <div className={`absolute inset-0 overflow-hidden ${preview ? '' : 'cursor-move'}`} onPointerDown={down('move')}
                       style={{ transform: st.flip ? 'scaleX(-1)' : undefined }}>
                    <img src={src} alt="" draggable={false} className="absolute max-w-none pointer-events-none" style={imgGeo} />
                  </div>
                  {!preview && (
                    <>
                      <div className="absolute inset-0 border border-dashed border-white/70 pointer-events-none" />
                      {(['-left-2 -top-2', '-right-2 -top-2', '-left-2 -bottom-2', '-right-2 -bottom-2'] as const).map((c) => (
                        <button key={c} type="button" aria-label="Resize" onPointerDown={down('size')}
                                className={`absolute ${c} w-4 h-4 rounded-full bg-white border-2 border-brand-500 cursor-nwse-resize`} />
                      ))}
                      <span className="absolute left-1/2 -top-8 h-6 border-l border-white/70 pointer-events-none" />
                      <button type="button" aria-label="Rotate" onPointerDown={down('turn')}
                              className="absolute left-1/2 -top-10 -ml-2.5 w-5 h-5 rounded-full bg-brand-500 border-2 border-white cursor-grab flex items-center justify-center">
                        <RotateCcw size={10} className="text-white" />
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl bg-navy-50 p-1">
                <button type="button" onClick={() => setTab('place')}
                        className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${tab === 'place' ? 'bg-white shadow-sm font-semibold text-navy-800' : 'text-navy-500'}`}>
                  <Move size={14} /> Place
                </button>
                <button type="button" onClick={() => setTab('crop')}
                        className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-1.5 ${tab === 'crop' ? 'bg-white shadow-sm font-semibold text-navy-800' : 'text-navy-500'}`}>
                  <Crop size={14} /> Crop
                </button>
              </div>
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5" onClick={trim} disabled={busy || !st}>
                <Scissors size={14} /> {busy ? 'Trimming…' : 'Trim empty edges'}
              </button>
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5" onClick={() => set({ flip: !st?.flip })} disabled={!st}>
                <FlipHorizontal2 size={14} /> Flip
              </button>
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5" onClick={() => set({ y: 0 })} disabled={!st}
                      title="Stand the bottom of the picture on the podium's top">
                <AlignVerticalJustifyEnd size={14} /> On the podium
              </button>
              <button type="button" className="btn-secondary !py-1.5 !px-3 text-sm flex items-center gap-1.5" onClick={() => set({ x: 0 })} disabled={!st}>
                <AlignHorizontalJustifyCenter size={14} /> Centre
              </button>
              <label className="ml-auto flex items-center gap-2 text-sm text-navy-600 cursor-pointer">
                <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} className="accent-brand-500" />
                <Eye size={14} /> Preview
              </label>
            </div>

            {st && (tab === 'place' ? (
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                <Slider label="Size" value={st.scale} min={0.15} max={2} step={0.005} onChange={(n) => set({ scale: n })} show={`${Math.round(st.scale * 100)}% of the podium`} />
                <Slider label="Rotate" value={st.rotate} min={-45} max={45} step={0.5} onChange={(n) => set({ rotate: n })} show={`${st.rotate}°`} />
                <Slider label="Left / right" value={st.x} min={-0.8} max={0.8} step={0.002} onChange={(n) => set({ x: n })} show={`${Math.round(st.x * 100)}`} />
                <Slider label="Up / down" value={st.y} min={-0.6} max={0.3} step={0.002} onChange={(n) => set({ y: n })} show={`${Math.round(st.y * 100)}`} />
              </div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
                <Slider label="Cut from the top" value={st.crop.t} min={0} max={0.6} step={0.002} onChange={(n) => setCrop('t', n)} show={`${Math.round(st.crop.t * 100)}%`} />
                <Slider label="Cut from the bottom" value={st.crop.b} min={0} max={0.6} step={0.002} onChange={(n) => setCrop('b', n)} show={`${Math.round(st.crop.b * 100)}%`} />
                <Slider label="Cut from the left" value={st.crop.l} min={0} max={0.6} step={0.002} onChange={(n) => setCrop('l', n)} show={`${Math.round(st.crop.l * 100)}%`} />
                <Slider label="Cut from the right" value={st.crop.r} min={0} max={0.6} step={0.002} onChange={(n) => setCrop('r', n)} show={`${Math.round(st.crop.r * 100)}%`} />
              </div>
            ))}

            {note && <p className="text-sm text-navy-600 bg-navy-50 rounded-xl px-3 py-2">{note}</p>}
            <p className="text-xs text-navy-400">
              Drag the car to move it, a corner dot to resize, the top dot to rotate. Arrow keys nudge it (Shift for bigger steps).
              The wedding page shows it exactly like this.
            </p>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button type="button" className="text-sm text-navy-500 hover:text-navy-700 underline mr-auto"
                      onClick={() => { onSave(null); onClose(); }}>
                Go back to automatic
              </button>
              <button type="button" className="btn-secondary" onClick={() => st && setSt(defaultStage(st.aspect))}>Reset</button>
              <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn-primary" disabled={!st} onClick={() => { if (st) { onSave(st); onClose(); } }}>Save</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
