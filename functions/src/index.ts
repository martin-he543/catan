/**
 * The server referee, for games with `authority: 'server'`.
 *
 * The browser never sees the full state: it lives in games/{code}/secret/state,
 * which the security rules close to every client. Each action arrives here,
 * is checked by the same rules engine the browser uses, and each seat gets
 * back a redacted view in games/{code}/views/{uid} — so hands, the deck order
 * and the fog stay hidden, and nobody can choose their own dice. Bots play
 * here too, straight after each human action.
 *
 * Deploying these needs the Blaze (pay-as-you-go) plan; see FIREBASE_SETUP.md.
 */
import { initializeApp } from 'firebase-admin/app'
import { FieldValue, getFirestore, type Transaction } from 'firebase-admin/firestore'
import { setGlobalOptions } from 'firebase-functions/v2'
import { HttpsError, onCall } from 'firebase-functions/v2/https'
import { onSchedule } from 'firebase-functions/v2/scheduler'
import * as logger from 'firebase-functions/logger'
import {
  RuleError,
  applyAction,
  autopilot,
  botAction,
  createGame,
  cryptoRng,
  recordingRng,
  redact,
  waitingOn,
  type Action,
  type GameState,
  type NewGame,
} from '../../src/game/engine/index'
import { MAX_STATE_BYTES, summarise, type GameDoc, type LogDoc } from '../../src/game/net/protocol'

initializeApp()
const db = getFirestore()

setGlobalOptions({ region: process.env.CATAN_REGION || 'us-central1', maxInstances: 20 })

/** Most bot moves in one call, so a table of bots can't run away with a function. */
const BOT_BUDGET = 400

interface Pending {
  seat: number
  action: Action
  draws: number[]
  uid: string
}

function apply(state: GameState, seat: number, action: Action, uid: string, log: Pending[]): GameState {
  const rng = recordingRng(cryptoRng)
  const next = applyAction(state, seat, action, { rng, now: Date.now() })
  log.push({ seat, action, draws: rng.draws, uid })
  return next
}

/** Let bots move until a human is needed (or the budget runs out). */
function runBots(state: GameState, game: GameDoc, log: Pending[]): GameState {
  for (let i = 0; i < BOT_BUDGET && state.phase !== 'ended'; i++) {
    const order = [...new Set([...waitingOn(state), ...state.players.map((_, s) => s)])]
    let moved = false
    for (const seat of order) {
      if (!game.seats[seat]?.bot || state.players[seat].resigned) continue
      // Bots decide from what their seat can see, like everyone else.
      const sight = redact(state, seat) as unknown as GameState
      const choice = botAction(sight, seat)
      if (!choice) continue
      try {
        state = apply(state, seat, choice, 'bot', log)
      } catch (error) {
        // A bot that gets confused falls back to the autopilot.
        logger.warn('bot action rejected', { code: game.code, seat, choice, error: (error as Error).message })
        const fallback = autopilot(sight, seat)
        if (!fallback) continue
        try {
          state = apply(state, seat, fallback, 'bot', log)
        } catch {
          continue
        }
      }
      moved = true
      break
    }
    if (!moved) break
  }
  return state
}

/** Write the state everywhere it belongs: secret, per-seat views, the public doc, the log. */
function store(tx: Transaction, code: string, game: GameDoc, state: GameState, log: Pending[]) {
  const json = JSON.stringify(state)
  if (json.length > MAX_STATE_BYTES) throw new HttpsError('resource-exhausted', 'The game grew too large to store.')
  const ref = db.collection('games').doc(code)
  tx.set(ref.collection('secret').doc('state'), { state: json })
  game.seats.forEach((s, seat) => {
    if (!s.uid) return
    tx.set(ref.collection('views').doc(s.uid), { state: JSON.stringify(redact(state, seat)), seq: state.seq })
  })
  tx.update(ref, {
    view: JSON.stringify(redact(state, null)),
    ...summarise(state),
    updatedAt: FieldValue.serverTimestamp(),
  })
  // Log entries are numbered by the sequence each action produced.
  const firstSeq = state.seq - log.length + 1
  log.forEach((entry, i) => {
    const doc: LogDoc = { seq: firstSeq + i, ...entry, at: FieldValue.serverTimestamp() }
    tx.set(ref.collection('log').doc(String(firstSeq + i)), doc)
  })
}

function requireUser(uid: string | undefined): string {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.')
  return uid
}

function requireCode(code: unknown): string {
  if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/.test(code)) throw new HttpsError('invalid-argument', 'That is not a game code.')
  return code
}

