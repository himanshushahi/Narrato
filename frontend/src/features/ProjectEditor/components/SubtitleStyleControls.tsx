import React from 'react';
import { CustomSelect } from '../../../components/ui/CustomSelect';
import { CustomColorInput } from '../../../components/ui/CustomColorInput';
import { CustomRange } from '../../../components/ui/CustomRange';

interface SubtitleStyleControlsProps {
  settings: any;
  onUpdate: (newSettings: any) => void;
  setSelectedPresetId: (id: string) => void;
  handleFontChange: (fontFamily: string) => void;
}

export const SubtitleStyleControls: React.FC<SubtitleStyleControlsProps> = ({
  settings,
  onUpdate,
  setSelectedPresetId,
  handleFontChange,
}) => {
  return (
    <div className="grid grid-cols-2 gap-4">
      <CustomSelect
        label="Font Family"
        options={[
          { value: 'Montserrat', label: 'Montserrat (Latin)' },
          { value: 'Inter', label: 'Inter (Latin)' },
          { value: 'Roboto', label: 'Roboto (Latin)' },
          { value: 'Poppins', label: 'Poppins (Supports Hindi)' },
          { value: 'Hind', label: 'Hind (Supports Hindi)' },
          { value: 'Mukta', label: 'Mukta (Supports Hindi)' },
          { value: 'Kalam', label: 'Kalam (Supports Hindi)' },
          { value: 'Noto Sans Devanagari', label: 'Noto Sans Devanagari' },
          { value: 'Lato', label: 'Lato (Latin)' },
          { value: 'Oswald', label: 'Oswald (Latin)' },
          { value: 'Raleway', label: 'Raleway (Latin)' },
          { value: 'Anton', label: 'Anton (Latin)' },
          { value: 'Bebas Neue', label: 'Bebas Neue (Latin)' },
        ]}
        value={settings.fontFamily || 'Montserrat'}
        onChange={handleFontChange}
      />
      <CustomRange
        label="Font Size"
        min="20" max="150"
        value={settings.fontSize !== undefined ? settings.fontSize : 54}
        valueDisplay={`${settings.fontSize !== undefined ? settings.fontSize : 54}px`}
        onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, fontSize: parseInt(e.target.value) || 54 }); }}
      />
      <CustomRange
        label="Word Spacing"
        min="0" max="50"
        value={settings.wordSpacing !== undefined ? settings.wordSpacing : 18}
        valueDisplay={`${settings.wordSpacing !== undefined ? settings.wordSpacing : 18}px`}
        onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, wordSpacing: parseInt(e.target.value) }); }}
      />
      <CustomColorInput
        label="Active Highlight Color"
        value={settings.activeColor || '#fbbf24'}
        onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, activeColor: e.target.value }); }}
      />
      <CustomColorInput
        label="Past/Inactive Text Color"
        value={settings.pastColor || '#d6d3d1'}
        onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, pastColor: e.target.value }); }}
      />
      <CustomSelect
        label="Text Transform"
        options={[
          { value: 'uppercase', label: 'UPPERCASE' },
          { value: 'lowercase', label: 'lowercase' },
          { value: 'capitalize', label: 'Capitalize' },
          { value: 'none', label: 'Normal' },
        ]}
        value={settings.textTransform || 'uppercase'}
        onChange={(val) => { setSelectedPresetId(''); onUpdate({ ...settings, textTransform: val }); }}
      />
      <CustomSelect
        label="Active Animation"
        options={[
          { value: 'bounce', label: 'Bounce (Default)' },
          { value: 'pop', label: 'Pop In' },
          { value: 'jump', label: 'Jump' },
          { value: 'none', label: 'None' },
        ]}
        value={settings.activeAnimation || 'bounce'}
        onChange={(val) => { setSelectedPresetId(''); onUpdate({ ...settings, activeAnimation: val }); }}
      />
      <CustomRange
        label="Y Position (px from bottom)"
        min="0" max="1500"
        value={settings.bottomOffset !== undefined ? settings.bottomOffset : 120}
        valueDisplay={`${settings.bottomOffset !== undefined ? settings.bottomOffset : 120}px`}
        onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, bottomOffset: parseInt(e.target.value) || 0 }); }}
      />
      <CustomRange
        label="Words Per Screen"
        min="1" max="20"
        value={settings.wordsPerScreen !== undefined ? settings.wordsPerScreen : 10}
        valueDisplay={`${settings.wordsPerScreen !== undefined ? settings.wordsPerScreen : 10} words`}
        onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, wordsPerScreen: parseInt(e.target.value) || 10 }); }}
      />
      <div className="flex flex-col gap-1.5 justify-center mt-2 col-span-2">
        <CustomSelect
          label="Background Style"
          options={[
            { value: 'none', label: 'None' },
            { value: 'highlight', label: 'Highlight Read Text' },
            { value: 'full_block', label: 'Entire Subtitle Block' }
          ]}
          value={settings.backgroundStyle || (settings.showBackgroundHighlight !== false ? 'highlight' : 'none')}
          onChange={(val) => { setSelectedPresetId(''); onUpdate({ ...settings, backgroundStyle: val, showBackgroundHighlight: val === 'highlight' }); }}
        />
      </div>
      {(settings.backgroundStyle === 'highlight' || (settings.backgroundStyle === undefined && settings.showBackgroundHighlight !== false)) && (
        <div className="flex flex-col gap-1.5 col-span-2">
          <div className="max-w-[50%]">
            <CustomColorInput
              label="Highlight Color"
              value={settings.highlightBgColor || settings.activeColor || '#fbbf24'}
              onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, highlightBgColor: e.target.value }); }}
            />
          </div>
        </div>
      )}
      {settings.backgroundStyle === 'full_block' && (
        <div className="flex flex-col gap-1.5 col-span-2">
          <div className="max-w-[50%]">
            <CustomColorInput
              label="Full Background Color"
              value={settings.fullBgColor || 'rgba(0,0,0,0.6)'}
              onChange={(e) => { setSelectedPresetId(''); onUpdate({ ...settings, fullBgColor: e.target.value }); }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
