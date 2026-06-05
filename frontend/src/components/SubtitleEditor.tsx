import React, { useState } from 'react';
import { Transcription, TranscriptionSegment } from './video/NitishRajputComposition';

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
    <div className="flex flex-col h-full bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      <div className="flex justify-between items-center p-4 bg-zinc-950 border-b border-zinc-800 gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h3 className="font-semibold text-zinc-100">Subtitle Editor</h3>
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-full px-2.5 py-1 cursor-pointer" onClick={() => setAdvancedMode(!advancedMode)}>
              <span className="text-[10px] uppercase font-bold text-zinc-400 select-none">Advanced Mode</span>
              <button
                className={`w-8 h-4 rounded-full relative transition-colors ${advancedMode ? 'bg-amber-600' : 'bg-zinc-700'}`}
              >
                <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${advancedMode ? 'translate-x-4' : 'translate-x-0'}`} />
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            {advancedMode ? "Edit individual words to preserve exact timing sync. Be careful with leading/trailing spaces." : "Edit full text. Word-level timestamps will be adjusted automatically."}
          </p>
        </div>
        <button
          onClick={onSave}
          disabled={isSaving}
          className="px-4 py-2 bg-amber-600 cursor-pointer hover:bg-amber-500 text-white text-sm font-medium rounded transition-colors disabled:opacity-50 flex items-center whitespace-nowrap shrink-0"
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

      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {transcription.segments.map((segment) => (
          <div
            key={segment.id}
            className={`p-3 rounded-lg border transition-colors ${editingId === segment.id
                ? 'bg-zinc-800/80 border-amber-500/50'
                : 'bg-zinc-950/50 border-zinc-800/50 hover:border-zinc-700'
              }`}
          >
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-mono text-amber-500/80 bg-amber-500/10 px-2 py-0.5 rounded">
                {formatTime(segment.start)} - {formatTime(segment.end)}
              </span>
              <button
                onClick={() => {
                  const fps = 30; // standard fps used in RemotionVideoPlayer
                  onPlaySegment(Math.floor(segment.start * fps));
                }}
                className="text-xs flex items-center gap-1 text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 px-2 py-1 rounded transition-colors"
              >
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
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
                      className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-base font-medium text-amber-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 w-full text-center"
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
                        className="w-14 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-400 px-1 py-1 text-center focus:outline-none focus:border-amber-500"
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
                        className="w-14 bg-zinc-950 border border-zinc-700 rounded text-xs text-zinc-400 px-1 py-1 text-center focus:outline-none focus:border-amber-500"
                        title="End time"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <textarea
                className={`w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500 resize-y min-h-[60px] ${advancedMode ? 'text-zinc-500 opacity-50' : 'text-zinc-200'}`}
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
