const _cachedPort: { port: number | null } = { port: null };
let _fetching = false;

async function _resolvePort(): Promise<number | null> {
  if (_cachedPort.port !== null) return _cachedPort.port;
  if (_fetching) return null;
  _fetching = true;
  try {
    if (window.pywebview?.api && typeof (window.pywebview.api as any).get_file_server_port === 'function') {
      const port = await (window.pywebview.api as any).get_file_server_port();
      _cachedPort.port = port;
      return port;
    }
  } catch {}
  _fetching = false;
  return null;
}

export async function getMediaUrl(filePath: string): Promise<string> {
  if (!filePath) return '';
  const port = await _resolvePort();
  if (port) {
    return `http://localhost:${port}/api/media?path=${encodeURIComponent(filePath)}&t=${Date.now()}`;
  }
  return `/api/media?path=${encodeURIComponent(filePath)}&t=${Date.now()}`;
}
