import React, { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, X } from 'lucide-react';

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

export default function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  isDanger = false
}: ConfirmModalProps) {
  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
          {/* Backdrop overlay */}
          <motion.div
            className="absolute inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Modal content box */}
          <motion.div
            className="relative w-full max-w-md bg-white dark:bg-[#1e1f22] border border-slate-100/80 dark:border-white/5 shadow-2xl rounded-3xl p-6 overflow-hidden z-10"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: 'spring', stiffness: 350, damping: 25 }}
          >
            {/* Close Button */}
            <button
              onClick={onClose}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>

            {/* Header Content */}
            <div className="flex flex-col items-center text-center mt-2 mb-6">
              <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${
                isDanger 
                  ? 'bg-rose-50 dark:bg-rose-950/30 text-rose-500 border border-rose-100 dark:border-rose-900/30' 
                  : 'bg-amber-50 dark:bg-amber-950/30 text-amber-500 border border-amber-100 dark:border-amber-900/30'
              }`}>
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-xl font-bold text-slate-900 dark:text-white leading-tight font-display">
                {title}
              </h3>
              <p className="text-sm font-semibold text-slate-500 dark:text-slate-400 mt-2.5 leading-relaxed">
                {message}
              </p>
            </div>

            {/* Actions Footer */}
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-3 rounded-xl font-bold text-slate-700 dark:text-slate-350 hover:bg-slate-50 dark:hover:bg-slate-800 border border-slate-200/50 dark:border-white/5 transition-all cursor-pointer text-center text-sm active:scale-98"
              >
                {cancelText}
              </button>
              <button
                type="button"
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={`flex-1 py-3 rounded-xl font-bold text-white transition-all cursor-pointer text-center text-sm shadow-md active:scale-98 ${
                  isDanger
                    ? 'bg-gradient-to-r from-rose-500 to-red-650 hover:opacity-95 shadow-rose-500/20'
                    : 'bg-gradient-to-r from-[#ff7c53] to-[#eb580a] hover:opacity-95 shadow-orange-500/20'
                }`}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
