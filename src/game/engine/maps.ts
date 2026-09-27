/**
 * Map generation: the standard island, the 5-6 and 7-8 player boards, the
 * Seafarers scenarios and the random New World.
 *
 * Scenario maps are drawn as ASCII hex pictures. Each character is half a hex
 * wide, so row r's hexes sit on columns of r's parity and neighbouring rows
 * interlock the way the tiles do:
 *
 *     "~ ~ ~ ~"        ~  sea               M, N, A, I, R …  land from that letter's pool
 *     " ~ M M ~"       P  sea, pirate start  F  fog (terrain from the fog pool)
 *     "~ M M M ~"      b l o s w d g k  a fixed brick/lumber/ore/sheep/wheat/desert/gold/lake
 *
 * Harbours are placed automatically, spaced evenly along the coast of the
 * regions players start on, so a picture never has to spell out which way
 * each harbour faces.
 */
import { buildTopology, sideVertices, type Topology } from './hexgrid'
import { pick, shuffle, type Rng } from './rng'
import type { Harbor, HarborType, HexState, MapState, Resource, Terrain } from './types'

export interface GeneratedMap {
  map: MapState
  robber: number
  pirate: number
}

export type NumberStyle = 'balanced' | 'random'

/* ------------------------------------------------------------------ *
 * Pools
 * ------------------------------------------------------------------ */

type Bag = Partial<Record<Terrain, number>>

const bag = (b: Bag): Terrain[] =>
  (Object.entries(b) as Array<[Terrain, number]>).flatMap(([t, n]) => Array<Terrain>(n).fill(t))

export const STANDARD_TERRAIN: Bag = { lumber: 4, sheep: 4, wheat: 4, brick: 3, ore: 3, desert: 1 }
export const LARGE56_TERRAIN: Bag = { lumber: 6, sheep: 6, wheat: 6, brick: 5, ore: 5, desert: 2 }
export const LARGE78_TERRAIN: Bag = { lumber: 8, sheep: 8, wheat: 7, brick: 6, ore: 6, desert: 2 }

const STANDARD_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]
const LARGE56_NUMBERS = [
  2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12,
]
const LARGE78_NUMBERS = [
  2, 2, 12, ...[3, 4, 5, 6, 8, 9, 10, 11].flatMap((n) => [n, n, n, n]),
]

/** A fair spread of `n` number tokens: whole base sets, then the middle numbers first. */
export function numberPool(n: number): number[] {
  const out: number[] = []
  while (out.length + STANDARD_NUMBERS.length <= n) out.push(...STANDARD_NUMBERS)
  const extra = [5, 9, 4, 10, 6, 8, 3, 11, 5, 9, 4, 10, 6, 8, 3, 11, 2, 12]
  out.push(...extra.slice(0, n - out.length))
  return out
}

const STANDARD_HARBORS: HarborType[] = ['any', 'any', 'any', 'any', 'brick', 'lumber', 'ore', 'sheep', 'wheat']

function harborBag(count: number): HarborType[] {
  const specific: HarborType[] = ['sheep', 'lumber', 'wheat', 'brick', 'ore']
  const out: HarborType[] = []
  // Roughly the base game's mix: a little under half generic.
  const generic = Math.round(count * 0.45)
  for (let i = 0; i < count - generic; i++) out.push(specific[i % specific.length])
  for (let i = 0; i < generic; i++) out.push('any')
  return out
}

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

const needsNumber = (t: Terrain) => t !== 'sea' && t !== 'desert' && t !== 'lake'

const isRed = (n: number | undefined) => n === 6 || n === 8

/**
 * Deal numbers onto the hexes that need them. Balanced dealing never lets
 * two 6s or 8s touch; if the greedy pass paints itself into a corner the deal
 * is simply redone.
 */
