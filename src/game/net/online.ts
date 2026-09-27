/**
 * Online games over Firestore.
 *
 * With client authority (the default, free on the Spark plan) each browser
 * runs the rules engine inside a Firestore transaction: read the state, apply
 * the action, write the next state and a log entry. The version check in the
 * security rules and the transaction retry mean two players acting at once
 * can't clobber each other. Everyone at the table can read the full state, so
 * this suits friends.
 *
 * With server authority (Blaze plan) actions go to the `act` Cloud Function,
 * which referees, rolls the dice and writes each seat a redacted view — nobody
 * can see anyone else's hand or cheat the dice.
 */
import { applyAction, createGame, type NewGame } from '../engine/game'
import { cryptoRng, recordingRng } from '../engine/rng'
import { redact, type GameView } from '../engine/view'
import { PLAYER_COLORS, RuleError, type Action, type GameConfig, type GameState } from '../engine/types'
import { ensureUser, getFirebase } from './firebase'
import {
  CHAT_LIMIT,
  MAX_STATE_BYTES,
  newCode,
  summarise,
  type Authority,
  type ChatDoc,
  type GameDoc,
  type LogDoc,
  type SeatDoc,
} from './protocol'

export type { GameDoc, SeatDoc, ChatDoc } from './protocol'

const fs = () => import('firebase/firestore')

/** A late submission whose state moved on underneath it — safe to drop. */
export class StaleError extends Error {
  constructor() {
    super('the game moved on')
    this.name = 'StaleError'
  }
}

/* ------------------------------------------------------------------ *
 * Lobby
 * ------------------------------------------------------------------ */

export interface CreateOptions {
  mode: string
  config: GameConfig
  /** A map dealt in advance and any starting position. */
  setup?: Pick<NewGame, 'map' | 'start'>
  /** The page the board was brought from, for the lobby's rules summary. */
  boardFrom?: string
  visibility: 'public' | 'private'
  hostName: string
  /** Seat names; `bot: true` seats start filled by bots. Seat 0 is the host. */
  seats: Array<{ bot: boolean; name: string }>
  authority?: Authority
}

export async function createOnlineGame(options: CreateOptions): Promise<string> {
  const user = await ensureUser()
  const { db, settings } = await getFirebase()
  const { doc, runTransaction, serverTimestamp } = await fs()
  const authority = options.authority ?? settings.authority ?? 'client'
  const seats: SeatDoc[] = options.seats.map((s, i) => ({
    uid: i === 0 ? user.uid : null,
    name: i === 0 ? options.hostName : s.bot ? s.name : '',
    color: PLAYER_COLORS[i],
    bot: i === 0 ? false : s.bot,
  }))
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = newCode()
    const ref = doc(db, 'games', code)
    const created = await runTransaction(db, async (tx) => {
      if ((await tx.get(ref)).exists()) return false
      const game: GameDoc = {
        code,
        hostUid: user.uid,
        status: 'lobby',
        visibility: options.visibility,
        authority,
        mode: options.mode,
        title: options.config.title,
        config: { ...options.config, players: seats.length },
        seats,
        seatUids: seats.map((s) => s.uid ?? ''),
        seq: 0,
        setup: options.setup ? JSON.stringify(options.setup) : null,
        boardFrom: options.boardFrom ?? null,
        turnSeat: null,
        waiting: [],
        winner: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      tx.set(ref, game)
      return true
    })
    if (created) return code
  }
  throw new Error('Could not find a free game code — try again.')
}

async function lobbyUpdate(code: string, update: (game: GameDoc, uid: string) => Partial<GameDoc> | null) {
  const user = await ensureUser()
  const { db } = await getFirebase()
  const { doc, runTransaction, serverTimestamp } = await fs()
  const ref = doc(db, 'games', code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('No game with that code.')
    const patch = update(snap.data() as GameDoc, user.uid)
    if (patch) tx.update(ref, { ...patch, updatedAt: serverTimestamp() })
  })
}

