/**
 * Reading a board off a photograph.
 *
 * Recognising a Catan board from an arbitrary snapshot is a hard vision problem
 * in general, so this deliberately does the tractable half well and hands the
 * rest to the user:
 *
 *  - **You place the grid.** Two draggable handles (the centres of the A1 and E3
 *    tiles) fix a similarity transform — position, scale and rotation — which is
 *    all a board needs, because its 19 hexes are rigid relative to each other.
 *  - **We read the terrain.** Each hex is sampled as a ring of pixels that dodges
 *    the number token, then matched against colours taken from this site's own
 *    tile artwork.
 *  - **The bag does the rest.** A Catan box holds exactly 1 desert, 3 brick,
 *    4 lumber, 3 ore, 4 sheep and 4 wheat, so classification is an assignment
 *    problem under fixed supply rather than 19 independent guesses. That single
 *    constraint fixes most of the mistakes a per-tile classifier would make.
 *
 * Number tokens are not read: OCR on a phone photo of a small printed numeral is
 * unreliable enough that a wrong answer costs more than an empty one. The UI
 * asks for the 18 numbers instead, and tracks the bag while you type.
 */
import { HEX_CENTERS, HEX_H, HEX_W } from './geometry'
import { tileImage } from './assets'
import { RESOURCE_LABELS, TILE_TYPES, type Tile, type TileType } from './types'

export interface Point {
  x: number
  y: number
}

/** How many of each terrain a standard base-game box contains. */
export const TILE_SUPPLY: Record<TileType, number> = {
  desert: 1,
  brick: 3,
  lumber: 4,
  ore: 3,
  sheep: 4,
  wheat: 4,
}

/** The 18 number tokens, for the bag tracker in the editor. */
export const NUMBER_SUPPLY: Record<number, number> = {
  2: 1, 3: 2, 4: 2, 5: 2, 6: 2, 8: 2, 9: 2, 10: 2, 11: 2, 12: 1,
}

/** Every number a tile can carry, in order. 7 belongs to the robber. */
export const NUMBER_TOKENS = Object.keys(NUMBER_SUPPLY).map(Number)

/** A board still being typed in carries 0 for "no number chosen yet". */
export const NO_NUMBER = 0

/** A tile whose terrain hasn't been chosen yet. */
export const BLANK_TILE: Tile = { type: 'desert', number: 7, blank: true }

/** A blank board: 19 grey tiles waiting for their terrain and numbers. */
export function blankBoard(): Tile[] {
  return HEX_CENTERS.map(() => ({ ...BLANK_TILE }))
}

/** How many of each terrain and number a board currently spends. */
export function tallyBoard(tiles: readonly Tile[]) {
  const terrain = {} as Record<TileType, number>
  const numbers: Record<number, number> = {}
  for (const type of TILE_TYPES) terrain[type] = 0
  for (const tile of tiles) {
    if (tile.blank) continue
    terrain[tile.type]++
    if (tile.type !== 'desert' && tile.number !== NO_NUMBER) {
      numbers[tile.number] = (numbers[tile.number] ?? 0) + 1
    }
  }
  return { terrain, numbers }
}

/**
 * Everything standing between this board and a shareable one, in plain words.
 * An empty list means it is a legal base-game layout.
 */
export function boardProblems(tiles: readonly Tile[]): string[] {
  const problems: string[] = []
  const { terrain, numbers } = tallyBoard(tiles)

  const unset = tiles.filter((t) => t.blank).length
  if (unset > 0) problems.push(`${unset} ${unset === 1 ? 'tile still needs' : 'tiles still need'} a terrain`)

  for (const type of TILE_TYPES) {
    const diff = terrain[type] - TILE_SUPPLY[type]
    // While tiles are still grey, running short of a terrain is expected.
    if (diff > 0 || (diff < 0 && unset === 0)) {
      problems.push(
        `${Math.abs(diff)} ${diff > 0 ? 'too many' : 'too few'} ${RESOURCE_LABELS[type].toLowerCase()}`,
      )
    }
  }

  const blank = tiles.filter((t) => t.type !== 'desert' && t.number === NO_NUMBER).length
  if (blank > 0) problems.push(`${blank} ${blank === 1 ? 'tile still needs' : 'tiles still need'} a number`)

  for (const number of NUMBER_TOKENS) {
    const diff = (numbers[number] ?? 0) - NUMBER_SUPPLY[number]
    if (diff > 0) problems.push(`the ${number} token is used ${diff} time${diff > 1 ? 's' : ''} too often`)
  }

  return problems
}

