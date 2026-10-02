import { X } from 'lucide-react';
import { ReactNode } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: string;
}

export default function Modal({ open, onClose, title, children, width = 'max-w-lg' }: Props) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-navy-900/30 backdrop-blur-sm anim-fade-in" />
      <div
        className={`relative bg-white w-full ${width} max-h-[92vh] overflow-y-auto
          rounded-t-2xl sm:rounded-xl3 shadow-xl anim-panel-in`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Drag handle on mobile */}
        <div className="flex justify-center pt-3 pb-1 sm:hidden">
          <div className="w-10 h-1 bg-navy-200 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-b border-navy-50">
          <h2 className="text-base font-semibold text-navy-800">{title}</h2>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-navy-400 hover:bg-navy-50 hover:text-navy-700 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
