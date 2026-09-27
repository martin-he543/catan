/** Regressions for rule bugs found in review. */
import { describe, expect, it } from 'vitest'
import { applyAction } from '../game'
import { botAction } from '../bot'
import { waitingOn, actingSeat } from '../rules'
import { activePrompts, emptyHand, handSize, topo } from '../state'
import { seededRng } from '../rng'
import { redact } from '../view'
import { newGame, playOut } from './simulate'
import type { Action, GameState, Hand } from '../types'

const ctx = (seed = 1) => ({ rng: seededRng(seed), now: 0 })
const act = (state: GameState, seat: number, action: Action, seed = 1) => applyAction(state, seat, action, ctx(seed))
const hand = (cards: Partial<Hand>): Hand => ({ ...emptyHand(), ...cards })

function finishSetup(state: GameState): GameState {
  const rng = seededRng(3)
  while (state.phase === 'setup') {
    const seat = waitingOn(state)[0]
    state = applyAction(state, seat, botAction(state, seat)!, { rng, now: 0 })
  }
  return state
}

function answerAll(state: GameState): GameState {
  for (let i = 0; i < 50 && activePrompts(state).length; i++) {
    const p = activePrompts(state)[0]
    state = act(state, p.seat, botAction(state, p.seat)!)
  }
  return state
}

