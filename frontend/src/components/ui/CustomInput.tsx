import React, { InputHTMLAttributes, TextareaHTMLAttributes, useState } from 'react';
import { VscEye, VscEyeClosed } from 'react-icons/vsc';

interface CustomInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: React.ReactNode;
}

export const CustomInput: React.FC<CustomInputProps> = ({ label, icon, className = '', type, ...props }) => {
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === 'password';
  const inputType = isPassword ? (showPassword ? 'text' : 'password') : type;

  return (
    <div className="space-y-1.5 w-full">
      {label && <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</label>}
      <div className="relative group flex items-center">
        <input
          type={inputType}
          autoComplete={isPassword ? 'new-password' : 'off'}
          className={`w-full px-4 py-2.5 bg-[var(--color-brand-950)]/50 border border-slate-700/50 rounded-md text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[var(--color-accent-primary)] focus:ring-1 focus:ring-[var(--color-accent-primary)] transition-all text-sm ${icon ? 'pl-10' : ''} ${isPassword ? 'pr-10' : ''} ${className}`}
          {...props}
        />
        {icon && (
          <div className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-[var(--color-accent-primary)] transition-colors">
            {icon}
          </div>
        )}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-[var(--color-accent-primary)] transition-colors"
          >
            {showPassword ? <VscEyeClosed /> : <VscEye />}
          </button>
        )}
      </div>
    </div>
  );
};

interface CustomTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
}

export const CustomTextarea: React.FC<CustomTextareaProps> = ({ label, className = '', ...props }) => {
  return (
    <div className="space-y-1.5 w-full">
      {label && <label className="block text-[10px] text-slate-400 font-bold uppercase tracking-wider">{label}</label>}
      <textarea
        className={`w-full px-4 py-3 bg-[var(--color-brand-950)]/50 border border-slate-700/50 rounded-md text-slate-200 placeholder-slate-600 focus:outline-none focus:border-[var(--color-accent-primary)] focus:ring-1 focus:ring-[var(--color-accent-primary)] transition-all text-sm leading-relaxed resize-none ${className}`}
        {...props}
      />
    </div>
  );
};
