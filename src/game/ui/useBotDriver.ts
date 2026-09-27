/**
 * Plays the bot seats — and calls time on stalled players — from this
 * browser, for local games and client-authority online games. (With server
 * authority the Cloud Function plays the bots itself.)
 *
 * Online, every human at the table runs this, with staggered delays: the
 * host's browser normally acts first, and the others only step in if the
 * host has gone quiet. Each submission names the state version it was
 * computed from, so a late duplicate is simply dropped.
 */
import { useEffect, useState } from 'react'
import { autopilot, botAction } from '../engine/bot'
import { waitingOn } from '../engine/rules'
import { redact } from '../engine/view'
import type { Action, GameState } from '../engine/types'

export interface BotDriverOptions {
  state: GameState | null
  isBot: (seat: number) => boolean
  submit: (action: Action, seat: number, expectedSeq: number) => Promise<void>
  enabled: boolean
  /** Milliseconds before a bot moves; more for browsers further down the pecking order. */
  delay: number
  /** Seat this browser uses to call time on others; null to never call time. */
  timeoutSeat: number | null
}

export function useBotDriver({ state, isBot, submit, enabled, delay, timeoutSeat }: BotDriverOptions) {
  const [retry, setRetry] = useState(0)
  const seq = state?.seq ?? -1

  useEffect(() => setRetry(0), [seq])

  useEffect(() => {
    if (!enabled || !state || state.phase === 'ended') return
    const order = [...new Set([...waitingOn(state), ...state.players.map((_, i) => i)])]
    for (const seat of order) {
      if (!isBot(seat) || state.players[seat].resigned) continue
      // Bots decide from what their seat can see. After a failure, fall back
      // to the autopilot, then to just passing.
      const sight = redact(state, seat) as unknown as GameState
      const action = retry === 0 ? botAction(sight, seat) : retry === 1 ? autopilot(sight, seat) : null
      const fallback: Action | null = retry >= 2 && waitingOn(state).includes(seat) ? { type: 'endTurn' } : null
      const chosen = action ?? fallback
      if (!chosen) continue
      const timer = setTimeout(() => {
        submit(chosen, seat, state.seq).catch((error: Error) => {
          if (error.name === 'StaleError') return
          console.warn(`Bot in seat ${seat + 1} could not ${chosen.type}:`, error.message)
          if (retry < 3) setRetry((r) => r + 1)
        })
      }, delay)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, enabled, retry, delay])

  // Call time when the clock runs out on someone.
  const deadline = state?.deadline ?? null
  useEffect(() => {
    if (!enabled || !state || deadline === null || timeoutSeat === null || state.phase === 'ended') return
    const wait = Math.max(0, deadline - Date.now()) + 500 + delay
    const timer = setTimeout(() => {
      submit({ type: 'timeout' }, timeoutSeat, state.seq).catch(() => {})
    }, wait)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seq, deadline, enabled, timeoutSeat, delay])
}