function dealNumbers(topo: Topology, hexes: HexState[], pool: number[], rng: Rng, style: NumberStyle) {
  const targets = hexes.flatMap((h, i) => (needsNumber(h.terrain) ? [i] : []))
  if (pool.length < targets.length) pool = [...pool, ...numberPool(targets.length - pool.length)]
  for (let attempt = 0; attempt < 200; attempt++) {
    const numbers = shuffle(rng, pool).slice(0, targets.length)
    if (style === 'random') {
      targets.forEach((h, i) => (hexes[h].number = numbers[i]))
      return
    }
    const reds = numbers.filter(isRed)
    const rest = numbers.filter((n) => !isRed(n))
    const open = new Set(shuffle(rng, targets))
    const assigned = new Map<number, number>()
    let ok = true
    for (const red of reds) {
      const spot = [...open].find((h) =>
        topo.hexes[h].neighbors.every((nb) => nb < 0 || !isRed(assigned.get(nb))),
      )
      if (spot === undefined) {
        ok = false
        break
      }
      assigned.set(spot, red)
      open.delete(spot)
    }
    if (!ok) continue
    const remaining = [...open]
    remaining.forEach((h, i) => assigned.set(h, rest[i]))
    for (const [h, n] of assigned) hexes[h].number = n
    return
  }
  // Could not balance (tiny odd maps); fall back to a plain deal.
  dealNumbers(topo, hexes, pool, rng, 'random')
}

/**
 * Land regions: connected groups of land that isn't desert. Deserts split
 * regions on purpose — in Through the Desert the land beyond the sand counts
 * as foreign soil.
 */
export function computeRegions(topo: Topology, hexes: HexState[]) {
  hexes.forEach((h) => (h.region = -1))
  let next = 0
  const land = (h: HexState) => h.terrain !== 'sea' && h.terrain !== 'desert'
  // Visible land first, then land under the fog, never flooding from one to
  // the other: the region numbers anyone can see then say nothing about what
  // the fog hides.
  for (const fogged of [false, true]) {
    hexes.forEach((h, i) => {
      if (h.region >= 0 || !land(h) || (h.veil === 'fog') !== fogged) return
      const stack = [i]
      h.region = next
      while (stack.length) {
        const at = stack.pop()!
        for (const nb of topo.hexes[at].neighbors) {
          if (nb < 0) continue
          const other = hexes[nb]
          if (other.region >= 0 || !land(other) || (other.veil === 'fog') !== fogged) continue
          other.region = next
          stack.push(nb)
        }
      }
      next++
    })
  }
}

/**
 * Pick `count` harbour spots along the coast of `regions`, spread evenly by
 * bearing and never sharing a corner. Harbours avoid deserts where they can.
 */
export function autoHarbors(
  topo: Topology,
  hexes: HexState[],
  types: HarborType[],
  regions: ReadonlySet<number> | null,
  rng: Rng,
): Harbor[] {
  const coast: Array<{ hex: number; side: number; angle: number }> = []
  const land = hexes.flatMap((h, i) => (h.terrain !== 'sea' && (!regions || regions.has(h.region)) ? [i] : []))
  if (land.length === 0) return []
  const cx = land.reduce((s, i) => s + topo.hexes[i].x, 0) / land.length
  const cy = land.reduce((s, i) => s + topo.hexes[i].y, 0) / land.length
  for (const i of land) {
    if (hexes[i].veil) continue
    topo.hexes[i].neighbors.forEach((nb, side) => {
      if (nb < 0 || hexes[nb].terrain !== 'sea' || hexes[nb].veil) return
      const e = topo.edges[topo.hexes[i].sides[side]]
      coast.push({ hex: i, side, angle: Math.atan2(e.y - cy, e.x - cx) })
    })
  }
  coast.sort((a, b) => a.angle - b.angle)
  const count = Math.min(types.length, Math.floor(coast.length / 2))
  if (count === 0) return []

  const offset = rng.next() * (coast.length / count)
  const used = new Set<number>()
  const out: Harbor[] = []
  const typesShuffled = shuffle(rng, types)
  for (let k = 0; k < count; k++) {
    const target = Math.round(offset + (k * coast.length) / count) % coast.length
    // Search outward from the ideal spot for a free, non-desert edge.
    let chosen: (typeof coast)[number] | null = null
    for (let d = 0; d < coast.length && !chosen; d++) {
      for (const idx of d === 0 ? [target] : [target + d, target - d]) {
        const c = coast[((idx % coast.length) + coast.length) % coast.length]
        const [a, b] = sideVertices(topo, c.hex, c.side)
        if (used.has(a) || used.has(b)) continue
        if (hexes[c.hex].terrain === 'desert' && d < 2) continue
        chosen = c
        break
      }
    }
    if (!chosen) break
    const [a, b] = sideVertices(topo, chosen.hex, chosen.side)
    used.add(a)
    used.add(b)
    out.push({ hex: chosen.hex, side: chosen.side, type: typesShuffled[k] })
  }
  return out
}

