import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface GlowButtonProps extends HTMLMotionProps<"button"> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: React.ReactNode;
  fullWidth?: boolean;
}

export const GlowButton: React.FC<GlowButtonProps> = React.memo(({ 
  children, 
  variant = 'primary', 
  size = 'md', 
  icon,
  fullWidth = false,
  className = '',
  disabled,
  ...props 
}) => {
  
  const baseClasses = "relative flex items-center justify-center gap-2 font-semibold tracking-wide transition-colors overflow-hidden rounded-md";
  
  const sizeClasses = {
    sm: "px-4 py-2 text-xs",
    md: "px-6 py-2.5 text-sm",
    lg: "px-8 py-3.5 text-base"
  };

  const variantClasses = {
    primary: "bg-[var(--color-accent-primary)] hover:bg-[var(--color-accent-hover)] text-white shadow-[0_0_20px_-5px_var(--color-accent-glow)] border border-[var(--color-accent-light)]/20",
    secondary: "bg-[var(--color-brand-700)]/80 hover:bg-[var(--color-brand-600)] text-slate-100 border border-slate-700/50 hover:border-slate-600",
    ghost: "bg-transparent hover:bg-slate-800/50 text-slate-300 hover:text-white",
    danger: "bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/20 hover:border-red-500/40"
  };

  const disabledClasses = disabled ? "opacity-50 cursor-not-allowed filter grayscale-[0.5]" : "cursor-pointer";
  const widthClass = fullWidth ? "w-full" : "";

  return (
    <motion.button
      whileHover={!disabled ? { scale: 1.02, y: -1 } : {}}
      whileTap={!disabled ? { scale: 0.98 } : {}}
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabledClasses} ${widthClass} ${className}`}
      disabled={disabled}
      {...props}
    >
      {/* Glossy overlay for primary buttons */}
      {variant === 'primary' && !disabled && (
        <div className="absolute inset-0 bg-gradient-to-b from-white/20 to-transparent opacity-0 hover:opacity-100 transition-opacity duration-300 pointer-events-none" />
      )}
      
      {icon && <span className="text-[1.1em]">{icon}</span>}
      <span className="relative z-10">{children}</span>
    </motion.button>
  );
});
GlowButton.displayName = 'GlowButton';
