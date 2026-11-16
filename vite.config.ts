import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// Relative base so the built app works from any folder (GitHub Pages, Netlify, a USB stick…).
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, strictPort: true, host: true },
  preview: { port: 4173, strictPort: true, host: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
