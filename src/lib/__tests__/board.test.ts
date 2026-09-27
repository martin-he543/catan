import { describe, expect, it } from 'vitest'
import { newGame } from '../board'
import { TILE_NEIGHBOURS } from '../geometry'
import type { GameType, TileType } from '../types'

const TYPES: GameType[] = ['spiral', 'pseudorandom', 'random']

/** The physical contents of a base-game box. */
const EXPECTED_TILES: Record<TileType, number> = {
  desert: 1, brick: 3, lumber: 4, ore: 3, sheep: 4, wheat: 4,
}
const EXPECTED_NUMBERS = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12]

describe.each(TYPES)('newGame(%s)', (type) => {
  const games = Array.from({ length: 200 }, () => newGame(type))

  it('deals exactly the tiles in the box', () => {
    for (const game of games) {
      const counts: Record<string, number> = {}
      for (const tile of game.tiles) counts[tile.type] = (counts[tile.type] ?? 0) + 1
      expect(counts).toEqual(EXPECTED_TILES)
    }
  })

  it('deals exactly the number tokens in the box', () => {
    for (const game of games) {
      const numbers = game.tiles
        .filter((t) => t.type !== 'desert')
        .map((t) => t.number)
        .sort((a, b) => a - b)
      expect(numbers).toEqual(EXPECTED_NUMBERS)
    }
  })

  it('leaves the desert without a number token', () => {
    for (const game of games) {
      expect(game.tiles.find((t) => t.type === 'desert')!.number).toBe(7)
    }
  })

  it('deals the nine ports', () => {
    for (const game of games) {
      expect(game.ports).toHaveLength(9)
      expect(game.ports.filter((p) => p === '31')).toHaveLength(4)
      expect(new Set(game.ports.filter((p) => p !== '31')).size).toBe(5)
    }
  })

  it('starts with no settlements placed', () => {
    for (const game of games) expect(game.locs).toEqual([])
  })
})

describe('the balanced generator', () => {
  it('never lets two red tiles touch', () => {
    for (let i = 0; i < 500; i++) {
      const game = newGame('pseudorandom')
      game.tiles.forEach((tile, index) => {
        if (tile.number !== 6 && tile.number !== 8) return
        for (const neighbour of TILE_NEIGHBOURS[index]) {
          const n = game.tiles[neighbour].number
          expect(n === 6 || n === 8).toBe(false)
        }
      })
    }
  })
})

describe('the spiral generator', () => {
  it('always deals the same number sequence along the spiral', () => {
    const order = [0, 3, 7, 12, 16, 17, 18, 15, 11, 6, 2, 1, 4, 8, 13, 14, 10, 5, 9]
    const expected = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11]
    for (let i = 0; i < 100; i++) {
      const game = newGame('spiral')
      const dealt = order
        .map((index) => game.tiles[index])
        .filter((tile) => tile.type !== 'desert')
        .map((tile) => tile.number)
      expect(dealt).toEqual(expected)
    }
  })
})
