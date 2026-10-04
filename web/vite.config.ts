import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'favicon-*.png', 'apple-touch-icon.png', 'icons/*.png'],
      manifest: {
        name: 'RiffPlayer',
        short_name: 'RiffPlayer',
        description: 'Self-hosted music server',
        theme_color: '#080e1a',
        background_color: '#080e1a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /\/rest\/getCoverArt/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'cover-art',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 7 },
            },
          },
          // Resilience, not offline browsing (#13): serve a GET the app has
          // already seen this session from cache while revalidating in the
          // background, so a brief network drop doesn't blank a page you're
          // already on. Deliberately excludes audio (stream/download) and
          // cover art (already cached above, CacheFirst) — real offline
          // playback stays the explicit Download feature's job, not the
          // service worker's; opportunistically caching audio here would
          // blur that line and cache data users never asked to keep.
          {
            urlPattern: ({ url, request }) =>
              request.method === 'GET' &&
              (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/api/v1/')) &&
              !url.pathname.startsWith('/rest/stream') &&
              !url.pathname.startsWith('/rest/getCoverArt') &&
              !url.pathname.startsWith('/rest/download'),
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'api-resilience',
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      '/rest': 'http://localhost:4533',
      '/api': 'http://localhost:4533',
    },
  },
});
