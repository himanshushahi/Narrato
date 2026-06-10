import React, { useState } from 'react';
import { VscSave, VscLoading, VscPlay } from 'react-icons/vsc';
import { Transcription } from '../../../components/video/NitishRajputComposition';
import { CustomToggle } from '../../../components/ui/CustomToggle';

interface SubtitleEditorProps {
  transcription: Transcription;
  onChange: (newTranscription: Transcription) => void;
  onPlaySegment: (startFrame: number) => void;
  onSave: () => void;
  isSaving?: boolean;
  /** When true, the internal header (title, advanced toggle, save btn) is hidden
   *  because the parent provides its own. advancedMode must also be provided
   *  so the parent drives the advanced edit mode externally. */
  embedded?: boolean;
  advancedMode?: boolean;
}

export const SubtitleEditor: React.FC<SubtitleEditorProps> = ({
  transcription,
  onChange,
  onPlaySegment,
  onSave,
  isSaving = false,
  embedded = false,
  advancedMode: externalAdvancedMode
}) => {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [internalAdvancedMode, setInternalAdvancedMode] = useState<boolean>(false);
  const advancedMode = externalAdvancedMode !== undefined ? externalAdvancedMode : internalAdvancedMode;
  const setAdvancedMode = (value: boolean) => {
    if (externalAdvancedMode === undefined) {
      setInternalAdvancedMode(value);
    }
  };

  if (!transcription || !transcription.segments || transcription.segments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-zinc-500 space-y-4 p-8 text-center">
        <svg className="w-12 h-12 text-zinc-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 6h16M4 12h16m-7 6h7" />
        </svg>
        <p className="text-xs">No subtitles available. Ensure transcription is completed first.</p>
      </div>
    );
  }

  const handleTextChange = (id: number, newText: string) => {
    const newSegments = transcription.segments.map(seg => {
      if (seg.id === id) {
        return {
          ...seg,
          text: newText,
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
    <div className="flex flex-col h-full bg-transparent">
      {!embedded && (
        <div className="sticky top-0 z-10 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800/50 px-4 py-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h3 className="text-xs font-bold text-zinc-300">Subtitles</h3>
              <CustomToggle
                label="ADVANCED"
                checked={advancedMode}
                onChange={(e) => setAdvancedMode(e.target.checked)}
              />
            </div>
            <button
              onClick={onSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 text-[10px] font-bold transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? <VscLoading className="animate-spin text-[10px]" /> : <VscSave className="text-[10px]" />}
              {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
          {advancedMode && (
            <p className="text-[10px] text-zinc-500 mt-1.5">Edit individual words. Be careful with leading/trailing spaces.</p>
          )}
        </div>
      )}

      {/* Segment list */}
      <div className="flex-1 overflow-y-auto space-y-2 p-4">
        {transcription.segments.map((segment) => (
          <div
            key={segment.id}
            className={`rounded-lg border transition-all ${
              editingId === segment.id
                ? 'bg-zinc-900 border-blue-600/60'
                : 'bg-black/20 border-zinc-800 hover:border-zinc-700'
            }`}
          >
            {/* Segment header row */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40">
              <span className="text-[10px] font-mono text-blue-400 bg-blue-600/10 px-2 py-0.5 rounded">
                {formatTime(segment.start)} - {formatTime(segment.end)}
              </span>
              <button
                onClick={() => {
                  onPlaySegment(Math.floor(segment.start * 30));
                }}
                className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-white px-2 py-1 rounded transition-colors"
              >
                <VscPlay className="text-[9px]" />
                Preview
              </button>
            </div>

            {/* Segment content */}
            <div className="p-3">
              {advancedMode && segment.words && segment.words.length > 0 ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2">
                  {segment.words.map((w, wIdx) => (
                    <div
                      key={wIdx}
                      className="flex flex-col bg-zinc-950 border border-zinc-800/60 rounded p-1.5"
                    >
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
                        className="bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-[11px] font-medium text-blue-400 focus:outline-none focus:border-blue-500 text-center w-full"
                      />
                      <div className="flex items-center gap-1 mt-1.5 justify-center">
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
                          className="w-12 bg-zinc-950 border border-zinc-800 rounded text-[9px] font-mono text-zinc-500 px-1 py-0.5 text-center focus:outline-none focus:border-blue-500"
                          title="Start"
                        />
                        <span className="text-[9px] text-zinc-600">-</span>
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
                          className="w-12 bg-zinc-950 border border-zinc-800 rounded text-[9px] font-mono text-zinc-500 px-1 py-0.5 text-center focus:outline-none focus:border-blue-500"
                          title="End"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <textarea
                  className={`w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs leading-relaxed focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 resize-y min-h-[60px] ${
                    advancedMode ? 'text-zinc-600 opacity-50' : 'text-zinc-300'
                  }`}
                  value={segment.text}
                  onFocus={() => setEditingId(segment.id)}
                  onBlur={() => setEditingId(null)}
                  onChange={(e) => handleTextChange(segment.id, e.target.value)}
                  placeholder={advancedMode ? "Word data missing for this segment." : "Enter subtitle text..."}
                  disabled={advancedMode}
                />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
