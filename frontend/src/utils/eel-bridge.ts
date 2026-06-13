/**
 * Eel Bridge Utility - Connection Monitor & Retry Logic
 *
 * PROBLEM: On first app launch after install, the React frontend loads before
 * Python's Eel WebSocket server is ready. The original eel.js has no retry
 * logic, so the WebSocket connection fails and the UI can't communicate with
 * the backend. After restart, the backend is fully initialized so it works.
 *
 * SOLUTION: Monitor the WebSocket connection and automatically retry with
 * exponential backoff until the backend is ready.
 */




const MAX_RETRIES = 15;
const INITIAL_RETRY_DELAY = 300;
const MAX_RETRY_DELAY = 4000;

class EelConnectionMonitor {
  state: { isConnected: boolean; isConnecting: boolean; error: string | null; retryCount: number } = {
    isConnected: false,
    isConnecting: true,
    error: null,
    retryCount: 0
  };

  private listeners: Set<(state: { isConnected: boolean; isConnecting: boolean; error: string | null; retryCount: number }) => void> = new Set();
  private checkInterval: number | null = null;
  private reconnectTimeout: number | null = null;

  constructor() {
    this.startMonitoring();
  }

  subscribe(listener: (state: { isConnected: boolean; isConnecting: boolean; error: string | null; retryCount: number }) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    const state = { ...this.state };
    this.listeners.forEach(fn => fn(state));
  }

  private startMonitoring() {
    // Wait for DOM to be ready
    if (typeof document === 'undefined') return;

    document.addEventListener('DOMContentLoaded', () => {
      // Give eel.js time to initialize
      setTimeout(() => this.checkAndRetry(), 500);
    });

    // Also check periodically
    this.checkInterval = window.setInterval(() => {
      this.checkAndRetry();
    }, 2000);
  }

  private checkAndRetry() {
    if (!window.eel) {
      this.state.error = "Eel library not loaded. Backend may not be running.";
      this.state.isConnecting = false;
      this.notifyListeners();
      return;
    }
    const eelAny = window.eel as any;
    const ws = eelAny._websocket as WebSocket | undefined;

    // Check connection state
    if (ws && ws.readyState === 1) { // OPEN
      if (!this.state.isConnected) {
        this.state.isConnected = true;
        this.state.isConnecting = false;
        this.state.error = null;
        this.state.retryCount = 0;
        console.log("[EelBridge] Backend connected!");
        this.notifyListeners();
      }
      return;
    }

    // Not connected - try to reconnect
    if (this.state.retryCount < MAX_RETRIES && this.state.isConnecting) {
      this.attemptReconnect();
    } else if (this.state.retryCount >= MAX_RETRIES) {
      this.state.error = "Failed to connect to backend. Try restarting the app.";
      this.state.isConnecting = false;
      this.notifyListeners();
    }
  }

  private attemptReconnect() {
    this.state.retryCount++;
    const delay = Math.min(
      INITIAL_RETRY_DELAY * Math.pow(1.4, this.state.retryCount),
      MAX_RETRY_DELAY
    );

    console.log(`[EelBridge] Retry ${this.state.retryCount}/${MAX_RETRIES} in ${delay}ms`);
    this.notifyListeners();

    this.reconnectTimeout = window.setTimeout(() => {
      const eelAny = window.eel as any;
      if (!eelAny) return;

      try {
        const websocketAddr = (eelAny._host + '/eel').replace('http', 'ws');
        console.log(`[EelConnection] Connecting WebSocket to ${websocketAddr}`);

        // Close existing connection if any
        if (eelAny._websocket) {
          eelAny._websocket.close();
        }

        // Create new WebSocket connection
        const newWs = new WebSocket(websocketAddr);
        (window.eel as any)._websocket = newWs;

        newWs.onopen = () => {
          // Import Python functions
          if ((window.eel as any)._py_functions) {
            for (const fn of (window.eel as any)._py_functions) {
              (window.eel as any)._import_py_function(fn);
            }
          }
          this.state.isConnected = true;
          this.state.isConnecting = false;
          this.state.error = null;
          this.state.retryCount = 0;
          console.log("[EelBridge] Reconnected successfully!");
          this.notifyListeners();
        };

        newWs.onclose = () => {
          this.state.isConnected = false;
          if (this.state.retryCount < MAX_RETRIES) {
            this.attemptReconnect();
          }
        };

        newWs.onerror = () => {
          this.state.isConnected = false;
        };

        // Handle messages from Python
        newWs.onmessage = (e) => {
          this.handleMessage(e);
        };

      } catch (err) {
        this.attemptReconnect();
      }
    }, delay);
  }

  private handleMessage(e: MessageEvent) {
    if (!window.eel) return;
    const message = JSON.parse(e.data);

    if (message.hasOwnProperty('call')) {
      // Python calling JS function
      const fnName = message.name;
      if (fnName in (window.eel as any)._exposed_functions) {
        try {
          const result = (window.eel as any)._exposed_functions[fnName](...message.args);
          Promise.resolve(result).then(value => {
            (window.eel as any)._websocket.send(
              (window.eel as any)._toJSON({
                return: message.call,
                status: 'ok',
                value
              })
            );
          }).catch(err => {
            (window.eel as any)._websocket.send(
              (window.eel as any)._toJSON({
                return: message.call,
                status: 'error',
                error: err.message,
                stack: err.stack
              })
            );
          });
        } catch (err: any) {
          (window.eel as any)._websocket.send(
            (window.eel as any)._toJSON({
              return: message.call,
              status: 'error',
              error: err.message,
              stack: err.stack
            })
          );
        }
      }
    } else if (message.hasOwnProperty('return')) {
      // Python returning value to callback
      const callId = message['return'];
      if (callId in (window.eel as any)._call_return_callbacks) {
        const callbacks = (window.eel as any)._call_return_callbacks[callId];
        if (message['status'] === 'ok') {
          callbacks.resolve?.(message.value);
        } else if (message['status'] === 'error' && callbacks.reject) {
          callbacks.reject(message['error']);
        }
      }
    }
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
  }
}

// Singleton instance
export const eelConnection = new EelConnectionMonitor();



/**
 * Waits for eel to be connected, with timeout
 */
export async function waitForEelConnection(timeoutMs: number = 10000): Promise<boolean> {
  const eelAny = window.eel as any;
  if (eelAny?.isConnected) return true;

  return new Promise((resolve) => {
    const startTime = Date.now();

    const check = () => {
      if (import.meta.env.MODE === 'production') {
        if (eelAny?._websocket?.readyState === 1) {
          resolve(true);
          return;
        }
      } else {
        if (eelAny?._websocket?.readyState === 1) {
          resolve(true);
          return;
        }
      }
      
      if (Date.now() - startTime > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(check, 100);
    };

    check();
  });
}

/**
 * Safe wrapper for eel calls that retries on connection failure
 */
export async function callEel<T>(fnName: string, ...args: any[]): Promise<T | null> {
  if (!window.eel) {
    console.warn(`[EelBridge] Cannot call ${fnName}: eel not loaded`);
    return null;
  }

  // Wait for connection (up to 5 seconds)
  const connected = await waitForEelConnection(5000);
  if (!connected) {
    console.warn(`[EelBridge] Cannot call ${fnName}: backend not connected`);
    return null;
  }

  try {
    const fn = (window.eel as any)[fnName];
    if (!fn) {
      console.warn(`[EelBridge] Function ${fnName} not found`);
      return null;
    }
    return await fn(...args)() as T;
  } catch (error) {
    console.error(`[EelBridge] Call to ${fnName} failed:`, error);
    return null;
  }
}