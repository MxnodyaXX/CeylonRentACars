import { useState, useRef } from 'react';
import { Crop, Check } from 'lucide-react';

interface Box { x: number; y: number; w: number; h: number }
type Handle = 'move' | 'tl' | 'tr' | 'bl' | 'br';

interface Props {
  src: string;
  fileName: string;
  aspectRatio?: number; // w/h, defaults to 16/7
  onSave: (file: File) => void;
  onSkip: () => void;
}

const CONTAINER_H = 320;

export default function CropModal({ src, fileName, aspectRatio = 16 / 7, onSave, onSkip }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef       = useRef<HTMLImageElement>(null);
  const dragRef      = useRef<{ handle: Handle; mx0: number; my0: number; box0: Box } | null>(null);
  // image display rect within the container (computed from object-contain layout)
  const dispRef      = useRef<Box>({ x: 0, y: 0, w: 0, h: 0 });

  const [box,        setBox]        = useState<Box>({ x: 0, y: 0, w: 0, h: 0 });
  const [processing, setProcessing] = useState(false);

  // Keep clamp stable by reading from refs
  const clamp = (b: Box): Box => {
    const dr = dispRef.current;
    if (!dr.w) return b;
    let w = Math.max(60, Math.min(b.w, dr.w));
    let h = w / aspectRatio;
    if (h > dr.h) { h = dr.h; w = h * aspectRatio; }
    const x = Math.max(dr.x, Math.min(b.x, dr.x + dr.w - w));
    const y = Math.max(dr.y, Math.min(b.y, dr.y + dr.h - h));
    return { x, y, w, h };
  };

  const initBox = () => {
    const el = imgRef.current;
    const co = containerRef.current;
    if (!el || !co) return;
    const iw = el.naturalWidth;
    const ih = el.naturalHeight;
    if (!iw || !ih) return;
    const cw = co.clientWidth;
    const ch = CONTAINER_H;
    let dw: number, dh: number, dx: number, dy: number;
    if (iw / ih > cw / ch) {
      dw = cw; dh = cw * ih / iw; dx = 0; dy = (ch - dh) / 2;
    } else {
      dh = ch; dw = ch * iw / ih; dx = (cw - dw) / 2; dy = 0;
    }
    dispRef.current = { x: dx, y: dy, w: dw, h: dh };
    let bw = dw * 0.9;
    let bh = bw / aspectRatio;
    if (bh > dh) { bh = dh; bw = bh * aspectRatio; }
    setBox({ x: dx + (dw - bw) / 2, y: dy + (dh - bh) / 2, w: bw, h: bh });
  };

  const getPos = (e: React.MouseEvent | React.TouchEvent) => {
    const rect = containerRef.current!.getBoundingClientRect();
    if ('touches' in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDrag = (handle: Handle, e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const { x, y } = getPos(e);
    dragRef.current = { handle, mx0: x, my0: y, box0: { ...box } };
  };

  const onMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!dragRef.current) return;
    const { handle, mx0, my0, box0 } = dragRef.current;
    const { x, y } = getPos(e);
    const dx = x - mx0;
    const dy = y - my0;
    let nb: Box;
    if (handle === 'move') {
      nb = { ...box0, x: box0.x + dx, y: box0.y + dy };
    } else {
      const brx = box0.x + box0.w;
      const bry = box0.y + box0.h;
      if (handle === 'br') {
        const w = Math.max(60, box0.w + dx); nb = { x: box0.x, y: box0.y, w, h: w / aspectRatio };
      } else if (handle === 'bl') {
        const w = Math.max(60, box0.w - dx); nb = { x: brx - w, y: box0.y, w, h: w / aspectRatio };
      } else if (handle === 'tr') {
        const w = Math.max(60, box0.w + dx); const h = w / aspectRatio;
        nb = { x: box0.x, y: bry - h, w, h };
      } else {
        const w = Math.max(60, box0.w - dx); const h = w / aspectRatio;
        nb = { x: brx - w, y: bry - h, w, h };
      }
    }
    setBox(clamp(nb));
  };

  const stopDrag = () => { dragRef.current = null; };

  const applyCrop = () => {
    setProcessing(true);
    // Preserve PNG when the source is PNG (transparency); otherwise use JPEG
    const isPng = /\.png$/i.test(fileName);
    const outMime = isPng ? 'image/png' : 'image/jpeg';
    const img = new Image();
    img.onload = () => {
      const dr = dispRef.current;
      const sx = Math.max(0, (box.x - dr.x) * (img.naturalWidth  / dr.w));
      const sy = Math.max(0, (box.y - dr.y) * (img.naturalHeight / dr.h));
      const sw = Math.min(img.naturalWidth  - sx, box.w * (img.naturalWidth  / dr.w));
      const sh = Math.min(img.naturalHeight - sy, box.h * (img.naturalHeight / dr.h));
      const outW = Math.min(1920, Math.round(sw));
      const outH = Math.round(outW / aspectRatio);
      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d')!;
      // For JPEG output, fill white first so transparent pixels don't become black
      if (!isPng) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, outW, outH); }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      canvas.toBlob((blob) => {
        setProcessing(false);
        if (!blob) { onSkip(); return; }
        const ext = isPng ? 'png' : (fileName.split('.').pop() ?? 'jpg');
        onSave(new File([blob], `cropped-${Date.now()}.${ext}`, { type: outMime }));
      }, outMime, isPng ? undefined : 0.92);
    };
    img.src = src;
  };

  const HANDLES: Handle[] = ['tl', 'tr', 'bl', 'br'];
  const cursors: Record<Handle, string> = { tl: 'nw-resize', tr: 'ne-resize', bl: 'sw-resize', br: 'se-resize', move: 'move' };

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl overflow-hidden w-full max-w-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-navy-100 flex items-center gap-2.5">
          <Crop size={15} className="text-navy-400" />
          <p className="text-sm font-semibold text-navy-800">Crop Photo</p>
          <p className="text-xs text-navy-400 ml-auto hidden sm:block">Drag the box to position · drag corners to resize</p>
        </div>

        {/* Crop canvas */}
        <div
          ref={containerRef}
          className="relative bg-black select-none overflow-hidden"
          style={{ height: CONTAINER_H }}
          onMouseMove={onMove}
          onMouseUp={stopDrag}
          onMouseLeave={stopDrag}
          onTouchMove={onMove}
          onTouchEnd={stopDrag}
        >
          <img
            ref={imgRef}
            src={src}
            alt=""
            className="w-full h-full object-contain pointer-events-none"
            onLoad={initBox}
          />

          {box.w > 0 && (
            <>
              {/* Dark overlay strips around crop box */}
              <div className="absolute inset-x-0 top-0 bg-black/60 pointer-events-none" style={{ height: box.y }} />
              <div className="absolute inset-x-0 bg-black/60 pointer-events-none" style={{ top: box.y + box.h, bottom: 0 }} />
              <div className="absolute bg-black/60 pointer-events-none" style={{ top: box.y, height: box.h, left: 0, width: box.x }} />
              <div className="absolute bg-black/60 pointer-events-none" style={{ top: box.y, height: box.h, left: box.x + box.w, right: 0 }} />

              {/* Crop box */}
              <div
                className="absolute border-2 border-white"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h, cursor: cursors.move }}
                onMouseDown={(e) => startDrag('move', e)}
                onTouchStart={(e) => startDrag('move', e)}
              >
                {/* Rule-of-thirds grid */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute inset-x-0 border-t border-white/25" style={{ top: '33.33%' }} />
                  <div className="absolute inset-x-0 border-t border-white/25" style={{ top: '66.66%' }} />
                  <div className="absolute inset-y-0 border-l border-white/25" style={{ left: '33.33%' }} />
                  <div className="absolute inset-y-0 border-l border-white/25" style={{ left: '66.66%' }} />
                </div>

                {/* Corner handles */}
                {HANDLES.map((h) => (
                  <div
                    key={h}
                    className="absolute w-4 h-4 bg-white shadow-lg z-10"
                    style={{
                      top:    h.startsWith('t') ? -3 : undefined,
                      bottom: h.startsWith('b') ? -3 : undefined,
                      left:   h.endsWith('l')   ? -3 : undefined,
                      right:  h.endsWith('r')   ? -3 : undefined,
                      cursor: cursors[h],
                    }}
                    onMouseDown={(e) => startDrag(h, e)}
                    onTouchStart={(e) => startDrag(h, e)}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* Footer actions */}
        <div className="px-5 py-3.5 flex justify-between items-center border-t border-navy-100 bg-navy-50/40">
          <button type="button" onClick={onSkip} className="btn-secondary text-sm px-4 py-2">
            Use Original
          </button>
          <button
            type="button"
            onClick={applyCrop}
            disabled={processing || box.w === 0}
            className="btn-primary text-sm px-5 py-2 flex items-center gap-2 disabled:opacity-60"
          >
            {processing
              ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
              : <Check size={14} />
            }
            Apply Crop
          </button>
        </div>
      </div>
    </div>
  );
}
