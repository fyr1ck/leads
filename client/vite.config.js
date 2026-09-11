import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_PORT = process.env.PORT || 3001;
const WEB_PORT = Number(process.env.WEB_PORT || 3000);

export default defineConfig({
  plugins: [react()],
  server: {
    port: WEB_PORT,
    strictPort: false,
    // O frontend nunca fala com a Groq: tudo passa pelo backend local.
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
      '/socket.io': { target: `http://localhost:${API_PORT}`, ws: true }
    }
  },
  build: { outDir: 'dist', emptyOutDir: true }
});