/** Sea hexes framing a set of land coordinates. */
function withSeaFrame(land: Array<{ q: number; r: number }>): Array<{ q: number; r: number }> {
  const key = (q: number, r: number) => `${q},${r}`
  const seen = new Set(land.map((c) => key(c.q, c.r)))
  const sea: Array<{ q: number; r: number }> = []
  for (const c of land) {
    for (const [dq, dr] of [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]]) {
      const k = key(c.q + dq, c.r + dr)
      if (!seen.has(k)) {
        seen.add(k)
        sea.push({ q: c.q + dq, r: c.r + dr })
      }
    }
  }
  return [...land, ...sea]
}

/** Land hexes in rows of the given sizes, centred, top to bottom. */
function rowsOfLand(sizes: number[]): Array<{ q: number; r: number }> {
  const mid = Math.floor(sizes.length / 2)
  // Choose a horizontal shift that puts the middle row on whole-number x.
  const shift = ((sizes[mid] - 1) / 2) % 1
  const out: Array<{ q: number; r: number }> = []
  sizes.forEach((n, row) => {
    const r = row - mid
    for (let c = 0; c < n; c++) {
      const x = c - (n - 1) / 2 + shift
      out.push({ q: Math.round(x - r / 2), r })
    }
  })
  return out
}

function finish(
  coords: Array<{ q: number; r: number }>,
  terrains: Terrain[],
  opts: {
    numbers: number[]
    style: NumberStyle
    harbors: HarborType[] | Harbor[]
    homeLetters?: Set<number>
    rng: Rng
    fishermen: boolean
    pirate?: number
    fog?: Set<number>
    homeAll?: boolean
  },
): GeneratedMap {
  const topo = buildTopology(coords)
  const hexes: HexState[] = coords.map((c, i) => ({
    q: c.q,
    r: c.r,
    terrain: terrains[i],
    region: -1,
    ...(opts.fog?.has(i) ? { veil: 'fog' as const } : {}),
  }))
  if (opts.fishermen) {
    for (const h of hexes) if (h.terrain === 'desert') h.terrain = 'lake'
  }
  dealNumbers(topo, hexes, opts.numbers, opts.rng, opts.style)
  computeRegions(topo, hexes)

  const homeRegions =
    opts.homeAll || !opts.homeLetters
      ? []
      : [...new Set([...opts.homeLetters].map((i) => hexes[i].region).filter((r) => r >= 0))]

  const harbors =
    opts.harbors.length > 0 && typeof opts.harbors[0] === 'object'
      ? (opts.harbors as Harbor[])
      : autoHarbors(
          topo,
          hexes,
          opts.harbors as HarborType[],
          homeRegions.length ? new Set(homeRegions) : null,
          opts.rng,
        )

  if (opts.fishermen) placeFishingGrounds(topo, hexes, harbors, opts.rng)

  const desert = hexes.findIndex((h) => h.terrain === 'desert' && !h.veil)
  return {
    map: { hexes, harbors, homeRegions },
    robber: desert,
    pirate: opts.pirate ?? -1,
  }
}

