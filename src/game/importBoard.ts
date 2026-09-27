/**
 * Bring a board — and any pieces on it — over from the other pages.
 *
 *  - Board generator links carry `game` (the board) and `moves` (opening
 *    settlements in snake order). The game starts in setup with those
 *    settlements down; each seat still places the road beside theirs.
 *  - Position links carry `b` (board), `p` (everyone's pieces), `n` (names)
 *    and `r` (robber). The game starts mid-play from exactly that position.
 *  - Import links carry just `b`.
 *
 * The base board's geometry numbers its 54 corners and 72 edges on its own;
 * the engine's topology includes the sea frame and numbers differently, so
 * pieces are matched up by position.
 */
import { EDGES } from '../lib/notation'
import { VERTICES, portsFor } from '../lib/geometry'
import { decodeGame, decodeMoves } from '../lib/codec'
import { parsePosition, positionFromUrl, robberFromLabel, type SeatPieces } from '../lib/position'
import { parseCsn } from '../lib/notation'
import { boardProblems } from '../lib/vision'
import type { Game } from '../lib/types'
import { buildTopology, type Topology } from './engine/hexgrid'
import { STANDARD_COORDS, fixedMap, type GeneratedMap } from './engine/maps'
import type { StartPosition } from './engine/game'
import type { Rng } from './engine/rng'
import type { Harbor, HarborType, Terrain } from './engine/types'

export type BoardSource = 'generator' | 'position' | 'import' | 'notation'

export interface ImportedBoard {
  source: BoardSource
  game: Pick<Game, 'tiles' | 'ports' | 'portShifts'>
  /** Everyone's pieces, from a Position link. */
  seats?: SeatPieces[]
  names?: string[]
  /** Robber tile in the board's own numbering. */
  robber?: number
  /** Opening settlements in snake order, in the board's own corner numbering. */
  opening?: number[]
}

const SIDES = ['ne', 'e', 'se', 'sw', 'w', 'nw'] as const

const key = (x: number, y: number) => `${Math.round(x * 1e4)},${Math.round(y * 1e4)}`

/** Base-board corner index -> engine vertex index on the standard map. */
export function baseVertexMap(topo: Topology): number[] {
  const byPos = new Map(topo.vertices.map((v, i) => [key(v.x, v.y), i]))
  return VERTICES.map((v) => {
    const i = byPos.get(key(v.x, v.y))
    if (i === undefined) throw new Error('base board corner has no match in the engine map')
    return i
  })
}

export function baseEdgeIndex(topo: Topology, vertexMap: number[], a: number, b: number): number {
  return topo.edgeBetween(vertexMap[a], vertexMap[b])
}

/** Is this board complete enough to play on? Returns the problems, if any. */
export const importProblems = (board: ImportedBoard) => boardProblems(board.game.tiles)

export function mapFromBoard(board: ImportedBoard, opts: { fishermen: boolean; rng: Rng }): GeneratedMap {
  const { tiles, ports, portShifts } = board.game
  const hexes: Array<{ terrain: Terrain; number?: number }> = STANDARD_COORDS.map((_, i) => {
    if (i >= tiles.length) return { terrain: 'sea' }
    const tile = tiles[i]
    if (tile.blank) return { terrain: 'desert' }
    return { terrain: tile.type, number: tile.type === 'desert' ? undefined : tile.number }
  })
  const harbors: Harbor[] = portsFor(portShifts).map((p, i) => ({
    hex: p.tile,
    side: SIDES.indexOf(p.dir),
    type: (ports[i] === '31' ? 'any' : ports[i]) as HarborType,
  }))
  const generated = fixedMap({ coords: STANDARD_COORDS, hexes, harbors, fishermen: opts.fishermen, rng: opts.rng })
  if (board.robber !== undefined && board.robber >= 0 && board.robber < tiles.length && !opts.fishermen) {
    generated.robber = board.robber
  }
  return generated
}

