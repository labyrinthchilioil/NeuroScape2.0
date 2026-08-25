import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/study': 'http://127.0.0.1:8787',
      '/api/llm': 'http://127.0.0.1:8787',
      '/api/calibration': {
        target: 'http://127.0.0.1:8000',
        rewrite: (path) => path.replace(/^\/api\/calibration/, '/api'),
      },
      '/ws/calibration': {
        target: 'ws://127.0.0.1:8000',
        ws: true,
        rewrite: () => '/ws/live',
      },
    },
  },
});