/**
 * Fishermen: six fishing grounds on coastal sea hexes, spaced around the
 * island, numbered 4, 5, 6, 8, 9 and 10. They keep clear of harbours.
 */
function placeFishingGrounds(topo: Topology, hexes: HexState[], harbors: Harbor[], rng: Rng) {
  const harborSea = new Set(harbors.map((h) => topo.hexes[h.hex].neighbors[h.side]))
  const land = hexes.flatMap((h, i) => (h.terrain !== 'sea' ? [i] : []))
  const cx = land.reduce((s, i) => s + topo.hexes[i].x, 0) / land.length
  const cy = land.reduce((s, i) => s + topo.hexes[i].y, 0) / land.length
  const candidates = hexes
    .map((h, i) => ({ h, i }))
    .filter(({ h, i }) =>
      h.terrain === 'sea' && !harborSea.has(i) &&
      topo.hexes[i].neighbors.filter((nb) => nb >= 0 && hexes[nb].terrain !== 'sea').length >= 2,
    )
    .map(({ i }) => ({ i, angle: Math.atan2(topo.hexes[i].y - cy, topo.hexes[i].x - cx) }))
    .sort((a, b) => a.angle - b.angle)
  const numbers = shuffle(rng, [4, 5, 6, 8, 9, 10])
  const count = Math.min(6, candidates.length)
  const offset = Math.floor(rng.next() * candidates.length)
  const picked = new Set<number>()
  for (let k = 0; k < count; k++) {
    let idx = (offset + Math.round((k * candidates.length) / count)) % candidates.length
    while (picked.has(candidates[idx].i)) idx = (idx + 1) % candidates.length
    picked.add(candidates[idx].i)
    hexes[candidates[idx].i].fishing = numbers[k]
  }
}

/**
 * A map whose every tile is already decided — a board brought over from the
 * board generator, Import or Position pages.
 */
export function fixedMap(opts: {
  coords: Array<{ q: number; r: number }>
  hexes: Array<{ terrain: Terrain; number?: number }>
  harbors: Harbor[]
  fishermen: boolean
  rng: Rng
}): GeneratedMap {
  const topo = buildTopology(opts.coords)
  const hexes: HexState[] = opts.coords.map((c, i) => {
    const { terrain, number } = opts.hexes[i]
    return { q: c.q, r: c.r, terrain, region: -1, ...(needsNumber(terrain) && number ? { number } : {}) }
  })
  if (opts.fishermen) {
    for (const h of hexes) if (h.terrain === 'desert') h.terrain = 'lake'
  }
  computeRegions(topo, hexes)
  if (opts.fishermen) placeFishingGrounds(topo, hexes, opts.harbors, opts.rng)
  return { map: { hexes, harbors: opts.harbors, homeRegions: [] }, robber: hexes.findIndex((h) => h.terrain === 'desert'), pirate: -1 }
}

/* ------------------------------------------------------------------ *
 * The base boards
 * ------------------------------------------------------------------ */

/**
 * The standard harbours, as (land tile, side) in the base board's tile order —
 * the same berths the board generator uses.
 */
const STANDARD_HARBOR_SIDES: Array<[number, number]> = [
  [0, 5], [1, 0], [3, 4], [2, 1], [12, 4], [11, 1], [16, 3], [17, 2], [15, 2],
]

/** The 19-hex board's land coordinates, in the board generator's tile order. */
export const STANDARD_LAND = rowsOfLand([3, 4, 5, 4, 3])
export const STANDARD_COORDS = withSeaFrame(STANDARD_LAND)

