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



