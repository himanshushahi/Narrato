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
 * Common Lucide v0.300+ alias map to ensure 100% resolution
 */
const LUCIDE_NAME_ALIASES: Record<string, string> = {
  'check-circle': 'CheckCircle2',
  'checkcircle': 'CheckCircle2',
  'alert-circle': 'AlertCircle',
  'alertcircle': 'AlertCircle',
  'alert-triangle': 'AlertTriangle',
  'alerttriangle': 'AlertTriangle',
  'alert-octagon': 'AlertOctagon',
  'alertoctagon': 'AlertOctagon',
  'x-circle': 'XCircle',
  'xcircle': 'XCircle',
  'help-circle': 'HelpCircle',
  'helpcircle': 'HelpCircle',
  'refresh-cw': 'RefreshCw',
  'dollar-sign': 'DollarSign',
  'arrow-up-right': 'ArrowUpRight',
  'arrow-down-right': 'ArrowDownRight',
  'shield-alert': 'ShieldAlert',
  'shield-check': 'ShieldCheck',
  'trending-up': 'TrendingUp',
  'trending-down': 'TrendingDown',
  'file-text': 'FileText',
  'credit-card': 'CreditCard',
  'piggy-bank': 'PiggyBank',
  'map-pin': 'MapPin',
};

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

/**
 * Resolve icon component with case-insensitivity and alias fallbacks
 */
function getIconComponent(name: string) {
  if (!name) return LucideIcons.Sparkles;

  const normalized = name.toLowerCase().trim();
  const pascalName = toPascalCase(name);

  // 1. Direct PascalCase lookup
  const iconsDict = LucideIcons as Record<string, any>;
  if (iconsDict[pascalName]) return iconsDict[pascalName];

  // 2. Alias map lookup
  if (LUCIDE_NAME_ALIASES[normalized] && iconsDict[LUCIDE_NAME_ALIASES[normalized]]) {
    return iconsDict[LUCIDE_NAME_ALIASES[normalized]];
  }

  // 3. Try "Circle" or "Triangle" prefixes (Lucide v0.300+ changes)
  const circlePrefix = 'Circle' + pascalName.replace(/Circle$/, '');
  if (iconsDict[circlePrefix]) return iconsDict[circlePrefix];

  const trianglePrefix = 'Triangle' + pascalName.replace(/Triangle$/, '');
  if (iconsDict[trianglePrefix]) return iconsDict[trianglePrefix];

  // 4. Case-insensitive key lookup across all exports
  const cleaned = normalized.replace(/[-_]/g, '');
  for (const key of Object.keys(iconsDict)) {
    if (key.toLowerCase() === cleaned) {
      return iconsDict[key];
    }
  }

  // Fallback
  return iconsDict.Sparkles || null;
}

export const DynamicIcon: React.FC<DynamicIconProps> = ({
  name = 'Sparkles',
  size = 24,
  color = 'currentColor',
  strokeWidth = 2,
  className = '',
  style = {},
}) => {
  const IconComponent = getIconComponent(name) || LucideIcons.Sparkles;

  if (!IconComponent || (typeof IconComponent !== 'function' && typeof IconComponent !== 'object')) {
    return <LucideIcons.Sparkles size={size} color={color} strokeWidth={strokeWidth} className={className} style={style} />;
  }

  return <IconComponent size={size} color={color} strokeWidth={strokeWidth} className={className} style={style} />;
};
