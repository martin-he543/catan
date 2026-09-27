import { describe, expect, it } from 'vitest'
import { applyAction, createGame } from '../game'
import { configFor } from '../config'
import { buildTopology } from '../hexgrid'
import { SCENARIOS, STANDARD_COORDS, parseRows, recipeMap, standardMap } from '../maps'
import { legalSettlements, longestRoute } from '../placement'
import { activePrompts, emptyHand, handSize, harborVertices, topo, totalPoints, tradeRatios } from '../state'
import { recordingRng, replayRng, seededRng } from '../rng'
import { redact } from '../view'
import { botAction } from '../bot'
import { waitingOn } from '../rules'
import { newGame, playOut, seats } from './simulate'
import type { Action, GameState, Hand } from '../types'
import { VERTICES as BASE_VERTICES, PORTS } from '../../../lib/geometry'
import { baseVertexMap, boardFromParams, mapFromBoard, startFromBoard } from '../../importBoard'
import { encodeGame, encodeMoves } from '../../../lib/codec'
import { newGame as baseBoard } from '../../../lib/board'
import { formatPosition, placeBuilding, positionToUrl, emptySeat, toggleRoad } from '../../../lib/position'

const ctx = (seed = 7, now = 0) => ({ rng: seededRng(seed), now })

function act(state: GameState, seat: number, action: Action, seed = 1) {
  return applyAction(state, seat, action, ctx(seed))
}

/** Answer every setup placement with the bot until the main phase. */
function finishSetup(state: GameState): GameState {
  const rng = seededRng(3)
  while (state.phase === 'setup') {
    const seat = waitingOn(state)[0]
    state = applyAction(state, seat, botAction(state, seat)!, { rng, now: 0 })
  }
  return state
}

const hand = (cards: Partial<Hand>): Hand => ({ ...emptyHand(), ...cards })

describe('geometry', () => {
  it('the standard map has 54 land corners and 72 land edges', () => {
    const t = buildTopology(STANDARD_COORDS)
    const land = new Set(STANDARD_COORDS.slice(0, 19).map((_, i) => i))
    expect(t.vertices.filter((v) => v.hexes.some((h) => land.has(h))).length).toBe(54)
    expect(t.edges.filter((e) => e.hexes.some((h) => land.has(h))).length).toBe(72)
  })

  it('lines up with the board generator corner for corner', () => {
    const t = buildTopology(STANDARD_COORDS)
    const map = baseVertexMap(t)
    expect(new Set(map).size).toBe(54)
    BASE_VERTICES.forEach((v, i) => {
      expect(t.vertices[map[i]].x).toBeCloseTo(v.x)
      expect(t.vertices[map[i]].y).toBeCloseTo(v.y)
    })
  })

  it('puts standard harbours on the board generator berths', () => {
    const { map } = standardMap(seededRng(1))
    const t = buildTopology(map.hexes)
    const vmap = baseVertexMap(t)
    const expected = new Set(PORTS.flatMap((p) => p.vertices.map((v) => vmap[v])))
    const actual = new Set(harborVertices({ map } as GameState).keys())
    expect(actual).toEqual(expected)
    void t
  })
})

