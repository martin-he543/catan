import { useId, useState, type ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  children: ReactNode
  defaultOpen?: boolean
}

/**
 * The original used a checkbox-and-CSS accordion; this is the same interaction
 * with real disclosure semantics for screen readers.
 */
export function Accordion({ title, subtitle, children, defaultOpen = false }: Props) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()

  return (
    <div className="overflow-hidden border-b border-white/10 last:border-b-0">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-white/5"
        >
          <span className="flex-1">
            <span className="block font-display font-semibold">{title}</span>
            {subtitle && <span className="block text-xs text-sea-200">{subtitle}</span>}
          </span>
          <span
            aria-hidden
            className="text-sea-200 transition-transform duration-300"
            style={{ rotate: open ? '90deg' : '0deg' }}
          >
            ❯
          </span>
        </button>
      </h3>
      <div
        id={id}
        role="region"
        hidden={!open}
        className="px-4 pb-4 text-sm leading-relaxed text-sea-100/90"
      >
        {children}
      </div>
    </div>
  )
}