export function standardMap(rng: Rng, opts: { style?: NumberStyle; fishermen?: boolean } = {}): GeneratedMap {
  const terrains: Terrain[] = [...shuffle(rng, bag(STANDARD_TERRAIN)), ...STANDARD_COORDS.slice(19).map(() => 'sea' as const)]
  const types = shuffle(rng, STANDARD_HARBORS)
  return finish(STANDARD_COORDS, terrains, {
    numbers: STANDARD_NUMBERS,
    style: opts.style ?? 'balanced',
    harbors: STANDARD_HARBOR_SIDES.map(([hex, side], i) => ({ hex, side, type: types[i] })),
    rng,
    fishermen: !!opts.fishermen,
    homeAll: true,
  })
}

export function largeMap(
  players: number,
  rng: Rng,
  opts: { style?: NumberStyle; fishermen?: boolean } = {},
): GeneratedMap {
  const eight = players > 6
  const land = rowsOfLand(eight ? [4, 5, 6, 7, 6, 5, 4] : [3, 4, 5, 6, 5, 4, 3])
  const coords = withSeaFrame(land)
  const pool = bag(eight ? LARGE78_TERRAIN : LARGE56_TERRAIN)
  const terrains: Terrain[] = [...shuffle(rng, pool), ...coords.slice(land.length).map(() => 'sea' as const)]
  return finish(coords, terrains, {
    numbers: eight ? LARGE78_NUMBERS : LARGE56_NUMBERS,
    style: opts.style ?? 'balanced',
    harbors: harborBag(eight ? 13 : 11),
    rng,
    fishermen: !!opts.fishermen,
    homeAll: true,
  })
}

/* ------------------------------------------------------------------ *
 * ASCII scenario maps
 * ------------------------------------------------------------------ */

const FIXED: Record<string, Terrain> = {
  b: 'brick', l: 'lumber', o: 'ore', s: 'sheep', w: 'wheat', d: 'desert', g: 'gold', k: 'lake',
}

export interface Recipe {
  rows: string[]
  /** Land pools by letter. */
  pools: Record<string, Bag>
  /** Letters whose regions players may start on. Empty means anywhere. */
  home: string[]
  harbors: number
  fog?: Bag
}

interface ParsedCell {
  q: number
  r: number
  token: string
}

export function parseRows(rows: string[]): ParsedCell[] {
  const cells: ParsedCell[] = []
  rows.forEach((line, r) => {
    for (let c = 0; c < line.length; c++) {
      const token = line[c]
      if (token === ' ' || token === '.') continue
      if ((c - r) % 2 !== 0) {
        throw new Error(`map row ${r}: "${token}" at column ${c} is off the hex grid`)
      }
      // x = c / 2, and x = q + r / 2.
      cells.push({ q: (c - r) / 2, r, token })
    }
  })
  return cells
}

export function recipeMap(recipe: Recipe, rng: Rng, opts: { fishermen?: boolean } = {}): GeneratedMap {
  const cells = parseRows(recipe.rows)
  const coords = cells.map(({ q, r }) => ({ q, r }))
  const pools: Record<string, Terrain[]> = {}
  for (const [letter, b] of Object.entries(recipe.pools)) pools[letter] = shuffle(rng, bag(b))
  const fogPool = recipe.fog ? shuffle(rng, bag(recipe.fog)) : []

  const fog = new Set<number>()
  const homeCells = new Set<number>()
  let pirate = -1
  const terrains: Terrain[] = cells.map((cell, i) => {
    const t = cell.token
    if (t === '~') return 'sea'
    if (t === 'P') {
      pirate = i
      return 'sea'
    }
    if (FIXED[t]) return FIXED[t]
    if (t === 'F') {
      fog.add(i)
      return fogPool.pop() ?? 'sea'
    }
    const pool = pools[t]
    if (!pool) throw new Error(`map uses "${t}" but has no pool for it`)
    if (recipe.home.includes(t)) homeCells.add(i)
    // A short pool is a recipe bug, but a playable one: pad with a random resource.
    return pool.pop() ?? pick(rng, ['brick', 'lumber', 'ore', 'sheep', 'wheat'] as Resource[])
  })

  const needing = terrains.filter(needsNumber).length
  return finish(coords, terrains, {
    numbers: numberPool(needing),
    style: 'balanced',
    harbors: harborBag(recipe.harbors),
    homeLetters: homeCells,
    homeAll: recipe.home.length === 0,
    rng,
    fishermen: !!opts.fishermen,
    pirate,
    fog,
  })
}

