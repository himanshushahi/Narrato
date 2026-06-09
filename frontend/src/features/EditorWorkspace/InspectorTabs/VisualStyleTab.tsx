import React from 'react';
import { motion } from 'framer-motion';
import { VscCheck, VscSymbolClass } from 'react-icons/vsc';

interface VisualStyleTabProps {
  currentStyle: string;
  onStyleChange: (style: string) => void;
}

const styles = [
  { id: 'documentary', label: 'Documentary', gradient: 'from-amber-600/30 to-orange-600/30', desc: 'Classic documentary feel with warm tones' },
  { id: 'cinematic', label: 'Cinematic', gradient: 'from-blue-600/30 to-purple-600/30', desc: 'Film-like with dramatic color grading' },
  { id: 'news', label: 'News', gradient: 'from-blue-500/30 to-cyan-500/30', desc: 'Clean broadcast-style presentation' },
  { id: 'historical', label: 'Historical', gradient: 'from-amber-800/30 to-yellow-700/30', desc: 'Sepia-toned vintage aesthetic' },
  { id: 'realistic', label: 'Realistic', gradient: 'from-zinc-600/30 to-stone-600/30', desc: 'Natural, unprocessed documentary style' },
  { id: 'anime', label: 'Anime', gradient: 'from-pink-500/30 to-violet-500/30', desc: 'Animated Japanese art style inspired' },
  { id: '3d', label: '3D', gradient: 'from-cyan-600/30 to-emerald-600/30', desc: 'Three-dimensional rendered look' },
];

export const VisualStyleTab: React.FC<VisualStyleTabProps> = ({ currentStyle, onStyleChange }) => {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
      <div className="mb-3">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Visual Style</h3>
        <p className="text-[8px] text-zinc-600 mt-0.5">Choose the aesthetic for your documentary</p>
      </div>

      <div className="grid grid-cols-1 gap-2">
        {styles.map((style) => {
          const isSelected = currentStyle === style.id || (!currentStyle && style.id === 'documentary');

          return (
            <motion.button
              key={style.id}
              onClick={() => onStyleChange(style.id)}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className={`relative flex items-start gap-3 p-3 rounded-xl border transition-all text-left ${
                isSelected
                  ? 'bg-blue-600/10 border-blue-500/50 shadow-lg shadow-blue-900/10'
                  : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700 hover:bg-zinc-800/50'
              }`}
            >
              {/* Thumbnail */}
              <div className={`w-10 h-10 rounded-lg bg-gradient-to-br ${style.gradient} border border-white/10 shrink-0 flex items-center justify-center`}>
                <VscSymbolClass className={`text-sm ${isSelected ? 'text-white' : 'text-zinc-400'}`} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${isSelected ? 'text-blue-300' : 'text-zinc-200'}`}>
                    {style.label}
                  </span>
                </div>
                <p className="text-[9px] text-zinc-500 mt-0.5">{style.desc}</p>
              </div>

              {/* Selected check */}
              {isSelected && (
                <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0 mt-0.5">
                  <VscCheck className="text-[9px] text-white" />
                </div>
              )}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
};