/** Take the first open seat, or rename yourself if you're already seated. */
export function joinGame(code: string, name: string) {
  return lobbyUpdate(code, (game, uid) => {
    const seats = game.seats.map((s) => ({ ...s }))
    const mine = seats.findIndex((s) => s.uid === uid)
    if (mine >= 0) {
      if (game.status !== 'lobby') return null
      seats[mine].name = name
    } else {
      if (game.status !== 'lobby') throw new Error('That game has already started.')
      const open = seats.findIndex((s) => !s.uid && !s.bot)
      if (open < 0) throw new Error('That game is full.')
      seats[open] = { ...seats[open], uid, name }
    }
    return { seats, seatUids: seats.map((s) => s.uid ?? '') }
  })
}

export function leaveSeat(code: string) {
  return lobbyUpdate(code, (game, uid) => {
    if (game.status !== 'lobby') return null
    const seats = game.seats.map((s) => (s.uid === uid ? { ...s, uid: null, name: '' } : s))
    return { seats, seatUids: seats.map((s) => s.uid ?? '') }
  })
}

/** Host only: change a seat — make it a bot, open it, or kick whoever is in it. */
export function setSeat(code: string, index: number, change: 'bot' | 'open' | 'remove' | 'add') {
  return lobbyUpdate(code, (game, uid) => {
    if (game.hostUid !== uid) throw new Error('Only the host can change seats.')
    if (game.status !== 'lobby') return null
    let seats = game.seats.map((s) => ({ ...s }))
    if (change === 'add') {
      if (seats.length >= 8) throw new Error('Eight seats at most.')
      seats.push({ uid: null, name: '', color: PLAYER_COLORS.find((c) => !seats.some((s) => s.color === c))!, bot: false })
    } else if (change === 'remove') {
      if (index === 0) throw new Error("The host's seat stays.")
      if (seats.length <= 2) throw new Error('Two seats at least.')
      seats = seats.filter((_, i) => i !== index)
    } else if (index > 0) {
      seats[index] = change === 'bot'
        ? { ...seats[index], uid: null, bot: true, name: `Bot ${index + 1}` }
        : { ...seats[index], uid: null, bot: false, name: '' }
    }
    return { seats, seatUids: seats.map((s) => s.uid ?? ''), config: { ...game.config, players: seats.length } }
  })
}

export function setColor(code: string, index: number, color: SeatDoc['color']) {
  return lobbyUpdate(code, (game, uid) => {
    if (game.status !== 'lobby') return null
    if (game.hostUid !== uid && game.seats[index]?.uid !== uid) throw new Error('That seat is not yours.')
    const seats = game.seats.map((s) => ({ ...s }))
    const other = seats.findIndex((s) => s.color === color)
    if (other >= 0) seats[other].color = seats[index].color
    seats[index].color = color
    return { seats }
  })
}

export function setConfig(code: string, config: GameConfig) {
  return lobbyUpdate(code, (game, uid) => {
    if (game.hostUid !== uid) throw new Error('Only the host can change the rules.')
    if (game.status !== 'lobby') return null
    return { config: { ...config, players: game.seats.length }, title: config.title }
  })
}

export async function deleteGame(code: string) {
  const { db } = await getFirebase()
  const { doc, deleteDoc } = await fs()
  await deleteDoc(doc(db, 'games', code))
}

