/** Trading with the bank, harbours and other players. */
import { useMemo, useState } from 'react'
import { actingSeat } from '../engine/rules'
import { activePrompts, hasCards, tradeRatios } from '../engine/state'
import type { GameView } from '../engine/view'
import { COMMODITIES, RESOURCES, type Action, type Card, type CardCounts } from '../engine/types'
import { CardList, CardPicker } from './cards'
import { Panel, Swatch } from './panels'
import { asState } from './util'
import { CARD_LABEL, PLAYER_HEX } from './labels'

interface Props {
  view: GameView
  seat: number
  act: (action: Action) => void
  busy: boolean
}

const total = (cards: CardCounts) => Object.values(cards).reduce<number>((s, n) => s + (n ?? 0), 0)

export function TradePanel({ view, seat, act, busy }: Props) {
  const state = asState(view)
  const ck = view.config.citiesKnights
  const kinds: Card[] = ck ? [...RESOURCES, ...COMMODITIES] : [...RESOURCES]
  const [tab, setTab] = useState<'bank' | 'players'>('bank')
  const [give, setGive] = useState<CardCounts>({})
  const [get, setGet] = useState<CardCounts>({})
  const [offerGive, setOfferGive] = useState<CardCounts>({})
  const [offerGet, setOfferGet] = useState<CardCounts>({})
  const [to, setTo] = useState<number[]>([])

  const hand = view.players[seat].hand
  const ratios = useMemo(() => tradeRatios(state, seat), [state, seat])
  const stage = view.turn.stage.kind
  const prompts = activePrompts(state).length > 0
  const myTurn = view.phase === 'main' && actingSeat(state) === seat
  const bankOpen = myTurn && stage !== 'specialBuild' && (stage !== 'main' || view.turn.rolled)
  const playersOpen = view.config.playerTrades && view.phase === 'main' && !prompts && stage === 'main' && view.turn.rolled
  const current = view.turn.seat
  const iAmCurrent = current === seat

  const special = kinds.filter((c) => ratios[c] < 4)
  const rates = special.length === 0
    ? '4:1 for everything'
    : special.map((c) => `${CARD_LABEL[c].toLowerCase()} ${ratios[c]}:1`).join(', ') + (special.length < kinds.length ? ', others 4:1' : '')

  const credit = kinds.reduce((s, c) => s + (give[c] ?? 0) / ratios[c], 0)
  const bankValid = total(give) > 0 && total(get) > 0 && Number.isInteger(credit) && credit === total(get)

  const others = view.players.map((p, i) => ({ p, i })).filter(({ p, i }) => i !== seat && !p.resigned)
  const offers = view.offers

  return (
    <Panel
      title="Trade"
      right={
        <div className="flex gap-1 text-xs" role="tablist">
          {(['bank', 'players'] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={`rounded-md px-2 py-1 ${tab === t ? 'bg-white/15 text-white' : 'text-sea-200 hover:bg-white/5'}`}>
              {t === 'bank' ? 'Bank' : `Players${offers.length ? ` (${offers.length})` : ''}`}
            </button>
          ))}
        </div>
      }
    >
      {tab === 'bank' ? (
        <div className="flex flex-col gap-3">
          <p className="text-xs text-sea-200">Your rates: {rates}</p>
          <div>
            <h3 className="mb-1 text-xs font-semibold text-sea-200 uppercase">Give</h3>
            <CardPicker cards={kinds.filter((c) => hand[c] >= ratios[c])} value={give} onChange={setGive}
              max={(c) => hand[c] - (hand[c] % ratios[c])} step={(c) => ratios[c]} />
            {!kinds.some((c) => hand[c] >= ratios[c]) && <p className="text-xs text-sea-200/60">Nothing to trade yet.</p>}
          </div>
          <div>
            <h3 className="mb-1 text-xs font-semibold text-sea-200 uppercase">Take</h3>
            <CardPicker cards={kinds.filter((c) => !(give[c] ?? 0))} value={get} onChange={setGet}
              max={(c) => view.bank[c]} total={Math.max(1, Math.floor(credit))} />
          </div>
          <button
            type="button"
            disabled={!bankOpen || !bankValid || busy}
            onClick={() => {
              act({ type: 'tradeBank', give, get })
              setGive({})
              setGet({})
            }}
            className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950 disabled:opacity-40"
          >
            Trade with the bank
          </button>
          {!bankOpen && <p className="text-xs text-sea-200/70">You can trade with the bank on your turn, after rolling.</p>}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {offers.length > 0 && (
            <ul className="space-y-2">
              {offers.map((o) => {
                const from = view.players[o.from]
                const mine = o.from === seat
                const forMe = o.to.includes(seat)
                const accepted = o.accepted.includes(seat)
                const rejected = o.rejected.includes(seat)
                return (
                  <li key={o.id} className="rounded-xl bg-white/5 p-2 text-sm">
                    <div className="flex items-center gap-1.5">
                      <Swatch color={PLAYER_HEX[from.color]} className="h-3 w-3" />
                      <b>{mine ? 'You' : from.name}</b>
                      <span className="text-sea-200">offer{mine ? '' : 's'}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      <CardList cards={o.give} /> <span className="text-sea-200">for</span> <CardList cards={o.get} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {mine ? (
                        <>
                          {o.accepted.map((s) => (
                            <button key={s} type="button" disabled={busy} onClick={() => act({ type: 'offerConfirm', id: o.id, with: s })}
                              className="rounded-lg bg-emerald-400 px-2.5 py-1 text-xs font-semibold text-emerald-950">
                              Trade with {view.players[s].name}
                            </button>
                          ))}
                          {o.accepted.length === 0 && (
                            <span className="text-xs text-sea-200">
                              {o.rejected.length === o.to.length ? 'Everyone said no.' : 'Waiting for answers…'}
                            </span>
                          )}
                          <button type="button" disabled={busy} onClick={() => act({ type: 'offerCancel', id: o.id })}
                            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs">
                            Withdraw
                          </button>
                        </>
                      ) : forMe ? (
                        <>
                          <button type="button" disabled={busy || accepted || !hasCards(hand, o.get)}
                            onClick={() => act({ type: 'offerRespond', id: o.id, accept: true })}
                            className="rounded-lg bg-emerald-400 px-2.5 py-1 text-xs font-semibold text-emerald-950 disabled:opacity-40">
                            {accepted ? 'Accepted' : 'Accept'}
                          </button>
                          <button type="button" disabled={busy || rejected}
                            onClick={() => act({ type: 'offerRespond', id: o.id, accept: false })}
                            className="rounded-lg border border-white/15 px-2.5 py-1 text-xs disabled:opacity-40">
                            {rejected ? 'Declined' : 'Decline'}
                          </button>
                        </>
                      ) : (
                        <span className="text-xs text-sea-200">to {o.to.map((s) => view.players[s].name).join(', ')}</span>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}

          {playersOpen ? (
            <div className="flex flex-col gap-2 rounded-xl border border-white/10 p-2">
              <h3 className="text-xs font-semibold text-sea-200 uppercase">
                {iAmCurrent ? 'Make an offer' : `Offer ${view.players[current].name} a trade`}
              </h3>
              <span className="text-xs text-sea-200">You give</span>
              <CardPicker cards={kinds.filter((c) => hand[c] > 0)} value={offerGive} onChange={setOfferGive} max={(c) => hand[c]} />
              <span className="text-xs text-sea-200">You want</span>
              <CardPicker cards={kinds} value={offerGet} onChange={setOfferGet} max={() => 19} />
              {iAmCurrent && (
                <div className="flex flex-wrap gap-1 text-xs">
                  <span className="text-sea-200">To:</span>
                  {others.map(({ p, i }) => (
                    <button key={i} type="button" onClick={() => setTo((t) => (t.includes(i) ? t.filter((x) => x !== i) : [...t, i]))}
                      className={`rounded-md px-2 py-0.5 ${to.length === 0 || to.includes(i) ? 'bg-white/15' : 'bg-white/5 text-sea-200/60'}`}>
                      {p.name}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                disabled={busy || (total(offerGive) === 0 && total(offerGet) === 0)}
                onClick={() => {
                  act({ type: 'offer', give: offerGive, get: offerGet, to: iAmCurrent && to.length ? to : undefined })
                  setOfferGive({})
                  setOfferGet({})
                }}
                className="rounded-xl bg-sea-400 px-4 py-2 font-display font-semibold text-sea-950 disabled:opacity-40"
              >
                Send offer
              </button>
            </div>
          ) : (
            <p className="text-xs text-sea-200/70">
              {view.config.playerTrades
                ? 'Player trades open once the player whose turn it is has rolled.'
                : 'Player trades are off in this game.'}
            </p>
          )}
        </div>
      )}
    </Panel>
  )
}
