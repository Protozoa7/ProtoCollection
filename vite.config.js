import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'ProtoCollection',
        short_name: 'ProtoCollection',
        description: 'Personal Pokémon card digital binder',
        theme_color: '#0b1220',
        background_color: '#07101c',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/assets\.tcgdex\.net\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tcgdex-card-images',
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] }
            }
          },
          {
            urlPattern: /^https:\/\/api\.tcgdex\.net\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'tcgdex-api',
              networkTimeoutSeconds: 5,
              expiration: { maxEntries: 250, maxAgeSeconds: 60 * 60 * 24 * 7 }
            }
          }
        ]
      }
    })
  ]
})
