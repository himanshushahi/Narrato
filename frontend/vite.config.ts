import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import fs from 'fs'

const VALID_MEDIA = ['.mp3', '.wav', '.mp4', '.png', '.jpg', '.jpeg', '.gif', '.webm', '.mkv', '.mov', '.avi', '.ogg', '.webp', '.svg', '.css', '.woff2', '.ttf']

const CONTENT_TYPES: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska', '.mov': 'video/quicktime', '.avi': 'video/x-msvideo',
  '.webm': 'video/webm', '.ogg': 'audio/ogg',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.css': 'text/css', '.woff2': 'font/woff2', '.ttf': 'font/ttf',
}

function mediaServerPlugin() {
  let isDev = false;
  return {
    name: 'media-server',
    configResolved(config) {
      isDev = config.command === 'serve';
    },
    configureServer(server: any) {
      if (!isDev) return;
      server.middlewares.use('/api/media', (req: any, res: any, next: any) => {
        const url = new URL(req.url, `http://${req.headers.host}`);
        const filePath = url.searchParams.get('path');

        if (!filePath) {
          res.statusCode = 400;
          res.end('Missing path parameter');
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        if (!VALID_MEDIA.includes(ext)) {
          res.statusCode = 400;
          res.end('Invalid file type');
          return;
        }

        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          res.statusCode = 404;
          res.end('File not found');
          return;
        }

        const contentType = CONTENT_TYPES[ext] || 'application/octet-stream';
        const fileSize = stat.size;
        const range = req.headers['range'];

        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

          if (start >= fileSize) {
            res.statusCode = 416;
            res.setHeader('Content-Range', `bytes */${fileSize}`);
            res.end();
            return;
          }

          const chunkSize = end - start + 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${fileSize}`);
          res.setHeader('Content-Length', chunkSize);
          res.setHeader('Content-Type', contentType);

          const stream = fs.createReadStream(filePath, { start, end });
          stream.pipe(res);
          stream.on('error', () => { res.statusCode = 500; res.end(); });
          res.on('close', () => stream.destroy());
        } else {
          res.statusCode = 200;
          res.setHeader('Content-Length', fileSize);
          res.setHeader('Content-Type', contentType);

          const stream = fs.createReadStream(filePath);
          stream.pipe(res);
          stream.on('error', () => { res.statusCode = 500; res.end(); });
          res.on('close', () => stream.destroy());
        }
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), mediaServerPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            const parts = id.split('node_modules/');
            const pkg = parts[parts.length - 1];
            if (pkg.startsWith('react-icons')) {
              return 'vendor-icons';
            }
            if (pkg.startsWith('framer-motion')) {
              return 'vendor-framer';
            }
            if (pkg.startsWith('remotion') || pkg.startsWith('@remotion')) {
              return 'vendor-remotion';
            }
            return 'vendor';
          }
        }
      }
    }
  },
  server: {
    port: 5173,
  }
})
