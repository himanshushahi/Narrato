export async function callApi<T>(fnName: string, ...args: any[]): Promise<T | null> {
  if (!window.pywebview?.api) {
    console.warn(`[callApi] Cannot call ${fnName}: pywebview not available`);
    return null;
  }
  const fn = (window.pywebview.api as any)[fnName];
  if (typeof fn !== 'function') {
    console.warn(`[callApi] Function ${fnName} not found on pywebview.api`);
    return null;
  }
  try {
    return await fn(...args) as T;
  } catch (error) {
    console.error(`[callApi] Call to ${fnName} failed:`, error);
    return null;
  }
}

export async function callApiOrThrow<T>(fnName: string, ...args: any[]): Promise<T> {
  if (!window.pywebview?.api) {
    throw new Error(`[callApi] Cannot call ${fnName}: pywebview not available`);
  }
  const fn = (window.pywebview.api as any)[fnName];
  if (typeof fn !== 'function') {
    throw new Error(`[callApi] Function ${fnName} not found on pywebview.api`);
  }
  return await fn(...args) as T;
}
