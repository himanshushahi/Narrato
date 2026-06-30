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

export const PIPER_VOICE_OPTIONS: SelectOption[] = [
  // Hindi
  { value: 'hi_IN-priyamvada', label: 'Priyamvada (Hindi India - Female)' },
  { value: 'hi_IN-rohan', label: 'Rohan (Hindi India - Male)' },
  { value: 'hi_IN-pratham', label: 'Pratham (Hindi India - Male)' },
  
  // English US
  { value: 'en_US-lessac', label: 'Lessac (English US - Female)' },
  { value: 'en_US-amy', label: 'Amy (English US - Female)' },
  { value: 'en_US-kathleen', label: 'Kathleen (English US - Female)' },
  { value: 'en_US-ryan', label: 'Ryan (English US - Male)' },
  { value: 'en_US-joe', label: 'Joe (English US - Male)' },
  { value: 'en_US-danny', label: 'Danny (English US - Male)' },
  
  // English GB
  { value: 'en_GB-alba', label: 'Alba (English GB - Female)' },
  { value: 'en_GB-cori', label: 'Cori (English GB - Female)' },
  { value: 'en_GB-southern_english_female', label: 'Southern (English GB - Female)' },
  { value: 'en_GB-alan', label: 'Alan (English GB - Male)' },
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
  { value: 'tiny', label: 'Tiny (~75MB) - Fastest' },
  { value: 'base', label: 'Base (~140MB) - Balanced' },
  { value: 'small', label: 'Small (~460MB) - Good Accuracy' },
  { value: 'collabora/faster-whisper-small-hindi', label: 'Small Hindi (~460MB) - Best for Hindi' },
  { value: 'medium', label: 'Medium (~1.5GB) - High Accuracy' },
];