/** The pieces on an imported board, in the engine's numbering. */
export function startFromBoard(board: ImportedBoard, players: number): StartPosition | undefined {
  const topo = buildTopology(STANDARD_COORDS)
  const vmap = baseVertexMap(topo)
  if (board.seats?.some((s) => s.settlements.length || s.cities.length || s.roads.length)) {
    const start: StartPosition = { buildings: [], routes: [], knightsPlayed: [], victoryCards: [], claims: {} }
    board.seats.slice(0, players).forEach((seat, owner) => {
      for (const v of seat.settlements) start.buildings!.push({ vertex: vmap[v], owner, kind: 'settlement' })
      for (const v of seat.cities) start.buildings!.push({ vertex: vmap[v], owner, kind: 'city' })
      for (const [a, b] of seat.roads) {
        const edge = baseEdgeIndex(topo, vmap, a, b)
        if (edge >= 0) start.routes!.push({ edge, owner, kind: 'road' })
      }
      start.knightsPlayed![owner] = seat.knights
      start.victoryCards![owner] = seat.victoryCards
      if (seat.claims.includes('LR')) start.claims!.longestRoad = owner
      if (seat.claims.includes('LA')) start.claims!.largestArmy = owner
    })
    if (board.robber !== undefined) start.robber = board.robber
    return start
  }
  if (board.opening?.length) {
    // Snake order only lines up for four players, which is what the generator deals.
    if (players !== 4) return undefined
    return { opening: board.opening.map((v) => vmap[v]) }
  }
  return undefined
}

/* ------------------------------------------------------------------ *
 * Reading links and notation
 * ------------------------------------------------------------------ */

/** Read a board out of a URL's parameters — any of the three pages' links. */
export function boardFromParams(params: URLSearchParams): ImportedBoard | null {
  if (params.has('p') || (params.has('b') && params.has('r'))) {
    const game = params.get('b') ? decodeGame(params.get('b')!) : null
    if (!game) return null
    const seats = params.has('p') ? parsePosition(positionFromUrl(params.get('p')!)) : undefined
    const robber = params.has('r') ? robberFromLabel(params.get('r')!) : -1
    return {
      source: 'position',
      game,
      seats,
      names: (params.get('n') ?? '').split('.').filter(Boolean),
      robber: robber >= 0 ? robber : undefined,
    }
  }
  const code = params.get('game') ?? params.get('b')
  if (!code) return null
  const game = decodeGame(code)
  if (!game) return null
  const moves = params.get('moves')
  return {
    source: params.has('game') ? 'generator' : 'import',
    game,
    opening: moves ? decodeMoves(moves) : undefined,
  }
}

/** Read pasted text: a link from any of the pages, or Catan notation. */
export function boardFromText(text: string): { board: ImportedBoard | null; message: string } {
  const trimmed = text.trim()
  if (!trimmed) return { board: null, message: 'Paste a link or some notation first.' }
  if (/^https?:\/\/|^\?|^\/\S*\?/.test(trimmed)) {
    try {
      const board = boardFromParams(new URL(trimmed, 'https://example.invalid/').searchParams)
      return board
        ? { board, message: `Loaded the board from that ${board.source === 'generator' ? 'board generator' : board.source} link.` }
        : { board: null, message: 'That link has no board in it.' }
    } catch {
      return { board: null, message: 'That link could not be read.' }
    }
  }
  const parsed = parseCsn(trimmed)
  if (!parsed.tiles) return { board: null, message: parsed.issues[0]?.message ?? 'No [Board] tag in that notation.' }
  const seats = parsed.tags.Position ? parsePosition(parsed.tags.Position) : undefined
  const robber = parsed.tags.Robber ? robberFromLabel(parsed.tags.Robber) : -1
  return {
    board: {
      source: 'notation',
      game: {
        tiles: parsed.tiles,
        ports: parsed.ports ?? ['31', 'wheat', '31', 'brick', 'ore', '31', 'sheep', '31', 'lumber'],
        portShifts: parsed.portShifts ?? undefined,
      },
      seats,
      names: parsed.players.map((p) => p.name),
      robber: robber >= 0 ? robber : undefined,
    },
    message: 'Loaded the board from that notation.',
  }
}

export { EDGES as BASE_EDGES }
