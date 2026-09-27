import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { asset, dieImage } from '../lib/assets'

interface Roll {
  id: number
  a: number
  b: number
}

const roll = () => 1 + Math.floor(Math.random() * 6)

interface Props {
  open: boolean
  onClose: () => void
}

export function DiceRoller({ open, onClose }: Props) {
  const [current, setCurrent] = useState<Roll>({ id: 0, a: 3, b: 4 })
  const [rolling, setRolling] = useState(false)
  const [history, setHistory] = useState<number[]>([])
  const [muted, setMuted] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const throwDice = useCallback(() => {
    if (rolling) return
    setRolling(true)

    if (!muted) {
      const audio = new Audio(asset('audio/dice_roll.mp3'))
      // Autoplay can be blocked before the user interacts; that's harmless.
      audio.play().catch(() => {})
    }

    timer.current = setTimeout(() => {
      const next = { id: Date.now(), a: roll(), b: roll() }
      setCurrent(next)
      setHistory((h) => [next.a + next.b, ...h].slice(0, 12))
      setRolling(false)
    }, 700)
  }, [muted, rolling])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault()
        throwDice()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, throwDice])

  const total = current.a + current.b

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label="Dice roller"
        >
          <motion.div
            className="panel w-full max-w-sm bg-sea-900/90 p-6 text-center shadow-2xl"
            initial={{ scale: 0.9, y: 16 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 8 }}
            transition={{ type: 'spring', stiffness: 320, damping: 26 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <h2 className="font-display text-lg font-semibold">Dice</h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-2 py-1 text-sea-200 hover:bg-white/10"
                aria-label="Close dice roller"
              >
                ✕
              </button>
            </div>

            <div className="my-6 flex justify-center gap-5">
              {[current.a, current.b].map((face, i) => (
                <motion.img
                  key={`${current.id}-${i}`}
                  src={dieImage(face)}
                  alt={`Die showing ${face}`}
                  className="h-20 w-20 drop-shadow-[0_4px_10px_rgba(0,0,0,0.5)]"
                  animate={
                    rolling
                      ? { rotate: [0, -14, 14, -10, 0], y: [0, -10, 0, -6, 0] }
                      : { rotate: 0, y: 0 }
                  }
                  transition={
                    rolling
                      ? { duration: 0.35, repeat: Infinity, ease: 'easeInOut' }
                      : { type: 'spring', stiffness: 400, damping: 18 }
                  }
                />
              ))}
            </div>

            <p className="font-display text-3xl font-bold tabular-nums" aria-live="polite">
              {rolling ? '…' : total}
            </p>
            <p className="mt-1 text-xs text-sea-200">
              {rolling ? 'Rolling' : total === 7 ? 'Move the robber' : 'Collect resources'}
            </p>

            <button
              type="button"
              onClick={throwDice}
              disabled={rolling}
              className="mt-5 w-full rounded-xl bg-player-red py-3 font-display font-semibold
                         text-white transition hover:brightness-110 disabled:opacity-60"
            >
              Roll
            </button>

            <div className="mt-4 flex items-center justify-between text-xs text-sea-200">
              <span className="flex flex-wrap gap-1" aria-label="Recent rolls">
                {history.map((value, i) => (
                  <span
                    key={i}
                    className={`rounded px-1.5 py-0.5 tabular-nums ${
                      value === 7 ? 'bg-player-red/30 text-white' : 'bg-white/10'
                    }`}
                  >
                    {value}
                  </span>
                ))}
              </span>
              <button
                type="button"
                onClick={() => setMuted((m) => !m)}
                className="shrink-0 rounded px-2 py-1 hover:bg-white/10"
              >
                {muted ? '🔇' : '🔊'}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
