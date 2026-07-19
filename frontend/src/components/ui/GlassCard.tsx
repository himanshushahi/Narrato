import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface GlassCardProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
  className?: string;
  hoverEffect?: boolean;
  elevation?: 'low' | 'high';
}

export const GlassCard: React.FC<GlassCardProps> = React.memo(({ 
  children, 
  className = '', 
  hoverEffect = false,
  elevation = 'low',
  ...props 
}) => {
  const baseClass = elevation === 'high' ? 'glass-panel-elevated' : 'glass-panel';
  const hoverClass = hoverEffect ? 'glass-card-hover cursor-pointer' : '';
  
  return (
    <motion.div 
      className={`${baseClass} ${hoverClass} rounded-lg ${className}`}
      initial={false}
      {...props}
    >
      {children}
    </motion.div>
  );
});
GlassCard.displayName = 'GlassCard';
