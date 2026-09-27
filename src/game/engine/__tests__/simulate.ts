/** Helpers for tests that play whole games with bots. */
import { applyAction, createGame, type NewGame } from '../game'
import { botAction } from '../bot'
import { configFor } from '../config'
import { waitingOn } from '../rules'
import { seededRng, type Rng } from '../rng'
import { PLAYER_COLORS, type GameConfig, type GameState } from '../types'

export function seats(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Bot ${i + 1}`, color: PLAYER_COLORS[i], bot: true }))
}

export function newGame(mode: string, players: number, seed = 1, overrides: Partial<GameConfig> = {}, extra: Partial<NewGame> = {}) {
  const rng = seededRng(seed)
  const state = createGame({ config: configFor(mode, players, overrides), seats: seats(players), ...extra }, { rng, now: 0 })
  return { state, rng }
}

export interface PlayResult {
  state: GameState
  actions: number
}

/** Let the bots play until someone wins or `limit` actions pass. */
export function playOut(state: GameState, rng: Rng, limit = 6000): PlayResult {
  let actions = 0
  while (state.phase !== 'ended' && actions < limit) {
    // Bots waiting on the game come first; then anyone with an offer to answer.
    const order = [...new Set([...waitingOn(state), ...state.players.map((_, i) => i)])]
    let acted = false
    for (const seat of order) {
      const action = botAction(state, seat)
      if (!action) continue
      try {
        state = applyAction(state, seat, action, { rng, now: actions })
      } catch (error) {
        const detail = JSON.stringify(action)
        throw new Error(`seat ${seat} tried ${detail} on turn ${state.turn.number}: ${(error as Error).message}`, { cause: error })
      }
      actions++
      acted = true
      break
    }
    if (!acted) {
      throw new Error(`nobody can move (turn ${state.turn.number}, waiting on ${waitingOn(state).join(',')}, queue ${JSON.stringify(state.queue.slice(0, 2))})`)
    }
  }
  return { state, actions }
}
