import React, { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Eye, EyeOff, CheckCircle2, XCircle } from 'lucide-react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  validationState?: 'none' | 'valid' | 'invalid';
  enablePasswordToggle?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ 
  label, error, validationState = 'none', enablePasswordToggle, className = '', type, ...props 
}, ref) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const actualType = isPassword && showPassword ? 'text' : type;

  return (
    <div className="flex flex-col gap-1.5 w-full relative">
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <div className="relative">
        <input
          ref={ref}
          type={actualType}
          className={`w-full px-3.5 py-2.5 rounded-lg border bg-white shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-gray-900 ${enablePasswordToggle || validationState !== 'none' ? 'pr-12' : ''} ${error || validationState === 'invalid' ? 'border-red-500 focus:border-red-500 focus:ring-red-500/20' : validationState === 'valid' ? 'border-green-500 focus:border-green-500 focus:ring-green-500/20' : 'border-gray-300 hover:border-gray-400'} ${className}`}
          {...props}
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-2">
          {validationState === 'valid' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
          {validationState === 'invalid' && <XCircle className="w-5 h-5 text-red-500" />}
          {enablePasswordToggle && isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="text-gray-400 hover:text-gray-600 focus:outline-none flex items-center justify-center cursor-pointer"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
      {error && <span className="text-sm text-red-500 mt-0.5">{error}</span>}
    </div>
  );
});
Input.displayName = 'Input';
