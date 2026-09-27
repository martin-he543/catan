import { describe, expect, it } from 'vitest'
import {
  EDGES,
  HEX_LABELS,
  VERTEX_LABELS,
  boardToCsn,
  countCards,
  edgeLabel,
  formatAction,
  formatCards,
  formatCsn,
  hexIndex,
  isEdge,
  parseAction,
  parseBoard,
  parseCsn,
  parsePortShifts,
  parsePorts,
  replay,
  serializeBoard,
  serializePorts,
  setupSeat,
  turnSeat,
  vertexIndex,
  visiblePoints,
  NOTATION_EXAMPLE,
  PORT_SLOT_LABELS,
  RESOURCE_CODES,
  tileCode,
  type ParseIssue,
  type Position,
} from '../notation'
import { HEX_CENTERS, VERTICES } from '../geometry'
import type { Tile } from '../types'
import { newGame } from '../board'
import type { GameType } from '../types'

const TYPES: GameType[] = ['spiral', 'pseudorandom', 'random']

/** Parse a token that is expected to be valid, failing loudly if it isn't. */
function action(token: string) {
  const issues: ParseIssue[] = []
  const parsed = parseAction(token, issues)
  expect(issues).toEqual([])
  expect(parsed).not.toBeNull()
  return parsed!
}

describe('coordinates', () => {
  it('labels every tile and corner exactly once', () => {
    expect(HEX_LABELS).toHaveLength(HEX_CENTERS.length)
    expect(VERTEX_LABELS).toHaveLength(VERTICES.length)
    expect(new Set(HEX_LABELS).size).toBe(19)
    expect(new Set(VERTEX_LABELS).size).toBe(54)
  })

  it('numbers labels in board reading order', () => {
    // The whole scheme rests on geometry's (y, x) ordering, so guard it here:
    // a label's row must follow the corner's height down the board.
    const rowOf = (label: string) => label[0]
    for (let i = 1; i < VERTICES.length; i++) {
      const dy = VERTICES[i].y - VERTICES[i - 1].y
      if (rowOf(VERTEX_LABELS[i]) === rowOf(VERTEX_LABELS[i - 1])) {
        expect(dy).toBeCloseTo(0)
        expect(VERTICES[i].x).toBeGreaterThan(VERTICES[i - 1].x)
      } else {
        expect(dy).toBeGreaterThan(0)
      }
    }
  })

  it('round-trips labels back to indices', () => {
    HEX_LABELS.forEach((label, i) => expect(hexIndex(label)).toBe(i))
    VERTEX_LABELS.forEach((label, i) => expect(vertexIndex(label)).toBe(i))
    expect(hexIndex('E4')).toBe(-1)
    expect(vertexIndex('m1')).toBe(-1)
  })

  it('knows the 72 road slots', () => {
    expect(EDGES).toHaveLength(72)
    for (const [a, b] of EDGES) {
      expect(a).toBeLessThan(b)
      expect(isEdge(a, b)).toBe(true)
      expect(isEdge(b, a)).toBe(true)
      // An edge label reads the same whichever end you start from.
      expect(edgeLabel(b, a)).toBe(edgeLabel(a, b))
    }
    expect(isEdge(0, 53)).toBe(false)
  })
})

describe('board serialisation', () => {
  it('round-trips every kind of generated board', () => {
    for (const type of TYPES) {
      for (let i = 0; i < 25; i++) {
        const game = newGame(type)
        expect(parseBoard(serializeBoard(game.tiles))).toEqual(game.tiles)
        expect(parsePorts(serializePorts(game.ports))).toEqual(game.ports)
      }
    }
  })

  it('writes the desert without a number', () => {
    const game = newGame('spiral')
    const text = serializeBoard(game.tiles)
    expect(text.split(/[\s/]+/).filter((t) => t === 'D')).toHaveLength(1)
    expect(text).toMatch(/^(?:[BLOGW]\d{1,2}|D)(?: \/? ?(?:[BLOGW]\d{1,2}|D))*$/)
  })

  it('rejects malformed boards with a readable reason', () => {
    const issues: ParseIssue[] = []
    expect(parseBoard('O6 B3', issues)).toBeNull()
    expect(parseBoard('X6 ' + 'D '.repeat(18), issues)).toBeNull()
    expect(parseBoard('O7 ' + 'D '.repeat(18), issues)).toBeNull()
    expect(issues.map((i) => i.message)).toEqual([
      'board needs 19 tiles, found 2',
      'not a tile: "X6"',
      '"O7" needs a number token of 2-12 (not 7)',
    ])
  })

  it('rejects malformed port lists', () => {
    const issues: ParseIssue[] = []
    expect(parsePorts('* * *', issues)).toBeNull()
    expect(parsePorts('* * * * * * * * Z', issues)).toBeNull()
    expect(issues).toHaveLength(2)
  })

  it('marks nudged ports with > and < and reads them back', () => {
    const ports = newGame('spiral').ports
    const shifts = [1, 0, 0, -1, 0, 0, 0, 0, 0]
    const text = serializePorts(ports, shifts)
    expect(text.split(' ')[0]).toMatch(/>$/)
    expect(text.split(' ')[3]).toMatch(/<$/)
    expect(parsePorts(text)).toEqual(ports)
    expect(parsePortShifts(text)).toEqual(shifts)
    expect(parsePortShifts(serializePorts(ports))).toBeNull()
  })

  it('refuses nudges that would put two ports on one corner', () => {
    // Ports 0 and 1 sit three edges apart; moving both inward leaves one.
    const issues: ParseIssue[] = []
    expect(parsePortShifts('*> *< * * * * * * *', issues)).toBeNull()
    expect(issues.map((i) => i.message)).toEqual(['two nudged ports would share a corner'])
  })
})

