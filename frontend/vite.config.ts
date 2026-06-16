import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // Extract the package name after node_modules/ to avoid
            // false matches on the project folder name (remotion_canvas)
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
    proxy: {
      '/eel.js': {
        target: 'http://127.0.0.1:8888',
        ws: true,
      },
      '/eel': {
        target: 'http://127.0.0.1:8888',
        ws: true,
      },
      '/api/media': {
        target: 'http://127.0.0.1:8888',
      }
    }
  }
})
