/**
 * Game modes. Each preset is a starting point — the create screen lets the
 * host change any option afterwards — and between them they cover what
 * TwoSheep offers: the base game from 1v1 up to eight players, Seafarers'
 * scenarios, Cities & Knights, Fishermen, and the custom modes (Dust Bowl,
 * blind placement, numbers only).
 */
import { SCENARIOS, scenarioById } from './maps'
import type { GameConfig } from './types'

export const DEFAULT_CONFIG: GameConfig = {
  title: 'Classic',
  players: 4,
  vpTarget: 10,
  discardLimit: 7,
  seafarers: false,
  citiesKnights: false,
  fishermen: false,
  islandBonus: 0,
  friendlyRobber: false,
  dice: 'random',
  balancedSevens: false,
  largeGameTurns: 'secondSettler',
  dustBowl: false,
  veil: 'none',
  turnTimer: 0,
  playerTrades: true,
}

export type ModeGroup = 'Base game' | 'Seafarers' | 'Cities & Knights' | 'Fishermen' | 'Custom modes'

export interface ModePreset {
  id: string
  group: ModeGroup
  title: string
  blurb: string
  minPlayers: number
  maxPlayers: number
  defaultPlayers: number
  config: Partial<GameConfig>
  /**
   * Whether a board from the board generator, Import or Position can be used.
   * Seafarers scenarios bring their own maps.
   */
  acceptsBoard: boolean
}

const seafarers = SCENARIOS.map<ModePreset>((s) => ({
  id: `seafarers-${s.id}`,
  group: 'Seafarers',
  title: s.title,
  blurb: s.blurb,
  minPlayers: s.minPlayers,
  maxPlayers: s.maxPlayers,
  defaultPlayers: 4,
  config: { seafarers: true, scenario: s.id, vpTarget: s.vpTarget, islandBonus: s.islandBonus },
  acceptsBoard: false,
}))

export const MODES: ModePreset[] = [
  {
    id: 'classic',
    group: 'Base game',
    title: 'Classic',
    blurb: 'The base game on the standard island. Ten points wins.',
    minPlayers: 2,
    maxPlayers: 4,
    defaultPlayers: 4,
    config: {},
    acceptsBoard: true,
  },
  {
    id: 'duel',
    group: 'Base game',
    title: '1v1 Duel',
    blurb: 'Two players to 15 points: discard at 9, friendly robber, balanced dice and balanced 7s.',
    minPlayers: 2,
    maxPlayers: 2,
    defaultPlayers: 2,
    config: { vpTarget: 15, discardLimit: 9, friendlyRobber: true, dice: 'balanced', balancedSevens: true },
    acceptsBoard: true,
  },
  {
    id: 'extension-56',
    group: 'Base game',
    title: '5–6 players',
    blurb: 'The 30-hex board. Each turn the player opposite gets a second-settler turn to build.',
    minPlayers: 5,
    maxPlayers: 6,
    defaultPlayers: 6,
    config: { largeGameTurns: 'secondSettler' },
    acceptsBoard: false,
  },
  {
    id: 'extension-78',
    group: 'Base game',
    title: '7–8 players',
    blurb: 'A 37-hex board for a crowd, with second-settler turns to keep it moving.',
    minPlayers: 7,
    maxPlayers: 8,
    defaultPlayers: 8,
    config: { largeGameTurns: 'secondSettler' },
    acceptsBoard: false,
  },
  ...seafarers,
  {
    id: 'cities-knights',
    group: 'Cities & Knights',
    title: 'Cities & Knights',
    blurb: 'Commodities, city improvements, knights and the barbarian fleet. Thirteen points wins.',
    minPlayers: 2,
    maxPlayers: 8,
    defaultPlayers: 4,
    config: { citiesKnights: true, vpTarget: 13 },
    acceptsBoard: true,
  },
  {
    id: 'cities-knights-seafarers',
    group: 'Cities & Knights',
    title: 'C&K on the New World',
    blurb: 'Cities & Knights played on a random Seafarers archipelago, ships and all.',
    minPlayers: 2,
    maxPlayers: 8,
    defaultPlayers: 4,
    config: { citiesKnights: true, seafarers: true, scenario: 'new-world', vpTarget: 15, islandBonus: 2 },
    acceptsBoard: false,
  },
  {
    id: 'fishermen',
    group: 'Fishermen',
    title: 'Fishermen of Catan',
    blurb: 'Fishing grounds and a lake. Spend fish to banish the robber, steal, or build for free.',
    minPlayers: 2,
    maxPlayers: 8,
    defaultPlayers: 4,
    config: { fishermen: true },
    acceptsBoard: true,
  },
  {
    id: 'dust-bowl',
    group: 'Custom modes',
    title: 'Dust Bowl',
    blurb: 'Every 7 spreads the desert: numbers beside it drift to 2 and 12, then turn to sand.',
    minPlayers: 2,
    maxPlayers: 8,
    defaultPlayers: 4,
    config: { dustBowl: true },
    acceptsBoard: true,
  },
  {
    id: 'blind',
    group: 'Custom modes',
    title: 'Blind placement',
    blurb: 'The island is face down. Tiles turn over as settlements go next to them.',
    minPlayers: 2,
    maxPlayers: 8,
    defaultPlayers: 4,
    config: { veil: 'blind' },
    acceptsBoard: true,
  },
  {
    id: 'numbers-only',
    group: 'Custom modes',
    title: 'Numbers only',
    blurb: 'You can see the numbers but not the terrain until you settle beside it.',
    minPlayers: 2,
    maxPlayers: 8,
    defaultPlayers: 4,
    config: { veil: 'terrain' },
    acceptsBoard: true,
  },
]

export const modeById = (id: string) => MODES.find((m) => m.id === id)

/** The full config for a mode at a player count. */
export function configFor(modeId: string, players: number, overrides: Partial<GameConfig> = {}): GameConfig {
  const mode = modeById(modeId) ?? MODES[0]
  const config: GameConfig = { ...DEFAULT_CONFIG, title: mode.title, ...mode.config, players, ...overrides }
  if (config.scenario && !config.seafarers) config.seafarers = true
  if (config.scenario && overrides.vpTarget === undefined && mode.config.vpTarget === undefined) {
    config.vpTarget = scenarioById(config.scenario)?.vpTarget ?? config.vpTarget
  }
  return config
}

/** Pieces each player has in the box. */
export const SUPPLY = {
  road: 15,
  ship: 15,
  settlement: 5,
  city: 4,
  wall: 3,
  /** Per knight level. */
  knight: 2,
} as const

/** The development deck, scaled for bigger tables as the 5-6 extension does. */
export function devDeckFor(players: number) {
  if (players <= 4) return { knight: 14, victory: 5, roadBuilding: 2, yearOfPlenty: 2, monopoly: 2 }
  if (players <= 6) return { knight: 20, victory: 5, roadBuilding: 3, yearOfPlenty: 3, monopoly: 3 }
  return { knight: 26, victory: 6, roadBuilding: 4, yearOfPlenty: 4, monopoly: 4 }
}

/** Resource cards of each kind in the bank. */
export const bankSizeFor = (players: number) => (players <= 4 ? 19 : players <= 6 ? 24 : 29)
/** Commodity cards of each kind in the bank (C&K). */
export const COMMODITY_BANK = 12

export const LONGEST_ROAD_MIN = 5
export const LARGEST_ARMY_MIN = 3
export const PROGRESS_HAND_LIMIT = 4
export const FISH_HAND_LIMIT = 7
/** Steps the barbarian ship sails before it lands. */
export const BARBARIAN_TRACK = 7
