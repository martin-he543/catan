/**
 * What one seat is allowed to see.
 *
 * In server mode the Cloud Function stores one redacted copy per seat, so a
 * player's browser never receives anyone else's cards, the deck order or
 * what lies under the fog. In direct mode the browser has the full state but
 * the UI still renders through `redact`, so both modes look the same.
 */
import { handSize } from './state'
import { TRACKS, type GameState, type PlayerState, type Track } from './types'

export interface HiddenCounts {
  cards: number
  dev: number
  progress: number
  fish: number
}

export type PlayerView = PlayerState & { hidden?: HiddenCounts }

export interface GameView extends Omit<GameState, 'players'> {
  players: PlayerView[]
  /** The seat this view is for, or null for a spectator. */
  viewer: number | null
  decks: { dev: number; progress: Record<Track, number>; fish: number }
}

export function redact(state: GameState, viewer: number | null): GameView {
  const view = structuredClone(state) as unknown as GameView
  view.viewer = viewer
  view.decks = {
    dev: state.devDeck.length,
    progress: Object.fromEntries(TRACKS.map((t) => [t, state.progressDecks[t].length])) as Record<Track, number>,
    fish: state.fishDeck.length,
  }
  const over = state.phase === 'ended'

  // Seats whose hand this viewer may look at because a prompt says so (Master Merchant).
  const peek = new Set<number>()
  for (const step of state.queue) {
    if (step.kind === 'prompt' && step.seat === viewer && step.input.kind === 'cards' && typeof step.input.source === 'object') {
      peek.add(step.input.source.seat)
    }
  }

  view.players.forEach((p, i) => {
    if (over || i === viewer) return
    const original = state.players[i]
    p.hidden = {
      cards: handSize(original.hand),
      dev: original.dev.length,
      progress: original.progress.length,
      fish: original.fish.length,
    }
    if (!peek.has(i)) for (const k of Object.keys(p.hand) as Array<keyof typeof p.hand>) p.hand[k] = 0
    p.dev = []
    p.progress = []
    p.fish = []
  })

  if (!over) {
    view.devDeck = []
    view.progressDecks = { trade: [], politics: [], science: [] }
    view.fishDeck = []
    view.fishDiscard = []
    for (const h of view.map.hexes) {
      if (h.veil === 'fog') {
        h.terrain = 'sea'
        delete h.number
        delete h.fishing
        h.region = -1
      } else if (h.veil === 'blind') {
        h.terrain = 'desert'
        delete h.number
      } else if (h.veil === 'terrain') {
        h.terrain = 'desert'
      }
    }
  }

  view.log = view.log.map((entry) => {
    if (!entry.secret || over || (viewer !== null && entry.secret.seats.includes(viewer))) return entry
    const { secret: _secret, ...rest } = entry
    void _secret
    return rest
  })

  view.queue = view.queue.map((step) => {
    if (step.kind !== 'prompt' || step.seat === viewer) return step
    const { data: _data, ...rest } = step
    void _data
    if (rest.input.kind === 'choice') {
      rest.input = { kind: 'choice', options: rest.input.options.map((o) => ({ id: o.id, label: '' })) }
    }
    return rest
  })

  return view
}

/** Everything face up — for replays of finished games. */
export function fullView(state: GameState): GameView {
  const view = structuredClone(state) as unknown as GameView
  view.viewer = null
  view.decks = {
    dev: state.devDeck.length,
    progress: Object.fromEntries(TRACKS.map((t) => [t, state.progressDecks[t].length])) as Record<Track, number>,
    fish: state.fishDeck.length,
  }
  return view
}

/** Card count for a player in a view, whether or not their hand is hidden. */
export const cardCount = (p: PlayerView) => p.hidden?.cards ?? handSize(p.hand)
export const devCount = (p: PlayerView) => p.hidden?.dev ?? p.dev.length
export const progressCount = (p: PlayerView) => p.hidden?.progress ?? p.progress.length
export const fishCount = (p: PlayerView) => p.hidden?.fish ?? p.fish.length
