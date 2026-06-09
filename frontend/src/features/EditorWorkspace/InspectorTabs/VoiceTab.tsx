import React from 'react';
import { motion } from 'framer-motion';
import { VscCheck, VscAccount, VscPlay } from 'react-icons/vsc';
import { CustomRange } from '../../../components/ui/CustomRange';
import { CustomSelect } from '../../../components/ui/CustomSelect';

interface VoiceTabProps {
  ttsEngine?: string;
  ttsVoice?: string;
  onVoiceChange: (engine: string, voice: string) => void;
}

const voiceCards = [
  { id: 'male_narrator', engine: 'edge', label: 'Male Narrator', gender: 'Male', desc: 'Deep, authoritative voice' },
  { id: 'female_narrator', engine: 'edge', label: 'Female Narrator', gender: 'Female', desc: 'Warm, engaging tone' },
  { id: 'deep_documentary', engine: 'edge', label: 'Deep Documentary', gender: 'Male', desc: 'Rich, cinematic narration' },
  { id: 'news_voice', engine: 'edge', label: 'News Voice', gender: 'Female', desc: 'Clear broadcast quality' },
];

export const VoiceTab: React.FC<VoiceTabProps> = ({ ttsVoice, onVoiceChange }) => {
  const selectedVoice = ttsVoice || 'male_narrator';

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
      {/* Voice Selection */}
      <div>
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-2">Voice Selection</h3>
        <div className="grid grid-cols-1 gap-2">
          {voiceCards.map((voice) => {
            const isSelected = selectedVoice === voice.id;
            return (
              <motion.button
                key={voice.id}
                onClick={() => onVoiceChange(voice.engine, voice.id)}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className={`flex items-center gap-3 p-3 rounded-xl border transition-all text-left ${
                  isSelected
                    ? 'bg-blue-600/10 border-blue-500/50'
                    : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  isSelected ? 'bg-blue-600/30 text-blue-400' : 'bg-zinc-800 text-zinc-500'
                }`}>
                  <VscAccount className="text-sm" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold ${isSelected ? 'text-blue-300' : 'text-zinc-200'}`}>
                      {voice.label}
                    </span>
                    <span className="text-[8px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-500 uppercase tracking-wider font-bold">
                      {voice.gender}
                    </span>
                  </div>
                  <p className="text-[9px] text-zinc-500 mt-0.5">{voice.desc}</p>
                </div>
                {isSelected && (
                  <div className="w-5 h-5 rounded-full bg-blue-600 flex items-center justify-center shrink-0">
                    <VscCheck className="text-[9px] text-white" />
                  </div>
                )}
              </motion.button>
            );
          })}
        </div>
      </div>

      {/* Preview button */}
      <button className="flex items-center gap-2 px-4 py-2 bg-zinc-800/50 hover:bg-zinc-700/50 border border-zinc-700 rounded-lg text-xs text-zinc-300 transition-all w-full justify-center">
        <VscPlay className="text-xs text-blue-400" /> Preview Voice
      </button>

      {/* Voice Controls */}
      <div className="glass-panel rounded-xl p-4 space-y-4">
        <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Voice Controls</h3>
        <CustomRange
          label="Speed"
          min={0.5}
          max={2.0}
          step={0.1}
          defaultValue={1.0}
          valueDisplay="1.0x"
        />
        <CustomRange
          label="Pitch"
          min={-12}
          max={12}
          step={1}
          defaultValue={0}
          valueDisplay="0 semitones"
        />
        <CustomSelect
          label="Emotion"
          options={[
            { value: 'neutral', label: 'Neutral' },
            { value: 'energetic', label: 'Energetic' },
            { value: 'calm', label: 'Calm' },
            { value: 'dramatic', label: 'Dramatic' },
          ]}
          value="neutral"
          onChange={() => {}}
        />
      </div>

      <p className="text-[9px] text-zinc-600 text-center">
        Configure additional TTS options in Settings
      </p>
    </div>
  );
};
