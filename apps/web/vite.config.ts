import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const webDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(webDir, '../..');

function landingPage(): Plugin {
  return {
    name: 'landing-page',
    configureServer(server) {
      server.middlewares.use('/landing', (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(readFileSync(path.join(root, 'matchcoreph_landing_page.html')));
      });
    },
  };
}

const base = '/';
export default defineConfig({
  base,
  plugins: [
    react(),
    tailwindcss(),
    landingPage(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['ico.png'],
      manifest: {
        name: 'MatchCorePH',
        short_name: 'MatchCorePH',
        description: 'Practical shooting competition management and scoring platform.',
        theme_color: '#242526',
        background_color: '#242526',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [{ src: '/ico.png', sizes: 'any', type: 'image/png' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,png}'],
        navigateFallback: 'index.html',
      },
    }),
  ],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  build: { outDir: 'dist', sourcemap: false },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true },
    },
  },
});