declare global {
  interface Window {
    __file_server_port__?: number;
  }
}

export function getMediaUrlSync(filePath: string | undefined | null): string {
  if (!filePath) return '';
  const str = String(filePath).trim();
  if (
    str.startsWith('data:') ||
    str.startsWith('http://') ||
    str.startsWith('https://') ||
    str.startsWith('blob:')
  ) {
    return str;
  }
  let cleanPath = str;
  if (cleanPath.startsWith('file:///')) {
    const afterThreeSlashes = cleanPath.slice(8);
    // If followed by Windows drive letter like C:/, strip 8 chars; otherwise on POSIX keep the root slash (slice 7)
    if (/^[a-zA-Z]:/.test(afterThreeSlashes)) {
      cleanPath = afterThreeSlashes;
    } else {
      cleanPath = cleanPath.slice(7);
    }
  } else if (cleanPath.startsWith('file://')) {
    cleanPath = cleanPath.slice(7);
  }
  if (
    cleanPath.startsWith('data:') ||
    cleanPath.startsWith('http://') ||
    cleanPath.startsWith('https://') ||
    cleanPath.startsWith('blob:')
  ) {
    return cleanPath;
  }
  if (window.__file_server_port__) {
    return `http://127.0.0.1:${window.__file_server_port__}/?path=${encodeURIComponent(cleanPath)}`;
  }
  return `/api/media?path=${encodeURIComponent(cleanPath)}`;
}

/** URL for a small on-demand thumbnail (images + video poster frames). */
export function getMediaThumbUrl(filePath: string | undefined | null): string {
  if (!filePath) return '';
  const base = getMediaUrlSync(filePath);
  if (base.startsWith('data:') || base.startsWith('blob:')) return base;
  return `${base}&thumb=1`;
}



