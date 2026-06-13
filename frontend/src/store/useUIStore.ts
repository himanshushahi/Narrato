import { create } from 'zustand';

export interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
}

interface ConfirmState {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

interface UIStore {
  logs: string[];
  toasts: Toast[];
  confirmState: ConfirmState;
  
  clearLogs: () => void;
  addLog: (msg: string) => void;
  addToast: (message: string, type?: Toast['type'], duration?: number) => void;
  removeToast: (id: string) => void;
  showConfirm: (title: string, message: string, onConfirm: () => void, onCancel?: () => void) => void;
  closeConfirm: () => void;
}

export const useUIStore = create<UIStore>((set, get) => ({
  logs: [],
  toasts: [],
  confirmState: { isOpen: false, title: '', message: '', onConfirm: () => {}, onCancel: () => {} },
  
  clearLogs: () => set({ logs: [] }),
  addLog: (msg: string) => set((state) => {
    const newLogs = [...state.logs, msg];
    if (newLogs.length > 500) {
      newLogs.shift();
    }
    return { logs: newLogs };
  }),
  
  addToast: (message, type = 'info', duration = 3000) => {
    const id = Math.random().toString(36).substring(2, 9);
    set((state) => ({ toasts: [...state.toasts, { id, message, type, duration }] }));
    
    if (duration > 0) {
      setTimeout(() => {
        get().removeToast(id);
      }, duration);
    }
  },
  
  removeToast: (id) => set((state) => ({ toasts: state.toasts.filter(t => t.id !== id) })),
  
  showConfirm: (title, message, onConfirm, onCancel = () => {}) => 
    set({ confirmState: { isOpen: true, title, message, onConfirm, onCancel } }),
    
  closeConfirm: () => 
    set(state => ({ confirmState: { ...state.confirmState, isOpen: false } }))
}));