describe('move tokens', () => {
  const ROUND_TRIP = [
    'Sf3', 'Cl2', 'Ra1b1', 'Rf3g3',
    '+2G1O', '+3:1L', '-2:4', '-1G1W',
    'XC3', 'XC3x2', 'XC3x2G',
    'Dk', 'D?', 'Pk', 'Pm:W', 'Py:1G1O', 'Pr:f3g3+g3h3',
    'T2:2G>1O', 'Tb:4W>1B', 'Tp:2O>1G',
    '^LR', '^LA', '#2:10', '#3',
  ]

  it('round-trips every token in the reference', () => {
    for (const token of ROUND_TRIP) {
      expect(formatAction(action(token))).toBe(token)
    }
  })

  it('reads the pieces of a move', () => {
    expect(action('Sf3')).toEqual({ kind: 'settlement', vertex: vertexIndex('f3') })
    expect(action('XC3x2G')).toEqual({
      kind: 'robber',
      hex: hexIndex('C3'),
      stealFrom: 2,
      stolen: 'G',
    })
    expect(action('T2:2G>1O')).toEqual({
      kind: 'trade',
      partner: 2,
      give: { G: 2 },
      get: { O: 1 },
    })
    expect(action('Tb:4W>1B')).toMatchObject({ partner: 'bank' })
    expect(action('Tp:2O>1G')).toMatchObject({ partner: 'port' })
  })

  it('counts a bare number as unknown cards', () => {
    expect(action('-2:4')).toEqual({ kind: 'loss', seat: 2, cards: { hidden: 4 } })
    expect(countCards({ G: 2, hidden: 3 })).toBe(5)
    expect(formatCards({ G: 2, O: 1 })).toBe('2G1O')
    expect(formatCards({})).toBe('0')
  })

  it('refuses nonsense, and says why', () => {
    const bad: Array<[string, RegExp]> = [
      ['Sz9', /no such corner/],
      ['Ra1l3', /not adjacent/],
      ['Rf3g4', /not adjacent/],
      ['Ra1', /not a road/],
      ['XZ9', /not a robber move/],
      ['Dq', /not a development card/],
      ['Pv', /not a playable card/],
      ['Pm:XY', /monopoly needs one resource/],
      ['Pk:a1b1', /takes no argument/],
      ['T2:2G', /give>get/],
      ['Txx:1G>1O', /not a trade partner/],
      ['^XX', /awards are/],
      ['Qf3', /unknown move/],
    ]
    for (const [token, expected] of bad) {
      const issues: ParseIssue[] = []
      expect(parseAction(token, issues), token).toBeNull()
      expect(issues[0]?.message, token).toMatch(expected)
    }
  })
})

describe('seat order', () => {
  it('snakes the eight opening placements', () => {
    const seats = [1, 2, 3, 4, 5, 6, 7, 8].map((s) => setupSeat(s, 4))
    expect(seats).toEqual([1, 2, 3, 4, 4, 3, 2, 1])
    expect([1, 2, 3, 4, 5, 6].map((s) => setupSeat(s, 3))).toEqual([1, 2, 3, 3, 2, 1])
  })

  it('cycles the main game', () => {
    expect([1, 2, 3, 4, 5, 9].map((n) => turnSeat(n, 4))).toEqual([1, 2, 3, 4, 1, 1])
    expect([1, 2, 3, 4].map((n) => turnSeat(n, 3))).toEqual([1, 2, 3, 1])
  })
})

