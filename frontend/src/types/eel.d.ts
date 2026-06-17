type EelCall<Args extends any[], Return> = (...args: Args) => (callback?: (result: Return) => void) => Promise<Return>;

interface Eel {
  expose: (callback: Function, name: string) => void;
  browse_export_directory: EelCall<[], string>;
  browse_bg_music_file: EelCall<[], string>;
  db_get_projects: EelCall<[], any[]>;
  db_get_project: EelCall<[string], any>;
  db_delete_project: EelCall<[string], boolean>;
  db_get_project_tasks: EelCall<[string], any[]>;
  db_get_settings: EelCall<[], any>;
  db_update_settings: EelCall<[any], boolean>;
  create_new_project: EelCall<[string, string, string, string, string], any>;
  start_processing_pipeline: EelCall<[string, string[]], any>;
  resume_processing_pipeline: EelCall<[string, string[]], any>;
  cancel_processing_pipeline: EelCall<[string], boolean>;
  read_json_file: EelCall<[string], any>;
  save_json_file: EelCall<[string, any], boolean>;
  check_kokoro_downloaded: EelCall<[], boolean>;
  start_kokoro_download: EelCall<[], any>;
  check_whisper_downloaded: EelCall<[string], boolean>;
  start_whisper_download: EelCall<[string], any>;
  check_nvidia_gpu_available: EelCall<[], boolean>;
  regenerate_script_section: EelCall<[number, string, any, string, string], any>;
  regenerate_sub_visual: EelCall<[number, string, number, any, string, string], any>;
  add_scene_with_ai: EelCall<[any, string, string], any>;
  generate_voice_preview: EelCall<[string, string, string, string, string, string], any>;
  fetch_single_scene_asset: EelCall<[string, number, number, string, string], any>;
  preview_asset_download: EelCall<[string, string, string], { success: boolean; visual_path?: string; error?: string }>;
  cleanup_preview_assets: EelCall<[string, string[]], { success: boolean; deleted?: string[] }>;
  get_ytdlp_version: EelCall<[], { installed: boolean; version: string | null; path: string | null }>;
  update_ytdlp: EelCall<[], { status: string }>;
  save_project_with_cleanup: EelCall<[string, any, any], any>;
  db_update_project: EelCall<[string, any], any>;
  upload_project_bg_music: EelCall<[string], { success: boolean; path: string | null; filename?: string; size_bytes?: number; extension?: string; error?: string }>;
  download_google_font: EelCall<[string], any>;
  get_downloaded_whisper_models: EelCall<[], any[]>;
  delete_whisper_model: EelCall<[string], any>;
  generate_chart_data_api: EelCall<[any], any>;
}

interface Window {
  eel?: Eel;
}
