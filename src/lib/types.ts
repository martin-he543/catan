export const TILE_TYPES = ['desert', 'brick', 'lumber', 'ore', 'sheep', 'wheat'] as const
export const PORT_TYPES = ['31', 'wheat', 'ore', 'lumber', 'brick', 'sheep'] as const

export type TileType = (typeof TILE_TYPES)[number]
export type PortType = (typeof PORT_TYPES)[number]
export type ResourceType = Exclude<TileType, 'desert'>

/** The four seating colours, in Catan placement order (snake draft). */
export const PLAYER_COLORS = ['red', 'blue', 'yellow', 'white'] as const
export type PlayerColor = (typeof PLAYER_COLORS)[number]

/** Snake-draft order for the eight opening settlements. */
export const PLACEMENT_ORDER: PlayerColor[] = [
  'red', 'blue', 'yellow', 'white',
  'white', 'yellow', 'blue', 'red',
]

export interface Tile {
  type: TileType
  /** 2-12; the desert carries 7, which is never rolled onto a tile. */
  number: number
  /**
   * Terrain not chosen yet: the tile shows grey, and `type`/`number` are a
   * desert placeholder so nothing asks it for a number token.
   */
  blank?: boolean
}

export interface Game {
  tiles: Tile[]
  ports: PortType[]
  /**
   * Per-port nudge along the shore (-1, 0 or +1 edge), matching `ports` by
   * index. Missing means the standard layout.
   */
  portShifts?: number[]
  /** Vertex indices (0-53) of placed settlements, in placement order. */
  locs: number[]
}

export type GameType = 'spiral' | 'pseudorandom' | 'random'

export const GAME_TYPE_LABELS: Record<GameType, { title: string; blurb: string }> = {
  spiral: {
    title: 'Spiral',
    blurb: 'Tiles shuffled, numbers laid out in the classic counter-clockwise A-R spiral.',
  },
  pseudorandom: {
    title: 'Balanced',
    blurb: 'Fully random numbers, except no two 6s or 8s are ever allowed to touch.',
  },
  random: {
    title: 'Chaos',
    blurb: 'Everything shuffled. Red tiles may clump. Anything goes.',
  },
}

export const RESOURCE_LABELS: Record<TileType, string> = {
  desert: 'Desert',
  brick: 'Brick',
  lumber: 'Lumber',
  ore: 'Ore',
  sheep: 'Sheep',
  wheat: 'Wheat',
}

export const PORT_LABELS: Record<PortType, string> = {
  '31': '3 : 1 Any',
  wheat: '2 : 1 Wheat',
  ore: '2 : 1 Ore',
  lumber: '2 : 1 Lumber',
  brick: '2 : 1 Brick',
  sheep: '2 : 1 Sheep',
}
