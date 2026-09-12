import React from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useUIStore } from '../../store/useUIStore';
import { VscWarning } from 'react-icons/vsc';

export const ConfirmModal: React.FC = React.memo(() => {
  // Fix 5: granular selectors — previously whole-store sub re-rendered on
  // every log/toast/agent event even when closed.
  const confirmState = useUIStore((s) => s.confirmState);
  const closeConfirm = useUIStore((s) => s.closeConfirm);

  const handleConfirm = () => {
    confirmState.onConfirm();
    closeConfirm();
  };

  const handleCancel = () => {
    confirmState.onCancel();
    closeConfirm();
  };

  return createPortal(
    <AnimatePresence>
      {confirmState.isOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={handleCancel}
          />
          <motion.div
            initial={{ scale: 0.95, opacity: 0, y: 10 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: 10 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            className="relative w-full max-w-sm bg-stone-900 border border-stone-800 rounded-xl shadow-2xl overflow-hidden"
          >
            <div className="p-5 space-y-3">
              <div className="flex items-start gap-3 text-stone-200">
                <VscWarning className="text-2xl text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-bold text-sm tracking-wide">{confirmState.title || 'Confirm Action'}</h3>
                  <p className="text-xs text-stone-400 mt-1.5 leading-relaxed">
                    {confirmState.message}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-stone-950/50 px-5 py-3 border-t border-stone-800 flex justify-end gap-3">
              <button
                onClick={handleCancel}
                className="px-4 py-1.5 text-xs font-bold text-stone-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                className="px-4 py-1.5 text-xs font-bold bg-amber-600 hover:bg-amber-700 text-zinc-950 rounded shadow-md transition-colors cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body
  );
});
(ConfirmModal as any).displayName = 'ConfirmModal';