const SAMPLE = `[Players "1:Ana 2:Sam"]
[Board "O6 B3 G11 / W12 L9 D G4 / L5 B10 O8 W4 G9 / W6 L3 B5 G10 / O11 L2 W8"]
[Ports "* G * B O * W * L"]

s1. Sa1 Ra1b1
s2. Sl3 Rk3l3
s3. Sl1 Rk1l1
s4. Sa3 Ra3b4  ; the good corner

1. 8 +2G1O Ca1!
2. 7 -1:3 XC3x1G
3. 4 Tb:4W>1B Ra1b1
4. - Dk Pk XA1 #2:10
`

describe('documents', () => {
  it('parses a whole game without complaint', () => {
    const game = parseCsn(SAMPLE)
    expect(game.issues).toEqual([])
    expect(game.players.map((p) => p.name)).toEqual(['Ana', 'Sam'])
    expect(game.tiles).toHaveLength(19)
    expect(game.ports).toHaveLength(9)
    expect(game.turns).toHaveLength(8)
  })

  it('derives the seat to move and keeps comments', () => {
    const { turns } = parseCsn(SAMPLE)
    expect(turns.slice(0, 4).map((t) => t.seat)).toEqual([1, 2, 2, 1])
    expect(turns[3].comment).toBe('the good corner')
    expect(turns[4].roll).toBe(8)
    expect(turns[7].roll).toBeNull()
  })

  it('keeps chess annotation marks on the move', () => {
    const { turns } = parseCsn(SAMPLE)
    expect(turns[4].moves[1].annotation).toBe('!')
    expect(turns[4].moves[1].action).toMatchObject({ kind: 'city' })
  })

  it('round-trips through format and back', () => {
    const once = formatCsn(parseCsn(SAMPLE))
    expect(formatCsn(parseCsn(once))).toBe(once)
    expect(parseCsn(once).issues).toEqual([])
  })

  it('collects every problem instead of throwing', () => {
    const broken = parseCsn('[Board "nope"]\n1. 99 Sz9\nwhat?\n')
    expect(broken.issues.map((i) => i.line)).toEqual([1, 2, 2, 3])
    expect(broken.tiles).toBeNull()
  })

  it('emits a header a fresh board can be shared as', () => {
    const game = newGame('spiral')
    const parsed = parseCsn(boardToCsn(game, { Event: 'Friday' }))
    expect(parsed.issues).toEqual([])
    expect(parsed.tags.Event).toBe('Friday')
    expect(parsed.tiles).toEqual(game.tiles)
    expect(parsed.ports).toEqual(game.ports)
  })
})

describe('replay', () => {
  it('builds the position the moves describe', () => {
    const game = parseCsn(SAMPLE)
    const position = replay(game)
    const [ana, sam] = position.seats

    expect(ana.settlements.map((v) => VERTEX_LABELS[v])).toEqual(['a3'])
    expect(ana.cities.map((v) => VERTEX_LABELS[v])).toEqual(['a1'])
    expect(sam.settlements.map((v) => VERTEX_LABELS[v])).toEqual(['l3', 'l1'])
    expect(position.robber).toBe(hexIndex('A1'))
    expect(sam.knightsPlayed).toBe(1)
    expect(sam.devCards).toEqual([])
  })

  it('moves cards between the seats involved', () => {
    const { seats } = replay(parseCsn(SAMPLE))
    // Seat 1 rolled 8 for 2 grain + 1 ore, then lost a grain to seat 2's robber
    // and four more cards to the 4:1 bank trade.
    expect(seats[0].cards).toMatchObject({ G: 1, O: 1, W: -4, B: 1, hidden: -3 })
    expect(seats[1].cards).toMatchObject({ G: 1 })
  })

  it('starts the robber on the desert', () => {
    const board = parseCsn(boardToCsn(newGame('spiral')))
    expect(replay(board).robber).toBe(board.tiles!.findIndex((t) => t.type === 'desert'))
  })

  it('stops where you ask it to', () => {
    const game = parseCsn(SAMPLE)
    expect(replay(game, 4).seats[0].settlements).toHaveLength(2)
    expect(replay(game, 1).seats[0].settlements).toEqual([vertexIndex('a1')])
    expect(replay(game, 0).turnsPlayed).toBe(0)
  })

  it('scores the points everyone can see', () => {
    const { seats } = replay(parseCsn(SAMPLE))
    expect(visiblePoints(seats[0])).toBe(3) // a settlement and a city
    expect(visiblePoints(seats[1])).toBe(2) // two settlements
  })
})

