import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import tailwindcss from '@tailwindcss/vite' // Возвращаем сборщик стилей

export default defineConfig({
  // Эта настройка вернет IP-адреса в консоль
  server: {
  //  host: true, 
  },
  plugins: [
    react(),
    tailwindcss(), // Включаем Tailwind обратно
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['z-icon.svg'],
      manifest: {
        name: 'zproject Mortgage Tracker',
        short_name: 'zproject',
        description: 'Продвинутый ипотечный трекер',
        theme_color: '#020617',
        background_color: '#020617',
        display: 'standalone',
        icons: [
          {
            src: '/z-icon.svg',
            sizes: '192x192 512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      }
    })
  ],
})