/* ------------------------------------------------------------------ *
 * The calibration transform
 * ------------------------------------------------------------------ */

/** The two tiles the user drags, chosen because they are opposite corners. */
export const ANCHOR_TILES = [0, 18] as const

/**
 * Map board coordinates onto the photo, given where the user put the handles.
 *
 * Two points pin down a similarity transform exactly: the vector between them
 * gives scale and rotation, and either one gives the offset. Both anchor tiles
 * sit symmetrically about the board's centre, so the fit is stable even if the
 * photo is rotated or taken at an angle from one side.
 */
export function makeTransform(a: Point, b: Point) {
  const from = HEX_CENTERS[ANCHOR_TILES[0]]
  const to = HEX_CENTERS[ANCHOR_TILES[1]]
  const bx = to.x - from.x
  const by = to.y - from.y
  const boardLen = Math.hypot(bx, by)

  const ix = b.x - a.x
  const iy = b.y - a.y
  const imageLen = Math.hypot(ix, iy)

  const scale = imageLen / boardLen
  const angle = Math.atan2(iy, ix) - Math.atan2(by, bx)
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)

  const project = (p: Point): Point => {
    const dx = p.x - from.x
    const dy = p.y - from.y
    return {
      x: a.x + scale * (dx * cos - dy * sin),
      y: a.y + scale * (dx * sin + dy * cos),
    }
  }

  return { project, scale, angle }
}

/** Where each of the 19 tiles lands on the photo. */
export function hexPositions(a: Point, b: Point): Point[] {
  const { project } = makeTransform(a, b)
  return HEX_CENTERS.map(project)
}

/** Corners of a pointy-top hex, clockwise from the top, in board units. */
const HEX_CORNERS: Point[] = [
  { x: 0, y: -HEX_H / 2 },
  { x: HEX_W / 2, y: -HEX_H / 4 },
  { x: HEX_W / 2, y: HEX_H / 4 },
  { x: 0, y: HEX_H / 2 },
  { x: -HEX_W / 2, y: HEX_H / 4 },
  { x: -HEX_W / 2, y: -HEX_H / 4 },
]

/** The 19 hexes as polygons on the photo, for drawing the calibration grid. */
export function hexOutlines(a: Point, b: Point): Point[][] {
  const { project } = makeTransform(a, b)
  return HEX_CENTERS.map((center) =>
    HEX_CORNERS.map((corner) => project({ x: center.x + corner.x, y: center.y + corner.y })),
  )
}

/** Half-extent of the island in board units, hex bodies included. */
const BOARD_HALF = { x: 2 + HEX_W / 2, y: 1.5 * HEX_H + HEX_H / 2 }

/**
 * A first guess at the handles for a freshly opened photo: the island centred
 * and filling most of the frame, which is how people photograph a board.
 */
export function defaultAnchors(width: number, height: number): [Point, Point] {
  const scale = 0.78 * Math.min(width / (BOARD_HALF.x * 2), height / (BOARD_HALF.y * 2))
  const place = (i: number): Point => ({
    x: width / 2 + HEX_CENTERS[i].x * scale,
    y: height / 2 + HEX_CENTERS[i].y * scale,
  })
  return [place(ANCHOR_TILES[0]), place(ANCHOR_TILES[1])]
}

/* ------------------------------------------------------------------ *
 * Colour
 * ------------------------------------------------------------------ */

export interface Hsv {
  h: number
  s: number
  v: number
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const span = max - min
  let h = 0
  if (span !== 0) {
    if (max === r) h = ((g - b) / span) % 6
    else if (max === g) h = (b - r) / span + 2
    else h = (r - g) / span + 4
  }
  h = (h * 60 + 360) % 360
  return { h, s: max === 0 ? 0 : span / max, v: max / 255 }
}

/** Shortest way round the colour wheel, 0-180. */
const hueGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return d > 180 ? 360 - d : d
}

/**
 * How unlike two colours are, on a scale where ~0.3 is already a poor match.
 *
 * Hue carries most of the signal but becomes meaningless as colours approach
 * grey, so it is weighted by how saturated *both* colours are — which is what
 * keeps the ore mountains from being read as whatever hue their shadows happen
 * to skew towards.
 */
