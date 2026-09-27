/** The three board generators, ported from the original site. */
import { TILE_NEIGHBOURS } from './geometry'
import type { Game, GameType, PortType, Tile, TileType } from './types'

const ALL_TILES: TileType[] = [
  'desert',
  'brick', 'brick', 'brick',
  'lumber', 'lumber', 'lumber', 'lumber',
  'ore', 'ore', 'ore',
  'sheep', 'sheep', 'sheep', 'sheep',
  'wheat', 'wheat', 'wheat', 'wheat',
]

const ALL_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]

const ALL_PORTS: PortType[] = ['31', '31', '31', '31', 'wheat', 'ore', 'lumber', 'brick', 'sheep']

/** The official A-R number sequence, and the spiral of tiles it is dealt onto. */
const SPIRAL_NUMBERS = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11]
const SPIRAL_ORDER = [0, 3, 7, 12, 16, 17, 18, 15, 11, 6, 2, 1, 4, 8, 13, 14, 10, 5, 9]

/** The desert's placeholder number; 7 is rolled for the robber, never a tile. */
const DESERT = 7

function shuffle<T>(input: readonly T[]): T[] {
  const array = [...input]
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

function takeRandom<T>(array: T[]): T {
  return array.splice(Math.floor(Math.random() * array.length), 1)[0]
}

function blankTiles(): Tile[] {
  return shuffle(ALL_TILES).map((type) => ({ type, number: DESERT }))
}

/** Tiles shuffled, numbers dealt in the classic counter-clockwise spiral. */
function spiralGame(): Game {
  const tiles = blankTiles()
  let next = 0
  for (const index of SPIRAL_ORDER) {
    if (tiles[index].type !== 'desert') {
      tiles[index].number = SPIRAL_NUMBERS[next++]
    }
  }
  return { tiles, ports: shuffle(ALL_PORTS), locs: [] }
}

/**
 * Random numbers, but no two red tiles (6 or 8) are allowed to touch.
 *
 * Seating the reds greedily can paint itself into a corner — each pick rules
 * out up to six neighbours, so the pool of legal spots can empty before all
 * four are down. When that happens we simply deal the board again.
 */
function balancedGame(): Game {
  for (let attempt = 0; attempt < 100; attempt++) {
    const tiles = blankTiles()
    let open = tiles.flatMap((t, i) => (t.type === 'desert' ? [] : [i]))
    let placed = 0

    for (const number of [6, 6, 8, 8]) {
      if (open.length === 0) break
      const index = takeRandom(open)
      tiles[index].number = number
      open = open.filter((i) => !TILE_NEIGHBOURS[index].includes(i))
      placed++
    }
    if (placed < 4) continue

    const rest = shuffle(ALL_NUMBERS).filter((n) => n !== 6 && n !== 8)
    for (const tile of tiles) {
      if (tile.type !== 'desert' && tile.number === DESERT) {
        tile.number = rest.pop()!
      }
    }
    return { tiles, ports: shuffle(ALL_PORTS), locs: [] }
  }

  // Vanishingly unlikely, but never hand back a half-numbered board.
  return spiralGame()
}

/** Everything shuffled, no constraints at all. */
function chaosGame(): Game {
  const numbers = shuffle(ALL_NUMBERS)
  const tiles = blankTiles()
  for (const tile of tiles) {
    if (tile.type !== 'desert') tile.number = numbers.pop()!
  }
  return { tiles, ports: shuffle(ALL_PORTS), locs: [] }
}

export function newGame(type: GameType): Game {
  if (type === 'random') return chaosGame()
  if (type === 'pseudorandom') return balancedGame()
  return spiralGame()
}
