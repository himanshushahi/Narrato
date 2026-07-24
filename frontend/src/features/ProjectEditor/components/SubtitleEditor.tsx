import React, { useState, useRef, useEffect } from 'react';
import { VscSave, VscLoading, VscPlay, VscLink } from 'react-icons/vsc';
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
  const [dragState, setDragState] = useState<{ segmentId: number; wordIdx: number; startX: number; startEndVal: number } | null>(null);
  const containerRefs = useRef<Record<number, HTMLDivElement | null>>({});

  const advancedMode = externalAdvancedMode !== undefined ? externalAdvancedMode : internalAdvancedMode;
  const setAdvancedMode = (value: boolean) => {
    if (externalAdvancedMode === undefined) {
      setInternalAdvancedMode(value);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragState) return;
      const seg = transcription.segments.find(s => s.id === dragState.segmentId);
      if (!seg) return;
      const container = containerRefs.current[dragState.segmentId];
      if (!container) return;

      const rect = container.getBoundingClientRect();
      const segDuration = seg.end - seg.start;
      if (segDuration <= 0) return;
      const pixelsPerSecond = rect.width / segDuration;

      const deltaX = e.clientX - dragState.startX;
      const deltaSeconds = deltaX / pixelsPerSecond;

      if (dragState.wordIdx >= seg.words.length - 1) return;

      let newEnd = dragState.startEndVal + deltaSeconds;

      const minEnd = seg.words[dragState.wordIdx].start + 0.05;
      const maxEnd = seg.words[dragState.wordIdx + 1].end - 0.05;
      
      newEnd = Math.max(minEnd, Math.min(maxEnd, newEnd));

      const newSegments = transcription.segments.map(s => {
        if (s.id === dragState.segmentId) {
          const newWords = [...s.words];
          newWords[dragState.wordIdx] = { ...newWords[dragState.wordIdx], end: newEnd };
          newWords[dragState.wordIdx + 1] = { ...newWords[dragState.wordIdx + 1], start: newEnd };
          return { ...s, words: newWords };
        }
        return s;
      });
      onChange({ ...transcription, segments: newSegments });
    };

    const handleMouseUp = () => {
      if (dragState) setDragState(null);
    };

    if (dragState) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragState, transcription, onChange]);

  const handleDragStart = (e: React.MouseEvent, segmentId: number, wordIdx: number) => {
    e.preventDefault();
    const seg = transcription.segments.find(s => s.id === segmentId);
    if (!seg) return;
    setDragState({
      segmentId,
      wordIdx,
      startX: e.clientX,
      startEndVal: seg.words[wordIdx].end
    });
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

  const handleWordTimingChange = (segmentId: number, wordIndex: number, field: 'start' | 'end', val: number) => {
    const newSegments = transcription.segments.map(seg => {
      if (seg.id === segmentId) {
        const newWords = [...seg.words];
        
        // Update the current word
        newWords[wordIndex] = { ...newWords[wordIndex], [field]: val };
        
        // Ripple edit: adjust adjacent words to prevent overlaps
        if (field === 'start' && wordIndex > 0) {
          const prevWord = newWords[wordIndex - 1];
          if (val < prevWord.end) {
             newWords[wordIndex - 1] = { ...prevWord, end: val };
          }
        } else if (field === 'end' && wordIndex < newWords.length - 1) {
          const nextWord = newWords[wordIndex + 1];
          if (val > nextWord.start) {
            newWords[wordIndex + 1] = { ...nextWord, start: val };
          }
        }

        return { ...seg, words: newWords };
      }
      return seg;
    });
    onChange({ ...transcription, segments: newSegments });
  };

  const handleMergeNextWord = (segmentId: number, wordIndex: number) => {
    const newSegments = transcription.segments.map(seg => {
      if (seg.id === segmentId) {
        const newWords = [...seg.words];
        if (wordIndex < newWords.length - 1) {
          const currentWord = newWords[wordIndex];
          const nextWord = newWords[wordIndex + 1];
          
          const mergedWord = {
            ...currentWord,
            word: `${currentWord.word.trim()} ${nextWord.word.trim()}`,
            end: nextWord.end
          };
          
          newWords.splice(wordIndex, 2, mergedWord);
          const newText = newWords.map(w => w.word).join('');
          return { ...seg, words: newWords, text: newText };
        }
      }
      return seg;
    });
    onChange({ ...transcription, segments: newSegments });
  };

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
                className="flex items-center gap-1 text-[9px] text-zinc-500 hover:text-white px-2 py-1 rounded transition-colors cursor-pointer"
              >
                <VscPlay className="text-[9px]" />
                Preview
              </button>
            </div>

            {/* Segment content */}
            <div className="p-3">
              {advancedMode && segment.words && segment.words.length > 0 ? (
                <>
                  {/* Visual Timeline Bar */}
                  <div className="w-full overflow-x-auto pb-2 mb-2 custom-scrollbar">
                    <div 
                      ref={(el) => { containerRefs.current[segment.id] = el; }}
                      className="relative h-8 bg-zinc-950 rounded-lg overflow-hidden flex border border-zinc-800/60 group select-none min-w-full"
                      style={{ minWidth: `max(100%, ${segment.words.length * 50}px)` }}
                    >
                      {segment.words.map((w, wIdx) => {
                         const segDuration = segment.end - segment.start;
                         const widthPct = segDuration > 0 ? ((w.end - w.start) / segDuration) * 100 : 0;
                         return (
                           <div 
                             key={wIdx} 
                             style={{ width: `${Math.max(0, widthPct)}%` }} 
                             className={`relative h-full border-r border-zinc-900 bg-blue-600/10 hover:bg-blue-500/20 transition-colors flex items-center justify-center overflow-hidden ${dragState?.segmentId === segment.id && dragState?.wordIdx === wIdx ? 'bg-blue-500/30' : ''}`}
                           >
                              <span className="text-[10px] text-blue-200/70 font-medium truncate px-1 whitespace-nowrap">
                                {w.word.trim()}
                              </span>
                              {wIdx < segment.words.length - 1 && (
                                <div 
                                  className="absolute right-0 top-0 w-3 h-full cursor-col-resize hover:bg-blue-500 z-10 translate-x-1/2 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                  onMouseDown={(e) => handleDragStart(e, segment.id, wIdx)}
                                >
                                  <div className="w-[1px] h-3 bg-blue-300 rounded-full" />
                                </div>
                              )}
                           </div>
                         )
                      })}
                    </div>
                  </div>

                  {/* Word Grid */}
                  <div className="flex flex-wrap gap-y-3 gap-x-4 items-center">
                  {segment.words.map((w, wIdx) => {
                    const isInvalid = w.start > w.end;
                    const overlapNext = wIdx < segment.words.length - 1 && w.end > segment.words[wIdx + 1].start;
                    
                    return (
                      <div
                        key={wIdx}
                        className={`flex flex-col bg-zinc-950 border rounded p-1.5 w-[130px] relative group transition-colors ${
                          isInvalid || overlapNext ? 'border-red-500/80 shadow-[0_0_8px_rgba(239,68,68,0.2)]' : 'border-zinc-800/60 hover:border-zinc-600'
                        }`}
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
                          className={`bg-zinc-900 border border-zinc-800 rounded px-1.5 py-1 text-[11px] font-medium focus:outline-none focus:border-blue-500 text-center w-full ${isInvalid ? 'text-red-400' : 'text-blue-400'}`}
                        />
                        <div className="flex items-center gap-1 mt-1.5 justify-center">
                          <input
                            type="number"
                            step="0.1"
                            value={w.start}
                            onChange={(e) => handleWordTimingChange(segment.id, wIdx, 'start', parseFloat(e.target.value) || 0)}
                            className={`w-12 bg-zinc-950 border rounded text-[9px] font-mono px-1 py-0.5 text-center focus:outline-none focus:border-blue-500 ${w.start > w.end ? 'border-red-500/80 text-red-400' : 'border-zinc-800 text-zinc-500'}`}
                            title="Start Time"
                          />
                          <span className="text-[9px] text-zinc-600">-</span>
                          <input
                            type="number"
                            step="0.1"
                            value={w.end}
                            onChange={(e) => handleWordTimingChange(segment.id, wIdx, 'end', parseFloat(e.target.value) || 0)}
                            className={`w-12 bg-zinc-950 border rounded text-[9px] font-mono px-1 py-0.5 text-center focus:outline-none focus:border-blue-500 ${w.end < w.start || overlapNext ? 'border-red-500/80 text-red-400' : 'border-zinc-800 text-zinc-500'}`}
                            title="End Time"
                          />
                        </div>
                        {/* Merge button */}
                        {wIdx < segment.words.length - 1 && (
                          <button
                            onClick={() => handleMergeNextWord(segment.id, wIdx)}
                            className="absolute -right-[18px] top-1/2 -translate-y-1/2 z-10 w-5 h-5 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-blue-600 hover:border-blue-500 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                            title="Merge with next word"
                          >
                            <VscLink className="text-[10px]" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                </>
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
