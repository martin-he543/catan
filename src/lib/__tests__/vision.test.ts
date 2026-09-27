import { describe, expect, it } from 'vitest'
import {
  ANCHOR_TILES,
  NUMBER_SUPPLY,
  TILE_SUPPLY,
  classifyTiles,
  colorDistance,
  hexPositions,
  makeTransform,
  rgbToHsv,
  type Hsv,
} from '../vision'
import { HEX_CENTERS } from '../geometry'
import { TILE_TYPES, type TileType } from '../types'

/** Stand-in reference palette, roughly the hues of the real tile art. */
const REFERENCES = new Map<TileType, Hsv>([
  ['desert', { h: 45, s: 0.3, v: 0.85 }],
  ['brick', { h: 18, s: 0.7, v: 0.6 }],
  ['lumber', { h: 120, s: 0.6, v: 0.3 }],
  ['ore', { h: 210, s: 0.15, v: 0.45 }],
  ['sheep', { h: 95, s: 0.45, v: 0.75 }],
  ['wheat', { h: 48, s: 0.75, v: 0.85 }],
])

/** A board holding exactly the box's tiles, in a fixed order. */
const BAG: TileType[] = TILE_TYPES.flatMap((type) =>
  Array.from({ length: TILE_SUPPLY[type] }, () => type),
)

describe('the box', () => {
  it('holds 19 tiles and 18 numbers', () => {
    expect(Object.values(TILE_SUPPLY).reduce((a, b) => a + b, 0)).toBe(19)
    expect(Object.values(NUMBER_SUPPLY).reduce((a, b) => a + b, 0)).toBe(18)
    expect(NUMBER_SUPPLY[7]).toBeUndefined()
  })
})

describe('calibration transform', () => {
  it('lands the handles exactly on the tiles they name', () => {
    const a = { x: 120, y: 90 }
    const b = { x: 480, y: 610 }
    const hexes = hexPositions(a, b)
    expect(hexes[ANCHOR_TILES[0]].x).toBeCloseTo(a.x)
    expect(hexes[ANCHOR_TILES[0]].y).toBeCloseTo(a.y)
    expect(hexes[ANCHOR_TILES[1]].x).toBeCloseTo(b.x)
    expect(hexes[ANCHOR_TILES[1]].y).toBeCloseTo(b.y)
  })

  it('recovers a known rotation, scale and offset', () => {
    // Project the board ourselves, then check calibration reads it back.
    const angle = Math.PI / 7
    const scale = 37
    const offset = { x: 300, y: 220 }
    const place = (p: { x: number; y: number }) => ({
      x: offset.x + scale * (p.x * Math.cos(angle) - p.y * Math.sin(angle)),
      y: offset.y + scale * (p.x * Math.sin(angle) + p.y * Math.cos(angle)),
    })

    const fit = makeTransform(place(HEX_CENTERS[0]), place(HEX_CENTERS[18]))
    expect(fit.scale).toBeCloseTo(scale)
    expect(fit.angle).toBeCloseTo(angle)
    for (const center of HEX_CENTERS) {
      const expected = place(center)
      const actual = fit.project(center)
      expect(actual.x).toBeCloseTo(expected.x)
      expect(actual.y).toBeCloseTo(expected.y)
    }
  })

  it('keeps the island the right way up when handles are dragged apart', () => {
    const hexes = hexPositions({ x: 0, y: 0 }, { x: 0, y: 400 })
    // A1 is the top-left tile and E3 the bottom-right, so rows descend.
    expect(hexes[0].y).toBeLessThan(hexes[9].y)
    expect(hexes[9].y).toBeLessThan(hexes[18].y)
  })
})

describe('colour', () => {
  it('converts RGB to HSV', () => {
    expect(rgbToHsv(255, 0, 0)).toMatchObject({ h: 0, s: 1, v: 1 })
    expect(rgbToHsv(0, 255, 0).h).toBeCloseTo(120)
    expect(rgbToHsv(0, 0, 255).h).toBeCloseTo(240)
    expect(rgbToHsv(0, 0, 0)).toMatchObject({ s: 0, v: 0 })
    expect(rgbToHsv(128, 128, 128).s).toBe(0)
  })

  it('measures hue the short way round the wheel', () => {
    const vivid = (h: number) => ({ h, s: 0.9, v: 0.8 })
    expect(colorDistance(vivid(350), vivid(10))).toBeCloseTo(colorDistance(vivid(10), vivid(30)))
    expect(colorDistance(vivid(0), vivid(180))).toBeGreaterThan(colorDistance(vivid(0), vivid(40)))
  })

  it('stops trusting hue as colours go grey', () => {
    const grey = (h: number) => ({ h, s: 0.02, v: 0.5 })
    const vivid = (h: number) => ({ h, s: 0.9, v: 0.5 })
    expect(colorDistance(grey(0), grey(180))).toBeLessThan(colorDistance(vivid(0), vivid(180)))
  })

  it('calls a colour identical to itself a perfect match', () => {
    for (const reference of REFERENCES.values()) {
      expect(colorDistance(reference, reference)).toBeCloseTo(0)
    }
  })
})

describe('classification', () => {
  it('reads back a board painted in the reference colours', () => {
    const samples = BAG.map((type) => REFERENCES.get(type)!)
    const guesses = classifyTiles(samples, REFERENCES)
    expect(guesses.map((g) => g.type)).toEqual(BAG)
  })

  it('survives a photo shot dark and warm', () => {
    const samples = BAG.map((type) => {
      const reference = REFERENCES.get(type)!
      return { h: (reference.h + 12) % 360, s: reference.s * 0.85, v: reference.v * 0.7 }
    })
    expect(classifyTiles(samples, REFERENCES).map((g) => g.type)).toEqual(BAG)
  })

  it('never spends more tiles than the box contains', () => {
    // Every hex looks like wheat; the result must still be a legal board.
    const samples = BAG.map(() => REFERENCES.get('wheat')!)
    const guesses = classifyTiles(samples, REFERENCES)
    const counted: Record<string, number> = {}
    for (const guess of guesses) counted[guess.type] = (counted[guess.type] ?? 0) + 1
    expect(counted).toEqual(TILE_SUPPLY)
  })

  it('flags the tiles it is guessing at', () => {
    const samples = BAG.map((type) => REFERENCES.get(type)!)
    // A hex halfway between the two greens is the classic ambiguous case.
    samples[0] = { h: 108, s: 0.52, v: 0.52 }
    const guesses = classifyTiles(samples, REFERENCES)
    expect(guesses[0].confidence).toBeLessThan(0.5)
    expect(guesses[BAG.length - 1].confidence).toBeGreaterThan(0.5)
  })

  it('copes with hexes it could not sample at all', () => {
    const samples: Array<Hsv | null> = BAG.map((type) => REFERENCES.get(type)!)
    samples[3] = null
    samples[11] = null
    const guesses = classifyTiles(samples, REFERENCES)
    expect(guesses).toHaveLength(19)
    expect(guesses.every((g) => TILE_TYPES.includes(g.type))).toBe(true)
  })

  it('returns a full board even with no references to match against', () => {
    const guesses = classifyTiles(BAG.map(() => null), new Map())
    expect(guesses).toHaveLength(19)
  })
})