/** Host only: deal the board and begin. */
export async function startGame(code: string) {
  const user = await ensureUser()
  const { db, functions } = await getFirebase()
  const { doc, getDoc, runTransaction, serverTimestamp } = await fs()
  const ref = doc(db, 'games', code)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('No game with that code.')
  const game = snap.data() as GameDoc
  if (game.hostUid !== user.uid) throw new Error('Only the host can start the game.')
  if (game.seats.some((s) => !s.uid && !s.bot)) throw new Error('Fill every seat — with a friend or a bot — first.')

  if (game.authority === 'server') {
    const { httpsCallable } = await import('firebase/functions')
    await httpsCallable(functions, 'startGame')({ code })
    return
  }

  await runTransaction(db, async (tx) => {
    const fresh = (await tx.get(ref)).data() as GameDoc
    if (fresh.status !== 'lobby') return
    const setup = fresh.setup ? (JSON.parse(fresh.setup) as Pick<NewGame, 'map' | 'start'>) : {}
    const state = createGame(
      {
        config: { ...fresh.config, players: fresh.seats.length },
        seats: fresh.seats.map((s, i) => ({ name: s.name || `Player ${i + 1}`, color: s.color, bot: s.bot })),
        ...setup,
      },
      { rng: cryptoRng, now: Date.now() },
    )
    const json = JSON.stringify(state)
    if (json.length > MAX_STATE_BYTES) throw new Error('That game is too big to store.')
    tx.update(ref, { state: json, ...summarise(state), updatedAt: serverTimestamp() })
    // The starting state, so a replay can begin from it.
    tx.set(doc(db, 'games', code, 'log', '0'), { seq: 0, initial: json, uid: user.uid, at: serverTimestamp() })
  })
}

/* ------------------------------------------------------------------ *
 * Playing
 * ------------------------------------------------------------------ */

export interface SubmitOptions {
  /** Act for this seat (a bot, driven from this browser); defaults to your own. */
  seat?: number
  /** Drop the action if the state has moved past this sequence number. */
  expectedSeq?: number
}

export async function submitAction(code: string, authority: Authority, action: Action, opts: SubmitOptions = {}) {
  const user = await ensureUser()
  const { db, functions } = await getFirebase()

  if (authority === 'server') {
    const { httpsCallable } = await import('firebase/functions')
    try {
      await httpsCallable(functions, 'act')({ code, action, expectedSeq: opts.expectedSeq })
    } catch (error) {
      const e = error as { code?: string; message?: string }
      if (e.code === 'functions/aborted') throw new StaleError()
      throw new RuleError(e.message ?? 'That action failed.')
    }
    return
  }

  const { doc, runTransaction, serverTimestamp } = await fs()
  const ref = doc(db, 'games', code)
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists()) throw new Error('No game with that code.')
    const game = snap.data() as GameDoc
    if (game.status !== 'playing' || !game.state) throw new RuleError('The game is not running.')
    const state = JSON.parse(game.state) as GameState
    if (opts.expectedSeq !== undefined && state.seq !== opts.expectedSeq) throw new StaleError()
    const mine = game.seatUids.indexOf(user.uid)
    if (mine < 0) throw new RuleError("You're watching, not playing.")
    let seat = mine
    if (opts.seat !== undefined && opts.seat !== mine) {
      // A human may act for a bot, or call time on anyone.
      if (!game.seats[opts.seat]?.bot && action.type !== 'timeout') throw new RuleError('That seat is not yours.')
      seat = opts.seat
    }
    const rng = recordingRng(cryptoRng)
    const next = applyAction(state, seat, action, { rng, now: Date.now() })
    const json = JSON.stringify(next)
    if (json.length > MAX_STATE_BYTES) throw new Error('The game state grew too large to store.')
    tx.update(ref, { state: json, ...summarise(next), updatedAt: serverTimestamp() })
    const entry: LogDoc = { seq: next.seq, seat, action, draws: rng.draws, uid: user.uid, at: serverTimestamp() }
    tx.set(doc(db, 'games', code, 'log', String(next.seq)), entry)
  })
}

/* ------------------------------------------------------------------ *
 * Subscriptions
 * ------------------------------------------------------------------ */

export interface Live {
  game: GameDoc | null
  /** What this browser may see. */
  view: GameView | null
  /** The full state, when this browser has it (client authority). */
  state: GameState | null
  seat: number | null
  uid: string
}

