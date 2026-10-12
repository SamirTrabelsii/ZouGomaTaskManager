import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  server: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } } },
  preview: { proxy: { '/api': { target: 'http://localhost:3001', changeOrigin: false } } },
  test: { environment: 'node', fileParallelism: false, include: ['src/**/*.test.ts', 'server/**/*.test.ts'] },
});