/* ------------------------------------------------------------------ *
 * Seafarers scenarios
 * ------------------------------------------------------------------ */

export interface Scenario {
  id: string
  title: string
  blurb: string
  vpTarget: number
  islandBonus: number
  minPlayers: number
  maxPlayers: number
  /** Map for up to four players, and for five or six. */
  small: Recipe | 'random'
  large: Recipe | 'random'
}

const NEW_SHORES: Scenario = {
  id: 'new-shores',
  title: 'Heading for New Shores',
  blurb: 'A familiar island, and small islands across the water — two gold fields among them.',
  vpTarget: 14,
  islandBonus: 2,
  minPlayers: 2,
  maxPlayers: 6,
  small: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ ~ M M M ~ ~ I I ~ ~ ~',
      '~ ~ M M M M ~ ~ I I ~ ~',
      ' ~ M M M M M ~ ~ P ~ I ~',
      '~ ~ M M M M ~ I I ~ I ~',
      ' ~ ~ M M M ~ ~ I ~ ~ I ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      M: STANDARD_TERRAIN,
      I: { gold: 2, ore: 2, brick: 2, wheat: 2, sheep: 1, lumber: 1 },
    },
    home: ['M'],
    harbors: 9,
  },
  large: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ ~ M M M ~ ~ I I ~ ~ ~ ~',
      '~ ~ M M M M ~ ~ I I I ~ ~ ~',
      ' ~ M M M M M ~ ~ ~ P ~ ~ ~',
      '~ M M M M M M ~ I I ~ I ~',
      ' ~ M M M M M ~ ~ I ~ ~ I ~ ~',
      '~ ~ M M M M ~ ~ ~ ~ ~ I I ~',
      ' ~ ~ M M M ~ ~ I I I ~ ~ ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      M: LARGE56_TERRAIN,
      I: { gold: 3, ore: 3, brick: 3, wheat: 2, sheep: 2, lumber: 2 },
    },
    home: ['M'],
    harbors: 11,
  },
}

const FOUR_ISLANDS: Scenario = {
  id: 'four-islands',
  title: 'The Four Islands',
  blurb: 'Four islands of equal size. Start on one or two; every other island is worth a bonus.',
  vpTarget: 13,
  islandBonus: 2,
  minPlayers: 2,
  maxPlayers: 6,
  small: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ R R R ~ R R R ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ ~ ~ ~ P ~ ~ ~ ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ R R R ~ R R R ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: { R: { lumber: 6, sheep: 6, wheat: 6, brick: 5, ore: 5 } },
    home: [],
    harbors: 8,
  },
  large: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ R R R ~ R R R ~ R R R ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ ~ ~ ~ P ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ R R R ~ R R R ~ R R R ~ ~',
      ' ~ ~ R R ~ ~ R R ~ ~ R R ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: { R: { lumber: 9, sheep: 9, wheat: 8, brick: 8, ore: 8 } },
    home: [],
    harbors: 12,
  },
}

