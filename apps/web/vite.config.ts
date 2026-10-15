import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.LL_WEB_PORT ?? 43128),
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${process.env.LL_PORT ?? 3210}`, changeOrigin: false },
    },
  },
});