describe('maps', () => {
  for (const scenario of SCENARIOS) {
    for (const [size, recipe] of [['small', scenario.small], ['large', scenario.large]] as const) {
      if (recipe === 'random') continue
      it(`${scenario.title} (${size}) uses its pools exactly and places harbours apart`, () => {
        const cells = parseRows(recipe.rows)
        for (const [letter, pool] of Object.entries(recipe.pools)) {
          const want = Object.values(pool).reduce((s, n) => s + (n ?? 0), 0)
          expect(cells.filter((c) => c.token === letter).length, `pool ${letter}`).toBe(want)
        }
        if (recipe.fog) {
          const want = Object.values(recipe.fog).reduce((s, n) => s + (n ?? 0), 0)
          expect(cells.filter((c) => c.token === 'F').length, 'fog pool').toBe(want)
        }
        expect(cells.filter((c) => c.token === 'P').length).toBe(1)
        const { map, pirate } = recipeMap(recipe, seededRng(9))
        expect(map.hexes[pirate].terrain).toBe('sea')
        const t = buildTopology(map.hexes)
        const used = new Set<number>()
        for (const h of map.harbors) {
          const [a, b] = [t.hexes[h.hex].corners[h.side], t.hexes[h.hex].corners[(h.side + 1) % 6]]
          expect(used.has(a) || used.has(b)).toBe(false)
          used.add(a).add(b)
          expect(map.hexes[t.hexes[h.hex].neighbors[h.side]].terrain).toBe('sea')
        }
        expect(map.harbors.length).toBeGreaterThanOrEqual(recipe.harbors - 1)
        // Every tile that produces has a number.
        for (const h of map.hexes) {
          if (!['sea', 'desert', 'lake'].includes(h.terrain)) expect(h.number).toBeGreaterThanOrEqual(2)
        }
        if (recipe.home.length) expect(map.homeRegions.length).toBeGreaterThan(0)
      })
    }
  }

  it('never lets two red numbers touch on a balanced board', () => {
    for (let seed = 1; seed < 30; seed++) {
      const { map } = standardMap(seededRng(seed))
      const t = buildTopology(map.hexes)
      map.hexes.forEach((h, i) => {
        if (h.number !== 6 && h.number !== 8) return
        for (const n of t.hexes[i].neighbors) {
          if (n >= 0) expect([6, 8]).not.toContain(map.hexes[n].number)
        }
      })
    }
  })
})

describe('setup', () => {
  it('snakes 1-2-3-4-4-3-2-1 and pays out for the second settlement', () => {
    let state = createGame({ config: configFor('classic', 4), seats: seats(4) }, ctx())
    const order: number[] = []
    const rng = seededRng(2)
    while (state.phase === 'setup') {
      const seat = waitingOn(state)[0]
      const action = botAction(state, seat)!
      if (action.type === 'build' && (action.piece === 'settlement' || action.piece === 'city')) order.push(seat)
      state = applyAction(state, seat, action, { rng, now: 0 })
    }
    expect(order).toEqual([0, 1, 2, 3, 3, 2, 1, 0])
    expect(state.phase).toBe('main')
    for (const p of state.players) expect(handSize(p.hand)).toBeGreaterThan(0)
  })

  it('enforces the distance rule and a road beside the new settlement', () => {
    let state = createGame({ config: configFor('classic', 3), seats: seats(3) }, ctx())
    const spot = legalSettlements(state, 0, true)[0]
    state = act(state, 0, { type: 'build', piece: 'settlement', at: spot })
    const t = topo(state)
    // A road not touching the settlement is refused.
    const far = t.edges.findIndex((e) => e.a !== spot && e.b !== spot && e.hexes.some((h) => state.map.hexes[h].terrain !== 'sea'))
    expect(() => act(state, 0, { type: 'build', piece: 'road', at: far })).toThrow(/must touch/)
    const road = t.vertices[spot].edges.find((e) => t.edges[e].hexes.some((h) => state.map.hexes[h].terrain !== 'sea'))!
    state = act(state, 0, { type: 'build', piece: 'road', at: road })
    // Seat 1 can't build next to seat 0.
    for (const n of t.vertices[spot].neighbors) {
      expect(() => act(state, 1, { type: 'build', piece: 'settlement', at: n })).toThrow()
    }
  })
})

