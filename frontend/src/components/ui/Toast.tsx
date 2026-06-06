import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VscCheck, VscError, VscInfo, VscWarning, VscClose } from 'react-icons/vsc';
import { useUIStore, Toast } from '../../store/useUIStore';

interface ToastItemProps {
  toast: Toast;
  onClose: (id: string) => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose }) => {
  const { id, message, type, duration = 4000 } = toast;

  // Icon mapping
  const getIcon = () => {
    switch (type) {
      case 'success':
        return <VscCheck className="text-emerald-400 text-lg shrink-0 mt-0.5" />;
      case 'error':
        return <VscError className="text-rose-400 text-lg shrink-0 mt-0.5" />;
      case 'warning':
        return <VscWarning className="text-amber-400 text-lg shrink-0 mt-0.5" />;
      case 'info':
      default:
        return <VscInfo className="text-sky-400 text-lg shrink-0 mt-0.5" />;
    }
  };

  // Color mapping for glass borders/glows
  const getThemeClass = () => {
    switch (type) {
      case 'success':
        return 'border-emerald-500/20 shadow-[0_4px_30px_rgba(16,185,129,0.08)] bg-zinc-950/80';
      case 'error':
        return 'border-rose-500/20 shadow-[0_4px_30px_rgba(244,63,94,0.08)] bg-zinc-950/80';
      case 'warning':
        return 'border-amber-500/20 shadow-[0_4px_30px_rgba(245,158,11,0.08)] bg-zinc-950/80';
      case 'info':
      default:
        return 'border-sky-500/20 shadow-[0_4px_30px_rgba(14,165,233,0.08)] bg-zinc-950/80';
    }
  };

  const getProgressBarClass = () => {
    switch (type) {
      case 'success':
        return 'bg-emerald-500';
      case 'error':
        return 'bg-rose-500';
      case 'warning':
        return 'bg-amber-500';
      case 'info':
      default:
        return 'bg-sky-500';
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.9 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95, transition: { duration: 0.2 } }}
      className={`w-full max-w-sm pointer-events-auto border rounded-lg p-4 backdrop-blur-xl overflow-hidden relative flex gap-3 items-start select-none ${getThemeClass()}`}
    >
      {getIcon()}
      <div className="flex-1 min-w-0 pr-4">
        <p className="text-xs font-semibold text-slate-200 leading-relaxed break-words">{message}</p>
      </div>
      <button
        onClick={() => onClose(id)}
        className="text-slate-500 hover:text-slate-200 transition-colors shrink-0 mt-0.5 cursor-pointer"
      >
        <VscClose className="text-base" />
      </button>

      {/* Auto-dismiss progress bar */}
      {duration > 0 && (
        <motion.div
          initial={{ width: '100%' }}
          animate={{ width: '0%' }}
          transition={{ duration: duration / 1000, ease: 'linear' }}
          className={`absolute bottom-0 left-0 h-[2px] ${getProgressBarClass()}`}
        />
      )}
    </motion.div>
  );
};

export const ToastContainer: React.FC = () => {
  const toasts = useUIStore((state) => state.toasts);
  const removeToast = useUIStore((state) => state.removeToast);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col gap-3 w-80 md:w-96 max-w-full pointer-events-none">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={removeToast} />
        ))}
      </AnimatePresence>
    </div>
  );
};
