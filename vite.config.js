import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: true,
    manifest: true,
    rollupOptions: { input: { app: 'index.html', guest: 'src/v2/public-entry.jsx' } },
  },
});
