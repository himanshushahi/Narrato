import React, { useState } from 'react';
import { Transcription } from '../../../components/video/NitishRajputComposition';
import { CustomToggle } from '../../../components/ui/CustomToggle';

interface SubtitleEditorProps {
  transcription: Transcription;
  onChange: (newTranscription: Transcription) => void;
  onPlaySegment: (startFrame: number) => void;
  onSave: () => void;
  isSaving?: boolean;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  transcription,
  onChange,
  onPlaySegment,
  onSave,
  isSaving = false
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [advancedMode, setAdvancedMode] = useState<boolean>(false);

  if (!transcription || !transcription.segments || transcription.segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4 p-8 text-center">
        <svg className="w-12 h-12 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
        <p>No subtitles available. Ensure transcription is completed first.</p>
      </div>
    );
  }

  const handleTextChange = (id: number, newText: string) => {
    const newSegments = transcription.segments.map(seg => {
      if (seg.id === id) {
        return {
          ...seg,
          text: newText,
          // Clear word-level timestamps so KineticSubtitles uses text-only fallback proportional to length
          words: []
        };
      }
      return seg;
    });

    onChange({ ...transcription, segments: newSegments });
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 1000);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
  };

  return (
    <div className="flex flex-col h-full bg-transparent overflow-hidden">
      <div className="flex flex-col py-4 gap-2 bg-[var(--color-brand-950)]/95 border-b border-stone-850/50 mb-2 sticky top-0 z-10 backdrop-blur-sm">
        <div className="flex justify-between items-center gap-4">
          <div className="flex items-center gap-4">
            <h3 className="text-xl font-bold font-display text-white tracking-tight">Subtitle Editor</h3>
            <CustomToggle label="ADVANCED MODE" checked={advancedMode} onChange={(e) => setAdvancedMode(e.target.checked)} />
          </div>
          <button
            onClick={onSave}
            disabled={isSaving}
            className="px-5 py-2.5 bg-[var(--color-accent-primary)] cursor-pointer hover:bg-[var(--color-accent-hover)] text-white text-sm font-bold rounded-lg transition-colors shadow-md disabled:opacity-50 flex items-center whitespace-nowrap shrink-0"
          >
            {isSaving ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Saving...
              </>
            ) : (
              'Save Changes'
            )}
          </button>
        </div>
        <p className="text-[13px] text-stone-500 max-w-2xl">
          {advancedMode ? "Edit individual words to preserve exact timing sync. Be careful with leading/trailing spaces." : "Edit full text. Word-level timestamps will be adjusted automatically."}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto space-y-3 pb-6">
        {transcription.segments.map((segment) => (
          <div
            key={segment.id}
            className={`p-4 rounded-xl border transition-all ${editingId === segment.id
              ? 'bg-stone-900 border-[var(--color-accent-primary)]/60 shadow-lg'
              : 'bg-black/20 border-stone-850 hover:border-stone-700'
              }`}
          >
            <div className="flex justify-between items-center mb-3">
              <span className="text-[11px] font-mono text-[var(--color-accent-primary)] bg-[var(--color-accent-primary)]/10 border border-[var(--color-accent-primary)]/20 px-2 py-0.5 rounded shadow-sm">
                {formatTime(segment.start)} - {formatTime(segment.end)}
              </span>
              <button
                onClick={() => {
                  const fps = 30; // standard fps used in RemotionVideoPlayer
                  onPlaySegment(Math.floor(segment.start * fps));
                }}
                className="text-xs flex items-center gap-1.5 text-stone-400 hover:text-white bg-stone-900 border border-stone-800 hover:bg-stone-800 px-3 py-1.5 rounded transition-colors cursor-pointer shadow-sm"
              >
                <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" fillRule="evenodd" />
                </svg>
                Preview
              </button>
            </div>
            {advancedMode && segment.words && segment.words.length > 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-2.5 p-3 bg-zinc-950 border border-zinc-800/50 rounded-lg min-h-[60px]">
                {segment.words.map((w, wIdx) => (
                  <div key={wIdx} className="flex flex-col items-center justify-center bg-zinc-900 border border-zinc-800/80 rounded p-1.5 shadow-sm">
                    <input
                      type="text"
                      value={w.word}
                      onFocus={() => setEditingId(segment.id)}
                      onBlur={() => setEditingId(null)}
                      onChange={(e) => {
                        const newWordText = e.target.value;
                        const newSegments = transcription.segments.map(seg => {
                          if (seg.id === segment.id) {
                            const newWords = [...seg.words];
                            newWords[wIdx] = { ...newWords[wIdx], word: newWordText };
                            const newText = newWords.map(w => w.word).join('');
                            return { ...seg, words: newWords, text: newText };
                          }
                          return seg;
                        });
                        onChange({ ...transcription, segments: newSegments });
                      }}
                      className="bg-stone-900 border border-stone-800 rounded px-2 py-1.5 text-[13px] font-medium text-[var(--color-accent-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] focus:ring-1 focus:ring-[var(--color-accent-primary)] w-full text-center shadow-inner"
                    />
                    <div className="flex items-center gap-1.5 mt-2">
                      <input
                        type="number"
                        step="0.1"
                        value={w.start}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const newSegments = transcription.segments.map(seg => {
                            if (seg.id === segment.id) {
                              const newWords = [...seg.words];
                              newWords[wIdx] = { ...newWords[wIdx], start: val };
                              return { ...seg, words: newWords };
                            }
                            return seg;
                          });
                          onChange({ ...transcription, segments: newSegments });
                        }}
                        className="w-14 bg-stone-950 border border-stone-800 rounded text-[11px] font-mono text-stone-400 px-1 py-1 text-center focus:outline-none focus:border-[var(--color-accent-primary)]"
                        title="Start time"
                      />
                      <span className="text-xs font-bold text-zinc-600">-</span>
                      <input
                        type="number"
                        step="0.1"
                        value={w.end}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          const newSegments = transcription.segments.map(seg => {
                            if (seg.id === segment.id) {
                              const newWords = [...seg.words];
                              newWords[wIdx] = { ...newWords[wIdx], end: val };
                              return { ...seg, words: newWords };
                            }
                            return seg;
                          });
                          onChange({ ...transcription, segments: newSegments });
                        }}
                        className="w-14 bg-stone-950 border border-stone-800 rounded text-[11px] font-mono text-stone-400 px-1 py-1 text-center focus:outline-none focus:border-[var(--color-accent-primary)]"
                        title="End time"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <textarea
                className={`w-full bg-[#18181b] border border-stone-800 rounded-lg px-4 py-3 text-[13px] leading-relaxed focus:outline-none focus:border-[var(--color-accent-primary)] focus:ring-1 focus:ring-[var(--color-accent-primary)]/50 resize-y min-h-[80px] shadow-inner ${advancedMode ? 'text-stone-500 opacity-50' : 'text-stone-300'}`}
                value={segment.text}
                onFocus={() => setEditingId(segment.id)}
                onBlur={() => setEditingId(null)}
                onChange={(e) => handleTextChange(segment.id, e.target.value)}
                placeholder={advancedMode ? "Word data missing for this segment." : "Enter subtitle text..."}
                disabled={advancedMode}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
