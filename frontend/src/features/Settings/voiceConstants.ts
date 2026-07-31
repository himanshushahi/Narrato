import { SelectOption } from '../../components/ui/CustomSelect';

export const EDGE_VOICE_OPTIONS: SelectOption[] = [
  { value: 'en-US-AndrewNeural', label: 'Andrew (English US - Male)' },
  { value: 'en-US-EmmaNeural', label: 'Emma (English US - Female)' },
  { value: 'hi-IN-SwaraNeural', label: 'Swara (Hindi India - Female)' },
  { value: 'hi-IN-MadhurNeural', label: 'Madhur (Hindi India - Male)' },
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

export const WHISPER_MODEL_OPTIONS: SelectOption[] = [
  { value: 'small', label: 'Small (~460MB) - Good Accuracy' },
  { value: 'collabora/faster-whisper-small-hindi', label: 'Small Hindi (~460MB) - Best for Hindi' },
  { value: 'medium', label: 'Medium (~1.5GB) - High Accuracy' },
  { value: 'turbo', label: 'Turbo (~1.5GB) - Fast & Accurate' },
];
