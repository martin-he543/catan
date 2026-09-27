/**
 * Geometry for an arbitrary map of pointy-top hexes in axial coordinates.
 *
 * The board generator's geometry (src/lib/geometry.ts) is fixed to the 19-hex
 * island. Online games also need Seafarers maps and 5-8 player boards, so this
 * derives vertices, edges and adjacency from whatever hexes a map lists. It
 * uses the same units as the board generator — a hex is 1 wide — so pieces and
 * artwork line up the same way.
 *
 * Axial neighbours of (q, r), clockwise from the north-east:
 *   NE (q+1, r-1)  E (q+1, r)  SE (q, r+1)  SW (q-1, r+1)  W (q-1, r)  NW (q, r-1)
 *
 * Every corner is the top ("N") or bottom ("S") corner of exactly one hex
 * position, which gives each vertex a unique key without floating point.
 */

export const HEX_W = 1
/** Distance from a hex centre to a corner. */
export const HEX_SIZE = 1 / Math.sqrt(3)
export const HEX_H = 2 * HEX_SIZE

export interface Point {
  x: number
  y: number
}

/** Direction vectors by side, 0 = NE clockwise to 5 = NW. */
export const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1],
]

export const SIDE_NAMES = ['ne', 'e', 'se', 'sw', 'w', 'nw'] as const

/**
 * The six corners of hex (q, r), clockwise from the top, as vertex keys.
 * Side i runs from corner i to corner i+1.
 */
function cornerKeys(q: number, r: number): string[] {
  return [
    `${q},${r},N`,
    `${q + 1},${r - 1},S`,
    `${q},${r + 1},N`,
    `${q},${r},S`,
    `${q - 1},${r + 1},N`,
    `${q},${r - 1},S`,
  ]
}

export const hexCenter = (q: number, r: number): Point => ({
  x: (q + r / 2) * HEX_W,
  y: r * 1.5 * HEX_SIZE,
})

const CORNER_OFFSETS: Point[] = [
  { x: 0, y: -HEX_SIZE },
  { x: HEX_W / 2, y: -HEX_SIZE / 2 },
  { x: HEX_W / 2, y: HEX_SIZE / 2 },
  { x: 0, y: HEX_SIZE },
  { x: -HEX_W / 2, y: HEX_SIZE / 2 },
  { x: -HEX_W / 2, y: -HEX_SIZE / 2 },
]

export interface TopoHex extends Point {
  q: number
  r: number
  /** Vertex index per corner, clockwise from the top. */
  corners: number[]
  /** Edge index per side, 0 = NE. */
  sides: number[]
  /** Neighbouring hex index per side, or -1 off the map. */
  neighbors: number[]
}

export interface TopoVertex extends Point {
  hexes: number[]
  edges: number[]
  /** Vertices one edge away. */
  neighbors: number[]
}

export interface TopoEdge extends Point {
  a: number
  b: number
  hexes: number[]
  /** Degrees from horizontal, for laying a road along it. */
  angle: number
}

export interface Topology {
  hexes: TopoHex[]
  vertices: TopoVertex[]
  edges: TopoEdge[]
  bounds: { minX: number; minY: number; width: number; height: number }
  hexAt: (q: number, r: number) => number
  /** The edge joining two vertices, or -1. */
  edgeBetween: (a: number, b: number) => number
}

const cache = new Map<string, Topology>()

/**
 * Build the topology for a list of hex coordinates. Vertices and edges are
 * numbered in reading order (top to bottom, left to right), so the same map
 * always yields the same indices — which the stored game state relies on.
 */