const THROUGH_THE_DESERT: Scenario = {
  id: 'through-the-desert',
  title: 'Through the Desert',
  blurb: 'A strip of desert cuts the island in two. The far side and the islets count as new lands.',
  vpTarget: 14,
  islandBonus: 2,
  minPlayers: 2,
  maxPlayers: 6,
  small: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ M M M M d A A ~ ~ ~ ~',
      '~ M M M M M d A A ~ I ~',
      ' ~ M M M M M d A ~ P I ~',
      '~ M M M M M d A A ~ ~ ~',
      ' ~ ~ M M M d A A ~ I I ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      M: { lumber: 5, sheep: 5, wheat: 5, brick: 3, ore: 4 },
      A: { gold: 1, ore: 2, brick: 2, wheat: 1, sheep: 1, lumber: 2 },
      I: { gold: 2, ore: 1, brick: 1 },
    },
    home: ['M'],
    harbors: 8,
  },
  large: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ M M M M M d A A ~ ~ ~ ~',
      '~ M M M M M M d A A ~ I ~ ~',
      ' ~ M M M M M M d A ~ ~ I ~ ~',
      '~ M M M M M M d A A ~ P ~ ~',
      ' ~ M M M M M d A A ~ I I ~ ~',
      '~ ~ M M M M d A A ~ ~ ~ I ~',
      ' ~ ~ ~ M M M d A ~ ~ ~ ~ ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      M: { lumber: 8, sheep: 8, wheat: 7, brick: 6, ore: 6 },
      A: { gold: 2, ore: 3, brick: 2, wheat: 2, sheep: 1, lumber: 2 },
      I: { gold: 2, ore: 1, brick: 1, wheat: 1 },
    },
    home: ['M'],
    harbors: 11,
  },
}

const FOG_ISLAND: Scenario = {
  id: 'fog-island',
  title: 'Fog Island',
  blurb: 'Two home islands and a bank of fog. Build into it to find out what lies beneath.',
  vpTarget: 12,
  islandBonus: 0,
  minPlayers: 2,
  maxPlayers: 6,
  small: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ M M M ~ F F F F ~',
      '~ M M M M ~ F F F F ~',
      ' ~ M M M ~ F F F F F ~',
      '~ ~ P ~ ~ F F F F F ~',
      ' ~ N N N ~ F F F F ~ ~',
      '~ N N N N ~ F F F ~ ~',
      ' ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      M: { lumber: 2, sheep: 2, wheat: 2, brick: 2, ore: 1, desert: 1 },
      N: { lumber: 2, sheep: 2, wheat: 1, brick: 1, ore: 1 },
    },
    fog: { sea: 10, gold: 2, ore: 3, brick: 2, wheat: 3, sheep: 2, lumber: 3 },
    home: ['M', 'N'],
    harbors: 6,
  },
  large: {
    rows: [
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
      ' ~ M M M M ~ F F F F F ~',
      '~ M M M M M ~ F F F F F ~',
      ' ~ M M M M ~ F F F F F F ~',
      '~ ~ P ~ ~ ~ F F F F F F ~',
      ' ~ N N N N ~ F F F F F ~',
      '~ N N N N N ~ F F F F ~',
      ' ~ N N N N ~ F F F ~ ~',
      '~ ~ ~ ~ ~ ~ ~ ~ ~ ~ ~',
    ],
    pools: {
      M: { lumber: 3, sheep: 3, wheat: 3, brick: 2, ore: 1, desert: 1 },
      N: { lumber: 3, sheep: 3, wheat: 2, brick: 2, ore: 2, desert: 1 },
    },
    fog: { sea: 12, gold: 3, ore: 4, brick: 4, wheat: 4, sheep: 3, lumber: 4 },
    home: ['M', 'N'],
    harbors: 8,
  },
}

const NEW_WORLD: Scenario = {
  id: 'new-world',
  title: 'The New World',
  blurb: 'A random archipelago, different every game. Settle anywhere; new islands pay a bonus.',
  vpTarget: 12,
  islandBonus: 2,
  minPlayers: 2,
  maxPlayers: 8,
  small: 'random',
  large: 'random',
}

export const SCENARIOS: Scenario[] = [NEW_SHORES, FOUR_ISLANDS, THROUGH_THE_DESERT, FOG_ISLAND, NEW_WORLD]

export const scenarioById = (id: string | undefined) => SCENARIOS.find((s) => s.id === id)

