/** Names, emoji and colours for cards and pieces, matching the board generator's palette. */
import { PASTEL_INK, RESOURCE_EMOJI, RESOURCE_PASTEL } from '../../lib/palette'
import type { Card, DevCardType, HarborType, PlayerColor, Track } from '../engine/types'

export const CARD_LABEL: Record<Card, string> = {
  brick: 'Brick',
  lumber: 'Lumber',
  ore: 'Ore',
  sheep: 'Wool',
  wheat: 'Grain',
  paper: 'Paper',
  cloth: 'Cloth',
  coin: 'Coin',
}

export const CARD_EMOJI: Record<Card, string> = {
  brick: RESOURCE_EMOJI.brick,
  lumber: RESOURCE_EMOJI.lumber,
  ore: RESOURCE_EMOJI.ore,
  sheep: RESOURCE_EMOJI.sheep,
  wheat: RESOURCE_EMOJI.wheat,
  paper: '📜',
  cloth: '🧶',
  coin: '🪙',
}

export const CARD_COLOR: Record<Card, string> = {
  brick: RESOURCE_PASTEL.brick,
  lumber: RESOURCE_PASTEL.lumber,
  ore: RESOURCE_PASTEL.ore,
  sheep: RESOURCE_PASTEL.sheep,
  wheat: RESOURCE_PASTEL.wheat,
  paper: '#e7dcc4',
  cloth: '#d9c6e8',
  coin: '#f1d98a',
}

export const INK = PASTEL_INK

export const DEV_LABEL: Record<DevCardType, string> = {
  knight: 'Knight',
  victory: 'Victory Point',
  roadBuilding: 'Road Building',
  yearOfPlenty: 'Year of Plenty',
  monopoly: 'Monopoly',
}

export const DEV_TEXT: Record<DevCardType, string> = {
  knight: 'Move the robber and steal a card. Counts towards the largest army.',
  victory: 'One hidden victory point.',
  roadBuilding: 'Build two roads for free.',
  yearOfPlenty: 'Take any two resources from the bank.',
  monopoly: 'Name a resource; everyone gives you all of theirs.',
}

export const TRACK_LABEL: Record<Track, string> = { trade: 'Trade', politics: 'Politics', science: 'Science' }
export const TRACK_COLOR: Record<Track, string> = { trade: '#f2c230', politics: '#3b82f6', science: '#22c55e' }
export const TRACK_BUILDINGS: Record<Track, string[]> = {
  trade: ['Market', 'Trading House', 'Merchant Guild', 'Bank', 'Great Exchange'],
  politics: ['Town Hall', 'Church', 'Fortress', 'Cathedral', 'High Assembly'],
  science: ['Abbey', 'Library', 'Aqueduct', 'Theatre', 'University'],
}
export const TRACK_PERK: Record<Track, string> = {
  trade: 'Level 3: trade commodities 2:1 with the bank.',
  politics: 'Level 3: promote strong knights to mighty.',
  science: 'Level 3: take a resource when a roll gives you nothing.',
}

export const HARBOR_LABEL: Record<HarborType, string> = {
  any: '3:1 any',
  brick: '2:1 brick',
  lumber: '2:1 lumber',
  ore: '2:1 ore',
  sheep: '2:1 wool',
  wheat: '2:1 grain',
}

/** Hex colours for the player swatches, as in index.css. */
export const PLAYER_HEX: Record<PlayerColor, string> = {
  red: '#ff453a',
  blue: '#0a87ff',
  yellow: '#ffd60a',
  white: '#f8fafc',
  green: '#30d158',
  brown: '#a2744a',
  purple: '#bf5af2',
  pink: '#ff6fb5',
}

/** Text that stays readable on top of a player colour. */
export const PLAYER_INK: Record<PlayerColor, string> = {
  red: '#fff',
  blue: '#fff',
  yellow: '#1c1917',
  white: '#1c1917',
  green: '#052e16',
  brown: '#fff',
  purple: '#fff',
  pink: '#1c1917',
}
