/** Resolve a public/ asset through Vite's base path (needed on GitHub Pages). */
export const asset = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

export const tileImage = (type: string) => asset(`tiles/${type}.webp`)
export const portImage = (type: string) => asset(`ports/${type}.webp`)
export const dieImage = (face: number) =>
  asset(`dice/dice-0${face}.svg`)
