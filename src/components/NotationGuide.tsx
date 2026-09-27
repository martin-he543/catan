import { NOTATION_EXAMPLE, NOTATION_REFERENCE } from '../lib/notation'
import { Accordion } from './Accordion'


/**
 * The spec, rendered from the same tables the parser is built around so the two
 * cannot drift apart.
 */
export function NotationGuide() {
  return (
    <div className="flex flex-col gap-6">
      <div className="panel overflow-hidden">
        {NOTATION_REFERENCE.map((section, i) => (
          <Accordion
            key={section.title}
            title={section.title}
            subtitle={section.blurb}
            defaultOpen={i === 0}
          >
            <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[minmax(9rem,auto)_1fr]">
              {section.rows.map((row) => (
                <div key={row.token} className="contents">
                  <dt className="font-mono text-sm text-sea-50">{row.token}</dt>
                  <dd className="mb-2 text-sm text-sea-100/80 sm:mb-0">{row.meaning}</dd>
                </div>
              ))}
            </dl>
          </Accordion>
        ))}
      </div>

      <div>
        <h3 className="font-display text-lg font-semibold">A whole game, start to finish</h3>
        <p className="mt-1 text-sm text-sea-100/70">
          Nine turns and an opening. Everything after a semicolon is a comment.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-2xl border border-white/10 bg-black/40 p-4
                        font-mono text-xs leading-relaxed text-sea-100">
          {NOTATION_EXAMPLE}
        </pre>
      </div>
    </div>
  )
}