export function colorDistance(a: Hsv, b: Hsv): number {
  const chroma = Math.min(a.s, b.s)
  return (
    (hueGap(a.h, b.h) / 180) * chroma * 1.6 +
    Math.abs(a.s - b.s) * 0.7 +
    Math.abs(a.v - b.v) * 0.7
  )
}

/** Component-wise median: one robust colour from a cloud of noisy samples. */
function medianRgb(samples: number[][]): [number, number, number] {
  const pick = (channel: number) => {
    const sorted = samples.map((s) => s[channel]).sort((x, y) => x - y)
    return sorted[sorted.length >> 1]
  }
  return [pick(0), pick(1), pick(2)]
}

/* ------------------------------------------------------------------ *
 * Sampling
 * ------------------------------------------------------------------ */

/** Ring of sample points, as a fraction of hex width from the centre. */
const RING_RADII = [0.27, 0.33, 0.39, 0.44]
const RING_STEPS = 18

/** The biggest canvas we will decode a photo into; plenty for colour work. */
const MAX_CANVAS = 1400

export interface Raster {
  data: Uint8ClampedArray
  width: number
  height: number
  /** Photo pixels per raster pixel, so callers can scale their coordinates. */
  ratio: number
}

/** Decode an image into a flat pixel buffer we can sample cheaply. */
export function rasterize(image: HTMLImageElement): Raster | null {
  const natural = Math.max(image.naturalWidth, image.naturalHeight)
  const ratio = natural > MAX_CANVAS ? natural / MAX_CANVAS : 1
  const width = Math.round(image.naturalWidth / ratio)
  const height = Math.round(image.naturalHeight / ratio)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.drawImage(image, 0, 0, width, height)

  try {
    const { data } = ctx.getImageData(0, 0, width, height)
    return { data, width, height, ratio }
  } catch {
    // A cross-origin image taints the canvas; nothing to read.
    return null
  }
}

/**
 * The average colour of the ring around one hex centre.
 *
 * The ring skips the middle of the tile, where the number token, the robber or
 * a stray piece would otherwise dominate, and stops short of the edge, where
 * the neighbouring hex bleeds in.
 */
export function sampleRing(raster: Raster, center: Point, hexPixels: number): Hsv | null {
  const samples: number[][] = []
  for (const radius of RING_RADII) {
    for (let i = 0; i < RING_STEPS; i++) {
      const angle = (i / RING_STEPS) * Math.PI * 2
      const x = Math.round(center.x + Math.cos(angle) * radius * hexPixels)
      const y = Math.round(center.y + Math.sin(angle) * radius * hexPixels)
      if (x < 0 || y < 0 || x >= raster.width || y >= raster.height) continue
      const at = (y * raster.width + x) * 4
      samples.push([raster.data[at], raster.data[at + 1], raster.data[at + 2]])
    }
  }
  if (samples.length < RING_STEPS) return null
  const [r, g, b] = medianRgb(samples)
  return rgbToHsv(r, g, b)
}

/* ------------------------------------------------------------------ *
 * Reference colours, taken from this site's own tile art
 * ------------------------------------------------------------------ */

let referencePromise: Promise<Map<TileType, Hsv>> | null = null

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`could not load ${src}`))
    image.src = src
  })
}

/**
 * Sample each tile graphic exactly the way we sample the photo, so the two are
 * directly comparable. Loaded once and cached for the session.
 */
export function referenceColors(): Promise<Map<TileType, Hsv>> {
  referencePromise ??= (async () => {
    const out = new Map<TileType, Hsv>()
    for (const type of TILE_TYPES) {
      try {
        const image = await loadImage(tileImage(type))
        const raster = rasterize(image)
        if (!raster) continue
        const center = { x: raster.width / 2, y: raster.height / 2 }
        const color = sampleRing(raster, center, raster.width)
        if (color) out.set(type, color)
      } catch {
        // A missing graphic just means one fewer reference to match against.
      }
    }
    return out
  })()
  return referencePromise
}

/* ------------------------------------------------------------------ *
 * Classification
 * ------------------------------------------------------------------ */

export interface TileGuess {
  type: TileType
  /** 0-1. How much better this terrain fit than the runner-up. */
  confidence: number
}

/**
 * Pull the photo's exposure and white balance towards the reference art.
 *
 * A board shot under a warm lamp is uniformly darker and more orange than the
 * artwork, which would otherwise push every tile the same wrong way. Matching
 * the two sets' averages cancels that out, and because it is a single shift
 * applied to all 19 samples it cannot invent differences between them.
 */
