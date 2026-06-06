import React from 'react';
import { GlassCard } from '../../../components/ui/GlassCard';
import { VscCheck, VscError, VscKey } from 'react-icons/vsc';

interface AIProviderCardProps {
  title: string;
  provider: string;
  isConnected: boolean;
  children: React.ReactNode;
}

export const AIProviderCard: React.FC<AIProviderCardProps> = ({ 
  title, 
  provider, 
  isConnected,
  children
}) => {
  return (
    <GlassCard className="p-6 relative overflow-hidden group">
      {/* Dynamic glow based on connection status */}
      <div className={`absolute top-0 right-0 w-32 h-32 blur-[60px] rounded-full transition-colors duration-700 ${isConnected ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`} />
      
      <div className="flex items-start justify-between mb-6 relative z-10">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-md bg-[var(--color-brand-800)] border border-slate-700/50 flex items-center justify-center text-xl text-slate-300 shadow-inner">
            <VscKey />
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">{title}</h3>
            <p className="text-xs text-slate-400 font-medium">{provider}</p>
          </div>
        </div>
        
        <div className={`px-3 py-1 rounded-md text-[10px] font-bold tracking-widest uppercase flex items-center gap-1.5 border ${
          isConnected 
            ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 shadow-[0_0_15px_-5px_rgba(16,185,129,0.3)]' 
            : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
        }`}>
          {isConnected ? <VscCheck className="text-sm" /> : <VscError className="text-sm" />}
          {isConnected ? 'Connected' : 'Key Required'}
        </div>
      </div>

      <div className="space-y-4 relative z-10">
        {children}
      </div>
    </GlassCard>
  );
};
