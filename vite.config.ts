import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { firebaseHostingGuard } from './firebase-hosting-guard.js'
import { githubPagesAssets } from './github-pages-assets.js'

// GitHub Pages serves project sites from /<repo>/, so the base path is
// injected at build time (see .github/workflows/deploy.yml).
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react(), tailwindcss(), githubPagesAssets(), firebaseHostingGuard()],
  server: { port: 9121, strictPort: true },
  // The Play and Import pages load lazily, so without this the dev server only
  // discovers their dependencies on first visit, re-optimizes, and force-reloads
  // the page — which leaves already-open tabs requesting stale chunks.
  optimizeDeps: {
    include: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/functions',
      '@anthropic-ai/sdk',
      '@anthropic-ai/sdk/helpers/json-schema',
      '@google/genai',
    ],
  },
  build: {
    // Firestore's SDK is a single ~550 kB chunk, loaded only by the Play pages.
    chunkSizeWarningLimit: 600,
  },
})