function balance(samples: Hsv[], references: Hsv[]): Hsv[] {
  const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / (values.length || 1)
  const meanCos = mean(samples.map((s) => Math.cos((s.h * Math.PI) / 180)))
  const meanSin = mean(samples.map((s) => Math.sin((s.h * Math.PI) / 180)))
  const sampleHue = (Math.atan2(meanSin, meanCos) * 180) / Math.PI

  const refCos = mean(references.map((s) => Math.cos((s.h * Math.PI) / 180)))
  const refSin = mean(references.map((s) => Math.sin((s.h * Math.PI) / 180)))
  const refHue = (Math.atan2(refSin, refCos) * 180) / Math.PI

  const hueShift = refHue - sampleHue
  // Gains are clamped so a genuinely washed-out or vivid photo is nudged, not
  // rewritten into something the classifier has never seen.
  const clamp = (value: number) => Math.min(1.6, Math.max(0.625, value))
  const satGain = clamp(mean(references.map((r) => r.s)) / (mean(samples.map((s) => s.s)) || 1))
  const valGain = clamp(mean(references.map((r) => r.v)) / (mean(samples.map((s) => s.v)) || 1))

  return samples.map((s) => ({
    // Only half the hue shift: enough to correct a colour cast, not so much
    // that it drags a board photographed on green baize onto the grass.
    h: (s.h + hueShift * 0.5 + 360) % 360,
    s: Math.min(1, s.s * satGain),
    v: Math.min(1, s.v * valGain),
  }))
}

/**
 * Assign a terrain to each sampled hex, spending the box's tiles exactly.
 *
 * Every (hex, terrain) pair is scored, then the cheapest pairs are taken first,
 * skipping any hex already settled or any terrain whose supply has run out.
 * Greedy rather than optimal, but with only 19 hexes and six terrains the two
 * agree in practice, and it degrades gracefully: the confident tiles claim
 * their terrain first and the ambiguous ones take what is left.
 */
export function classifyTiles(
  samples: Array<Hsv | null>,
  references: Map<TileType, Hsv>,
): TileGuess[] {
  const types = TILE_TYPES.filter((t) => references.has(t))
  const guesses: TileGuess[] = samples.map(() => ({ type: 'desert', confidence: 0 }))
  if (types.length === 0) return guesses

  const known = samples.flatMap((s) => (s ? [s] : []))
  const adjusted = balance(known, types.map((t) => references.get(t)!))
  // Re-align the corrected colours with the hexes they came from.
  const corrected: Array<Hsv | null> = []
  let next = 0
  for (const sample of samples) corrected.push(sample ? adjusted[next++] : null)

  const cost = corrected.map((sample) =>
    types.map((type) => (sample ? colorDistance(sample, references.get(type)!) : 1)),
  )

  const supply = { ...TILE_SUPPLY }
  const pairs = cost.flatMap((row, hex) => row.map((value, type) => ({ hex, type, value })))
  pairs.sort((a, b) => a.value - b.value)

  const settled = new Set<number>()
  for (const { hex, type, value } of pairs) {
    if (settled.size === samples.length) break
    if (settled.has(hex) || supply[types[type]] <= 0) continue
    settled.add(hex)
    supply[types[type]]--

    // Confidence is the gap to the next-best terrain: a hex that could plausibly
    // be two things is one the user should look at.
    const alternatives = cost[hex].filter((_, i) => i !== type).sort((a, b) => a - b)
    const margin = (alternatives[0] ?? value) - value
    guesses[hex] = {
      type: types[type],
      confidence: Math.max(0, Math.min(1, margin / 0.18)),
    }
  }

  return guesses
}

/** Read the terrain of all 19 tiles from a photo and a pair of handles. */
export async function detectTiles(
  image: HTMLImageElement,
  anchorA: Point,
  anchorB: Point,
): Promise<TileGuess[] | null> {
  const raster = rasterize(image)
  if (!raster) return null

  const toRaster = (p: Point) => ({ x: p.x / raster.ratio, y: p.y / raster.ratio })
  const a = toRaster(anchorA)
  const b = toRaster(anchorB)
  const { project, scale } = makeTransform(a, b)
  const hexPixels = scale * HEX_W

  const samples = HEX_CENTERS.map((c) => sampleRing(raster, project(c), hexPixels))
  return classifyTiles(samples, await referenceColors())
}