/** Watch a game. Calls back with each change; returns an unsubscribe function. */
export async function watchGame(code: string, onChange: (live: Live) => void, onError: (e: Error) => void) {
  const user = await ensureUser()
  const { db } = await getFirebase()
  const { doc, onSnapshot } = await fs()
  let game: GameDoc | null = null
  let serverView: GameView | null = null
  let stopView: (() => void) | null = null

  const emit = () => {
    const seat = game ? game.seatUids.indexOf(user.uid) : -1
    const mySeat = seat >= 0 ? seat : null
    let state: GameState | null = null
    let view: GameView | null = null
    if (game?.authority === 'client' && game.state) {
      state = JSON.parse(game.state) as GameState
      view = redact(state, mySeat)
    } else if (game?.authority === 'server') {
      view = serverView ?? (game.view ? (JSON.parse(game.view) as GameView) : null)
    }
    onChange({ game, view, state, seat: mySeat, uid: user.uid })
  }

  const stopGame = onSnapshot(
    doc(db, 'games', code),
    (snap) => {
      game = snap.exists() ? (snap.data() as GameDoc) : null
      if (game?.authority === 'server' && !stopView && game.seatUids.includes(user.uid)) {
        stopView = onSnapshot(doc(db, 'games', code, 'views', user.uid), (v) => {
          serverView = v.exists() ? (JSON.parse((v.data() as { state: string }).state) as GameView) : null
          emit()
        }, (e) => onError(e))
      }
      emit()
    },
    (e) => onError(e),
  )
  return () => {
    stopGame()
    stopView?.()
  }
}

export async function watchChat(code: string, onChange: (messages: Array<ChatDoc & { id: string }>) => void) {
  await ensureUser()
  const { db } = await getFirebase()
  const { collection, limitToLast, onSnapshot, orderBy, query } = await fs()
  return onSnapshot(
    query(collection(db, 'games', code, 'chat'), orderBy('at'), limitToLast(100)),
    (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ChatDoc) }))),
    () => onChange([]),
  )
}

export async function sendChat(code: string, name: string, seat: number | null, text: string) {
  const user = await ensureUser()
  const { db } = await getFirebase()
  const { addDoc, collection, serverTimestamp } = await fs()
  const clean = text.trim().slice(0, CHAT_LIMIT)
  if (!clean) return
  const message: ChatDoc = { uid: user.uid, seat, name: name.slice(0, 32), text: clean, at: serverTimestamp() }
  await addDoc(collection(db, 'games', code, 'chat'), message)
}

export async function watchLists(
  onChange: (lists: { mine: GameDoc[]; open: GameDoc[] }) => void,
  onError: (e: Error) => void,
) {
  const user = await ensureUser()
  const { db } = await getFirebase()
  const { collection, limit, onSnapshot, orderBy, query, where } = await fs()
  let mine: GameDoc[] = []
  let open: GameDoc[] = []
  const emit = () => onChange({ mine, open })
  const a = onSnapshot(
    query(collection(db, 'games'), where('seatUids', 'array-contains', user.uid), orderBy('updatedAt', 'desc'), limit(20)),
    (snap) => {
      mine = snap.docs.map((d) => d.data() as GameDoc)
      emit()
    },
    (e) => onError(e),
  )
  const b = onSnapshot(
    query(collection(db, 'games'), where('visibility', '==', 'public'), where('status', '==', 'lobby'), orderBy('createdAt', 'desc'), limit(20)),
    (snap) => {
      open = snap.docs.map((d) => d.data() as GameDoc)
      emit()
    },
    (e) => onError(e),
  )
  return () => {
    a()
    b()
  }
}

/** A finished (or browser-refereed) game's start and every move, for the replay. */
export async function loadReplay(code: string): Promise<{ initial: GameState; moves: LogDoc[] } | null> {
  const log = await loadLog(code)
  const first = log[0] as (LogDoc & { initial?: string }) | undefined
  if (!first?.initial) return null
  return { initial: JSON.parse(first.initial) as GameState, moves: log.slice(1) }
}

/** The recorded actions, for a replay. */
export async function loadLog(code: string): Promise<LogDoc[]> {
  await ensureUser()
  const { db } = await getFirebase()
  const { collection, getDocs, orderBy, query } = await fs()
  const snap = await getDocs(query(collection(db, 'games', code, 'log'), orderBy('seq')))
  return snap.docs.map((d) => d.data() as LogDoc)
}
