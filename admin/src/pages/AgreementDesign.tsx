import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  AlignCenter, AlignLeft, AlignRight, ArrowLeft, Bold, Check, Copy, Files, Image as ImageIcon, Italic, Minus, PenLine,
  Printer, ReceiptText, Save, Square, Trash2, Type, Undo2, Upload, ZoomIn, ZoomOut,
} from 'lucide-react';
import Header from '../components/layout/Header';
import Select, { type SelectOption } from '../components/ui/Select';
import { useStore } from '../store/useStore';
import { useAuthStore } from '../store/useAuthStore';
import { toast } from '../store/useToast';
import { bookingNo } from '../lib/bookingRecord';
import {
  A4, DEFAULT_FONT, FIELDS, FONTS, SAMPLE_VALUES, TERM_FIELDS, agreementHtml, agreementValues, applyTerms, breakdownHtml, emptyTemplate, fieldLabel, fillText, imageToPage, isTicked,
  loadAgreementTemplate, pdfToPages, saveAgreementTemplate, uploadTemplateImage,
  type AgreementTemplate, type TplElement, type TplKind,
} from '../lib/agreementTemplate';

/* A scribble shown for signatures in the sample preview */
const SAMPLE_SIG = `data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 60"><path d="M8 42c18-30 30-30 26-6s14-26 22-10 10 12 22-4 8 20 26 2 20-6 30 8 22-14 50-6" fill="none" stroke="#1d3c8f" stroke-width="3" stroke-linecap="round"/></svg>')}`;
const PT_MM = 0.3528;          // 1pt in mm
const snap = (n: number) => Math.round(n * 2) / 2;
const uid = () => `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const KIND_NAME: Record<TplKind, string> = { text: 'Text', box: 'Box', line: 'Line', check: 'Tick', signature: 'Signature', image: 'Image', breakdown: 'Breakdown' };

function elementName(el: TplElement) {
  if (el.kind === 'text') {
    const t = (el.text ?? '').trim();
    const m = t.match(/^\{\{\s*([\w:]+)\s*\}\}$/);
    return m ? fieldLabel(m[1]) : t.slice(0, 34) || 'Text';
  }
  if (el.kind === 'check') return `Tick if ${fieldLabel(el.field ?? '')} = ${el.equals || '…'}`;
  if (el.kind === 'signature') return el.field === 'return' ? 'Customer signature (return)' : 'Customer signature (handover)';
  if (el.kind === 'breakdown') return 'Charge breakdown (how the total was worked out)';
  if (el.kind === 'box') return el.fill === '#ffffff' ? 'White box (cover)' : 'Box';
  return KIND_NAME[el.kind];
}

/** quick choices for a tick box on these fields */
const TICK_CHOICES: Record<string, string[]> = {
  rentalPackage: ['Daily', 'Monthly', 'Hourly'],
  packageBox: ['Daily', 'Weekly', 'Monthly', 'Other'],
  tripType: ['Self drive', 'With driver'],
};

const fieldOptions: SelectOption[] = FIELDS.map((f) => ({ value: f.key, label: f.label, sub: `{{${f.key}}}`, group: f.group }));

/** Text that shrinks until it fits its box (like the printed copy) */
function FitText({ el, text, scale, html }: { el: TplElement; text: string; scale: number; html?: string }) {
  const box = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const base = (el.size || 10) * PT_MM * scale;
  const [size, setSize] = useState(base);
  useLayoutEffect(() => {
    const b = box.current, i = inner.current;
    if (!b || !i) return;
    let s = base;
    b.style.fontSize = `${s}px`;
    if (el.fit !== false) {
      const min = 5 * PT_MM * scale;
      while (s > min && (i.scrollWidth > b.clientWidth + 1 || i.offsetHeight > b.clientHeight + 1)) { s -= 0.5 * PT_MM * scale; b.style.fontSize = `${s}px`; }
    }
    setSize(s);
  }, [text, html, base, el.fit, el.w, el.h, scale, el.bold, el.italic, el.font, el.lineHeight, el.letterSpacing]);
  return (
    <div ref={box} style={{
      position: 'absolute', inset: 0, overflow: 'hidden', display: 'flex', alignItems: html ? 'flex-start' : 'center',
      justifyContent: el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start',
      textAlign: el.align || 'left', fontSize: size, color: el.color || '#111', fontWeight: el.bold ? 700 : 400,
      fontStyle: el.italic ? 'italic' : 'normal', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: el.font || DEFAULT_FONT,
      lineHeight: el.lineHeight || 1.2, letterSpacing: (el.letterSpacing || 0) * PT_MM * scale,
    }}>
      {html ? <div ref={inner} style={{ width: '100%' }} dangerouslySetInnerHTML={{ __html: html }} /> : <div ref={inner} style={{ display: 'inline' }}>{text}</div>}
    </div>
  );
}

type Drag = { id: string; mode: 'move' | 'resize'; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number; group: Record<string, { x: number; y: number }> };
/** the box drawn on an empty part of the page to pick several things (mm) */
type Band = { x0: number; y0: number; x1: number; y1: number };

export default function AgreementDesign() {
  const { bookings, vehicles, owners, drivers } = useStore();
  const me = useAuthStore((s) => s.currentUser?.name) ?? 'Admin';

  const [tpl, setTpl] = useState<AgreementTemplate>(emptyTemplate());
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState('');
  const [pageIdx, setPageIdx] = useState(0);
  const [sels, setSels] = useState<string[]>([]);              // what's selected (several with Shift / Ctrl, or a drawn box)
  const sel = sels.length === 1 ? sels[0] : null;
  const setSel = (id: string | null) => setSels(id ? [id] : []);
  const [band, setBand] = useState<Band | null>(null);
  const [gap, setGap] = useState('');                           // row spacing (mm) for "Same spacing"
  const [zoom, setZoom] = useState(1);
  const [preview, setPreview] = useState<string>('fields');     // 'fields' | 'sample' | booking id
  const past = useRef<AgreementTemplate[]>([]);
  const drag = useRef<Drag | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [wrapW, setWrapW] = useState(800);
  const fileIn = useRef<HTMLInputElement>(null), imgIn = useRef<HTMLInputElement>(null);

  useEffect(() => {
    loadAgreementTemplate(true)
      .then((t) => { if (t) setTpl(t); })
      .catch((e) => toast.error('Could not load the agreement design', e?.message))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  /** Change the template; `record` keeps the old one for undo */
  const commit = useCallback((next: AgreementTemplate | ((t: AgreementTemplate) => AgreementTemplate), record = true) => {
    setTpl((cur) => {
      const n = typeof next === 'function' ? next(cur) : next;
      if (record) { past.current.push(cur); if (past.current.length > 60) past.current.shift(); }
      return n;
    });
    setDirty(true);
  }, []);
  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (prev) { setTpl(prev); setDirty(true); }
  }, []);
  const patch = useCallback((id: string, p: Partial<TplElement>, record = true) =>
    commit((t) => ({ ...t, elements: t.elements.map((e) => (e.id === id ? { ...e, ...p } : e)) }), record), [commit]);
  const remove = useCallback((id: string) => { commit((t) => ({ ...t, elements: t.elements.filter((e) => e.id !== id) })); setSels([]); }, [commit]);
  /** change several at once; `p` may work out each one's change from the element */
  const patchMany = useCallback((ids: string[], p: Partial<TplElement> | ((e: TplElement) => Partial<TplElement>), record = true) => {
    const set = new Set(ids);
    commit((t) => ({ ...t, elements: t.elements.map((e) => (set.has(e.id) ? { ...e, ...(typeof p === 'function' ? p(e) : p) } : e)) }), record);
  }, [commit]);
  const removeMany = useCallback((ids: string[]) => { const set = new Set(ids); commit((t) => ({ ...t, elements: t.elements.filter((e) => !set.has(e.id)) })); setSels([]); }, [commit]);

  const page = tpl.pages[pageIdx] ?? null;
  const pageW = page?.w ?? A4.w, pageH = page?.h ?? A4.h;
  const scale = Math.max(1, ((wrapW - 24) / pageW) * zoom);     // px per mm
  const onPage = tpl.elements.filter((e) => e.page === pageIdx);
  const selected = tpl.elements.find((e) => e.id === sel) ?? null;
  const selSet = new Set(sels);
  const selEls = tpl.elements.filter((e) => selSet.has(e.id));

  /* values shown on the canvas */
  const values = useMemo(() => {
    if (preview === 'fields') return null;
    if (preview === 'sample') return applyTerms({ ...SAMPLE_VALUES, 'sig:pickup': SAMPLE_SIG, 'sig:return': SAMPLE_SIG }, tpl.terms);
    const b = bookings.find((x) => x.id === preview);
    if (!b) return null;
    const v = vehicles.find((x) => x.id === b.vehicleId);
    return applyTerms(agreementValues(b, v, { owner: owners.find((o) => o.id === v?.ownerId), driverName: drivers.find((d) => d.id === b.driverId)?.name, staff: me }), tpl.terms);
  }, [preview, bookings, vehicles, owners, drivers, me, tpl.terms]);

  const bookingOptions: SelectOption[] = useMemo(() => [
    { value: 'fields', label: 'Show field names' },
    { value: 'sample', label: 'Sample customer' },
    ...[...bookings].sort((a, b) => b.startDate.localeCompare(a.startDate)).slice(0, 200).map((b) => {
      const v = vehicles.find((x) => x.id === b.vehicleId);
      return { value: b.id, label: `${b.customerName} · ${v?.vehicleNumber ?? '—'}`, sub: `${bookingNo(b)} · ${b.startDate} · ${b.status}`, group: 'Fill from a booking' };
    }),
  ], [bookings, vehicles]);

  /* ---------- adding ---------- */
  const add = (kind: TplKind, extra: Partial<TplElement> = {}) => {
    if (!page) { toast.warning('Upload the agreement first', 'Add the PDF of your agreement, then place fields on it.'); return; }
    // drop it near the top of what's on screen
    const scrollTop = wrap.current?.scrollTop ?? 0;
    const y = Math.min(pageH - 20, snap(scrollTop / scale + 30));
    const base: TplElement = { id: uid(), page: pageIdx, kind, x: 40, y, w: 70, h: 6 };
    const el: TplElement = {
      ...base,
      ...(kind === 'text' ? { text: 'Text', size: 10, fit: true } : {}),
      ...(kind === 'box' ? { w: 60, h: 6, fill: '#ffffff', border: '' } : {}),
      ...(kind === 'line' ? { w: 60, h: 0.4, color: '#111111' } : {}),
      ...(kind === 'check' ? { w: 5, h: 5, size: 12, field: 'packageBox', equals: '' } : {}),
      ...(kind === 'signature' ? { w: 45, h: 14, field: 'pickup' } : {}),
      ...(kind === 'image' ? { w: 40, h: 25 } : {}),
      ...(kind === 'breakdown' ? { w: 100, h: 30, size: 9, fit: true, color: '#0b1a3a' } : {}),
      ...extra,
    };
    commit((t) => ({ ...t, elements: [...t.elements, el] }));
    setSel(el.id);
  };
  const addField = (key: string) => add('text', { text: `{{${key}}}`, size: 10, fit: true, color: '#0b1a3a' });

  const duplicate = (el: TplElement) => {
    const c = { ...el, id: uid(), x: snap(el.x + 4), y: snap(el.y + 4) };
    commit((t) => ({ ...t, elements: [...t.elements, c] })); setSel(c.id);
  };
  const duplicateMany = (els: TplElement[]) => {
    const cs = els.map((el) => ({ ...el, id: uid(), x: snap(el.x + 4), y: snap(el.y + 4) }));
    commit((t) => ({ ...t, elements: [...t.elements, ...cs] })); setSels(cs.map((c) => c.id));
  };
  const toEveryPage = (el: TplElement) => {
    const copies = tpl.pages.map((_, i) => i).filter((i) => i !== el.page && !tpl.elements.some((e) => e.page === i && e.kind === el.kind && e.text === el.text && e.x === el.x && e.y === el.y))
      .map((i) => ({ ...el, id: uid(), page: i }));
    if (!copies.length) { toast.info('Already on every page'); return; }
    commit((t) => ({ ...t, elements: [...t.elements, ...copies] }));
    toast.success(`Copied to ${copies.length} more page${copies.length === 1 ? '' : 's'}`, 'Same place on each page.');
  };

  /* ---------- keyboard ---------- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement)?.isContentEditable) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void save(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSels(onPage.map((x) => x.id)); return; }
      if (!selEls.length) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') { e.preventDefault(); duplicateMany(selEls); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); removeMany(sels); return; }
      if (e.key === 'Escape') { setSels([]); return; }
      const step = e.shiftKey ? 5 : 0.5;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (d) { e.preventDefault(); patchMany(sels, (x) => ({ x: +(x.x + d[0]).toFixed(2), y: +(x.y + d[1]).toFixed(2) }), !e.repeat); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  /* ---------- drag ---------- */
  const startDrag = (e: RPointerEvent, el: TplElement, mode: Drag['mode']) => {
    e.stopPropagation(); e.preventDefault();
    // Shift / Ctrl / ⌘ + click: add it to (or take it out of) the selection
    if (mode === 'move' && (e.shiftKey || e.ctrlKey || e.metaKey)) {
      setSels((cur) => (cur.includes(el.id) ? cur.filter((x) => x !== el.id) : [...cur, el.id]));
      return;
    }
    // dragging one of several selected moves them all
    const inGroup = mode === 'move' && sels.includes(el.id);
    const ids = inGroup ? sels : [el.id];
    if (!inGroup) setSel(el.id);
    past.current.push(tpl);
    const group = Object.fromEntries(tpl.elements.filter((x) => ids.includes(x.id)).map((x) => [x.id, { x: x.x, y: x.y }]));
    drag.current = { id: el.id, mode, sx: e.clientX, sy: e.clientY, ox: el.x, oy: el.y, ow: el.w, oh: el.h, group };
    const move = (ev: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = (ev.clientX - d.sx) / scale, dy = (ev.clientY - d.sy) / scale;
      if (d.mode === 'move') patchMany(Object.keys(d.group), (x) => ({ x: Math.max(-5, Math.min(pageW - 2, snap(d.group[x.id].x + dx))), y: Math.max(-5, Math.min(pageH - 2, snap(d.group[x.id].y + dy))) }), false);
      else patch(d.id, { w: Math.max(1, snap(d.ow + dx)), h: Math.max(el.kind === 'line' ? 0.2 : 2, el.kind === 'line' ? +(d.oh + dy).toFixed(1) : snap(d.oh + dy)) }, false);
    };
    const up = () => { drag.current = null; window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  /** draw a box on an empty part of the page: everything it touches gets selected (Shift / Ctrl adds to the selection) */
  const startBand = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const at = (ev: { clientX: number; clientY: number }) => ({ x: (ev.clientX - r.left) / scale, y: (ev.clientY - r.top) / scale });
    const p0 = at(e), before = e.shiftKey || e.ctrlKey || e.metaKey ? sels : [];
    let b: Band = { x0: p0.x, y0: p0.y, x1: p0.x, y1: p0.y };
    setBand(b);
    setSels(before);
    const move = (ev: PointerEvent) => { const p = at(ev); b = { ...b, x1: p.x, y1: p.y }; setBand(b); };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setBand(null);
      const x0 = Math.min(b.x0, b.x1), x1 = Math.max(b.x0, b.x1), y0 = Math.min(b.y0, b.y1), y1 = Math.max(b.y0, b.y1);
      if (x1 - x0 < 1 && y1 - y0 < 1) return;   // just a click: clears the selection
      const hit = onPage.filter((el) => el.x < x1 && el.x + el.w > x0 && el.y < y1 && el.y + Math.max(el.h, 0.5) > y0).map((el) => el.id);
      setSels([...new Set([...before, ...hit])]);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  /* ---------- upload / save / print ---------- */
  const uploadAgreement = async (files: FileList | null) => {
    if (!files?.length) return;
    const list = Array.from(files);
    if (tpl.pages.length && !confirm(`Replace the ${tpl.pages.length} page${tpl.pages.length === 1 ? '' : 's'} with the new upload? The fields you placed stay on the same page numbers.`)) return;
    try {
      const rendered: { blob: Blob; w: number; h: number }[] = [];
      for (const f of list) {
        if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
          setBusy('Reading the PDF…');
          rendered.push(...await pdfToPages(f, (d, n) => setBusy(`Reading page ${d} of ${n}…`)));
        } else if (f.type.startsWith('image/')) rendered.push(await imageToPage(f));
      }
      if (!rendered.length) { toast.warning('Nothing to add', 'Choose a PDF or page pictures (JPG / PNG).'); return; }
      const pages: AgreementTemplate['pages'] = [];
      for (let i = 0; i < rendered.length; i++) {
        setBusy(`Saving page ${i + 1} of ${rendered.length}…`);
        const src = await uploadTemplateImage(rendered[i].blob, `page-${i + 1}.jpg`);
        pages.push({ src, w: rendered[i].w, h: rendered[i].h });
      }
      commit((t) => ({ ...t, pages }));
      setPageIdx(0);
      toast.success(`${pages.length} page${pages.length === 1 ? '' : 's'} added`, 'Now add fields where the details go, then Save.');
    } catch (e) {
      toast.error('Could not add the agreement', (e as Error)?.message);
    } finally { setBusy(''); }
  };

  const uploadImage = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    try {
      setBusy('Saving the picture…');
      const src = await uploadTemplateImage(f, f.name.replace(/[^\w.-]/g, '_'));
      if (selected?.kind === 'image') patch(selected.id, { src }); else add('image', { src });
    } catch (e) { toast.error('Could not save the picture', (e as Error)?.message); }
    finally { setBusy(''); }
  };

  async function save() {
    setSaving(true);
    try {
      await saveAgreementTemplate({ ...tpl, updatedBy: me });
      setDirty(false);
      toast.success('Agreement design saved', 'Print agreement on any booking now fills it in.');
    } catch (e) {
      toast.error('Could not save', (e as Error)?.message || 'Try again.');
    } finally { setSaving(false); }
  }

  const testPrint = () => {
    if (!tpl.pages.length) return;
    const v = values ?? { ...Object.fromEntries(FIELDS.map((f) => [f.key, `{{${f.key}}}`])), breakdown: SAMPLE_VALUES.breakdown };
    const w = window.open('', '_blank', 'width=900,height=1100');
    if (!w) { toast.error('The print window was blocked', 'Allow pop-ups for this site.'); return; }
    w.document.write(agreementHtml(tpl, v, 'Agreement test print'));
    w.document.close();
  };

  if (!useAuthStore.getState().isAdmin()) return <p className="text-sm text-navy-500">Only the admin can change the agreement design.</p>;

  /* ---------- element on the canvas ---------- */
  const renderEl = (el: TplElement) => {
    const isSel = selSet.has(el.id);
    const style: CSSProperties = { position: 'absolute', left: el.x * scale, top: el.y * scale, width: el.w * scale, height: Math.max(el.h * scale, 1), cursor: 'move' };
    let body: JSX.Element | null = null;
    if (el.kind === 'text') {
      const raw = el.text ?? '';
      body = <FitText el={el} text={values ? fillText(raw, values) : raw} scale={scale} />;
    } else if (el.kind === 'breakdown') {
      body = <FitText el={{ ...el, size: el.size || 9 }} text="" html={breakdownHtml(el, (values ?? SAMPLE_VALUES).breakdown)} scale={scale} />;
    } else if (el.kind === 'box') {
      body = <div style={{ position: 'absolute', inset: 0, background: el.fill || 'transparent', border: el.border ? `${Math.max(1, 0.3 * scale)}px solid ${el.border}` : undefined }} />;
    } else if (el.kind === 'line') {
      body = <div style={{ position: 'absolute', inset: 0, background: el.color || '#111' }} />;
    } else if (el.kind === 'image') {
      body = el.src ? <img src={el.src} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} /> : <div className="absolute inset-0 bg-navy-100/60 grid place-items-center text-[10px] text-navy-500">Image</div>;
    } else if (el.kind === 'signature') {
      const s = values?.[`sig:${el.field || 'pickup'}`];
      body = s ? <img src={s} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', objectPosition: 'left center' }} />
        : <div className="absolute inset-0 border border-dashed border-sky-400 bg-sky-50/60 grid place-items-center text-sky-700" style={{ fontSize: Math.max(8, 2.6 * scale) }}>{values ? '' : 'Customer signature'}</div>;
    } else if (el.kind === 'check') {
      // field names: a faint tick + what it's for ("Other"), so it's clear none are ticked yet;
      // a booking / the sample: ticked only when it matches, like the print
      const on = values ? isTicked(el, values) : true;
      body = (
        <>
          <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontWeight: 700, fontSize: (el.size || 12) * PT_MM * scale, color: values ? (el.color || '#111') : '#7c3aed', opacity: values ? (on ? 1 : 0) : 0.35 }}>✓</div>
          {!values && (
            <span className={`absolute left-1/2 -translate-x-1/2 bottom-full mb-0.5 whitespace-nowrap rounded px-1 text-[9px] font-semibold leading-tight pointer-events-none ${el.equals ? 'bg-violet-600 text-white' : 'bg-amber-400 text-amber-950'}`}>
              {el.equals || 'set when'}
            </span>
          )}
        </>
      );
    }
    const outline = isSel ? 'outline outline-2 outline-sky-500' : values ? 'hover:outline hover:outline-1 hover:outline-sky-300' : 'outline outline-1 outline-dashed outline-violet-400/70 hover:outline-sky-400';
    return (
      <div key={el.id} style={style} className={`${outline} ${!values && (el.kind === 'text' || el.kind === 'breakdown') ? 'bg-violet-50/40' : ''}`}
           onPointerDown={(e) => startDrag(e, el, 'move')}>
        {body}
        {el.id === sel && (
          <span onPointerDown={(e) => startDrag(e, el, 'resize')} title="Drag to resize"
                className="absolute -right-1.5 -bottom-1.5 w-3 h-3 rounded-sm bg-white border-2 border-sky-500 cursor-nwse-resize" />
        )}
      </div>
    );
  };

  const btn = 'inline-flex items-center gap-1.5 rounded-lg border border-navy-100 bg-white px-2.5 py-1.5 text-xs font-semibold text-navy-700 hover:bg-navy-50 disabled:opacity-50';
  const tog = (on: boolean) => `p-1.5 rounded ${on ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-600'}`;

  /** Font, size, spacing, colour… for one text or several at once (a mixed value shows empty) */
  const styleControls = (els: TplElement[]) => {
    const ids = els.map((e) => e.id);
    const set = (p: Partial<TplElement>, record = true) => patchMany(ids, p, record);
    const same = <T,>(get: (e: TplElement) => T): T | undefined => { const v = els.map(get); return v.every((x) => x === v[0]) ? v[0] : undefined; };
    const defSize = (e: TplElement) => e.size ?? (e.kind === 'breakdown' ? 9 : 10);
    const size = same(defSize), font = same((e) => e.font || DEFAULT_FONT), lh = same((e) => e.lineHeight || 1.2), ls = same((e) => e.letterSpacing || 0);
    const color = same((e) => e.color || '#111111'), align = same((e) => e.align || 'left'), bold = same((e) => !!e.bold), italic = same((e) => !!e.italic), fit = same((e) => e.fit !== false);
    const onlyTables = els.every((e) => e.kind === 'breakdown');
    const lab = 'text-[11px] text-navy-400';
    const inp = 'input !py-1 !px-2 text-xs mt-0.5';
    return (
      <div className="space-y-2">
        <label className={`block ${lab}`}>Font
          <select className={inp} value={font ?? ''} onChange={(e) => set({ font: e.target.value })}>
            {font === undefined && <option value="">Mixed</option>}
            {FONTS.map((f) => <option key={f.label} value={f.css} style={{ fontFamily: f.css }}>{f.label}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-1.5">
          <label className={`${lab} w-16`}>Size (pt)
            <input className={inp} type="number" min={5} max={72} step={0.5} value={size ?? ''} placeholder="Mixed" onChange={(e) => +e.target.value && set({ size: +e.target.value }, false)} />
          </label>
          <button type="button" className={`${tog(false)} text-xs font-bold w-8`} title="Smaller (each one by 0.5 pt)" onClick={() => patchMany(ids, (e) => ({ size: Math.max(5, defSize(e) - 0.5) }))}>A−</button>
          <button type="button" className={`${tog(false)} text-xs font-bold w-8`} title="Bigger (each one by 0.5 pt)" onClick={() => patchMany(ids, (e) => ({ size: Math.min(72, defSize(e) + 0.5) }))}>A+</button>
          <label className={lab}>Colour
            <input className="block mt-0.5 h-7 w-10 rounded border border-navy-100" type="color" value={color ?? '#111111'} onChange={(e) => set({ color: e.target.value }, false)} />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          <label className={lab}>Line spacing
            <input className={inp} type="number" min={0.8} max={3} step={0.05} value={lh ?? ''} placeholder="Mixed" onChange={(e) => +e.target.value && set({ lineHeight: +e.target.value }, false)} />
          </label>
          <label className={lab}>Letter spacing (pt)
            <input className={inp} type="number" min={-1} max={5} step={0.1} value={ls ?? ''} placeholder="Mixed" onChange={(e) => e.target.value !== '' && set({ letterSpacing: +e.target.value }, false)} />
          </label>
        </div>
        {!onlyTables && (
          <div className="flex gap-1">
            {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, I]) => (
              <button key={a} type="button" onClick={() => set({ align: a })} className={tog(align === a)}><I size={13} /></button>
            ))}
            <button type="button" onClick={() => set({ bold: !bold })} className={tog(bold === true)}><Bold size={13} /></button>
            <button type="button" onClick={() => set({ italic: !italic })} className={tog(italic === true)}><Italic size={13} /></button>
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-navy-600">
          <input type="checkbox" checked={fit === true} ref={(i) => { if (i) i.indeterminate = fit === undefined; }} onChange={(e) => set({ fit: e.target.checked })} /> Make long text smaller to fit the box
        </label>
      </div>
    );
  };

  /* ---------- lining up several ---------- */
  const arrange = (how: 'left' | 'right' | 'top' | 'width' | 'height' | 'even' | 'gap') => {
    const els = selEls;
    if (els.length < 2) return;
    const first = els.find((e) => e.id === sels[0]) ?? els[0];
    const byY = [...els].sort((a, b) => a.y - b.y);
    const minX = Math.min(...els.map((e) => e.x)), maxR = Math.max(...els.map((e) => e.x + e.w)), minY = Math.min(...els.map((e) => e.y));
    const step = how === 'gap' ? Number(gap) : (byY[byY.length - 1].y - byY[0].y) / (byY.length - 1);
    if (how === 'gap' && !(step > 0)) { toast.warning('Enter the row spacing', 'How far apart each line is, in mm — e.g. 7.5'); return; }
    const rowOf = new Map(byY.map((e, i) => [e.id, i]));
    patchMany(sels, (e) => {
      switch (how) {
        case 'left': return { x: minX };
        case 'right': return { x: +(maxR - e.w).toFixed(2) };
        case 'top': return { y: minY };
        case 'width': return { w: first.w };
        case 'height': return { h: first.h };
        default: return { y: +(byY[0].y + rowOf.get(e.id)! * step).toFixed(2) };
      }
    });
  };
  const num = (label: string, key: 'x' | 'y' | 'w' | 'h', step = 0.5) => selected && (
    <label className="text-[11px] text-navy-400">{label}
      <input className="input !py-1 !px-2 text-xs mt-0.5" type="number" step={step} value={selected[key]}
             onChange={(e) => patch(selected.id, { [key]: +e.target.value || 0 })} />
    </label>
  );

  return (
    <div>
      <Header title="Agreement design" subtitle="Your rental agreement with the booking details filled in when it's printed" />

      {/* toolbar */}
      <div className="sticky top-0 z-20 -mx-1 px-1 py-2 bg-[var(--app-bg,#f8fafc)]/95 backdrop-blur flex flex-wrap items-center gap-2 mb-3">
        <Link to="/settings" className={btn}><ArrowLeft size={13} /> Settings</Link>
        <button type="button" className={btn} onClick={() => fileIn.current?.click()} disabled={!!busy}><Upload size={13} /> {tpl.pages.length ? 'Replace agreement' : 'Upload agreement (PDF)'}</button>
        <input ref={fileIn} type="file" accept="application/pdf,image/*" multiple hidden onChange={(e) => { void uploadAgreement(e.target.files); e.target.value = ''; }} />
        {tpl.pages.length > 0 && <>
        <span className="w-px h-6 bg-navy-100" />
        <div className="w-56"><Select value="" onChange={(k) => k && addField(k)} options={fieldOptions} placeholder="+ Add a booking field" searchable /></div>
        <button type="button" className={btn} onClick={() => add('breakdown')} title="How the total rental charge was worked out — each item with its amount, then the total"><ReceiptText size={13} /> Charge breakdown</button>
        <button type="button" className={btn} onClick={() => add('text')}><Type size={13} /> Text</button>
        <button type="button" className={btn} onClick={() => add('box')} title="A white box covers the dotted line or old text under it"><Square size={13} /> Box</button>
        <button type="button" className={btn} onClick={() => add('line')}><Minus size={13} /> Line</button>
        <button type="button" className={btn} onClick={() => add('check')} title="A tick that shows only when a field matches — e.g. ☐ Daily"><Check size={13} /> Tick box</button>
        <button type="button" className={btn} onClick={() => add('signature')}><PenLine size={13} /> Signature</button>
        <button type="button" className={btn} onClick={() => imgIn.current?.click()} disabled={!!busy}><ImageIcon size={13} /> Image</button>
        <input ref={imgIn} type="file" accept="image/*" hidden onChange={(e) => { void uploadImage(e.target.files); e.target.value = ''; }} />
        </>}
        <span className="flex-1" />
        <button type="button" className={btn} onClick={undo} title="Undo (Ctrl+Z)"><Undo2 size={13} /></button>
        <button type="button" className={btn} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} title="Zoom out"><ZoomOut size={13} /></button>
        <span className="text-xs text-navy-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
        <button type="button" className={btn} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} title="Zoom in"><ZoomIn size={13} /></button>
        <button type="button" className={btn} onClick={testPrint} disabled={!tpl.pages.length}><Printer size={13} /> Test print</button>
        <button type="button" onClick={() => void save()} disabled={saving || !dirty}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-800 hover:bg-navy-900 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
          <Save size={13} /> {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
        </button>
      </div>
      {busy && <p className="mb-3 text-xs font-semibold text-sky-700 bg-sky-50 rounded-lg px-3 py-2">{busy}</p>}

      {!loaded ? <p className="text-sm text-navy-400">Loading…</p> : !tpl.pages.length ? (
        <div className="rounded-2xl border-2 border-dashed border-navy-200 bg-white p-10 text-center max-w-2xl mx-auto">
          <Files size={34} className="mx-auto text-navy-300" />
          <p className="mt-3 font-semibold text-navy-800">Upload your rental agreement</p>
          <p className="mt-1 text-sm text-navy-500">Choose the agreement PDF (or a picture of each page). Then add booking fields on the dotted lines —
            name, NIC, vehicle, dates, amounts… When a booking's agreement is printed, the fields are filled in from that booking.</p>
          <button type="button" onClick={() => fileIn.current?.click()} disabled={!!busy}
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy-800 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"><Upload size={15} /> Upload agreement</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[110px_minmax(0,1fr)_300px] gap-4 items-start">
          {/* pages */}
          <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-y-auto lg:max-h-[calc(100vh-170px)] pb-1">
            {tpl.pages.map((p, i) => {
              const n = tpl.elements.filter((e) => e.page === i).length;
              return (
                <button key={i} type="button" onClick={() => { setPageIdx(i); setSel(null); }}
                        className={`relative shrink-0 w-20 lg:w-full rounded-lg overflow-hidden border-2 bg-white ${i === pageIdx ? 'border-sky-500' : 'border-transparent hover:border-navy-200'}`}>
                  <img src={p.src} alt="" className="w-full block" loading="lazy" />
                  <span className="absolute left-1 top-1 rounded bg-navy-900/80 px-1.5 text-[10px] font-semibold text-white">{i + 1}</span>
                  {n > 0 && <span className="absolute right-1 top-1 rounded bg-violet-600 px-1.5 text-[10px] font-semibold text-white">{n}</span>}
                </button>
              );
            })}
          </div>

          {/* canvas */}
          <div ref={wrap} className="rounded-2xl bg-navy-100/60 p-3 overflow-auto max-h-[calc(100vh-170px)]" onPointerDown={() => setSels([])}>
            {page && (
              <div className="relative mx-auto bg-white shadow-lg select-none" style={{ width: pageW * scale, height: pageH * scale }} onPointerDown={startBand}>
                <img src={page.src} alt="" draggable={false} className="absolute inset-0 w-full h-full pointer-events-none" />
                {onPage.map(renderEl)}
                {band && <div className="absolute border border-sky-500 bg-sky-400/10 pointer-events-none" style={{ left: Math.min(band.x0, band.x1) * scale, top: Math.min(band.y0, band.y1) * scale, width: Math.abs(band.x1 - band.x0) * scale, height: Math.abs(band.y1 - band.y0) * scale }} />}
              </div>
            )}
            <p className="mt-2 text-center text-[11px] text-navy-500">Page {pageIdx + 1} of {tpl.pages.length} · drag to move · corner to resize · Shift+click or draw a box to pick several · Ctrl+A all · arrows nudge (Shift = 5 mm) · Delete removes · Ctrl+D copies</p>
          </div>

          {/* side panel */}
          <div className="space-y-3 lg:max-h-[calc(100vh-170px)] lg:overflow-y-auto">
            <div className="rounded-2xl bg-white border border-navy-100 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Preview with</p>
              <Select value={preview} onChange={setPreview} options={bookingOptions} searchable />
            </div>

            {selEls.length > 1 ? (() => {
              const texts = selEls.filter((e) => e.kind === 'text' || e.kind === 'breakdown');
              const a = 'rounded-lg border border-navy-100 bg-white px-2 py-1.5 text-[11px] font-semibold text-navy-700 hover:bg-navy-50';
              return (
                <div className="rounded-2xl bg-white border border-sky-200 p-3 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-navy-800">{selEls.length} selected{texts.length && texts.length < selEls.length ? ` · ${texts.length} text` : ''}</p>
                    <button type="button" className="text-xs font-semibold text-navy-500 underline" onClick={() => setSels([])}>Clear</button>
                  </div>
                  {texts.length > 0 ? (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Text style — changes all {texts.length}</p>
                      {styleControls(texts)}
                    </div>
                  ) : <p className="text-xs text-navy-500">No text fields in the selection — you can still move and line them up.</p>}
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">Line up</p>
                    <div className="grid grid-cols-3 gap-1">
                      <button type="button" className={a} onClick={() => arrange('left')}>Left edges</button>
                      <button type="button" className={a} onClick={() => arrange('right')}>Right edges</button>
                      <button type="button" className={a} onClick={() => arrange('top')}>Same top</button>
                      <button type="button" className={a} onClick={() => arrange('width')} title="The width of the first one picked">Same width</button>
                      <button type="button" className={a} onClick={() => arrange('height')} title="The height of the first one picked">Same height</button>
                      <button type="button" className={a} onClick={() => arrange('even')} title="Equal space between the top one and the bottom one">Even rows</button>
                    </div>
                    <div className="mt-1.5 flex items-end gap-1.5">
                      <label className="text-[11px] text-navy-400 flex-1">Row spacing (mm)
                        <input className="input !py-1 !px-2 text-xs mt-0.5" type="number" min={1} step={0.5} value={gap} placeholder="e.g. 7.5" onChange={(e) => setGap(e.target.value)} />
                      </label>
                      <button type="button" className={a} onClick={() => arrange('gap')}>Apply</button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button type="button" className={btn} onClick={() => duplicateMany(selEls)}><Copy size={12} /> Duplicate all</button>
                    <button type="button" className={`${btn} !text-red-600`} onClick={() => removeMany(sels)}><Trash2 size={12} /> Delete all</button>
                  </div>
                </div>
              );
            })() : selected ? (
              <div className="rounded-2xl bg-white border border-navy-100 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-navy-800 truncate">{elementName(selected)}</p>
                  <span className="text-[10px] font-semibold uppercase text-navy-400">{KIND_NAME[selected.kind]}</span>
                </div>

                {selected.kind === 'text' && (
                  <>
                    <label className="block text-[11px] text-navy-400">Text — fields in {'{{ }}'} are filled from the booking
                      <textarea className="input !py-1.5 text-sm mt-0.5 font-mono" rows={3} value={selected.text ?? ''} onChange={(e) => patch(selected.id, { text: e.target.value }, false)} />
                    </label>
                    <Select value="" onChange={(k) => k && patch(selected.id, { text: `${selected.text ?? ''}{{${k}}}` })} options={fieldOptions} placeholder="{ } Insert a field here" searchable />
                    {styleControls([selected])}
                  </>
                )}

                {selected.kind === 'breakdown' && (
                  <>
                    <p className="text-[11px] text-navy-500">Fills the empty space under <b>Total rental charge</b> with how it was worked out:
                      the rent (days × rate, or the agreed price), each extra charge, any discount, then the total. Make the box as big as the space.</p>
                    {styleControls([selected])}
                    <label className="flex items-center gap-2 text-xs text-navy-600">
                      <input type="checkbox" checked={selected.showDetail !== false} onChange={(e) => patch(selected.id, { showDetail: e.target.checked })} /> Show how each line was worked out (small text)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-navy-600">
                      <input type="checkbox" checked={selected.showTotal !== false} onChange={(e) => patch(selected.id, { showTotal: e.target.checked })} /> Total line at the bottom
                    </label>
                  </>
                )}

                {selected.kind === 'box' && (
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-[11px] text-navy-400">Fill
                      <input className="block mt-0.5 h-7 w-10 rounded border border-navy-100" type="color" value={selected.fill || '#ffffff'} onChange={(e) => patch(selected.id, { fill: e.target.value }, false)} />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-navy-600 pb-1"><input type="checkbox" checked={!selected.fill} onChange={(e) => patch(selected.id, { fill: e.target.checked ? '' : '#ffffff' })} /> No fill</label>
                    <label className="text-[11px] text-navy-400">Border
                      <input className="block mt-0.5 h-7 w-10 rounded border border-navy-100" type="color" value={selected.border || '#111111'} onChange={(e) => patch(selected.id, { border: e.target.value }, false)} />
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-navy-600 pb-1"><input type="checkbox" checked={!selected.border} onChange={(e) => patch(selected.id, { border: e.target.checked ? '' : '#111111' })} /> No border</label>
                    <p className="text-[11px] text-navy-400 w-full">A white box hides the dotted line or text under it.</p>
                  </div>
                )}

                {selected.kind === 'line' && (
                  <label className="text-[11px] text-navy-400">Colour
                    <input className="block mt-0.5 h-7 w-10 rounded border border-navy-100" type="color" value={selected.color || '#111111'} onChange={(e) => patch(selected.id, { color: e.target.value }, false)} />
                  </label>
                )}

                {selected.kind === 'check' && (
                  <>
                    <p className="text-[11px] text-navy-500">Prints a ✓ only when the field matches — put one over each ☐ box.</p>
                    <Select value={selected.field ?? ''} onChange={(k) => patch(selected.id, { field: k })} options={fieldOptions} searchable />
                    <label className="block text-[11px] text-navy-400">Tick when it is
                      <input className="input !py-1.5 text-sm mt-0.5" value={selected.equals ?? ''} onChange={(e) => patch(selected.id, { equals: e.target.value }, false)} />
                    </label>
                    {TICK_CHOICES[selected.field ?? ''] && (
                      <div className="flex flex-wrap gap-1.5">{TICK_CHOICES[selected.field ?? ''].map((v) => (
                        <button key={v} type="button" onClick={() => patch(selected.id, { equals: v })} className={`px-2 py-1 rounded text-xs font-semibold ${selected.equals === v ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-600'}`}>{v}</button>
                      ))}</div>
                    )}
                    {!selected.equals && <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">Choose when this box gets ticked — e.g. Other — or it never prints.</p>}
                    {(() => {
                      const twin = tpl.elements.find((e) => e.id !== selected.id && e.kind === 'check' && e.page === selected.page && e.field === selected.field && !!selected.equals
                        && (e.equals ?? '').trim().toLowerCase() === selected.equals.trim().toLowerCase());
                      return twin && <p className="text-[11px] font-semibold text-red-700 bg-red-50 rounded-lg px-2 py-1.5">Another tick box on this page also ticks for “{selected.equals}” — both would print ticked. Change one of them.</p>;
                    })()}
                    <p className="text-[11px] text-navy-400">With <b>Show field names</b> every tick box shows faintly with its label. Pick a booking under <b>Preview with</b> to see only the one that prints.</p>
                    <label className="text-[11px] text-navy-400 w-16 block">Size (pt)
                      <input className="input !py-1 !px-2 text-xs mt-0.5" type="number" min={6} max={40} value={selected.size ?? 12} onChange={(e) => patch(selected.id, { size: +e.target.value || 12 })} />
                    </label>
                  </>
                )}

                {selected.kind === 'signature' && (
                  <div className="flex gap-1.5">
                    {([['pickup', 'Signed at handover'], ['return', 'Signed at return']] as const).map(([k, l]) => (
                      <button key={k} type="button" onClick={() => patch(selected.id, { field: k })} className={`px-2 py-1 rounded text-xs font-semibold ${(selected.field || 'pickup') === k ? 'bg-navy-800 text-white' : 'bg-navy-50 text-navy-600'}`}>{l}</button>
                    ))}
                  </div>
                )}

                {selected.kind === 'image' && (
                  <button type="button" className={btn} onClick={() => imgIn.current?.click()}><ImageIcon size={13} /> Change picture</button>
                )}

                <div className="grid grid-cols-4 gap-1.5">
                  {num('Left mm', 'x')}{num('Top mm', 'y')}{num('Width', 'w')}{num('Height', 'h', selected.kind === 'line' ? 0.1 : 0.5)}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  <button type="button" className={btn} onClick={() => duplicate(selected)}><Copy size={12} /> Duplicate</button>
                  {tpl.pages.length > 1 && <button type="button" className={btn} onClick={() => toEveryPage(selected)}><Files size={12} /> Put on every page</button>}
                  <button type="button" className={`${btn} !text-red-600`} onClick={() => remove(selected.id)}><Trash2 size={12} /> Delete</button>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl bg-white border border-navy-100 p-3 text-xs text-navy-500 space-y-1.5">
                <p className="font-semibold text-navy-700">How it works</p>
                <p>1. Pick <b>+ Add a booking field</b> and drag it onto the dotted line.</p>
                <p>2. Use a <b>Tick box</b> over ☐ Daily / ☐ Monthly.</p>
                <p>To change several at once — size, font, spacing — <b>Shift+click</b> them, or <b>draw a box</b> around them on an empty part of the page (Ctrl+A picks the whole page).</p>
                <p>3. Choose a booking under <b>Preview with</b> to check it fits, then <b>Save</b>.</p>
                <p>Print agreement on a booking then prints these pages filled in.</p>
              </div>
            )}

            <details className="rounded-2xl bg-white border border-navy-100 p-3 group">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-navy-400">Company terms · {TERM_FIELDS.length}</summary>
              <p className="mt-1.5 text-[11px] text-navy-500">Your standard terms — printed the same on every agreement. Add them with <b>+ Add a booking field</b> (group “Company terms”).
                You can put booking fields inside, e.g. <span className="font-mono">{'{{pickupDateTime}}'}</span>.</p>
              <div className="mt-2 space-y-2">
                {TERM_FIELDS.map((f) => (
                  <label key={f.key} className="block text-[11px] text-navy-500">{f.label}
                    <textarea className="input !py-1 text-xs mt-0.5" rows={2} value={tpl.terms?.[f.key] ?? f.sample}
                              onChange={(e) => commit((t) => ({ ...t, terms: { ...(t.terms ?? {}), [f.key]: e.target.value } }), false)} />
                  </label>
                ))}
              </div>
            </details>

            <div className="rounded-2xl bg-white border border-navy-100 p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-navy-400 mb-1.5">On page {pageIdx + 1} · {onPage.length}</p>
              {onPage.length === 0 ? <p className="text-xs text-navy-400">Nothing placed on this page yet.</p> : (
                <ul className="space-y-1">
                  {onPage.map((el, i) => (
                    <li key={el.id}>
                      <button type="button" onClick={(e) => (e.shiftKey || e.ctrlKey || e.metaKey
                                ? setSels((cur) => (cur.includes(el.id) ? cur.filter((x) => x !== el.id) : [...cur, el.id]))
                                : setSel(el.id))}
                              className={`w-full text-left rounded-lg border px-2 py-1 text-xs truncate ${selSet.has(el.id) ? 'border-sky-500 bg-sky-50 text-navy-900' : 'border-navy-100 text-navy-600 hover:bg-navy-50'}`}>
                        {i + 1}. {elementName(el)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-[10px] text-navy-400">Later items print on top of earlier ones.</p>
            </div>
            {tpl.updatedAt && <p className="text-[11px] text-navy-400 px-1">Last saved {new Date(tpl.updatedAt).toLocaleString('en-GB')}{tpl.updatedBy ? ` by ${tpl.updatedBy}` : ''}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
