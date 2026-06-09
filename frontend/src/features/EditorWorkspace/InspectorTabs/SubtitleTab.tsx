import React from 'react';
import { VscLoading, VscSave, VscSymbolKeyword } from 'react-icons/vsc';
import { ProjectSettingsEditor } from '../../ProjectEditor/ProjectSettingsEditor';
import { SubtitleEditor } from '../../ProjectEditor/components/SubtitleEditor';

interface SubtitleTabProps {
  transcriptionData: any;
  localProjectSettings: any;
  isSavingSubtitles: boolean;
  onSettingsUpdate: (settings: any) => void;
  onTranscriptionChange: (data: any) => void;
  onSaveTranscription: () => void;
  onPlaySegment: (frame: number) => void;
  onSeek: (frame: number) => void;
}

export const SubtitleTab: React.FC<SubtitleTabProps> = ({
  transcriptionData, localProjectSettings, isSavingSubtitles,
  onSettingsUpdate, onTranscriptionChange, onSaveTranscription, onPlaySegment
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-4">
        {/* Subtitle Styling */}
        <div className="glass-panel rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Subtitle Styling</h3>
            <VscSymbolKeyword className="text-zinc-500 text-sm" />
          </div>
          <ProjectSettingsEditor
            settings={localProjectSettings}
            onUpdate={onSettingsUpdate}
          />
        </div>

        {/* Subtitle Segment Editor */}
        <div className="glass-panel rounded-xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">Subtitle Segments</h3>
            <button
              onClick={onSaveTranscription}
              disabled={isSavingSubtitles}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-600/20 text-[9px] font-bold transition-all disabled:opacity-50"
            >
              {isSavingSubtitles ? <VscLoading className="animate-spin" /> : <VscSave />}
              Save Subtitles
            </button>
          </div>
          <div className="min-h-[300px]">
            <SubtitleEditor
              transcription={transcriptionData}
              onChange={onTranscriptionChange}
              onPlaySegment={onPlaySegment}
              onSave={onSaveTranscription}
              isSaving={isSavingSubtitles}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
