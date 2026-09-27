import { describe, expect, it } from 'vitest'
import { decodeGame, decodeMoves, encodeGame, encodeMoves } from '../codec'
import { newGame } from '../board'
import { blankBoard, boardProblems } from '../vision'
import { parseBoard, serializeBoard } from '../notation'
import type { GameType } from '../types'

const TYPES: GameType[] = ['spiral', 'pseudorandom', 'random']

describe('share-link codec', () => {
  it('round-trips every kind of generated board', () => {
    for (const type of TYPES) {
      for (let i = 0; i < 50; i++) {
        const game = newGame(type)
        const decoded = decodeGame(encodeGame(game))
        expect(decoded).not.toBeNull()
        expect(decoded!.tiles).toEqual(game.tiles)
        expect(decoded!.ports).toEqual(game.ports)
      }
    }
  })

  it('round-trips placements, including a partially filled board', () => {
    for (const locs of [[], [0], [0, 5, 17], [1, 3, 8, 12, 20, 33, 41, 53]]) {
      expect(decodeMoves(encodeMoves(locs))).toEqual(locs)
    }
  })

  it('decodes a board minted by the original site', () => {
    // Captured from a legacy ?game= link.
    const game = decodeGame('EqhJClM7YeTbLHGzSKZpqLQogZC')
    expect(game).not.toBeNull()
    expect(game!.tiles).toHaveLength(19)
    expect(game!.ports).toHaveLength(9)
    expect(game!.tiles.filter((t) => t.type === 'desert')).toHaveLength(1)
  })

  it('rejects malformed codes rather than returning a broken board', () => {
    expect(decodeGame('')).toBeNull()
    expect(decodeGame('short')).toBeNull()
    expect(decodeGame('!!!not base64!!!')).toBeNull()
  })

  it('treats a truncated moves code as no placements', () => {
    expect(decodeMoves('')).toEqual([])
    expect(decodeMoves('##')).toEqual([])
  })

  it('round-trips nudged ports and leaves unnudged codes at the legacy length', () => {
    const game = newGame('spiral')
    const plain = encodeGame(game)
    expect(plain).toHaveLength(27)
    expect(encodeGame({ ...game, portShifts: [0, 0, 0, 0, 0, 0, 0, 0, 0] })).toBe(plain)

    const portShifts = [1, 0, -1, 0, 0, 1, 0, 0, 0]
    const decoded = decodeGame(encodeGame({ ...game, portShifts }))
    expect(decoded!.tiles).toEqual(game.tiles)
    expect(decoded!.ports).toEqual(game.ports)
    expect(decoded!.portShifts).toEqual(portShifts)
    expect(decodeGame(plain)!.portShifts).toBeUndefined()
  })
})

describe('blank boards', () => {
  it('keep their grey tiles through a share link and through notation', () => {
    const game = { ...newGame('spiral'), locs: [] }
    game.tiles = game.tiles.map((t, i) => (i % 3 === 0 ? blankBoard()[i] : t))
    expect(decodeGame(encodeGame(game))!.tiles).toEqual(game.tiles)
    expect(parseBoard(serializeBoard(game.tiles))).toEqual(game.tiles)
  })

  it('ask for terrain rather than listing every missing tile type', () => {
    expect(boardProblems(blankBoard())).toEqual(['19 tiles still need a terrain'])
  })
})
