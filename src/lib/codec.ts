/**
 * Share-link encoding, kept bit-for-bit compatible with the original site so
 * that links minted years ago still open the same board here.
 *
 * Layout: 19 tiles x 7 bits (3 type + 4 number), then 9 ports x 3 bits.
 * Moves: 8 slots x 6 bits, with 63 meaning "not placed yet".
 */
import { PORT_TYPES, TILE_TYPES, type Game, type PortType, type Tile, type TileType } from './types'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const TILE_BITS = 7
const PORT_BITS = 3
const MOVE_BITS = 6
const MOVE_SLOTS = 8
const NO_MOVE = 63

const GAME_BIT_LENGTH = 19 * TILE_BITS + 9 * PORT_BITS
const MOVES_BIT_LENGTH = MOVE_SLOTS * MOVE_BITS

const pad = (value: number, width: number) => value.toString(2).padStart(width, '0')

function toBase64(binary: string): string {
  const padded = binary.padStart(Math.ceil(binary.length / 6) * 6, '0')
  let out = ''
  for (let i = 0; i < padded.length; i += 6) {
    out += ALPHABET[parseInt(padded.slice(i, i + 6), 2)]
  }
  return out
}

function fromBase64(text: string): string {
  let out = ''
  for (const char of text) {
    const value = ALPHABET.indexOf(char)
    if (value < 0) return ''
    out += pad(value, 6)
  }
  return out
}

export function encodeGame(game: Game): string {
  if (game.tiles.length !== 19 || game.ports.length !== 9) return ''
  const binary =
    game.tiles.map((t) => pad(TILE_TYPES.indexOf(t.type), 3) + pad(t.number, 4)).join('') +
    game.ports.map((p) => pad(PORT_TYPES.indexOf(p), 3)).join('')
  return toBase64(binary)
}

export function decodeGame(code: string): Game | null {
  const bits = fromBase64(code)
  if (bits.length < GAME_BIT_LENGTH) return null
  const binary = bits.slice(bits.length - GAME_BIT_LENGTH)

  const tiles: Tile[] = []
  for (let i = 0; i < 19; i++) {
    const slice = binary.slice(i * TILE_BITS, (i + 1) * TILE_BITS)
    const type = TILE_TYPES[parseInt(slice.slice(0, 3), 2)] as TileType | undefined
    const number = parseInt(slice.slice(3), 2)
    if (!type || Number.isNaN(number)) return null
    tiles.push({ type, number })
  }

  const ports: PortType[] = []
  for (let i = 0; i < 9; i++) {
    const start = 19 * TILE_BITS + i * PORT_BITS
    const type = PORT_TYPES[parseInt(binary.slice(start, start + PORT_BITS), 2)] as
      | PortType
      | undefined
    if (!type) return null
    ports.push(type)
  }

  return { tiles, ports, locs: [] }
}

export function encodeMoves(locs: number[]): string {
  let binary = ''
  for (let i = 0; i < MOVE_SLOTS; i++) {
    binary += pad(i < locs.length ? locs[i] : NO_MOVE, MOVE_BITS)
  }
  return toBase64(binary)
}

export function decodeMoves(code: string): number[] {
  const bits = fromBase64(code)
  if (bits.length < MOVES_BIT_LENGTH) return []
  const binary = bits.slice(bits.length - MOVES_BIT_LENGTH)

  const locs: number[] = []
  for (let i = 0; i < MOVE_SLOTS; i++) {
    const value = parseInt(binary.slice(i * MOVE_BITS, (i + 1) * MOVE_BITS), 2)
    // A sentinel ends the list; later slots are unplayed too.
    if (value === NO_MOVE) break
    if (value < 54) locs.push(value)
  }
  return locs
}
