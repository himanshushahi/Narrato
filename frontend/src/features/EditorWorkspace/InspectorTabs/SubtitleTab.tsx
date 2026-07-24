import React, { useState } from 'react';
import { VscSymbolKeyword, VscSave, VscLoading } from 'react-icons/vsc';
import { CustomToggle } from '../../../components/ui/CustomToggle';
import { SubtitleEditor } from '../../ProjectEditor/components/SubtitleEditor';

interface SubtitleTabProps {
  transcriptionData: any;
  localProjectSettings: any;
  isSavingSubtitles: boolean;
  onSettingsUpdate: (settings: any) => void;
  onTranscriptionChange: (data: any) => void;
  onSaveTranscription: () => void;
  onResetTranscription: () => void;
  onPlaySegment: (frame: number) => void;
  onSeek: (frame: number) => void;
}

export const SubtitleTab: React.FC<SubtitleTabProps> = ({
  transcriptionData, isSavingSubtitles,
  onTranscriptionChange, onSaveTranscription, onResetTranscription, onPlaySegment
}) => {
  const [advancedMode, setAdvancedMode] = useState(false);

  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-4">
      <div className="bg-zinc-900/60 rounded-xl border border-zinc-800/60 overflow-hidden">
        <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-zinc-800/40">
          <VscSymbolKeyword className="text-xs text-zinc-500" />
          <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-300">
            Subtitles
          </h3>
          <div className="ml-2">
            <CustomToggle
              label="ADVANCED"
              checked={advancedMode}
              onChange={(e) => setAdvancedMode(e.target.checked)}
            />
          </div>
          {transcriptionData?.segments?.length > 0 && (
            <span className="text-[8px] text-zinc-600 ml-auto">
              {transcriptionData.segments.length} seg
            </span>
          )}
          <div className="flex gap-2">
            <button
              onClick={onResetTranscription}
              disabled={isSavingSubtitles}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-zinc-600/20 hover:bg-zinc-600/30 text-zinc-400 border border-zinc-600/20 text-[10px] font-bold transition-all disabled:opacity-50 cursor-pointer shrink-0"
            >
              Reset
            </button>
            <button
              onClick={onSaveTranscription}
              disabled={isSavingSubtitles}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 text-[10px] font-bold transition-all disabled:opacity-50 cursor-pointer shrink-0"
            >
              {isSavingSubtitles ? <VscLoading className="animate-spin text-[10px]" /> : <VscSave className="text-[10px]" />}
              {isSavingSubtitles ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {/* SubtitleEditor with advanced mode state passed through */}
        <SubtitleEditor
          transcription={transcriptionData}
          onChange={onTranscriptionChange}
          onPlaySegment={onPlaySegment}
          onSave={onSaveTranscription}
          isSaving={isSavingSubtitles}
          embedded
          advancedMode={advancedMode}
        />

        {advancedMode && (
          <p className="text-[9px] text-zinc-500 px-4 pb-3 -mt-1">
            Edit individual words. Be careful with leading/trailing spaces.
          </p>
        )}
      </div>
    </div>
  );
};
