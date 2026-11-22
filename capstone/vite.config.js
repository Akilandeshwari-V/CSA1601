import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = { '/api': { target: 'http://localhost:4000', changeOrigin: false } };

export default defineConfig({
  plugins: [react()],
  server: { proxy: api },
  preview: { proxy: api },
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: { output: { manualChunks: { three: ['three'], charts: ['recharts'] } } },
  },
});
