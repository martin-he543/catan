import type { GameState } from '../engine/types'
import type { GameView } from '../engine/view'

/**
 * A view has the same shape as a state, minus what it hides, so the rule
 * queries (legal spots, scores, trade rates) run on it directly.
 */
export const asState = (view: GameView) => view as unknown as GameState
