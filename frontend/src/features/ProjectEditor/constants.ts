

export const PIPELINE_STAGES = [
  { id: 'generate_script', title: 'Script Generation', desc: 'AI scriptwriting & cues formulation' },
  { id: 'generate_voiceover', title: 'Voiceover Synthesis', desc: 'Synthesizing AI narrator voiceover' },
  { id: 'transcribe', title: 'Transcription & Sync', desc: 'Whisper word-level audio alignment' },
  { id: 'generate_visuals', title: 'Visuals Generation', desc: 'AI visual cues aligned to transcription' },
  { id: 'fetch_assets', title: 'Fetch Visual Assets', desc: 'Retrieving B-roll clips & images' },
  { id: 'render', title: 'Video Export (Remotion)', desc: 'Compiling frames to final MP4' }
];


export const formatTime = (frame: number) => {
  const totalSeconds = Math.floor(frame / 30);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

