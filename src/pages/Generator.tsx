import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Board } from '../components/Board'
import { Sidebar } from '../components/Sidebar'
import { DiceRoller } from '../components/DiceRoller'
import { newGame } from '../lib/board'
import { decodeGame, decodeMoves, encodeGame, encodeMoves } from '../lib/codec'
import { analyseBoard, legalVertices } from '../lib/analysis'
import { PortShifter } from '../components/PortMarker'
import { PLACEMENT_ORDER, type Game, type GameType } from '../lib/types'

const GAME_TYPES: GameType[] = ['spiral', 'pseudorandom', 'random']

function isGameType(value: string | null): value is GameType {
  return value !== null && (GAME_TYPES as string[]).includes(value)
}

/** Read the board out of the URL, falling back to a fresh one. */
function initialState(params: URLSearchParams): { game: Game; type: GameType } {
  const type = isGameType(params.get('gameType')) ? (params.get('gameType') as GameType) : 'spiral'

  const code = params.get('game')
  if (code) {
    const game = decodeGame(code)
    if (game) {
      const moves = params.get('moves')
      if (moves) {
        // Trust the geometry, not the link: drop any illegal placements.
        for (const loc of decodeMoves(moves)) {
          if (game.locs.length < PLACEMENT_ORDER.length && legalVertices(game.locs).has(loc)) {
            game.locs.push(loc)
          }
        }
      }
      return { game, type }
    }
  }

  return { game: newGame(type), type }
}

export function Generator() {
  const [params, setParams] = useSearchParams()
  const [{ game, type }, setState] = useState(() => initialState(params))
  const [hovered, setHovered] = useState<number | null>(null)
  const [showRatings, setShowRatings] = useState(true)
  const [diceOpen, setDiceOpen] = useState(false)

  const code = useMemo(() => encodeGame(game), [game])
  const reports = useMemo(() => analyseBoard(game), [game])

  // Keep the address bar in step so a refresh or a copied URL is lossless.
  useEffect(() => {
    const next = new URLSearchParams()
    next.set('gameType', type)
    next.set('game', code)
    if (game.locs.length > 0) next.set('moves', encodeMoves(game.locs))
    setParams(next, { replace: true })
  }, [code, game.locs, type, setParams])

  const generate = useCallback((nextType: GameType) => {
    // Port nudges describe the physical board, so they outlive a reshuffle.
    setState((s) => ({ game: { ...newGame(nextType), portShifts: s.game.portShifts }, type: nextType }))
    setHovered(null)
  }, [])

  const select = useCallback((vertex: number) => {
    setState((s) => {
      if (s.game.locs.length >= PLACEMENT_ORDER.length) return s
      if (!legalVertices(s.game.locs).has(vertex)) return s
      return { ...s, game: { ...s.game, locs: [...s.game.locs, vertex] } }
    })
  }, [])

  const undo = useCallback(() => {
    setState((s) => ({ ...s, game: { ...s.game, locs: s.game.locs.slice(0, -1) } }))
  }, [])

  const reset = useCallback(() => {
    setState((s) => ({ ...s, game: { ...s.game, locs: [] } }))
  }, [])

  // Keyboard shortcuts, ignored while the user is typing somewhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (target?.closest('input, textarea, select, [contenteditable]')) return

      const key = e.key.toLowerCase()
      if (key === 'r') generate(type)
      else if (key === 'u') undo()
      else if (key === 'd') setDiceOpen((open) => !open)
      else if (key === 'p') setShowRatings((show) => !show)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [generate, type, undo])

  const origin = typeof window === 'undefined' ? '' : window.location.origin
  const path = typeof window === 'undefined' ? '' : window.location.pathname
  const boardUrl = `${origin}${path}?gameType=${type}&game=${encodeURIComponent(code)}`
  const fullUrl =
    game.locs.length > 0
      ? `${boardUrl}&moves=${encodeURIComponent(encodeMoves(game.locs))}`
      : boardUrl

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 lg:px-8">
      <div className="flex flex-col gap-8 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
            <PortShifter
              shifts={game.portShifts}
              onShift={(portShifts) => setState((s) => ({ ...s, game: { ...s.game, portShifts } }))}
            />
          </div>
          <Board
            game={game}
            reports={reports}
            showRatings={showRatings}
            hovered={hovered}
            onHover={setHovered}
            onSelect={select}
          />
        </div>

        <Sidebar
          gameType={type}
          onGenerate={generate}
          boardUrl={boardUrl}
          fullUrl={fullUrl}
          locs={game.locs}
          reports={reports}
          onUndo={undo}
          onReset={reset}
          showRatings={showRatings}
          onToggleRatings={() => setShowRatings((s) => !s)}
          onOpenDice={() => setDiceOpen(true)}
          hovered={hovered}
        />
      </div>

      <DiceRoller open={diceOpen} onClose={() => setDiceOpen(false)} />
    </div>
  )
}
