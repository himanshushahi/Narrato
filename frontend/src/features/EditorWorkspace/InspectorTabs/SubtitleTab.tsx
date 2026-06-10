import React from 'react';
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
  transcriptionData, isSavingSubtitles,
  onTranscriptionChange, onSaveTranscription, onPlaySegment
}) => {
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto overflow-x-hidden">
        <SubtitleEditor
          transcription={transcriptionData}
          onChange={onTranscriptionChange}
          onPlaySegment={onPlaySegment}
          onSave={onSaveTranscription}
          isSaving={isSavingSubtitles}
        />
      </div>
    </div>
  );
};
