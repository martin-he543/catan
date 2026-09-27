/** Resolve a public/ asset through Vite's base path (needed on GitHub Pages). */
export const asset = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`

export const tileImage = (type: string) => asset(`tiles/${type}.webp`)
export const portImage = (type: string) => asset(`ports/${type}.webp`)
export const dieImage = (face: number) =>
  asset(`dice/dice-0${face}.svg`)
export const robberImage = asset('robber/robber.webp')
/** A player piece photographed at a low angle, tinted per colour; see scripts/make-pieces.sh. */
export const pieceImage = (piece: 'road' | 'settlement' | 'city', color: string) =>
  asset(`pieces/${piece}-${color}.webp`)
