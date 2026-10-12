import { useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

/** Finger / mouse signature box. Calls onChange with a PNG data URL (or undefined when cleared). */
export default function SignaturePad({ onChange, height = 140 }: { onChange: (dataUrl?: string) => void; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  // Match the canvas to its on-screen size (sharp lines on high-DPI screens)
  useEffect(() => {
    const c = ref.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = height * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111114';
  }, [height]);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: React.PointerEvent) => {
    ref.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = ref.current!.getContext('2d')!;
    const p = pos(e);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    if (empty) setEmpty(false);
  };
  const up = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (!empty) onChange(ref.current!.toDataURL('image/png'));
  };
  const clear = () => {
    const c = ref.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setEmpty(true);
    onChange(undefined);
  };

  return (
    <div className="relative rounded-xl border border-dashed border-navy-200 bg-white">
      <canvas ref={ref} style={{ height, width: '100%', touchAction: 'none' }} className="block rounded-xl cursor-crosshair"
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Signature area" />
      {empty && <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-navy-300">Customer signs here</p>}
      {!empty && (
        <button type="button" onClick={clear} className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-lg bg-navy-50 px-2 py-1 text-[11px] font-medium text-navy-500 hover:bg-navy-100">
          <Eraser size={12} /> Clear
        </button>
      )}
    </div>
  );
}