describe('review regressions', () => {
  it('refuses to roll, trade or end a turn during setup', () => {
    const { state } = newGame('classic', 3)
    for (const action of [{ type: 'roll' }, { type: 'endTurn' }, { type: 'buyDev' }, { type: 'tradeBank', give: { brick: 4 }, get: { ore: 1 } }] as Action[]) {
      expect(() => act(state, 0, action)).toThrow(/opening pieces/)
    }
  })

  it('never asks for gold the bank cannot pay', () => {
    let state = finishSetup(newGame('seafarers-new-shores', 3, 4).state)
    const t = topo(state)
    const gold = state.map.hexes.findIndex((h) => h.terrain === 'gold')
    const corners = t.hexes[gold].corners
    // Two players on the same gold field, and one resource left in the bank.
    for (const v of corners) state.buildings[v] = null
    state.buildings[corners[0]] = { owner: 1, kind: 'settlement' }
    state.buildings[corners[3]] = { owner: 2, kind: 'settlement' }
    for (const r of ['brick', 'lumber', 'ore', 'sheep', 'wheat'] as const) state.bank[r] = 0
    state.bank.ore = 1
    const n = state.map.hexes[gold].number!
    state.config = { ...state.config, dice: 'balanced' }
    state.diceDeck = Array(10).fill(n <= 7 ? 10 + n - 1 : 60 + n - 6)
    state = act(state, state.turn.seat, { type: 'roll' })
    const golds = activePrompts(state).filter((p) => p.type === 'gold')
    expect(golds.length).toBe(1)
    state = answerAll(state)
    expect(activePrompts(state).length).toBe(0)
  })

  it('answers the prompts of a player who resigns, instead of waiting forever', () => {
    let state = finishSetup(newGame('classic', 3, 2).state)
    const seat = state.turn.seat
    const quitter = (seat + 1) % 3
    state.players[quitter].hand = hand({ brick: 10 })
    state.config = { ...state.config, dice: 'balanced' }
    state.diceDeck = Array(10).fill(34)
    state = act(state, seat, { type: 'roll' })
    expect(activePrompts(state).some((p) => p.seat === quitter)).toBe(true)
    state = act(state, quitter, { type: 'resign' })
    expect(activePrompts(state).some((p) => p.seat === quitter)).toBe(false)
    // And a game with a quitter still plays to the end.
    const { state: end } = playOut(state, seededRng(5), 20000)
    expect(end.phase).toBe('ended')
  })

  it('skips resigned seats in the special build phase, and nobody wins during it', () => {
    let state = finishSetup(newGame('extension-56', 5, 3, { largeGameTurns: 'specialBuild' }).state)
    const seat = state.turn.seat
    state = answerAll(act(state, seat, { type: 'roll' }))
    const skipped = (seat + 2) % 5
    state.players[skipped].resigned = true
    state = act(state, seat, { type: 'endTurn' })
    const builders: number[] = []
    while (state.turn.stage.kind === 'specialBuild') {
      const s = state.turn.stage.seat
      builders.push(s)
      // No knights or wins here: it's nobody's own turn.
      state = act(state, s, { type: 'endTurn' })
    }
    expect(builders).not.toContain(skipped)
    expect(state.turn.seat).toBe((seat + 1) % 5)
  })

  it('hides other seats’ progress card names in their prompts', () => {
    let state = finishSetup(newGame('cities-knights', 3, 9).state)
    state.players[1].progress = [
      { type: 'bishop', track: 'politics' }, { type: 'warlord', track: 'politics' },
      { type: 'spy', track: 'politics' }, { type: 'wedding', track: 'politics' }, { type: 'crane', track: 'science' },
    ]
    state.queue.unshift({
      kind: 'prompt', id: 'x', group: 'x', seat: 1, type: 'progressDiscard', text: 'Discard one',
      input: { kind: 'choice', options: state.players[1].progress.map((c, i) => ({ id: String(i), label: c.type })) },
    })
    const theirs = redact(state, 1).queue[0]
    const mine = redact(state, 0).queue[0]
    expect(JSON.stringify(theirs)).toContain('bishop')
    expect(JSON.stringify(mine)).not.toMatch(/bishop|warlord|crane/)
  })

  it('gives the second settler their own card allowance and Crane', () => {
    let state = finishSetup(newGame('cities-knights', 6, 4).state)
    const seat = state.turn.seat
    state = answerAll(act(state, seat, { type: 'roll' }))
    state.turn.devPlayed = true
    state = act(state, seat, { type: 'endTurn' })
    expect(state.turn.stage.kind).toBe('secondSettler')
    expect(state.turn.devPlayed).toBe(false)
    const second = actingSeat(state)!
    state.players[second].progress = [{ type: 'crane', track: 'science' }]
    state = act(state, second, { type: 'playProgress', card: 'crane' })
    state.players[second].hand = hand({ paper: 1 })
    state = act(state, second, { type: 'improve', track: 'science' })
    expect(state.players[second].improvements.science).toBe(1)
  })

  it('keeps knights still during the special build phase', () => {
    let state = finishSetup(newGame('cities-knights', 5, 2, { largeGameTurns: 'specialBuild' }).state)
    const seat = state.turn.seat
    state = answerAll(act(state, seat, { type: 'roll' }))
    state = act(state, seat, { type: 'endTurn' })
    const builder = actingSeat(state)!
    const v = state.knights.findIndex((k, i) => !k && !state.buildings[i])
    state.knights[v] = { owner: builder, level: 1, active: true }
    expect(() => act(state, builder, { type: 'moveKnight', from: v, to: v })).toThrow(/building only/)
    expect(() => act(state, builder, { type: 'chaseRobber', at: v })).toThrow(/building only/)
  })

  it('only builds the pieces a free road offers', () => {
    let state = finishSetup(newGame('seafarers-new-shores', 3, 6).state)
    const seat = state.turn.seat
    state = answerAll(act(state, seat, { type: 'roll' }))
    state.players[seat].dev = [{ type: 'roadBuilding', bought: 0 }]
    state = act(state, seat, { type: 'playDev', card: 'roadBuilding' })
    const prompt = activePrompts(state)[0]
    const edge = (prompt.input as { edges: number[] }).edges[0]
    expect(() => act(state, seat, { type: 'respond', prompt: prompt.id, edge, piece: 'city' as never })).toThrow(/has to be/)
  })

  it('passes the boot by visible points, not hidden cards', () => {
    let state = finishSetup(newGame('fishermen', 3, 2).state)
    const seat = state.turn.seat
    const other = (seat + 1) % 3
    state.players[seat].hasBoot = true
    // A hidden victory point shouldn't make the holder "ahead".
    state.players[seat].dev = [{ type: 'victory', bought: 0 }]
    state = act(state, seat, { type: 'passBoot', to: other })
    expect(state.players[other].hasBoot).toBe(true)
  })

  it('stops paying a player who resigned', () => {
    let state = finishSetup(newGame('classic', 3, 8).state)
    const seat = state.turn.seat
    const quitter = (seat + 1) % 3
    state = act(state, quitter, { type: 'resign' })
    const before = handSize(state.players[quitter].hand)
    for (let i = 0; i < 6 && state.phase === 'main'; i++) {
      const s = actingSeat(state)!
      state = answerAll(act(state, s, { type: 'roll' }, i + 10))
      state = act(state, s, { type: 'endTurn' })
    }
    expect(handSize(state.players[quitter].hand)).toBe(before)
  })

  it('turns down gifts and like-for-like trades, and malformed payloads', () => {
    let state = finishSetup(newGame('classic', 3, 1).state)
    const seat = state.turn.seat
    state = answerAll(act(state, seat, { type: 'roll' }))
    state.players[seat].hand = hand({ brick: 2 })
    expect(() => act(state, seat, { type: 'offer', give: { brick: 1 }, get: {} })).toThrow(/both ways/)
    expect(() => act(state, seat, { type: 'offer', give: { brick: 1 }, get: { brick: 1 } })).toThrow(/same card/)
    expect(() => act(state, seat, { type: 'build', piece: 'road', at: 'x' as never })).toThrow(/malformed/)
    expect(() => act(state, seat, { type: 'fish', use: 'robber', tokens: 'lots' as never })).toThrow(/malformed/)
  })
})
