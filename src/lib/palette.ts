/**
 * How terrain looks in the chrome, as opposed to on the board.
 *
 * The pastels started as the average colour of each tile graphic, lightened and
 * eased off until they read on the dark UI. Two pairs were then nudged apart by
 * hand: forest and pasture are both green in the artwork, and mountains and
 * desert are both muted, so at pastel strength each pair collapsed into one
 * colour. Mountains are pulled towards cool stone and forest towards a deeper
 * sage, which keeps every terrain distinguishable at the size of a chip.
 *
 * Colour is never the only signal — every swatch carries its emoji and its
 * name too, so this survives being printed, dimmed or read by someone who does
 * not separate greens.
 */
import type { TileType } from './types'

export const RESOURCE_EMOJI: Record<TileType, string> = {
  desert: '🏜️',
  brick: '🧱',
  lumber: '🌲',
  ore: '⛰️',
  sheep: '🐑',
  wheat: '🌾',
}

export const RESOURCE_PASTEL: Record<TileType, string> = {
  desert: '#e6dcc3',
  brick: '#e8b896',
  lumber: '#a9cca2',
  ore: '#cbd0da',
  sheep: '#cfe89b',
  wheat: '#f2da92',
}

/** Number tokens take the parchment of the real counters. */
export const TOKEN_PASTEL = '#ecd9a6'
/** 6 and 8 are printed red on the board, so they are red here too. */
export const TOKEN_PASTEL_RED = '#f0aa9f'

export const isRedToken = (number: number) => number === 6 || number === 8

export const tokenPastel = (number: number) =>
  isRedToken(number) ? TOKEN_PASTEL_RED : TOKEN_PASTEL

/** Dark ink that stays readable on any of the pastels above. */
export const PASTEL_INK = '#1c1917'
