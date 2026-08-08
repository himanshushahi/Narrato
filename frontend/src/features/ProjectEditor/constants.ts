export const VISUAL_TYPE_OPTIONS = [
  { value: 'scene', label: 'B-Roll Video Clip' },
  { value: 'image', label: 'Stock Photograph' },
  { value: 'parallax', label: '2.5D Parallax Photo' },
  { value: 'portrait', label: 'Portrait Photo' },
  { value: 'chart', label: 'Animated Chart' },
  { value: 'map', label: 'Vintage Map' },
  { value: 'network', label: 'Network Diagram' },
  { value: 'document', label: 'Archival Document' },
  { value: 'youtube', label: 'YouTube Video' },
  { value: 'list', label: 'Numbered List' },
  { value: 'custom_html', label: 'Custom HTML' },
  { value: 'timeline', label: 'Timeline Tracker' },
  { value: 'thread', label: 'Social Media Chat / Thread' },
  { value: 'device_mockup', label: '3D Device Mockup' },
  { value: 'ai_image', label: 'AI Generated Image' },
];

export const TRANSITION_TYPE_OPTIONS = [
  { value: 'subtle_slide', label: 'Subtle Slide (Default)' },
  { value: 'fade', label: 'Fade' },
  { value: 'zoom_in', label: 'Zoom In' },
  { value: 'zoom_out', label: 'Zoom Out' },
  { value: 'slide_left', label: 'Slide Left' },
  { value: 'slide_right', label: 'Slide Right' },
  { value: 'slide_up', label: 'Slide Up' },
  { value: 'slide_down', label: 'Slide Down' },
  { value: 'glitch', label: 'Glitch' },
  { value: 'none', label: 'None (Cut)' },
];



export const PIPELINE_STAGES = [
  { id: 'generate_script', title: 'Script Generation', desc: 'AI scriptwriting & cues formulation' },
  { id: 'generate_voiceover', title: 'Voiceover Synthesis', desc: 'Synthesizing AI narrator voiceover' },
  { id: 'transcribe', title: 'Transcription & Sync', desc: 'Whisper word-level audio alignment' },
  { id: 'generate_visuals', title: 'Visuals Generation', desc: 'AI visual cues aligned to transcription' },
  { id: 'fetch_assets', title: 'Fetch Visual Assets', desc: 'Retrieving B-roll clips & images' },
  { id: 'render', title: 'Video Export (Remotion)', desc: 'Compiling frames to final MP4' }
];

export const getDefaultMetaForType = (type: string, existingMeta: any) => {
  const meta: any = {};

  // Inject defaults based on type
  if (type === 'chart') {
    meta.chart_type = 'bar';
    meta.data = [{ label: 'Category 1', value: 10 }];
  } else if (type === 'map') {
    meta.map_style = 'vintage';
    meta.locations = [{ name: 'New Location', coord: [0, 0] }];
  } else if (type === 'document') {
    meta.headline = 'News';
    meta.doc_text = 'Content...';
    meta.highlight_text = '';
    meta.source = 'Source';
    meta.date = new Date().getFullYear().toString();
    meta.title = 'THE CLASSIFIED ARCHIVES';
    meta.subtitle = 'BREAKING NEWS';
    meta.section = '';
    meta.pull_quote = '';
    meta.show_image = false;
    meta.image_url = '';
    meta.image_caption = '';
    meta.image_scale = 100;
    meta.newspaper_theme = 'modern';
  } else if (type === 'network') {
    meta.theme = 'conspiracy_board';
    meta.nodes = [{ id: '1', label: 'Entity 1', type: 'person' }];
    meta.edges = [];
  } else if (type === 'youtube') {
    meta.start_offset = 15;
    meta.duration = 15;
    meta.skip_intro = true;
  } else if (type === 'portrait') {
    meta.person_name = 'Historical Figure';
  } else if (type === 'parallax') {
    meta.foreground_url = existingMeta?.foreground_url || '';
  } else if (type === 'list') {
    meta.number = 1;
    meta.title = 'Item Title';
    meta.description = 'Item description';
  } else if (type === 'custom_html') {
    meta.html = '<div class="custom-box">Hello Custom HTML</div>';
    meta.css = '.custom-box { color: white; font-size: 60px; text-align: center; }';
  } else if (type === 'timeline') {
    meta.title = 'Timeline of Events';
    meta.events = [
      { date: '2023', title: 'Start', description: 'The beginning.' },
      { date: '2024', title: 'Growth', description: 'Things get bigger.' }
    ];
  } else if (type === 'thread') {
    meta.platform = 'whatsapp';
    meta.messages = [
      { sender: 'User', text: 'Hello!', is_self: false },
      { text: 'Hi, how are you?', is_self: true }
    ];
  } else if (type === 'device_mockup') {
    meta.device = 'iphone';
    meta.screen_image_url = 'https://picsum.photos/400/800';
    meta.screen_zoom = 1;
    meta.screen_offset_x = 0;
    meta.screen_offset_y = 0;
  }

  return meta;
};


export const formatTime = (frame: number) => {
  const totalSeconds = Math.floor(frame / 30);
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

