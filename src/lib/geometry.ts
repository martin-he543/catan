/**
 * Board geometry, derived rather than hard-coded.
 *
 * The original site positioned every hex, port and settlement spot with
 * hand-tuned pixel offsets. We rebuild the same layout from first principles so
 * it scales to any size: pointy-top hexagons of width 1, laid out in rows of
 * 3/4/5/4/3, with row centres 0.75 * height apart.
 *
 * Vertex indices come out of a (y, x) sort, which reproduces the original
 * left-to-right, top-to-bottom numbering exactly — so share links minted by the
 * old site still resolve to the same settlements here.
 */

/** Hex width in layout units. Everything else is expressed relative to this. */
export const HEX_W = 1
/** Height of a regular pointy-top hexagon of width 1. */
export const HEX_H = 2 / Math.sqrt(3)

const ROW_SIZES = [3, 4, 5, 4, 3]

export interface Point {
  x: number
  y: number
}

/** The six edges of a pointy-top hex, named by compass direction. */
export type EdgeDir = 'ne' | 'e' | 'se' | 'sw' | 'w' | 'nw'

/** Vertex offsets from a hex centre, clockwise from the top. */
const VERTEX_OFFSETS: Point[] = [
  { x: 0, y: -HEX_H / 2 }, // 0 top
  { x: HEX_W / 2, y: -HEX_H / 4 }, // 1 upper-right
  { x: HEX_W / 2, y: HEX_H / 4 }, // 2 lower-right
  { x: 0, y: HEX_H / 2 }, // 3 bottom
  { x: -HEX_W / 2, y: HEX_H / 4 }, // 4 lower-left
  { x: -HEX_W / 2, y: -HEX_H / 4 }, // 5 upper-left
]

/** Each edge as the pair of vertex-offset indices it spans. */
const EDGE_VERTICES: Record<EdgeDir, [number, number]> = {
  ne: [0, 1],
  e: [1, 2],
  se: [2, 3],
  sw: [3, 4],
  w: [4, 5],
  nw: [5, 0],
}

/** Centre of hex row `row` (0-4 for land), in layout units. */
function rowCenterY(row: number): number {
  return (row - 2) * 0.75 * HEX_H
}

function buildCenters(rows: number[], firstRow: number): Point[] {
  const out: Point[] = []
  rows.forEach((count, i) => {
    for (let c = 0; c < count; c++) {
      out.push({ x: (c - (count - 1) / 2) * HEX_W, y: rowCenterY(firstRow + i) })
    }
  })
  return out
}

/** The 19 land hex centres, row-major — matching tile index order. */
export const HEX_CENTERS: Point[] = buildCenters(ROW_SIZES, 0)

/**
 * The 18 sea hexes that frame the island. Rows -1 and 5 are full, the rows
 * alongside the island contribute one hex on each flank.
 */
export const SEA_CENTERS: Point[] = (() => {
  const out: Point[] = [
    ...buildCenters([4], -1),
    ...buildCenters([4], 5),
  ]
  // Flanking hexes: one step wider than the land row they sit beside.
  ROW_SIZES.forEach((count, row) => {
    const outer = ((count - 1) / 2 + 1) * HEX_W
    out.push({ x: -outer, y: rowCenterY(row) }, { x: outer, y: rowCenterY(row) })
  })
  return out
})()

/** Round to a stable key so shared vertices between hexes dedupe cleanly. */
const key = (p: Point) => `${Math.round(p.x * 1e4)},${Math.round(p.y * 1e4)}`

export interface Vertex extends Point {
  index: number
  /** Indices of the land tiles touching this corner (1-3 of them). */
  tiles: number[]
}

/** The 54 settlement corners, indexed compatibly with the original encoding. */
export const VERTICES: Vertex[] = (() => {
  const map = new Map<string, { x: number; y: number; tiles: number[] }>()
  HEX_CENTERS.forEach((c, hexIndex) => {
    for (const off of VERTEX_OFFSETS) {
      const p = { x: c.x + off.x, y: c.y + off.y }
      const k = key(p)
      let entry = map.get(k)
      if (!entry) {
        entry = { ...p, tiles: [] }
        map.set(k, entry)
      }
      entry.tiles.push(hexIndex)
    }
  })
  return [...map.values()]
    .sort((a, b) => Math.round((a.y - b.y) * 1e4) || a.x - b.x)
    .map((v, index) => ({ ...v, index }))
})()

/** Fast lookup from a rounded coordinate back to its vertex index. */
const VERTEX_INDEX_BY_KEY = new Map(VERTICES.map((v) => [key(v), v.index]))

/**
 * Settlement corners are illegal within one edge of an existing settlement.
 * Two corners are neighbours when they are exactly one hex-side apart.
 */
export const VERTEX_NEIGHBOURS: number[][] = (() => {
  const out: number[][] = VERTICES.map(() => [])
  for (const c of HEX_CENTERS) {
    const corners = VERTEX_OFFSETS.map((o) =>
      VERTEX_INDEX_BY_KEY.get(key({ x: c.x + o.x, y: c.y + o.y })),
    )
    for (let i = 0; i < 6; i++) {
      const a = corners[i]
      const b = corners[(i + 1) % 6]
      if (a === undefined || b === undefined) continue
      if (!out[a].includes(b)) out[a].push(b)
      if (!out[b].includes(a)) out[b].push(a)
    }
  }
  return out
})()