/**
 * The New World: islands grown from random seeds on an open sea, never
 * touching each other, sized for the table.
 */
export function newWorldMap(players: number, rng: Rng, opts: { fishermen?: boolean } = {}): GeneratedMap {
  const rows = players <= 4 ? 7 : players <= 6 ? 9 : 11
  const cols = players <= 4 ? 10 : players <= 6 ? 13 : 15
  const target = players <= 4 ? 30 : players <= 6 ? 42 : 54

  // An offset-row rectangle of sea.
  const coords: Array<{ q: number; r: number }> = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) coords.push({ q: c - Math.floor(r / 2), r })
  }
  const topo = buildTopology(coords)
  const border = (i: number) => topo.hexes[i].neighbors.some((n) => n < 0)

  for (let attempt = 0; attempt < 100; attempt++) {
    const owner = coords.map(() => -1)
    const islands = players <= 4 ? 5 : players <= 6 ? 6 : 7
    const seeds: number[] = []
    const interior = shuffle(rng, coords.map((_, i) => i).filter((i) => !border(i)))
    for (const i of interior) {
      if (seeds.length === islands) break
      const far = seeds.every((s) => Math.hypot(topo.hexes[s].x - topo.hexes[i].x, topo.hexes[s].y - topo.hexes[i].y) > 2.4)
      if (far) seeds.push(i)
    }
    if (seeds.length < islands) continue
    seeds.forEach((s, k) => (owner[s] = k))

    // Grow islands one hex at a time, keeping a channel of sea between them.
    let land = seeds.length
    let stuck = 0
    while (land < target && stuck < 2000) {
      const k = Math.floor(rng.next() * islands)
      const mine = owner.flatMap((o, i) => (o === k ? [i] : []))
      const frontier = mine.flatMap((i) => topo.hexes[i].neighbors).filter((n) =>
        n >= 0 && owner[n] < 0 && !border(n) &&
        topo.hexes[n].neighbors.every((m) => m < 0 || owner[m] < 0 || owner[m] === k),
      )
      if (frontier.length === 0) {
        stuck++
        continue
      }
      owner[pick(rng, frontier)] = k
      land++
    }
    if (land < target) continue

    const landCount = land
    const gold = players <= 4 ? 2 : players <= 6 ? 3 : 4
    const rest = landCount - gold - 1
    const per = rest / 5
    const pool: Terrain[] = shuffle(rng, [
      'desert',
      ...Array<Terrain>(gold).fill('gold'),
      ...(['lumber', 'sheep', 'wheat', 'brick', 'ore'] as Terrain[]).flatMap((t, i) =>
        Array<Terrain>(Math.floor(per) + (i < rest - Math.floor(per) * 5 ? 1 : 0)).fill(t),
      ),
    ])
    const terrains: Terrain[] = owner.map((o) => (o < 0 ? 'sea' : pool.pop() ?? 'sheep'))
    const seaIdx = owner.flatMap((o, i) => (o < 0 && !border(i) ? [i] : []))
    const needing = terrains.filter(needsNumber).length
    return finish(coords, terrains, {
      numbers: numberPool(needing),
      style: 'balanced',
      harbors: harborBag(islands * 2),
      rng,
      fishermen: !!opts.fishermen,
      homeAll: true,
      pirate: pick(rng, seaIdx),
    })
  }
  // Practically unreachable; a big plain board still plays.
  return largeMap(players, rng, opts)
}

/** The Seafarers map for a scenario at a player count. */
export function scenarioMap(id: string, players: number, rng: Rng, opts: { fishermen?: boolean } = {}): GeneratedMap {
  const scenario = scenarioById(id)
  if (!scenario) throw new Error(`unknown scenario "${id}"`)
  const recipe = players <= 4 ? scenario.small : scenario.large
  return recipe === 'random' ? newWorldMap(players, rng, opts) : recipeMap(recipe, rng, opts)
}
