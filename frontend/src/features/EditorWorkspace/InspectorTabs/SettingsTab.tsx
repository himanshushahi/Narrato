import React from 'react';
import { ProjectSettingsEditor } from '../../ProjectEditor/ProjectSettingsEditor';

interface SettingsTabProps {
  localProjectSettings: any;
  onSettingsUpdate: (settings: any) => void;
}

export const SettingsTab: React.FC<SettingsTabProps> = ({
  localProjectSettings, onSettingsUpdate
}) => {
  return (
    <div className="flex-1 overflow-y-auto overflow-x-hidden p-4">
      <ProjectSettingsEditor
        settings={localProjectSettings}
        onUpdate={onSettingsUpdate}
      />
    </div>
  );
};
