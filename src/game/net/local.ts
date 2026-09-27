/**
 * Games on this device — against bots, or pass-and-play — kept in
 * localStorage so a refresh doesn't lose them. No Firebase needed.
 */
import type { Action, GameState } from '../engine/types'

/** One recorded action, with the random numbers it drew, so the game replays exactly. */
export interface Move {
  seat: number
  action: Action
  draws: number[]
}

export interface LocalGame {
  id: string
  createdAt: number
  updatedAt: number
  mode: string
  state: GameState
  /** Seats played by people at this device. */
  humans: boolean[]
  /** The starting state and every move since, for the replay. */
  initial?: GameState
  moves?: Move[]
}

const INDEX_KEY = 'catan.local.index'
const gameKey = (id: string) => `catan.local.${id}`

function readIndex(): string[] {
  try {
    return JSON.parse(localStorage.getItem(INDEX_KEY) ?? '[]') as string[]
  } catch {
    return []
  }
}

export function listLocalGames(): LocalGame[] {
  return readIndex()
    .map((id) => loadLocalGame(id))
    .filter((g): g is LocalGame => g !== null)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function loadLocalGame(id: string): LocalGame | null {
  try {
    const raw = localStorage.getItem(gameKey(id))
    return raw ? (JSON.parse(raw) as LocalGame) : null
  } catch {
    return null
  }
}

export function saveLocalGame(game: LocalGame) {
  const entry = { ...game, updatedAt: Date.now() }
  try {
    localStorage.setItem(gameKey(game.id), JSON.stringify(entry))
  } catch {
    // Storage full: drop the oldest finished games and try once more.
    for (const old of listLocalGames().reverse()) {
      if (old.id !== game.id && old.state.phase === 'ended') deleteLocalGame(old.id)
    }
    localStorage.setItem(gameKey(game.id), JSON.stringify(entry))
  }
  const index = readIndex().filter((x) => x !== game.id)
  localStorage.setItem(INDEX_KEY, JSON.stringify([game.id, ...index].slice(0, 30)))
}

export function deleteLocalGame(id: string) {
  localStorage.removeItem(gameKey(id))
  localStorage.setItem(INDEX_KEY, JSON.stringify(readIndex().filter((x) => x !== id)))
}

export const newLocalId = () => `L${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
