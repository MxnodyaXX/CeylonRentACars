import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, Copy, HelpCircle, MessageSquareText } from 'lucide-react';
import { isDanger, mainLabel, useDialogs } from '../../lib/dialog';

/** Draws the app's confirm / text pop-ups (lib/dialog.ts) — one at a time, in the app's own style */
export default function DialogHost() {
  const req = useDialogs((s) => s.queue[0]);
  const done = useDialogs((s) => s.done);
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const okBtn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!req) return;
    setText(req.kind === 'text' ? req.opts.defaultValue ?? '' : '');
    // focus the answer box (selected when it's text to copy), else the main button
    const t = setTimeout(() => {
      if (req.kind === 'text') { input.current?.focus(); if (req.opts.copy) input.current?.select(); }
      else okBtn.current?.focus();
    }, 30);
    return () => clearTimeout(t);
  }, [req]);

  if (!req) return null;
  const copy = req.kind === 'text' && !!req.opts.copy;
  const danger = !copy && isDanger(req.message, req.opts);
  const finish = (ok: boolean) => {
    if (req.kind === 'confirm') req.resolve(ok);
    else req.resolve(ok && !copy ? text : null);
    done();
  };
  // a long question: its first line is the heading, the rest the detail
  const [head, ...rest] = req.message.split('\n');
  const title = req.opts.title ?? (rest.length ? head : undefined);
  const body = req.opts.title ? req.message : rest.length ? rest.join('\n').trim() : head;
  const Icon = copy ? Copy : req.kind === 'text' ? MessageSquareText : danger ? AlertTriangle : HelpCircle;
  const multiline = req.kind === 'text' && (req.opts.multiline || copy && (req.opts.defaultValue ?? '').length > 60);

  return createPortal(
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center sm:p-4" role="presentation"
         onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); finish(false); } }}>
      <div className="absolute inset-0 bg-navy-900/35 backdrop-blur-sm anim-fade-in" onClick={() => finish(false)} />
      <div role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" aria-describedby="dlg-body"
           className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl anim-panel-in p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex gap-3">
          <span className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-navy-50 text-navy-700'}`}><Icon size={19} /></span>
          <div className="min-w-0 flex-1 pt-0.5">
            {title && <h2 id="dlg-title" className="text-[15px] font-semibold text-navy-900 leading-snug">{title}</h2>}
            <p id="dlg-body" className={`whitespace-pre-line text-sm leading-relaxed ${title ? 'text-navy-500 mt-1' : 'text-navy-800 font-medium'}`}>{body}</p>
          </div>
        </div>

        {req.kind === 'text' && (
          <form className="mt-4" onSubmit={(e) => { e.preventDefault(); finish(true); }}>
            {multiline
              ? <textarea ref={input} className="input text-sm" rows={3} value={text} readOnly={copy} placeholder={req.opts.placeholder}
                          onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finish(true); }} />
              : <input ref={input} className="input text-sm" value={text} readOnly={copy} placeholder={req.opts.placeholder ?? (copy ? '' : 'Type here…')}
                       onChange={(e) => setText(e.target.value)} />}
          </form>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          {!copy && <button type="button" onClick={() => finish(false)} className="btn-secondary !py-2 text-sm">{req.opts.cancelLabel ?? 'Cancel'}</button>}
          <button ref={okBtn} type="button" onClick={() => finish(true)}
                  disabled={req.kind === 'text' && !copy && !req.opts.optional && !text.trim()}
                  className={`${danger ? 'bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold px-4 transition-colors' : 'btn-primary'} !py-2 text-sm disabled:opacity-40`}>
            {copy ? 'Close' : req.kind === 'text' ? (req.opts.confirmLabel ?? 'OK') : mainLabel(req.message, req.opts)}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
