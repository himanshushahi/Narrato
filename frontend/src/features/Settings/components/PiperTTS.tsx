import React, { useState } from 'react';

import { CustomSelect } from '../../../components/ui/CustomSelect';
import { GlowButton } from '../../../components/ui/GlowButton';
import { PIPER_VOICE_OPTIONS, SPEED_OPTIONS } from '../voiceConstants';
import { callApi } from '../../../utils/call-api';
import { VscCloudDownload, VscLoading } from 'react-icons/vsc';

export const PiperTTS: React.FC<{ 
  appLanguage: string, 
  formData: any, 
  handleSelectChange: (name: string, value: string) => void,
  piperInstalled: boolean,
  onInstallStatusChange: (status: boolean) => void
}> = ({ appLanguage, formData, handleSelectChange, piperInstalled, onInstallStatusChange }) => {
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState('');

  const filteredVoices = PIPER_VOICE_OPTIONS.filter((opt) =>
    appLanguage === 'hi' ? opt.value.startsWith('hi_') : opt.value.startsWith('en_')
  );

  const handleVoiceChange = (val: string) => {
    handleSelectChange('piper_voice', val);
    setDownloadMsg('');
  };

  const downloadModel = async () => {
    setDownloading(true);
    setDownloadMsg('Downloading...');
    try {
      const res = await callApi<{ status: string; message?: string }>('download_piper_model', formData.piper_voice);
      if (res?.status === 'success') {
        setDownloadMsg('Model downloaded/verified successfully.');
        onInstallStatusChange(true);
      } else {
        setDownloadMsg(res?.message || 'Download failed.');
      }
    } catch (e: any) {
      setDownloadMsg(e.message || 'Error occurred during download.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-4">
      <CustomSelect
        label="Piper Offline Voice"
        options={filteredVoices}
        value={formData.piper_voice}
        onChange={handleVoiceChange}
      />
      <CustomSelect
        label="Rate/Speed"
        options={SPEED_OPTIONS}
        value={formData.tts_speed}
        onChange={(val) => handleSelectChange('tts_speed', val)}
      />
      
      {!piperInstalled && (
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-4 space-y-3">
          <p className="text-[10px] text-amber-200/70">
            Ensure the model is downloaded before generating speech. Models are ~30MB.
          </p>
          <GlowButton
            variant="secondary"
            size="sm"
            fullWidth
            onClick={downloadModel}
            disabled={downloading}
            type="button"
            icon={downloading ? <VscLoading className="animate-spin" /> : <VscCloudDownload />}
          >
            {downloading ? 'Downloading / Checking...' : 'Download / Check Model'}
          </GlowButton>
          {downloadMsg && (
            <p className="text-[10px] text-rose-400 font-mono mt-2">{downloadMsg}</p>
          )}
        </div>
      )}
    </div>
  );
};
