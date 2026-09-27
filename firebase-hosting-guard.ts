import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * Stops the dev server and build if `firebase init hosting` has been run over
 * the project. It writes a "Firebase Hosting Setup Complete" placeholder
 * `index.html` into the public directory it asks for, and may repoint
 * `firebase.json` at it:
 *
 *  - `public/index.html` is copied into `dist/` and replaces the app's page.
 *  - `hosting.public` other than `dist` serves that placeholder instead of the build.
 */
export function firebaseHostingGuard(): Plugin {
  return {
    name: 'firebase-hosting-guard',
    configResolved(config) {
      const problems: string[] = []

      const stray = resolve(config.publicDir, 'index.html')
      if (config.publicDir && existsSync(stray)) {
        problems.push(`${stray} would replace the app's index.html — delete it.`)
      }

      const firebaseJson = resolve(config.root, 'firebase.json')
      if (existsSync(firebaseJson)) {
        const hosting = JSON.parse(readFileSync(firebaseJson, 'utf8')).hosting
        if (hosting && hosting.public !== 'dist') {
          problems.push(
            `firebase.json has hosting.public = ${JSON.stringify(hosting.public)}; it must be "dist".`,
          )
        }
      }

      if (problems.length) {
        throw new Error(
          'This looks like `firebase init hosting` was run over the project:\n  ' +
            problems.join('\n  ') +
            '\nRestore them with `git checkout firebase.json` and remove the placeholder.',
        )
      }
    },
  }
}
