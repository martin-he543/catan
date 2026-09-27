import { describe, expect, it } from 'vitest'
import { analyseBoard, legalVertices, pips, playerTotals } from '../analysis'
import { VERTEX_NEIGHBOURS, VERTICES } from '../geometry'
import { newGame } from '../board'

describe('pips', () => {
  it('counts the dots on each number token', () => {
    expect([2, 3, 4, 5, 6, 8, 9, 10, 11, 12].map(pips)).toEqual([1, 2, 3, 4, 5, 5, 4, 3, 2, 1])
  })

  it('gives no dots to 7 or to anything off the token set', () => {
    expect(pips(7)).toBe(0)
    expect(pips(13)).toBe(0)
    expect(pips(0)).toBe(0)
  })
})

describe('legalVertices', () => {
  it('opens every corner on an empty board', () => {
    expect(legalVertices([]).size).toBe(54)
  })

  it('closes the chosen corner and its immediate neighbours', () => {
    const legal = legalVertices([10])
    expect(legal.has(10)).toBe(false)
    for (const n of VERTEX_NEIGHBOURS[10]) expect(legal.has(n)).toBe(false)
    expect(legal.size).toBe(54 - 1 - VERTEX_NEIGHBOURS[10].length)
  })
})

describe('analyseBoard', () => {
  const game = newGame('spiral')
  const reports = analyseBoard(game)

  it('reports on every corner', () => {
    expect(reports).toHaveLength(54)
    reports.forEach((r, i) => expect(r.vertex).toBe(i))
  })

  it('sums the pips of the touching tiles', () => {
    for (const vertex of VERTICES) {
      const expected = vertex.tiles
        .map((i) => game.tiles[i])
        .filter((t) => t.type !== 'desert')
        .reduce((sum, t) => sum + pips(t.number), 0)
      expect(reports[vertex.index].pips).toBe(expected)
    }
  })

  it('rates the strongest corner at 100', () => {
    expect(Math.max(...reports.map((r) => r.rating))).toBe(100)
  })

  it('counts variety as the distinct resources produced', () => {
    for (const report of reports) {
      expect(report.variety).toBe(Object.keys(report.byResource).length)
      expect(report.variety).toBeLessThanOrEqual(3)
    }
  })
})

describe('playerTotals', () => {
  it('adds up a player settlements', () => {
    const game = newGame('spiral')
    const reports = analyseBoard(game)
    const { pipTotal } = playerTotals(reports, [0, 20])
    expect(pipTotal).toBe(reports[0].pips + reports[20].pips)
  })

  it('returns zero for a player with nothing placed', () => {
    const reports = analyseBoard(newGame('spiral'))
    expect(playerTotals(reports, [])).toEqual({ totals: {}, pipTotal: 0, ports: [] })
  })
})