/**
 * Which land tiles touch each other, used to keep 6s and 8s apart. Two tiles
 * are adjacent when they share two corners (i.e. a full edge).
 */
export const TILE_NEIGHBOURS: Record<number, number[]> = (() => {
  const out: Record<number, number[]> = {}
  HEX_CENTERS.forEach((_, i) => (out[i] = []))
  for (const v of VERTICES) {
    for (const a of v.tiles) {
      for (const b of v.tiles) {
        if (a !== b && !out[a].includes(b)) {
          // Sharing a single corner isn't enough; require a shared edge.
          const shared = VERTICES.filter(
            (o) => o.tiles.includes(a) && o.tiles.includes(b),
          ).length
          if (shared === 2) out[a].push(b)
        }
      }
    }
  }
  return out
})()

export interface Port {
  /** Land tile the port's jetty points at. */
  tile: number
  dir: EdgeDir
  /** Position of this edge in `COAST`, the clockwise ring of shoreline edges. */
  coast: number
  /** Centre of the port marker, already pushed out over the water. */
  pos: Point
  /** Degrees of rotation so the jetty faces the island. */
  angle: number
  /** The two settlement corners that can claim this port. */
  vertices: [number, number]
}

const EDGE_DIRS = Object.keys(EDGE_VERTICES) as EdgeDir[]

/**
 * The 30 shoreline edges, clockwise from the top of the board. An edge is on
 * the shore when the hex across it is not land.
 */
export const COAST: Array<{ tile: number; dir: EdgeDir }> = (() => {
  const land = new Set(HEX_CENTERS.map(key))
  const out: Array<{ tile: number; dir: EdgeDir; turn: number }> = []
  HEX_CENTERS.forEach((c, tile) => {
    for (const dir of EDGE_DIRS) {
      const [i, j] = EDGE_VERTICES[dir]
      const mid = {
        x: c.x + (VERTEX_OFFSETS[i].x + VERTEX_OFFSETS[j].x) / 2,
        y: c.y + (VERTEX_OFFSETS[i].y + VERTEX_OFFSETS[j].y) / 2,
      }
      if (land.has(key({ x: 2 * mid.x - c.x, y: 2 * mid.y - c.y }))) continue
      // The island is star-shaped about its centre, so bearing orders the shore.
      const turn = Math.atan2(mid.x, -mid.y)
      out.push({ tile, dir, turn: turn < -1e-9 ? turn + 2 * Math.PI : turn })
    }
  })
  return out.sort((a, b) => a.turn - b.turn).map(({ tile, dir }) => ({ tile, dir }))
})()

/**
 * The nine standard port edges, recovered from the original stylesheet's
 * absolute offsets (see notes in the repo README).
 */
const PORT_EDGES: Array<{ tile: number; dir: EdgeDir }> = [
  { tile: 0, dir: 'nw' },
  { tile: 1, dir: 'ne' },
  { tile: 3, dir: 'w' },
  { tile: 2, dir: 'e' },
  { tile: 12, dir: 'w' },
  { tile: 11, dir: 'e' },
  { tile: 16, dir: 'sw' },
  { tile: 17, dir: 'se' },
  { tile: 15, dir: 'se' },
]

const DEFAULT_PORT_COAST = PORT_EDGES.map(({ tile, dir }) =>
  COAST.findIndex((e) => e.tile === tile && e.dir === dir),
)

/** How far past the coastline the port marker sits, in layout units. */
const PORT_OFFSET = 0.42

function buildPort(coast: number): Port {
  const { tile, dir } = COAST[coast]
  const c = HEX_CENTERS[tile]
  const [i, j] = EDGE_VERTICES[dir]
  const a = { x: c.x + VERTEX_OFFSETS[i].x, y: c.y + VERTEX_OFFSETS[i].y }
  const b = { x: c.x + VERTEX_OFFSETS[j].x, y: c.y + VERTEX_OFFSETS[j].y }
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const out = { x: mid.x - c.x, y: mid.y - c.y }
  const len = Math.hypot(out.x, out.y)
  return {
    tile,
    dir,
    coast,
    pos: {
      x: mid.x + (out.x / len) * PORT_OFFSET,
      y: mid.y + (out.y / len) * PORT_OFFSET,
    },
    // The pentagon of port art points "up"; turn that point out to sea.
    angle: (Math.atan2(out.y, out.x) * 180) / Math.PI + 90,
    vertices: [
      VERTEX_INDEX_BY_KEY.get(key(a))!,
      VERTEX_INDEX_BY_KEY.get(key(b))!,
    ],
  }
}

/** The nine ports in their standard spots. */
export const PORTS: Port[] = DEFAULT_PORT_COAST.map(buildPort)

