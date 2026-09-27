import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { HEX_CENTERS, HEX_W } from '../geometry'
import { TILE_TYPES, type TileType } from '../types'
import {
  classifyTiles, makeTransform, sampleRing, TILE_SUPPLY,
  type Hsv, type Point, type Raster,
} from '../vision'

/**
 * End-to-end check of the photo pipeline.
 *
 * A board is painted from the site's own tile artwork — rotated, dimmed and
 * warmed the way a phone photo in a lit room would be, with a blank number
 * token covering the middle of every tile — and then read back through exactly
 * the sampling and classification the Import page runs. It catches the things
 * the unit tests cannot: a sampling ring that drifts onto the tokens, a colour
 * metric that cannot separate the real artwork, a transform off by a rotation.
 *
 * Decoding webp needs ImageMagick, so the whole thing stands aside where that
 * is not installed rather than failing the suite.
 */
const haveImageMagick = (() => {
  try {
    execFileSync('convert', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/** Decode one of the site's real tile graphics into raw RGB. */
function decode(path: string) {
  const size = execFileSync('identify', ['-format', '%w %h', path]).toString().split(' ').map(Number)
  const data = execFileSync('convert', [path, '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 28 })
  return { width: size[0], height: size[1], data: new Uint8Array(data) }
}

const asRaster = (r: { width: number; height: number; data: Uint8Array }): Raster => {
  // Widen RGB to the RGBA layout the browser's getImageData hands back.
  const rgba = new Uint8ClampedArray(r.width * r.height * 4)
  for (let i = 0; i < r.width * r.height; i++) {
    rgba[i * 4] = r.data[i * 3]
    rgba[i * 4 + 1] = r.data[i * 3 + 1]
    rgba[i * 4 + 2] = r.data[i * 3 + 2]
    rgba[i * 4 + 3] = 255
  }
  return { data: rgba, width: r.width, height: r.height, ratio: 1 }
}

describe.skipIf(!haveImageMagick)('reading a photograph', () => {
it('recovers every tile from a board shot at an angle in warm light', () => {
  const art = new Map(TILE_TYPES.map((t) => [t, decode(`public/tiles/${t}.webp`)]))

  // Reference colours, sampled from the artwork exactly as the browser does.
  const references = new Map<TileType, Hsv>()
  for (const [type, image] of art) {
    const raster = asRaster(image)
    references.set(type, sampleRing(raster, { x: raster.width / 2, y: raster.height / 2 }, raster.width)!)
  }

  // A board holding the box's tiles, shuffled to a fixed arrangement.
  const truth: TileType[] = TILE_TYPES.flatMap((t) =>
    Array.from({ length: TILE_SUPPLY[t] }, () => t),
  )
  let seed = 7
  for (let i = truth.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    const j = seed % (i + 1)
    ;[truth[i], truth[j]] = [truth[j], truth[i]]
  }

  // Paint the photo: a board shot at an angle, under warm light.
  const W = 900
  const H = 820
  const angle = 0.19
  const scale = 118
  const centre = { x: W / 2, y: H / 2 }
  const place = (p: Point): Point => ({
    x: centre.x + scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)),
    y: centre.y + scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)),
  })
  const unplace = (p: Point): Point => {
    const dx = (p.x - centre.x) / scale
    const dy = (p.y - centre.y) / scale
    return { x: dx * Math.cos(-angle) - dy * Math.sin(-angle), y: dx * Math.sin(-angle) + dy * Math.cos(-angle) }
  }

  const photo = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const board = unplace({ x: x + 0.5, y: y + 0.5 })
      // Nearest hex centre: the Voronoi cells of a hex grid are the hexes.
      let best = -1
      let bestDist = Infinity
      HEX_CENTERS.forEach((c, i) => {
        const d = (c.x - board.x) ** 2 + (c.y - board.y) ** 2
        if (d < bestDist) { bestDist = d; best = i }
      })
      const at = (y * W + x) * 4
      photo[at + 3] = 255
      if (Math.sqrt(bestDist) > HEX_W * 0.58) continue // open sea

      const hex = HEX_CENTERS[best]
      const offset = { x: board.x - hex.x, y: board.y - hex.y }
      // A number token sits in the middle of every tile but the desert.
      if (truth[best] !== 'desert' && Math.hypot(offset.x, offset.y) < 0.2) {
        photo[at] = 233; photo[at + 1] = 212; photo[at + 2] = 157
        continue
      }
      const source = art.get(truth[best])!
      const sx = Math.floor((offset.x / HEX_W + 0.5) * source.width)
      const sy = Math.floor((offset.y / HEX_W + 0.5) * source.width)
      const si = (Math.min(source.height - 1, Math.max(0, sy)) * source.width +
                  Math.min(source.width - 1, Math.max(0, sx))) * 3
      // Warm, dim room light: the cast the classifier has to see through.
      photo[at] = Math.min(255, source.data[si] * 0.72 + 26)
      photo[at + 1] = Math.min(255, source.data[si + 1] * 0.66)
      photo[at + 2] = Math.min(255, source.data[si + 2] * 0.58)
    }
  }

  // Now read it back, the way the page does.
  const raster: Raster = { data: photo, width: W, height: H, ratio: 1 }
  const fit = makeTransform(place(HEX_CENTERS[0]), place(HEX_CENTERS[18]))
  const samples = HEX_CENTERS.map((c) => sampleRing(raster, fit.project(c), fit.scale * HEX_W))
  const guesses = classifyTiles(samples, references)

  expect(guesses.map((g) => g.type)).toEqual(truth)

  // The bag is spent exactly, so the result is always a legal board.
  const counted = {} as Record<string, number>
  for (const guess of guesses) counted[guess.type] = (counted[guess.type] ?? 0) + 1
  expect(counted).toEqual(TILE_SUPPLY)
})

it('is not simply matching whatever the reference art says', () => {
  // Guard against the fixture degenerating: the truth board must be varied.
  const truth = TILE_TYPES.flatMap((t) => Array.from({ length: TILE_SUPPLY[t] }, () => t))
  expect(new Set(truth).size).toBe(6)
  expect(truth).toHaveLength(19)
})
})
