/**
 * The Firestore documents, shared by the browser and the Cloud Function.
 *
 *   games/{code}                the lobby and the game (see GameDoc)
 *   games/{code}/log/{seq}      every action with the dice it drew, for replays
 *   games/{code}/chat/{id}      table talk
 *   games/{code}/views/{uid}    server authority only: each seat's redacted view
 *   games/{code}/secret/state   server authority only: the full state, no client access
 *
 * Game states are stored as JSON strings: Firestore can't hold nested arrays,
 * and a string keeps the security rules simple (they check its size).
 */
import { actingSeat, waitingOn } from '../engine/rules'
import type { Action, GameConfig, GameState, PlayerColor } from '../engine/types'

export type Authority = 'client' | 'server'
export type GameStatus = 'lobby' | 'playing' | 'ended'

export interface SeatDoc {
  /** Firebase uid of the human in the seat; null for an open seat or a bot. */
  uid: string | null
  name: string
  color: PlayerColor
  bot: boolean
}

export interface GameDoc {
  code: string
  hostUid: string
  status: GameStatus
  visibility: 'public' | 'private'
  authority: Authority
  mode: string
  title: string
  config: GameConfig
  seats: SeatDoc[]
  /** Uid per seat, '' for open seats and bots — what the security rules look at. */
  seatUids: string[]
  seq: number
  /** JSON of a map dealt in advance (and a starting position), when there is one. */
  setup: string | null
  /** Which page the board came from, if it was brought over. */
  boardFrom?: string | null
  /** Client authority: the full game state as JSON. */
  state?: string
  /** Server authority: the spectator's redacted view as JSON. */
  view?: string
  turnSeat: number | null
  waiting: number[]
  winner: number | null
  /** When the turn timer runs out (epoch ms), for the server's timeout sweep. */
  deadline?: number | null
  createdAt?: unknown
  updatedAt?: unknown
}

export interface LogDoc {
  seq: number
  seat: number
  action: Action
  /** Random numbers the action consumed, so it replays exactly. */
  draws: number[]
  uid: string
  at?: unknown
}

export interface ChatDoc {
  uid: string
  seat: number | null
  name: string
  text: string
  at?: unknown
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

/** A short code that reads aloud without confusion (no 0/O, 1/I). */
export function newCode(random: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < 6; i++) out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)]
  return out
}

export const isCode = (text: string) => /^[A-Z2-9]{6}$/.test(text)

/** The denormalised fields the lobby lists show without parsing the state. */
export function summarise(state: GameState): Pick<GameDoc, 'status' | 'turnSeat' | 'waiting' | 'winner' | 'seq' | 'deadline'> {
  return {
    status: state.phase === 'ended' ? 'ended' : 'playing',
    turnSeat: state.phase === 'main' ? state.turn.seat : actingSeat(state),
    waiting: waitingOn(state),
    winner: state.winner,
    seq: state.seq,
    deadline: state.deadline,
  }
}

/** Largest state the rules accept, comfortably under Firestore's 1 MiB document limit. */
export const MAX_STATE_BYTES = 900_000

export const CHAT_LIMIT = 300
