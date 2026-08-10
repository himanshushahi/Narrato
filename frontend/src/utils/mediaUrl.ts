declare global {
  interface Window {
    __file_server_port__?: number;
  }
}

export function getMediaUrlSync(filePath: string | undefined | null): string {
  if (!filePath) return '';
  if (window.__file_server_port__) {
    return `http://127.0.0.1:${window.__file_server_port__}/?path=${encodeURIComponent(filePath)}`;
  }
  return `/api/media?path=${encodeURIComponent(filePath)}`;
}

/** URL for a small on-demand thumbnail (images + video poster frames). */
export function getMediaThumbUrl(filePath: string | undefined | null): string {
  if (!filePath) return '';
  const base = getMediaUrlSync(filePath);
  return `${base}&thumb=1`;
}

export async function getMediaUrl(filePath: string): Promise<string> {
  if (!filePath) return '';
  // Ensure the port is fetched if not yet available, though typically pywebviewready handles this
  if (!window.__file_server_port__ && window.pywebview?.api?.get_file_server_port) {
    try {
      window.__file_server_port__ = await window.pywebview.api.get_file_server_port();
    } catch {}
  }
  const baseUrl = getMediaUrlSync(filePath);
  return `${baseUrl}&t=${Date.now()}`;
}

