import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { githubPagesAssets } from './github-pages-assets.js'

// GitHub Pages serves project sites from /<repo>/, so the base path is
// injected at build time (see .github/workflows/deploy.yml).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), githubPagesAssets()],
  build: {
    // Firestore's SDK is a single ~550 kB chunk, loaded only by the Play pages.
    chunkSizeWarningLimit: 600,
  },
})
