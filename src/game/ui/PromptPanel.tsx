/**
 * Whatever the game is asking you right now. Every prompt is one of three
 * shapes — pick cards, pick an option, or pick on the board — so this one
 * panel answers all of them, from discards to the Commercial Harbor.
 */
import { useState } from 'react'
import { CARDS, type Action, type Card, type CardCounts, type Prompt, type RouteKind } from '../engine/types'
import type { GameView } from '../engine/view'
import { CardPicker } from './cards'

type Respond = Omit<Extract<Action, { type: 'respond' }>, 'type' | 'prompt'>

interface Props {
  view: GameView
  prompt: Prompt
  onRespond: (prompt: Prompt, response: Respond) => void
  /** Hexes picked so far, for prompts that want two (Inventor). */
  picked: number[]
  routeKind: RouteKind
  onRouteKind: (kind: RouteKind) => void
  busy: boolean
}

export function PromptPanel({ view, prompt, onRespond, picked, routeKind, onRouteKind, busy }: Props) {
  // The parent keys this panel by prompt id, so the picks reset with each question.
  const [cards, setCards] = useState<CardCounts>({})
  const input = prompt.input

  return (
    <section className="panel border-amber-300/40 bg-amber-300/10 p-4" aria-live="polite">
      <h2 className="font-display text-base font-bold text-amber-100">{prompt.text}</h2>

      {input.kind === 'cards' && (() => {
        const source =
          input.source === 'hand' ? view.players[prompt.seat].hand
          : input.source === 'bank' ? view.bank
          : view.players[input.source.seat].hand
        // From a hand, offer only what is there; from the bank, every allowed kind.
        const allowed = (input.allowed ?? CARDS).filter((c) => input.source === 'bank' || source[c] > 0)
        const chosen = Object.values(cards).reduce<number>((s, n) => s + (n ?? 0), 0)
        return (
          <div className="mt-3 flex flex-col gap-3">
            <CardPicker
              cards={allowed as Card[]}
              value={cards}
              onChange={setCards}
              max={(c) => source[c]}
              total={input.count}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy || chosen !== input.count}
                onClick={() => onRespond(prompt, { cards })}
                className="rounded-xl bg-amber-300 px-4 py-2 font-display font-semibold text-amber-950 disabled:opacity-40"
              >
                Confirm {chosen}/{input.count}
              </button>
              {prompt.optional && (
                <button type="button" disabled={busy} onClick={() => onRespond(prompt, { skip: true })}
                  className="rounded-xl border border-white/15 px-4 py-2 text-sm hover:bg-white/10">
                  Skip
                </button>
              )}
            </div>
          </div>
        )
      })()}

      {input.kind === 'choice' && (
        <div className="mt-3 flex flex-wrap gap-2">
          {input.options.map((o) => (
            <button
              key={o.id}
              type="button"
              disabled={busy}
              onClick={() => onRespond(prompt, { choice: o.id })}
              className="rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold transition hover:bg-white/20 disabled:opacity-40"
            >
              {o.label}
            </button>
          ))}
          {prompt.optional && (
            <button type="button" disabled={busy} onClick={() => onRespond(prompt, { skip: true })}
              className="rounded-xl border border-white/15 px-3 py-2 text-sm hover:bg-white/10">
              Skip
            </button>
          )}
        </div>
      )}

      {input.kind === 'board' && (
        <div className="mt-2 flex flex-col gap-2 text-sm text-amber-50/90">
          <p>
            {input.hexes ? 'Choose a highlighted tile on the board.'
              : input.edges ? 'Choose a highlighted edge on the board.'
              : 'Choose a highlighted corner on the board.'}
          </p>
          {input.pieces && input.pieces.length > 1 && (
            <div className="flex gap-1" role="radiogroup" aria-label="Piece">
              {input.pieces.map((k) => (
                <button key={k} type="button" role="radio" aria-checked={routeKind === k}
                  onClick={() => onRouteKind(k)}
                  className={`rounded-lg px-3 py-1 text-sm ${routeKind === k ? 'bg-amber-300 font-semibold text-amber-950' : 'bg-white/10'}`}>
                  {k === 'road' ? 'Road' : 'Ship'}
                </button>
              ))}
            </div>
          )}
          {(input.count ?? 1) > 1 && (
            <div className="flex items-center gap-2">
              <span>{picked.length} of {input.count} picked</span>
              <button type="button" disabled={busy || picked.length !== input.count}
                onClick={() => onRespond(prompt, { hexes: picked })}
                className="rounded-xl bg-amber-300 px-4 py-1.5 font-semibold text-amber-950 disabled:opacity-40">
                Confirm
              </button>
            </div>
          )}
          {prompt.optional && (
            <button type="button" disabled={busy} onClick={() => onRespond(prompt, { skip: true })}
              className="self-start rounded-xl border border-white/15 px-3 py-1.5 text-sm hover:bg-white/10">
              {prompt.type === 'freeRoad' || prompt.type === 'smith' ? 'Stop here' : 'Skip'}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

/** What the others are being asked, so you know what you are waiting for. */
export function WaitingOn({ view, prompts }: { view: GameView; prompts: Prompt[] }) {
  if (!prompts.length) return null
  return (
    <ul className="space-y-1 text-sm text-sea-100/80">
      {prompts.map((p) => (
        <li key={p.id}>
          Waiting for <b>{view.players[p.seat].name}</b>: {p.text.charAt(0).toLowerCase() + p.text.slice(1)}
        </li>
      ))}
    </ul>
  )
}