describe('the worked example in the guide', () => {
  it('parses with no complaints at all', () => {
    const game = parseCsn(NOTATION_EXAMPLE)
    expect(game.issues).toEqual([])
    expect(game.tiles).toHaveLength(19)
    expect(game.ports).toHaveLength(9)
  })

  it('opens with eight placements that snake through the seats', () => {
    const setup = parseCsn(NOTATION_EXAMPLE).turns.filter((t) => t.phase === 'setup')
    expect(setup).toHaveLength(8)
    expect(setup.map((t) => t.seat)).toEqual([1, 2, 3, 4, 4, 3, 2, 1])
    // Everybody leaves the opening with one settlement and one road each round.
    for (const turn of setup) {
      expect(turn.moves.slice(0, 2).map((m) => m.action.kind)).toEqual(['settlement', 'road'])
    }
    // The four second-round settlements collect the moment they go down.
    expect(setup.slice(4).map((t) => t.moves.length)).toEqual([3, 3, 3, 3])
  })

  it('replays to a finished game', () => {
    const game = parseCsn(NOTATION_EXAMPLE)
    const position = replay(game)
    expect(position.seats).toHaveLength(4)
    // Eight opening settlements, two of which Ana later upgrades to cities.
    const settlements = position.seats.flatMap((s) => s.settlements)
    const cities = position.seats.flatMap((s) => s.cities)
    expect(settlements).toHaveLength(6)
    expect(cities).toHaveLength(2)
    // Nobody may hold the same corner twice.
    expect(new Set([...settlements, ...cities]).size).toBe(8)
    expect(position.seats[0].awards).toEqual(['LA'])
  })

  it('ends with the result the last turn declares', () => {
    const { turns } = parseCsn(NOTATION_EXAMPLE)
    const last = turns[turns.length - 1].moves.at(-1)!
    expect(last.action).toEqual({ kind: 'result', seat: 1, points: 10 })
  })

  it('round-trips unchanged', () => {
    const once = formatCsn(parseCsn(NOTATION_EXAMPLE))
    expect(formatCsn(parseCsn(once))).toBe(once)
  })
})

describe('the example pays out what the dice say', () => {
  /** What the board owes everybody for a roll, given who owns what. */
  function production(tiles: Tile[], position: Position, roll: number) {
    const owed: Record<number, Record<string, number>> = {}
    for (const seat of position.seats) {
      const claims = [
        ...seat.settlements.map((v) => [v, 1] as const),
        ...seat.cities.map((v) => [v, 2] as const),
      ]
      for (const [vertex, yield_] of claims) {
        for (const t of VERTICES[vertex].tiles) {
          const tile = tiles[t]
          if (tile.type === 'desert' || tile.number !== roll || t === position.robber) continue
          const code = tileCode(tile.type)
          owed[seat.seat] ??= {}
          owed[seat.seat][code] = (owed[seat.seat][code] ?? 0) + yield_
        }
      }
    }
    return owed
  }

  it('hands every seat exactly the cards their corners earn', () => {
    const game = parseCsn(NOTATION_EXAMPLE)
    const tiles = game.tiles!
    // The elided stretch means the last turn's owners are not fully recorded.
    const checkable = game.turns.filter((t) => t.phase === 'play' && t.number <= 11)
    expect(checkable).toHaveLength(11)

    for (const turn of checkable) {
      const before = replay(game, game.turns.indexOf(turn))
      const expected = production(tiles, before, turn.roll!)

      const recorded: Record<number, Record<string, number>> = {}
      for (const { action } of turn.moves) {
        if (action.kind !== 'gain') continue
        const seat = action.seat ?? turn.seat
        recorded[seat] ??= {}
        for (const code of RESOURCE_CODES) {
          if (action.cards[code]) recorded[seat][code] = action.cards[code]!
        }
      }

      expect(recorded, `turn ${turn.number} rolled ${turn.roll}`).toEqual(expected)
    }
  })

  it('leaves the robber where the record says, blocking a real tile', () => {
    const game = parseCsn(NOTATION_EXAMPLE)
    // Moved to C2 on turn 3, then to C3 by the knight on turn 8.
    expect(replay(game, game.turns.findIndex((t) => t.number === 3 && t.phase === 'play') + 1).robber)
      .toBe(hexIndex('C2'))
    expect(replay(game).robber).toBe(hexIndex('C3'))
    expect(game.tiles![hexIndex('C3')]).toEqual({ type: 'ore', number: 8 })
  })
})

describe('port slots', () => {
  it('names all nine berths distinctly, by a real tile and edge', () => {
    expect(PORT_SLOT_LABELS).toHaveLength(9)
    expect(new Set(PORT_SLOT_LABELS).size).toBe(9)
    for (const label of PORT_SLOT_LABELS) {
      const [tile, dir] = label.split('-')
      expect(hexIndex(tile)).toBeGreaterThanOrEqual(0)
      expect(['ne', 'e', 'se', 'sw', 'w', 'nw']).toContain(dir)
    }
  })
})
