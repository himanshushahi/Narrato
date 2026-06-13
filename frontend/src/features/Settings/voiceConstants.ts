import { SelectOption } from '../../components/ui/CustomSelect';

export const EDGE_VOICE_OPTIONS: SelectOption[] = [
  { value: 'en-US-AndrewNeural', label: 'Andrew (English US - Male)' },
  { value: 'en-US-EmmaNeural', label: 'Emma (English US - Female)' },
  { value: 'hi-IN-SwaraNeural', label: 'Swara (Hindi India - Female)' },
  { value: 'hi-IN-MadhurNeural', label: 'Madhur (Hindi India - Male)' },
];

export const KOKORO_VOICE_OPTIONS: SelectOption[] = [
  { value: 'af_bella', label: 'Bella (US Female - Soft)' },
  { value: 'af_sarah', label: 'Sarah (US Female - Engaging)' },
  { value: 'am_adam', label: 'Adam (US Male - Deep)' },
  { value: 'am_michael', label: 'Michael (US Male - Cinematic)' },
  { value: 'hf_alpha', label: 'Alpha (Hindi Female)' },
  { value: 'hf_beta', label: 'Beta (Hindi Female)' },
  { value: 'hm_omega', label: 'Omega (Hindi Male)' },
  { value: 'hm_psi', label: 'Psi (Hindi Male)' },
];

export const SPEED_OPTIONS: SelectOption[] = [
  { value: '0.8', label: '0.8x (Slow)' },
  { value: '1.0', label: '1.0x (Normal)' },
  { value: '1.2', label: '1.2x (Fast)' },
  { value: '1.4', label: '1.4x (Fastest)' },
];

export const PITCH_OPTIONS: SelectOption[] = [
  { value: '-5Hz', label: '-5Hz (Deeper)' },
  { value: '0Hz', label: '0Hz (Default)' },
  { value: '+5Hz', label: '+5Hz (Higher)' },
];