export const startGame = onCall(async (request) => {
  const uid = requireUser(request.auth?.uid)
  const code = requireCode((request.data as { code?: unknown })?.code)
  const ref = db.collection('games').doc(code)
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'No game with that code.')
    const game = snap.data() as GameDoc
    if (game.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can start the game.')
    if (game.authority !== 'server') throw new HttpsError('failed-precondition', 'This game is refereed in the browser.')
    if (game.status !== 'lobby') return
    if (game.seats.some((s) => !s.uid && !s.bot)) throw new HttpsError('failed-precondition', 'Fill every seat first.')

    const setup = game.setup ? (JSON.parse(game.setup) as Pick<NewGame, 'map' | 'start'>) : {}
    let state = createGame(
      {
        config: { ...game.config, players: game.seats.length },
        seats: game.seats.map((s, i) => ({ name: s.name || `Player ${i + 1}`, color: s.color, bot: s.bot })),
        ...setup,
      },
      { rng: cryptoRng, now: Date.now() },
    )
    // Kept private: it knows the deck order and what the fog hides.
    tx.set(ref.collection('secret').doc('initial'), { state: JSON.stringify(state) })
    const log: Pending[] = []
    state = runBots(state, game, log)
    store(tx, code, game, state, log)
  })
  return { ok: true }
})

export const act = onCall(async (request) => {
  const uid = requireUser(request.auth?.uid)
  const data = (request.data ?? {}) as { code?: unknown; action?: Action; expectedSeq?: unknown }
  const code = requireCode(data.code)
  const action = data.action
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') {
    throw new HttpsError('invalid-argument', 'Malformed action.')
  }
  const ref = db.collection('games').doc(code)
  await db.runTransaction(async (tx) => {
    const [snap, secret] = await Promise.all([tx.get(ref), tx.get(ref.collection('secret').doc('state'))])
    if (!snap.exists || !secret.exists) throw new HttpsError('not-found', 'That game is not running.')
    const game = snap.data() as GameDoc
    if (game.status !== 'playing') throw new HttpsError('failed-precondition', 'That game is not running.')
    const seat = game.seatUids.indexOf(uid)
    if (seat < 0) throw new HttpsError('permission-denied', "You're watching, not playing.")
    let state = JSON.parse((secret.data() as { state: string }).state) as GameState
    if (typeof data.expectedSeq === 'number' && data.expectedSeq !== state.seq) {
      throw new HttpsError('aborted', 'The game moved on.')
    }
    const log: Pending[] = []
    try {
      state = apply(state, seat, action, uid, log)
    } catch (error) {
      if (error instanceof RuleError) throw new HttpsError('failed-precondition', error.message)
      logger.error('engine error', { code, action, error })
      throw new HttpsError('internal', 'The referee tripped over that move.')
    }
    state = runBots(state, game, log)
    // Once it's over, the starting state can be published for replays.
    const initial = state.phase === 'ended' ? await tx.get(ref.collection('secret').doc('initial')) : null
    store(tx, code, game, state, log)
    if (initial?.exists) tx.set(ref.collection('log').doc('0'), { seq: 0, initial: (initial.data() as { state: string }).state, uid: 'server' })
  })
  return { ok: true }
})

/**
 * Every few minutes, play on autopilot for anyone whose turn timer ran out
 * while nobody at the table was looking.
 */
export const sweepTimeouts = onSchedule('every 5 minutes', async () => {
  const due = await db
    .collection('games')
    .where('authority', '==', 'server')
    .where('status', '==', 'playing')
    .where('deadline', '<', Date.now())
    .limit(25)
    .get()
  for (const doc of due.docs) {
    try {
      await db.runTransaction(async (tx) => {
        const [snap, secret] = await Promise.all([tx.get(doc.ref), tx.get(doc.ref.collection('secret').doc('state'))])
        if (!snap.exists || !secret.exists) return
        const game = snap.data() as GameDoc
        let state = JSON.parse((secret.data() as { state: string }).state) as GameState
        if (state.deadline === null || state.deadline > Date.now() || state.phase === 'ended') return
        const caller = state.players.findIndex((p) => !p.resigned)
        const log: Pending[] = []
        state = apply(state, caller, { type: 'timeout' }, 'scheduler', log)
        state = runBots(state, game, log)
        store(tx, game.code, game, state, log)
      })
    } catch (error) {
      logger.warn('timeout sweep failed', { code: doc.id, error: (error as Error).message })
    }
  }
})
