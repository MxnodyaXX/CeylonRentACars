import { create } from 'zustand';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: Toast[];
  show: (type: ToastType, title: string, message?: string) => void;
  success: (title: string, message?: string) => void;
  error: (title: string, message?: string) => void;
  info: (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  dismiss: (id: string) => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);
const DURATION = 3800; // ms before auto-dismiss

export const useToast = create<ToastState>((set, get) => ({
  toasts: [],

  show: (type, title, message) => {
    const id = uid();
    set((s) => ({ toasts: [...s.toasts, { id, type, title, message }] }));
    setTimeout(() => get().dismiss(id), DURATION);
  },

  success: (title, message) => get().show('success', title, message),
  error:   (title, message) => get().show('error', title, message),
  info:    (title, message) => get().show('info', title, message),
  warning: (title, message) => get().show('warning', title, message),

  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/** Non-hook accessor for use inside store actions / non-React code. */
export const toast = {
  success: (title: string, message?: string) => useToast.getState().success(title, message),
  error:   (title: string, message?: string) => useToast.getState().error(title, message),
  info:    (title: string, message?: string) => useToast.getState().info(title, message),
  warning: (title: string, message?: string) => useToast.getState().warning(title, message),
};
