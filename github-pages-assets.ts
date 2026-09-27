import type { Plugin } from 'vite'

/**
 * Emits the two files that have to know the deployed base path, which isn't
 * known until build time (GitHub Pages serves project sites from /<repo>/).
 *
 *  - `404.html`, because Pages has no rewrite rule: any path that isn't a real
 *    file gets 404.html, so it records the requested route in a query parameter
 *    and bounces to the app root, which index.html then restores.
 *  - `site.webmanifest`, whose icon paths must be base-relative.
 */
export function githubPagesAssets(): Plugin {
  let base = '/'
  return {
    name: 'github-pages-assets',
    configResolved(config) {
      base = config.base
    },
    // Vite rewrites icon hrefs in index.html for the base path but not
    // rel="manifest", so inject that one ourselves.
    transformIndexHtml() {
      return [
        {
          tag: 'link',
          attrs: { rel: 'manifest', href: `${base}site.webmanifest` },
          injectTo: 'head',
        },
      ]
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: '404.html',
        source: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Redirecting…</title>
    <script>
      (function () {
        var base = ${JSON.stringify(base)};
        var path = location.pathname + location.search + location.hash;
        location.replace(base + '?redirect=' + encodeURIComponent(path));
      })();
    </script>
  </head>
  <body>Redirecting…</body>
</html>
`,
      })

      this.emitFile({
        type: 'asset',
        fileName: 'site.webmanifest',
        source: JSON.stringify(
          {
            name: 'Settlers of Catan Board Generator',
            short_name: 'Catan',
            icons: [
              {
                src: `${base}favicon/android-chrome-192x192.png`,
                sizes: '192x192',
                type: 'image/png',
              },
              {
                src: `${base}favicon/android-chrome-512x512.png`,
                sizes: '512x512',
                type: 'image/png',
              },
            ],
            start_url: base,
            theme_color: '#041d2b',
            background_color: '#041d2b',
            display: 'standalone',
          },
          null,
          2,
        ),
      })
    },
  }
}
