import { create } from 'zustand';

/*
 * The app's own "are you sure?" and "type a reason" pop-ups — used instead of the browser's
 * confirm() / prompt() boxes ("localhost says…"), which look foreign and can't be styled.
 *
 *   if (!(await askConfirm('Delete this expense?'))) return;
 *   const why = await askText('Why is it rejected?');   // null = cancelled
 *
 * Shown by <DialogHost /> (mounted with the Toaster). One at a time; a second request waits.
 */

export interface ConfirmOptions {
  title?: string;
  /** the main button (default "Confirm"; "Delete" / "Remove" … when the message is about that) */
  confirmLabel?: string;
  cancelLabel?: string;
  /** red main button — worked out from the message when not given */
  danger?: boolean;
}
export interface TextOptions extends ConfirmOptions {
  defaultValue?: string;
  placeholder?: string;
  /** a longer answer box */
  multiline?: boolean;
  /** an empty answer is fine (e.g. an optional note) */
  optional?: boolean;
  /** show the text ready to copy (the clipboard was blocked) — only a Close button */
  copy?: boolean;
}

export type DialogRequest =
  | { kind: 'confirm'; message: string; opts: ConfirmOptions; resolve: (ok: boolean) => void }
  | { kind: 'text'; message: string; opts: TextOptions; resolve: (v: string | null) => void };

interface DialogState { queue: DialogRequest[]; push: (r: DialogRequest) => void; done: () => void }

export const useDialogs = create<DialogState>()((set) => ({
  queue: [],
  push: (r) => set((s) => ({ queue: [...s.queue, r] })),
  done: () => set((s) => ({ queue: s.queue.slice(1) })),
}));

/** "Are you sure?" — true when the main button is pressed */
export function askConfirm(message: string, opts: ConfirmOptions = {}): Promise<boolean> {
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'confirm', message, opts, resolve }));
}

/** Ask for a short text (a reason, a note) — null when cancelled. A string second argument is the starting text. */
export function askText(message: string, opts: TextOptions | string = {}): Promise<string | null> {
  const o: TextOptions = typeof opts === 'string' ? { defaultValue: opts } : opts;
  return new Promise((resolve) => useDialogs.getState().push({ kind: 'text', message, opts: o, resolve }));
}

/** Show a text to copy by hand (when the clipboard is blocked) */
export function showCopy(message: string, text: string): Promise<string | null> {
  return askText(message, { defaultValue: text, copy: true });
}

const DANGER = /\b(delete|remove|switch off|can't be undone|cannot be undone|for good|reject|revoke|cancel (the|this)|reverse)\b/i;
export const isDanger = (message: string, opts: ConfirmOptions) => opts.danger ?? DANGER.test(message);

/** A short main-button label from the question: "Delete this expense?" → "Delete" */
export function mainLabel(message: string, opts: ConfirmOptions): string {
  if (opts.confirmLabel) return opts.confirmLabel;
  const first = /^\s*(Delete|Remove|Approve|Reject|Close|Reopen|Submit|Send|Mark|Make|Return|Shorten|Record|Replace|Create|Give|Reduce|Deduct|Add|Pay|Change|Switch off|Take|Convert|Finish)\b/i.exec(message);
  return first ? first[1][0].toUpperCase() + first[1].slice(1).toLowerCase() : 'Confirm';
}