/**
 * Printed boards don't all agree on which way each harbour faces, so any port
 * may be nudged one shoreline edge either way: -1 is anticlockwise, +1
 * clockwise. Nothing shifted is the standard layout.
 */
export const NO_PORT_SHIFTS: readonly number[] = PORTS.map(() => 0)

const shiftAt = (shifts: readonly number[] | undefined, i: number) =>
  Math.max(-1, Math.min(1, Math.trunc(shifts?.[i] ?? 0)))

const coastOf = (shifts: readonly number[] | undefined, i: number) =>
  (DEFAULT_PORT_COAST[i] + shiftAt(shifts, i) + COAST.length) % COAST.length

/** Shoreline steps between two coast positions, whichever way round is shorter. */
const coastGap = (a: number, b: number) => {
  const d = Math.abs(a - b) % COAST.length
  return Math.min(d, COAST.length - d)
}

/** Two ports may not share a corner, so they must sit at least two edges apart. */
export function portShiftsValid(shifts: readonly number[] | undefined): boolean {
  const at = PORTS.map((_, i) => coastOf(shifts, i))
  return at.every((a, i) => at.every((b, j) => i === j || coastGap(a, b) >= 2))
}

/** Whether port `i` can move `delta` edges without crowding another port. */
export function canShiftPort(shifts: readonly number[] | undefined, i: number, delta: number): boolean {
  const next = shiftAt(shifts, i) + delta
  if (next < -1 || next > 1) return false
  const trial = PORTS.map((_, j) => (j === i ? next : shiftAt(shifts, j)))
  return portShiftsValid(trial)
}

/** `shifts` with port `i` moved `delta` edges, or unchanged if it can't move. */
export function shiftPort(shifts: readonly number[] | undefined, i: number, delta: number): number[] {
  const base = PORTS.map((_, j) => shiftAt(shifts, j))
  if (!canShiftPort(base, i, delta)) return base
  base[i] += delta
  return base
}

/**
 * How far the whole ring of ports is turned: -1 anticlockwise, +1 clockwise.
 * Ports nudged by different amounts count as not turned.
 */
export function portRotation(shifts: readonly number[] | undefined): number {
  const first = shiftAt(shifts, 0)
  return PORTS.every((_, i) => shiftAt(shifts, i) === first) ? first : 0
}

/** Whether every port can slide `delta` more edges along the shore. */
export const canRotatePorts = (shifts: readonly number[] | undefined, delta: number) =>
  Math.abs(portRotation(shifts) + delta) <= 1

/**
 * Every port slid `delta` edges along the shore together, or unchanged if
 * that would go past one edge. Undefined is the standard layout.
 */
export function rotatePorts(shifts: readonly number[] | undefined, delta: number): number[] | undefined {
  if (!canRotatePorts(shifts, delta)) return shifts ? [...shifts] : undefined
  const next = portRotation(shifts) + delta
  return next === 0 ? undefined : PORTS.map(() => next)
}

export const hasPortShifts = (shifts: readonly number[] | undefined) =>
  PORTS.some((_, i) => shiftAt(shifts, i) !== 0)

const portsCache = new Map<string, Port[]>()

/** The nine ports with `shifts` applied. Returns the same array for the same shifts. */
export function portsFor(shifts?: readonly number[]): Port[] {
  if (!hasPortShifts(shifts)) return PORTS
  const cacheKey = PORTS.map((_, i) => shiftAt(shifts, i)).join(',')
  let ports = portsCache.get(cacheKey)
  if (!ports) {
    ports = PORTS.map((_, i) => buildPort(coastOf(shifts, i)))
    portsCache.set(cacheKey, ports)
  }
  return ports
}

/** Ports reachable from each settlement corner. */
export function portsByVertex(ports: readonly Port[]): number[][] {
  const out: number[][] = VERTICES.map(() => [])
  ports.forEach((p, i) => p.vertices.forEach((v) => out[v].push(i)))
  return out
}

/** Ports reachable from each settlement corner, in the standard layout. */
export const PORTS_BY_VERTEX: number[][] = portsByVertex(PORTS)

/** Bounding box of everything we draw, with a little breathing room. */
export const VIEW = (() => {
  const pad = 0.12
  const xs = SEA_CENTERS.map((c) => c.x)
  const ys = SEA_CENTERS.map((c) => c.y)
  const minX = Math.min(...xs) - HEX_W / 2 - pad
  const maxX = Math.max(...xs) + HEX_W / 2 + pad
  const minY = Math.min(...ys) - HEX_H / 2 - pad
  const maxY = Math.max(...ys) + HEX_H / 2 + pad
  return { minX, minY, width: maxX - minX, height: maxY - minY }
})()

/** Convert a layout-unit point into a percentage position inside the board. */
export function toPercent(p: Point) {
  return {
    left: ((p.x - VIEW.minX) / VIEW.width) * 100,
    top: ((p.y - VIEW.minY) / VIEW.height) * 100,
  }
}

/** A size in layout units, as a percentage of board width. */
export const pctW = (units: number) => (units / VIEW.width) * 100
/** A size in layout units, as a percentage of board height. */
export const pctH = (units: number) => (units / VIEW.height) * 100
