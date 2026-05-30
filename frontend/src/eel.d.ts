type EelCall<Args extends any[], Return> = (...args: Args) => (callback?: (result: Return) => void) => Promise<Return>;

interface Eel {
  expose: (callback: Function, name: string) => void;
  browse_workspace_directory: EelCall<[], string>;
  browse_bg_music_file: EelCall<[], string>;
  db_get_projects: EelCall<[], any[]>;
  db_get_project: EelCall<[string], any>;
  db_delete_project: EelCall<[string], boolean>;
  db_get_project_tasks: EelCall<[string], any[]>;
  db_get_settings: EelCall<[], any>;
  db_update_settings: EelCall<[any], boolean>;
  create_new_project: EelCall<[string, string, string, string, string], any>;
  start_processing_pipeline: EelCall<[string, string[]], any>;
  resume_processing_pipeline: EelCall<[string], any>;
  cancel_processing_pipeline: EelCall<[string], boolean>;
  get_active_queue: EelCall<[], any>;
  read_json_file: EelCall<[string], any>;
  save_json_file: EelCall<[string, any], boolean>;
  check_kokoro_downloaded: EelCall<[], boolean>;
  start_kokoro_download: EelCall<[], any>;
  check_whisper_downloaded: EelCall<[string], boolean>;
  start_whisper_download: EelCall<[string], any>;
  check_nvidia_gpu_available: EelCall<[], boolean>;
  regenerate_script_section: EelCall<[number, string, any, string, string], any>;
  generate_voice_preview: EelCall<[string, string, string, string, string, string], any>;
  get_audio_base64: EelCall<[string], string>;
  open_exports_folder: EelCall<[], boolean>;
}

interface Window {
  eel?: Eel;
}
