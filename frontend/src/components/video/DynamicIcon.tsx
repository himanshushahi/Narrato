import React from 'react';
import * as LucideIcons from 'lucide-react';

export interface DynamicIconProps {
  name?: string;
  size?: number | string;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Converts a kebab-case string (e.g., 'shield-alert', 'trending-up') or snake_case
 * to PascalCase (e.g., 'ShieldAlert', 'TrendingUp').
 */
function toPascalCase(str: string): string {
  if (!str) return 'Sparkles';
  return str
    .replace(/[-_](\w)/g, (_, c) => c.toUpperCase())
    .replace(/^\w/, c => c.toUpperCase());
}

export const DynamicIcon: React.FC<DynamicIconProps> = ({
  name = 'Sparkles',
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  className = '',
  style = {},
}) => {
  const pascalName = toPascalCase(name);
  const IconComponent = (LucideIcons as Record<string, any>)[pascalName] || LucideIcons.Sparkles;

  if (!IconComponent || (typeof IconComponent !== 'function' && typeof IconComponent !== 'object')) {
    return <LucideIcons.Sparkles size={size} color={color} strokeWidth={strokeWidth} className={className} style={style} />;
  }

  return <IconComponent size={size} color={color} strokeWidth={strokeWidth} className={className} style={style} />;
};