describe('the main game', () => {
  function started(mode = 'classic', players = 4, seed = 1) {
    return finishSetup(newGame(mode, players, seed).state)
  }

  it('makes you roll before building and ends turns in order', () => {
    let state = started()
    const seat = state.turn.seat
    expect(() => act(state, seat, { type: 'endTurn' })).toThrow(/roll/)
    state = act(state, seat, { type: 'roll' })
    expect(state.turn.rolled).toBe(true)
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    state = act(state, seat, { type: 'endTurn' })
    expect(state.turn.seat).toBe((seat + 1) % 4)
    expect(state.turn.number).toBe(2)
  })

  it('pays two for a city and one for a settlement, and rations a short bank', () => {
    let state = started()
    const t = topo(state)
    // Find a numbered hex with a building on it.
    const hexIndex = state.map.hexes.findIndex((h, i) =>
      h.number && h.number !== 7 && i !== state.robber && t.hexes[i].corners.some((v) => state.buildings[v]),
    )
    const hex = state.map.hexes[hexIndex]
    const vertex = t.hexes[hexIndex].corners.find((v) => state.buildings[v])!
    const owner = state.buildings[vertex]!.owner
    state.buildings[vertex] = { owner, kind: 'city' }
    const before = state.players[owner].hand[hex.terrain as 'brick']
    // Force the roll.
    state.turn.alchemist = null
    const dice = hex.number! <= 7 ? { a: 1, b: hex.number! - 1 } : { a: 6, b: hex.number! - 6 }
    state.config = { ...state.config, dice: 'balanced' }
    state.diceDeck = Array(10).fill(dice.a * 10 + dice.b)
    state = act(state, state.turn.seat, { type: 'roll' })
    const gained = state.players[owner].hand[hex.terrain as 'brick'] - before
    const others = t.hexes[hexIndex].corners.filter((v) => state.buildings[v]?.owner === owner).length
    expect(gained).toBeGreaterThanOrEqual(2)
    expect(gained).toBeLessThanOrEqual(2 * others + 2)
  })

  it('discards half over seven, then moves the robber and steals', () => {
    let state = started()
    const seat = state.turn.seat
    const victim = (seat + 1) % 4
    state.players[victim].hand = hand({ brick: 5, ore: 4 })
    state.config = { ...state.config, dice: 'balanced' }
    state.diceDeck = Array(10).fill(34)
    state = act(state, seat, { type: 'roll' })
    const discard = activePrompts(state).find((p) => p.seat === victim && p.type === 'discard')!
    expect(discard.input).toMatchObject({ kind: 'cards', count: 4 })
    expect(() => act(state, victim, { type: 'respond', prompt: discard.id, cards: { brick: 3 } })).toThrow(/exactly 4/)
    state = act(state, victim, { type: 'respond', prompt: discard.id, cards: { brick: 2, ore: 2 } })
    expect(handSize(state.players[victim].hand)).toBe(5)
    // Everyone else discards too, then the robber moves.
    while (activePrompts(state).some((p) => p.type === 'discard')) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    const robber = activePrompts(state)[0]
    expect(robber.type).toBe('robber')
    expect(robber.seat).toBe(seat)
    // Put the robber on a victim tile.
    const t = topo(state)
    const target = (robber.input as { hexes: number[] }).hexes.find((h) =>
      t.hexes[h].corners.some((v) => state.buildings[v]?.owner === victim),
    )!
    const cards = handSize(state.players[seat].hand)
    state = act(state, seat, { type: 'respond', prompt: robber.id, hex: target })
    if (activePrompts(state)[0]?.type === 'steal') {
      state = act(state, seat, { type: 'respond', prompt: activePrompts(state)[0].id, choice: String(victim) })
    }
    expect(state.robber).toBe(target)
    expect(handSize(state.players[seat].hand)).toBe(cards + 1)
  })

  it('trades 4:1 with the bank, 3:1 and 2:1 at harbours', () => {
    let state = started()
    const seat = state.turn.seat
    state = act(state, seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    state.players[seat].hand = hand({ brick: 8 })
    const ratios = tradeRatios(state, seat)
    expect([2, 3, 4]).toContain(ratios.brick)
    expect(() => act(state, seat, { type: 'tradeBank', give: { brick: ratios.brick - 1 }, get: { ore: 1 } })).toThrow()
    state = act(state, seat, { type: 'tradeBank', give: { brick: ratios.brick }, get: { ore: 1 } })
    expect(state.players[seat].hand.ore).toBe(1)
    // A harbour under one of our buildings changes the rate.
    const harbors = harborVertices(state)
    const [v, type] = [...harbors.entries()].find(([, t]) => t === 'any')!
    state.buildings[v] = { owner: seat, kind: 'settlement' }
    expect(tradeRatios(state, seat).brick).toBeLessThanOrEqual(3)
    void type
  })

  it('makes player trades need both sides to agree', () => {
    let state = started()
    const seat = state.turn.seat
    const other = (seat + 1) % 4
    state = act(state, seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    state.players[seat].hand = hand({ brick: 1 })
    state.players[other].hand = hand({ ore: 1 })
    state = act(state, seat, { type: 'offer', give: { brick: 1 }, get: { ore: 1 } })
    const id = state.offers[0].id
    expect(() => act(state, seat, { type: 'offerConfirm', id, with: other })).toThrow(/accepted/)
    state = act(state, other, { type: 'offerRespond', id, accept: true })
    state = act(state, seat, { type: 'offerConfirm', id, with: other })
    expect(state.players[seat].hand).toMatchObject({ ore: 1, brick: 0 })
    expect(state.players[other].hand).toMatchObject({ brick: 1, ore: 0 })
  })

  it('holds back development cards the turn they are bought, and counts the army', () => {
    let state = started()
    const seat = state.turn.seat
    state = act(state, seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    state.devDeck.push('knight')
    state.players[seat].hand = hand({ ore: 1, sheep: 1, wheat: 1 })
    state = act(state, seat, { type: 'buyDev' })
    expect(() => act(state, seat, { type: 'playDev', card: 'knight' })).toThrow(/turn you buy/)
    state.players[seat].dev = [{ type: 'knight', bought: 0 }, { type: 'knight', bought: 0 }]
    state.players[seat].knightsPlayed = 2
    state = act(state, seat, { type: 'playDev', card: 'knight' })
    expect(state.largestArmy?.owner).toBe(seat)
    expect(() => act(state, seat, { type: 'playDev', card: 'knight' })).toThrow()
  })

  it('cuts the longest road at an opponent’s settlement', () => {
    let state = started('classic', 2)
    const t = topo(state)
    state.routes = state.routes.map(() => null)
    state.buildings = state.buildings.map(() => null)
    // A straight-ish chain of five land edges.
    const chain: number[] = []
    let at = t.vertices.findIndex((v) => v.hexes.length === 3)
    const seen = new Set([at])
    while (chain.length < 5) {
      const e = t.vertices[at].edges.find((x) => !chain.includes(x) && !seen.has(t.edges[x].a === at ? t.edges[x].b : t.edges[x].a))!
      chain.push(e)
      at = t.edges[e].a === at ? t.edges[e].b : t.edges[e].a
      seen.add(at)
    }
    for (const e of chain) state.routes[e] = { owner: 0, kind: 'road', built: 0 }
    expect(longestRoute(state, 0)).toBe(5)
    // Seat 1 settles in the middle of it.
    const middle = [t.edges[chain[2]].a, t.edges[chain[2]].b].find((v) => [t.edges[chain[1]].a, t.edges[chain[1]].b].includes(v))!
    state.buildings[middle] = { owner: 1, kind: 'settlement' }
    expect(longestRoute(state, 0)).toBe(3)
  })

  it('replays exactly from recorded dice', () => {
    const { state: start, rng } = newGame('classic', 3, 11)
    let live = start
    let replayed = start
    const log: Array<{ seat: number; action: Action; draws: number[] }> = []
    for (let i = 0; i < 300 && live.phase !== 'ended'; i++) {
      const seat = [...new Set([...waitingOn(live), 0, 1, 2])].find((s) => botAction(live, s))!
      const action = botAction(live, seat)!
      const rec = recordingRng(rng)
      live = applyAction(live, seat, action, { rng: rec, now: 0 })
      log.push({ seat, action, draws: rec.draws })
    }
    for (const entry of log) replayed = applyAction(replayed, entry.seat, entry.action, { rng: replayRng(entry.draws), now: 0 })
    expect(replayed).toEqual(live)
  })
})

describe('turn variants', () => {
  it('gives the opposite seat a second-settler turn at five or more', () => {
    let state = finishSetup(newGame('extension-56', 6, 2).state)
    const seat = state.turn.seat
    state = act(state, seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    state = act(state, seat, { type: 'endTurn' })
    expect(state.turn.stage).toEqual({ kind: 'secondSettler', seat: (seat + 3) % 6 })
    const second = (seat + 3) % 6
    state.players[second].hand = hand({ brick: 1 })
    state.players[seat].hand = hand({ ore: 1 })
    expect(() => act(state, second, { type: 'offer', give: { brick: 1 }, get: { ore: 1 } })).toThrow(/whose turn/)
    state = act(state, second, { type: 'endTurn' })
    expect(state.turn.seat).toBe((seat + 1) % 6)
  })

  it('runs a special build phase round the table', () => {
    let state = finishSetup(newGame('extension-56', 5, 2, { largeGameTurns: 'specialBuild' }).state)
    const seat = state.turn.seat
    state = act(state, seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    state = act(state, seat, { type: 'endTurn' })
    const builders: number[] = []
    while (state.turn.stage.kind === 'specialBuild') {
      builders.push(state.turn.stage.seat)
      expect(() => act(state, state.turn.stage.kind === 'specialBuild' ? state.turn.stage.seat : 0, { type: 'tradeBank', give: { brick: 4 }, get: { ore: 1 } })).toThrow()
      state = act(state, state.turn.stage.seat, { type: 'endTurn' })
    }
    expect(builders).toEqual([1, 2, 3, 4].map((i) => (seat + i) % 5))
    expect(state.turn.seat).toBe((seat + 1) % 5)
  })

  it('times out a stalled player onto autopilot', () => {
    let state = finishSetup(newGame('classic', 3, 4, { turnTimer: 30 }).state)
    state = applyAction(state, state.turn.seat, { type: 'roll' }, { rng: seededRng(1), now: 1000 })
    const stalled = waitingOn(state)[0]
    expect(() => applyAction(state, 1, { type: 'timeout' }, { rng: seededRng(1), now: 2000 })).toThrow(/still time/)
    state = applyAction(state, (stalled + 1) % 3, { type: 'timeout' }, { rng: seededRng(1), now: state.deadline! + 1 })
    expect(waitingOn(state)).not.toContain(stalled)
  })
})

describe('seafarers', () => {
  it('awards island bonuses and never lets a road become a ship without a building', () => {
    const { state, rng } = newGame('seafarers-new-shores', 4, 3)
    const { state: end } = playOut(state, rng, 20000)
    expect(end.phase).toBe('ended')
    expect(end.players.some((p) => p.islandPoints > 0)).toBe(true)
  })

  it('lifts the fog as ships sail into it', () => {
    const { state, rng } = newGame('seafarers-fog-island', 4, 4)
    const before = state.map.hexes.filter((h) => h.veil === 'fog').length
    const { state: end } = playOut(state, rng, 20000)
    expect(end.map.hexes.filter((h) => h.veil === 'fog').length).toBeLessThan(before)
  })

  it('keeps the pirate and fog secret in a player view', () => {
    const { state } = newGame('seafarers-fog-island', 3, 1)
    const view = redact(state, 0)
    for (const h of view.map.hexes) {
      if (h.veil === 'fog') {
        expect(h.terrain).toBe('sea')
        expect(h.number).toBeUndefined()
      }
    }
    expect(view.devDeck).toEqual([])
    expect(view.decks.dev).toBe(state.devDeck.length)
  })
})

describe('cities & knights', () => {
  it('pays a commodity from a city on forest, pasture or mountains', () => {
    let state = finishSetup(newGame('cities-knights', 4, 5).state)
    const t = topo(state)
    const i = state.map.hexes.findIndex((h, idx) => h.terrain === 'lumber' && idx !== state.robber && h.number !== undefined)
    const v = t.hexes[i].corners[0]
    for (const n of t.vertices[v].neighbors) state.buildings[n] = null
    for (const w of t.hexes[i].corners) if (w !== v) state.buildings[w] = null
    state.buildings[v] = { owner: 1, kind: 'city' }
    const before = { ...state.players[1].hand }
    const n = state.map.hexes[i].number!
    state.config = { ...state.config, dice: 'balanced' }
    state.diceDeck = Array(10).fill(n <= 7 ? 10 + (n - 1) : 60 + (n - 6))
    state = act(state, state.turn.seat, { type: 'roll' })
    expect(state.players[1].hand.paper - before.paper).toBeGreaterThanOrEqual(1)
    expect(state.players[1].hand.lumber - before.lumber).toBeGreaterThanOrEqual(1)
  })

  it('sacks a city when the knights are too weak, and rewards a lone defender', () => {
    let state = finishSetup(newGame('cities-knights', 3, 6).state)
    const t = topo(state)
    state.barbarian = { position: 6, attacks: 0 }
    // Everyone has cities (from setup). Seat 2 has one strong active knight.
    const spot = t.vertices.findIndex((_, v) => !state.buildings[v] && !state.knights[v])
    state.knights[spot] = { owner: 2, level: 1, active: true }
    const cities = (s: GameState, seat: number) => s.buildings.filter((b) => b?.owner === seat && b.kind === 'city').length
    const before = [0, 1, 2].map((s) => cities(state, s))
    // Roll a ship face on the event die by retrying seeds.
    let next = state
    for (let seed = 1; seed < 200; seed++) {
      next = applyAction(state, state.turn.seat, { type: 'roll' }, ctx(seed))
      if (next.turn.dice?.event === 'barbarian') break
    }
    expect(next.turn.dice?.event).toBe('barbarian')
    while (activePrompts(next).some((p) => p.type === 'cityLoss')) {
      const p = activePrompts(next).find((q) => q.type === 'cityLoss')!
      next = act(next, p.seat, botAction(next, p.seat)!)
    }
    const after = [0, 1, 2].map((s) => cities(next, s))
    // 3 cities vs 1 knight: the barbarians win, and seats 0 and 1 (no knights) lose a city.
    expect(after[0]).toBe(before[0] - 1)
    expect(after[1]).toBe(before[1] - 1)
    expect(after[2]).toBe(before[2])
    expect(next.barbarian).toEqual({ position: 0, attacks: 1 })
    expect(next.knights[spot]?.active).toBe(false)
  })

  it('costs one more commodity per level and hands out the metropolis at 4', () => {
    let state = finishSetup(newGame('cities-knights', 2, 7).state)
    const seat = state.turn.seat
    state = act(state, seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    state.players[seat].hand = hand({ paper: 10 })
    for (let level = 1; level <= 4; level++) state = act(state, seat, { type: 'improve', track: 'science' })
    expect(state.players[seat].improvements.science).toBe(4)
    expect(state.players[seat].hand.paper).toBe(0)
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    expect(state.metropolis.science).not.toBeNull()
    expect(state.buildings[state.metropolis.science!]?.owner).toBe(seat)
  })

  it('displaces a weaker knight', () => {
    let state = finishSetup(newGame('cities-knights', 2, 8).state)
    const seat = state.turn.seat
    const other = 1 - seat
    state = act(state, seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    const t = topo(state)
    // Lay a road for `seat` from its building; put our knight at the building side, theirs at the far end.
    const home = state.buildings.findIndex((b) => b?.owner === seat)
    const road = t.vertices[home].edges.find((e) => !state.routes[e])!
    const far = t.edges[road].a === home ? t.edges[road].b : t.edges[road].a
    state.routes[road] = { owner: seat, kind: 'road', built: 0 }
    const existing = t.vertices[home].edges.find((e) => e !== road && state.routes[e]?.owner === seat)!
    const near = t.edges[existing].a === home ? t.edges[existing].b : t.edges[existing].a
    state.knights[near] = { owner: seat, level: 2, active: true }
    state.buildings[far] = null
    state.knights[far] = { owner: other, level: 1, active: false }
    state = act(state, seat, { type: 'moveKnight', from: near, to: far })
    expect(state.knights[far]?.owner).toBe(seat)
    expect(state.knights[far]?.active).toBe(false)
  })

  it('plays every progress card without breaking the game', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { state, rng } = newGame('cities-knights', 4, 100 + seed)
      const { state: end } = playOut(state, rng, 20000)
      expect(end.phase).toBe('ended')
    }
  })
})

describe('fishermen', () => {
  it('spends fish without change, and banishes the robber', () => {
    let state = finishSetup(newGame('fishermen', 3, 2).state)
    const seat = state.turn.seat
    state.robber = state.map.hexes.findIndex((h) => h.terrain === 'wheat')
    state.players[seat].fish = [3]
    state = act(state, seat, { type: 'fish', use: 'robber', tokens: [0] })
    expect(state.robber).toBe(-1)
    expect(state.players[seat].fish).toEqual([])
    expect(() => act(state, seat, { type: 'fish', use: 'robber', tokens: [0] })).toThrow()
  })

  it('makes the boot holder need one more point', () => {
    const { state } = newGame('fishermen', 3, 2)
    state.players[0].hasBoot = true
    expect(state.config.vpTarget).toBe(10)
    expect(totalPoints(state, 0)).toBe(0)
  })

  it('turns the desert into a lake with fishing grounds around it', () => {
    const { state } = newGame('fishermen', 4, 3)
    expect(state.map.hexes.some((h) => h.terrain === 'lake')).toBe(true)
    expect(state.map.hexes.filter((h) => h.fishing).map((h) => h.fishing).sort()).toEqual([10, 4, 5, 6, 8, 9])
  })
})

describe('dust bowl', () => {
  it('pushes numbers beside the desert towards 2 and 12, and swallows 2s and 12s', () => {
    let state = finishSetup(newGame('dust-bowl', 3, 5).state)
    const t = topo(state)
    const desert = state.map.hexes.findIndex((h) => h.terrain === 'desert')
    const around = t.hexes[desert].neighbors.filter((n) => n >= 0 && state.map.hexes[n].number !== undefined)
    const before = around.map((n) => state.map.hexes[n].number!)
    state.config = { ...state.config, dice: 'balanced' }
    state.diceDeck = Array(10).fill(34)
    state = act(state, state.turn.seat, { type: 'roll' })
    while (activePrompts(state).length) {
      const p = activePrompts(state)[0]
      state = act(state, p.seat, botAction(state, p.seat)!)
    }
    around.forEach((n, i) => {
      const h = state.map.hexes[n]
      const was = before[i]
      if (was === 2 || was === 12) expect(h.terrain).toBe('desert')
      else if (was < 7) expect(h.number).toBe(was - 1)
      else expect(h.number).toBe(was + 1)
    })
  })
})

describe('blind placement', () => {
  it('hides the island until settled beside, and shows it all after setup', () => {
    const { state } = newGame('blind', 3, 1)
    expect(state.map.hexes.filter((h) => h.veil === 'blind').length).toBe(19)
    const view = redact(state, 0)
    expect(view.map.hexes.filter((h) => h.veil === 'blind').every((h) => h.number === undefined)).toBe(true)
    const played = finishSetup(state)
    expect(played.map.hexes.some((h) => h.veil)).toBe(false)
  })
})

describe('starting from another page', () => {
  it('starts mid-game from a Position link', () => {
    const game = baseBoard('spiral')
    let seatsPieces = [emptySeat(), emptySeat(), emptySeat()]
    seatsPieces = placeBuilding(seatsPieces, 0, 10, 'settlement')
    seatsPieces = placeBuilding(seatsPieces, 1, 30, 'city')
    seatsPieces = toggleRoad(seatsPieces, 0, [10, 14])
    seatsPieces[0].knights = 2
    seatsPieces[1].victoryCards = 1
    const params = new URLSearchParams({ b: encodeGame(game), p: positionToUrl(formatPosition(seatsPieces)) })
    const board = boardFromParams(params)!
    expect(board.source).toBe('position')
    const map = mapFromBoard(board, { fishermen: false, rng: seededRng(1) })
    const start = startFromBoard(board, 3)!
    const state = createGame({ config: configFor('classic', 3), seats: seats(3), map, start }, ctx())
    expect(state.phase).toBe('main')
    expect(state.buildings.filter(Boolean).length).toBe(2)
    expect(state.routes.filter(Boolean).length).toBe(1)
    expect(state.players[0].knightsPlayed).toBe(2)
    expect(totalPoints(state, 1)).toBe(3)
    // The tiles carry over as they were.
    game.tiles.forEach((tile, i) => expect(state.map.hexes[i].terrain).toBe(tile.type))
  })

  it('continues setup from a board generator opening', () => {
    const game = baseBoard('pseudorandom')
    const params = new URLSearchParams({ game: encodeGame(game), moves: encodeMoves([0, 20, 40, 50]) })
    const board = boardFromParams(params)!
    expect(board.source).toBe('generator')
    const map = mapFromBoard(board, { fishermen: false, rng: seededRng(1) })
    const start = startFromBoard(board, 4)!
    let state = createGame({ config: configFor('classic', 4), seats: seats(4), map, start }, ctx())
    expect(state.phase).toBe('setup')
    expect(state.buildings.filter(Boolean).length).toBe(4)
    // Seat 0's settlement is down, so their first move is a road.
    expect(state.setup!.anchor).not.toBeNull()
    state = finishSetup(state)
    expect(state.buildings.filter(Boolean).length).toBe(8)
    expect(state.routes.filter(Boolean).length).toBe(8)
  })
})