export function buildTopology(coords: ReadonlyArray<{ q: number; r: number }>): Topology {
  const cacheKey = coords.map((c) => `${c.q},${c.r}`).join(';')
  const cached = cache.get(cacheKey)
  if (cached) return cached

  const hexIndex = new Map<string, number>()
  coords.forEach((c, i) => hexIndex.set(`${c.q},${c.r}`, i))

  // Collect vertices with their positions.
  const vertexPos = new Map<string, Point>()
  const vertexHexes = new Map<string, number[]>()
  coords.forEach((c, i) => {
    const center = hexCenter(c.q, c.r)
    cornerKeys(c.q, c.r).forEach((k, corner) => {
      if (!vertexPos.has(k)) {
        vertexPos.set(k, { x: center.x + CORNER_OFFSETS[corner].x, y: center.y + CORNER_OFFSETS[corner].y })
        vertexHexes.set(k, [])
      }
      vertexHexes.get(k)!.push(i)
    })
  })

  const vertexKeys = [...vertexPos.keys()].sort((ka, kb) => {
    const a = vertexPos.get(ka)!
    const b = vertexPos.get(kb)!
    return Math.round((a.y - b.y) * 1e4) || Math.round((a.x - b.x) * 1e4)
  })
  const vertexIndex = new Map(vertexKeys.map((k, i) => [k, i]))
  const vertices: TopoVertex[] = vertexKeys.map((k) => ({
    ...vertexPos.get(k)!,
    hexes: vertexHexes.get(k)!,
    edges: [],
    neighbors: [],
  }))

  // Edges: every hex side, deduplicated.
  const edgeKeyIndex = new Map<string, number>()
  const rawEdges: Array<{ a: number; b: number; hexes: number[] }> = []
  const hexSides: number[][] = coords.map(() => [])
  coords.forEach((c, i) => {
    const keys = cornerKeys(c.q, c.r).map((k) => vertexIndex.get(k)!)
    for (let side = 0; side < 6; side++) {
      const va = keys[side]
      const vb = keys[(side + 1) % 6]
      const [a, b] = va < vb ? [va, vb] : [vb, va]
      const k = `${a}:${b}`
      let e = edgeKeyIndex.get(k)
      if (e === undefined) {
        e = rawEdges.length
        edgeKeyIndex.set(k, e)
        rawEdges.push({ a, b, hexes: [] })
      }
      rawEdges[e].hexes.push(i)
      hexSides[i][side] = e
    }
  })

  // Renumber edges in reading order of their midpoints.
  const mid = (e: { a: number; b: number }) => ({
    x: (vertices[e.a].x + vertices[e.b].x) / 2,
    y: (vertices[e.a].y + vertices[e.b].y) / 2,
  })
  const order = rawEdges
    .map((e, i) => ({ i, m: mid(e) }))
    .sort((p, q) => Math.round((p.m.y - q.m.y) * 1e4) || Math.round((p.m.x - q.m.x) * 1e4))
  const renumber = new Map(order.map((o, n) => [o.i, n]))
  const edges: TopoEdge[] = order.map(({ i, m }) => {
    const e = rawEdges[i]
    const va = vertices[e.a]
    const vb = vertices[e.b]
    return {
      ...m,
      a: e.a,
      b: e.b,
      hexes: e.hexes,
      angle: (Math.atan2(vb.y - va.y, vb.x - va.x) * 180) / Math.PI,
    }
  })
  const edgeLookup = new Map<string, number>()
  edges.forEach((e, n) => {
    vertices[e.a].edges.push(n)
    vertices[e.b].edges.push(n)
    vertices[e.a].neighbors.push(e.b)
    vertices[e.b].neighbors.push(e.a)
    edgeLookup.set(`${e.a}:${e.b}`, n)
  })

  const hexes: TopoHex[] = coords.map((c, i) => ({
    ...hexCenter(c.q, c.r),
    q: c.q,
    r: c.r,
    corners: cornerKeys(c.q, c.r).map((k) => vertexIndex.get(k)!),
    sides: hexSides[i].map((e) => renumber.get(e)!),
    neighbors: DIRECTIONS.map(([dq, dr]) => hexIndex.get(`${c.q + dq},${c.r + dr}`) ?? -1),
  }))

  const pad = 0.1
  const xs = hexes.map((h) => h.x)
  const ys = hexes.map((h) => h.y)
  const minX = Math.min(...xs) - HEX_W / 2 - pad
  const maxX = Math.max(...xs) + HEX_W / 2 + pad
  const minY = Math.min(...ys) - HEX_SIZE - pad
  const maxY = Math.max(...ys) + HEX_SIZE + pad

  const topology: Topology = {
    hexes,
    vertices,
    edges,
    bounds: { minX, minY, width: maxX - minX, height: maxY - minY },
    hexAt: (q, r) => hexIndex.get(`${q},${r}`) ?? -1,
    edgeBetween: (a, b) => edgeLookup.get(a < b ? `${a}:${b}` : `${b}:${a}`) ?? -1,
  }
  if (cache.size > 64) cache.clear()
  cache.set(cacheKey, topology)
  return topology
}

/** The two vertices of side `side` of a hex. */
export function sideVertices(topo: Topology, hex: number, side: number): [number, number] {
  const c = topo.hexes[hex].corners
  return [c[side], c[(side + 1) % 6]]
}

/** Hex polygon points for SVG, in layout units. */
export function hexPolygon(center: Point, scale = 1): string {
  return CORNER_OFFSETS.map((o) => `${center.x + o.x * scale},${center.y + o.y * scale}`).join(' ')
}
