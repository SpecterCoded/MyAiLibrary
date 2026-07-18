import React from 'react';
import type { ButtonHTMLAttributes } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  fullWidth?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ 
  children, 
  variant = 'primary', 
  fullWidth = true, 
  className = '', 
  ...props 
}, ref) => {
  const baseStyles = "inline-flex items-center justify-center font-semibold rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed";
  
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500 shadow-sm",
    secondary: "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500",
    outline: "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50 focus:ring-gray-500 shadow-sm",
    ghost: "text-gray-700 hover:bg-gray-100 hover:text-gray-900 focus:ring-gray-500"
  };

  const sizes = "px-4 py-2.5 text-sm";
  const width = fullWidth ? "w-full" : "";

  return (
    <button
      ref={ref}
      className={`${baseStyles} ${variants[variant]} ${sizes} ${width} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
});
Button.displayName = 'Button';
