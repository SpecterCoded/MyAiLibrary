import React, { useEffect } from "react";
import { CheckCircle, AlertCircle, Info, X } from "lucide-react";

export type ToastType = "success" | "error" | "info";

export interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
}

interface ToastProps {
  toast: ToastMessage;
  onDismiss: (id: number) => void;
}

const iconMap: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />,
  error: <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />,
  info: <Info className="w-4 h-4 text-blue-500 shrink-0" />,
};

const bgMap: Record<ToastType, string> = {
  success: "bg-emerald-50 border-emerald-200 text-emerald-800",
  error: "bg-red-50 border-red-200 text-red-800",
  info: "bg-blue-50 border-blue-200 text-blue-800",
};

export const ToastItem: React.FC<ToastProps> = ({ toast, onDismiss }) => {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 3000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`flex items-center gap-2.5 px-4 py-3 rounded-xl border shadow-lg text-sm font-medium animate-slideDown ${bgMap[toast.type]}`}
    >
      {iconMap[toast.type]}
      <span className="flex-1">{toast.text}</span>
      <button
        onClick={() => onDismiss(toast.id)}
        className="p-0.5 rounded hover:bg-black/5 transition-colors cursor-pointer"
      >
        <X className="w-3.5 h-3.5 opacity-50" />
      </button>
    </div>
  );
};

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: number) => void;
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;
  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: `@keyframes slideDown { from { opacity: 0; transform: translateY(-12px) scale(0.96); } to { opacity: 1; transform: translateY(0) scale(1); } } .animate-slideDown { animation: slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards; }` }} />
      <div className="fixed top-6 left-1/2 -translate-x-1/2 z-[999999] flex flex-col gap-2 items-center pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <ToastItem toast={t} onDismiss={onDismiss} />
          </div>
        ))}
      </div>
    </>
  );
};
