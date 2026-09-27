/** Card chips, card pickers and dice. */
import { dieImage } from '../../lib/assets'
import { CARDS, type Card, type CardCounts, type Dice, type Hand } from '../engine/types'
import { CARD_COLOR, CARD_EMOJI, CARD_LABEL, INK, TRACK_COLOR } from './labels'

export function CardChip({ card, count, dim, small }: { card: Card; count?: number; dim?: boolean; small?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg font-medium whitespace-nowrap ${small ? 'px-1.5 py-0.5 text-[0.7rem]' : 'px-2 py-1 text-xs'}`}
      style={{ backgroundColor: CARD_COLOR[card], color: INK, opacity: dim ? 0.45 : 1 }}
      title={CARD_LABEL[card]}
    >
      <span aria-hidden>{CARD_EMOJI[card]}</span>
      <span className={small ? 'sr-only' : ''}>{CARD_LABEL[card]}</span>
      {count !== undefined && <span className="font-display font-bold tabular-nums">{count}</span>}
    </span>
  )
}

/** A compact list like "🧱 2 🌾 1". */
export function CardList({ cards, empty = 'nothing' }: { cards: CardCounts; empty?: string }) {
  const entries = CARDS.filter((c) => (cards[c] ?? 0) > 0)
  if (!entries.length) return <span className="text-sea-200/60">{empty}</span>
  return (
    <span className="inline-flex flex-wrap gap-1">
      {entries.map((c) => (
        <CardChip key={c} card={c} count={cards[c]} small />
      ))}
    </span>
  )
}

export function HandView({ hand, cards = CARDS }: { hand: Hand; cards?: readonly Card[] }) {
  const shown = cards.filter((c) => hand[c] > 0)
  if (!shown.length) return <p className="text-sm text-sea-200/70">No cards.</p>
  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((c) => (
        <CardChip key={c} card={c} count={hand[c]} />
      ))}
    </div>
  )
}

/**
 * Pick cards with steppers. `max` bounds each kind; `step` makes a kind move
 * in lumps (bank trades at 4:1, say).
 */
export function CardPicker({
  cards,
  value,
  onChange,
  max,
  step,
  total,
}: {
  cards: readonly Card[]
  value: CardCounts
  onChange: (next: CardCounts) => void
  max: (c: Card) => number
  step?: (c: Card) => number
  /** Stop adding once this many are chosen. */
  total?: number
}) {
  const chosen = Object.values(value).reduce<number>((s, n) => s + (n ?? 0), 0)
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-1.5">
      {cards.map((c) => {
        const n = value[c] ?? 0
        const by = step?.(c) ?? 1
        const canAdd = n + by <= max(c) && (total === undefined || chosen + 1 <= total)
        return (
          <div key={c} className="flex items-center justify-between gap-1 rounded-lg px-1.5 py-1" style={{ backgroundColor: CARD_COLOR[c], color: INK }}>
            <span className="flex items-center gap-1 text-xs font-medium">
              <span aria-hidden>{CARD_EMOJI[c]}</span>
              {CARD_LABEL[c]}
              {by > 1 && <span className="text-[0.65rem] opacity-60">{by}:1</span>}
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-label={`One less ${CARD_LABEL[c]}`}
                disabled={n === 0}
                onClick={() => onChange({ ...value, [c]: n - by })}
                className="h-6 w-6 rounded-md bg-black/10 font-bold disabled:opacity-30"
              >
                −
              </button>
              <span className="w-4 text-center font-display font-bold tabular-nums">{n}</span>
              <button
                type="button"
                aria-label={`One more ${CARD_LABEL[c]}`}
                disabled={!canAdd}
                onClick={() => onChange({ ...value, [c]: n + by })}
                className="h-6 w-6 rounded-md bg-black/10 font-bold disabled:opacity-30"
              >
                +
              </button>
            </span>
          </div>
        )
      })}
    </div>
  )
}

const EVENT_FACE: Record<string, { label: string; symbol: string; color: string }> = {
  barbarian: { label: 'Barbarian ship', symbol: '⛵', color: '#1f2937' },
  trade: { label: 'Trade gate', symbol: '🏰', color: TRACK_COLOR.trade },
  politics: { label: 'Politics gate', symbol: '🏰', color: TRACK_COLOR.politics },
  science: { label: 'Science gate', symbol: '🏰', color: TRACK_COLOR.science },
}

const PIP_SPOTS: Record<number, Array<[number, number]>> = {
  1: [[50, 50]],
  2: [[28, 28], [72, 72]],
  3: [[26, 26], [50, 50], [74, 74]],
  4: [[28, 28], [72, 28], [28, 72], [72, 72]],
  5: [[26, 26], [74, 26], [50, 50], [26, 74], [74, 74]],
  6: [[28, 24], [72, 24], [28, 50], [72, 50], [28, 76], [72, 76]],
}

/** The Cities & Knights red die: white pips on red, as in the box. */
function RedDie({ value }: { value: number }) {
  return (
    <svg viewBox="0 0 100 100" className="h-8 w-8" role="img" aria-label={`red ${value}`}>
      <rect x="6" y="6" width="88" height="88" rx="10" fill="#dc2626" stroke="#7f1d1d" strokeWidth="3" />
      {PIP_SPOTS[value].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r="9" fill="#fff" />
      ))}
    </svg>
  )
}

export function DiceView({ dice, ck }: { dice: Dice | null; ck: boolean }) {
  if (!dice) return <span className="text-sm text-sea-200/70">Not rolled yet</span>
  const event = dice.event ? EVENT_FACE[dice.event] : null
  return (
    <span className="inline-flex items-center gap-1.5" aria-label={`Rolled ${dice.a + dice.b}`}>
      <img
        src={dieImage(dice.a)}
        alt={String(dice.a)}
        className="h-8 w-8"
        // In Cities & Knights the production die pair is yellow and red.
        style={ck ? { filter: 'sepia(0.9) saturate(5) hue-rotate(-8deg) brightness(1.05)' } : undefined}
      />
      {ck ? <RedDie value={dice.b} /> : <img src={dieImage(dice.b)} alt={String(dice.b)} className="h-8 w-8" />}
      {event && (
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md text-lg"
          style={{ backgroundColor: event.color }}
          title={event.label}
        >
          {event.symbol}
        </span>
      )}
      <span className="ml-1 font-display text-2xl font-bold tabular-nums">{dice.a + dice.b}</span>
    </span>
  )
}
