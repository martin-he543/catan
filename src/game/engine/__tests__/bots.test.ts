import { describe, expect, it } from 'vitest'
import { MODES } from '../config'
import { newGame, playOut } from './simulate'
import { totalPoints } from '../state'

/**
 * Whole games, bots in every seat, for every mode at the smallest, default
 * and largest table. They catch rules that deadlock, bots that attempt
 * illegal moves, and states the queue can't get out of.
 */
const cases = MODES.flatMap((mode) =>
  [...new Set([mode.minPlayers, mode.defaultPlayers, mode.maxPlayers])].map((players) => ({ mode: mode.id, players })),
)

describe('bot games', () => {
  it.each(cases)('$mode with $players players plays to a finish', { timeout: 60_000 }, ({ mode, players }) => {
    for (const seed of [1, 2]) {
      const { state, rng } = newGame(mode, players, seed)
      const { state: end } = playOut(state, rng, 12000)
      expect(end.phase, `${mode}/${players} seed ${seed} stuck on turn ${end.turn.number}`).toBe('ended')
      expect(end.winner).not.toBeNull()
      if (!end.config.dustBowl) {
        expect(totalPoints(end, end.winner!)).toBeGreaterThanOrEqual(end.config.vpTarget)
      }
    }
  })
})
