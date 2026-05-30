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
            if (id.includes('react-icons')) {
              return 'vendor-icons';
            }
            if (id.includes('framer-motion')) {
              return 'vendor-framer';
            }
            if (id.includes('remotion') || id.includes('@remotion')) {
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
      }
    }
  }
})
