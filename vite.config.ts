import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The e2e suite runs its own API (on the lifeos_test database) and points the dev server at it.
const api = process.env.LIFEOS_API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], r3f: ['@react-three/fiber', '@react-three/drei'] },
      },
    },
  },
  server: { proxy: { '/api': { target: api, changeOrigin: false } } },
  preview: { proxy: { '/api': { target: api, changeOrigin: false } } },
  test: { environment: 'node', fileParallelism: false, include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
