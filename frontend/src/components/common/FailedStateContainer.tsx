import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface FailedStateContainerProps {
  message: string;
  onRetry: () => void;
  title?: string;
}

export function FailedStateContainer({ message, onRetry, title = "Generation Failed" }: FailedStateContainerProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 bg-white dark:bg-[#1e1f22]">
      <div className="max-w-md w-full bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-2xl p-8 flex flex-col items-center text-center shadow-sm">
        <div className="w-16 h-16 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center mb-6">
          <AlertTriangle className="w-8 h-8 text-red-500 dark:text-red-400" />
        </div>
        <h3 className="text-xl font-bold text-slate-800 dark:text-slate-100 mb-2">
          {title}
        </h3>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-8 px-4 leading-relaxed">
          {message}
        </p>
        <button
          onClick={onRetry}
          className="flex items-center space-x-2 px-6 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-semibold transition-all active:scale-95 shadow-sm"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Try Again</span>
        </button>
      </div>
    </div>
  );
}
