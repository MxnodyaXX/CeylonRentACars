import { X } from 'lucide-react';
import { ReactNode, useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
  /** e.g. 'max-h-[96vh]' for big one-screen forms */
  maxHeight?: string;
  /** extra buttons shown before the close button */
  headerActions?: ReactNode;
}

export default function Modal({ open, onClose, title, children, width = 'max-w-lg', headerActions, maxHeight = 'max-h-[92vh]' }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  // a click outside only counts when it also started outside (selecting text and letting go outside isn't one)
  const downOutside = useRef(false);
  // a click outside asks first, so a form isn't lost by a stray tap — the × button still closes at once
  const [asking, setAsking] = useState(false);
  useEffect(() => { if (!open) setAsking(false); }, [open]);

  if (!open) return null;
  const outside = (t: EventTarget) => !panel.current?.contains(t as Node);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={(e) => { downOutside.current = outside(e.target); }}
      onClick={(e) => { if (downOutside.current && outside(e.target)) setAsking(true); downOutside.current = false; }}
    >
      <div className="absolute inset-0 bg-navy-900/30 backdrop-blur-sm anim-fade-in" />
      <div
        ref={panel}
        className={`relative bg-white w-full ${width} ${maxHeight} overflow-y-auto
          rounded-t-2xl sm:rounded-xl3 shadow-xl anim-panel-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle on mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-navy-200 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-b border-navy-50">
          <h2 className="text-base font-semibold text-navy-800">{title}</h2>
          <div className="flex items-center gap-1">
            {headerActions}
            <button
              onClick={onClose}
              title="Close"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-navy-50 hover:text-navy-700 transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="p-5">{children}</div>
      </div>

      {asking && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4 bg-navy-900/20" onClick={(e) => e.stopPropagation()}>
          <div role="alertdialog" aria-labelledby="modal-close-q" className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-5 space-y-4 anim-panel-in">
            <div>
              <p id="modal-close-q" className="text-base font-semibold text-navy-800">Close "{title}"?</p>
              <p className="text-sm text-navy-500 mt-1">Anything you entered here that isn't saved will be lost.</p>
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" autoFocus onClick={() => setAsking(false)} className="btn-secondary">Keep editing</button>
              <button type="button" onClick={() => { setAsking(false); onClose(); }}
                      className="rounded-xl px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700">Close it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
