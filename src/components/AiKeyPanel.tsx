import { useState } from 'react'
import { AI_PROVIDERS, PROVIDERS, effectiveModel, type AiProvider } from '../lib/ai'

interface Props {
  provider: AiProvider
  onProvider: (provider: AiProvider) => void
  /** The saved key for each provider, so switching never loses the other one. */
  keys: Record<AiProvider, string>
  onKey: (provider: AiProvider, key: string) => void
  /** Per-provider model override; blank means use the default. */
  models: Record<AiProvider, string>
  onModel: (provider: AiProvider, model: string) => void
}

/**
 * Where the user parks their own API key.
 *
 * This site is a static bundle with no server behind it, so there is nowhere to
 * keep a shared secret. The honest version of "read it with AI" is therefore
 * bring-your-own-key, and the panel says plainly where the key goes. Keys are
 * held per provider so that trying the other one is not a destructive act.
 */
export function AiKeyPanel({
  provider, onProvider, keys, onKey, models, onModel,
}: Props) {
  const info = PROVIDERS[provider]
  const saved = keys[provider]

  // The panel is the only thing that edits a key, so the draft can start from
  // whatever was stored and stay local from there.
  const [drafts, setDrafts] = useState<Record<AiProvider, string>>(keys)
  const [show, setShow] = useState(false)

  const draft = drafts[provider]
  const setDraft = (value: string) => setDrafts((d) => ({ ...d, [provider]: value }))
  const save = (value: string) => onKey(provider, value.trim())

  return (
    <details className="panel px-4 py-3" open={!saved}>
      <summary className="cursor-pointer font-display font-semibold">
        {saved ? `${info.label} key saved` : 'Add an API key to read numbers too'}
      </summary>

      <p className="mt-3 text-sm leading-relaxed text-sea-100/80">
        Colour detection reads terrain but cannot read number tokens. A vision model reads
        both. There is no server behind this site, so the key is yours: it is kept in this
        browser's local storage and sent straight to {info.label}, never to us. Only providers
        that answer a browser directly are listed here, since there is no server to relay through.
      </p>

      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Model provider">
        {AI_PROVIDERS.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => onProvider(id)}
            aria-pressed={provider === id}
            className={`rounded-lg px-3 py-1.5 text-sm transition ${
              provider === id
                ? 'bg-sea-400 font-semibold text-sea-950'
                : 'bg-white/10 hover:bg-white/20'
            }`}
          >
            {PROVIDERS[id].label}
            {PROVIDERS[id].free && (
              <span
                className={`ml-1.5 rounded px-1 py-0.5 text-[0.65rem] font-semibold uppercase ${
                  provider === id ? 'bg-sea-950/25' : 'bg-emerald-400/20 text-emerald-200'
                }`}
              >
                free
              </span>
            )}
            {keys[id] && (
              <span className="ml-1.5 text-xs opacity-70" aria-label="key saved">
                ✓
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type={show ? 'text' : 'password'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => save(draft)}
          spellCheck={false}
          autoComplete="off"
          placeholder={info.placeholder}
          aria-label={`${info.label} API key`}
          className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2
                     font-mono text-sm text-sea-100 placeholder:text-sea-200/40"
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="rounded-xl border border-white/15 px-3 py-2 text-sm transition hover:bg-white/10"
        >
          {show ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          onClick={() => save(draft)}
          className="rounded-xl border border-white/15 px-3 py-2 text-sm font-semibold
                     transition hover:bg-white/10"
        >
          Save
        </button>
        {saved && (
          <button
            type="button"
            onClick={() => {
              setDraft('')
              save('')
            }}
            className="rounded-xl px-3 py-2 text-sm text-sea-200 transition hover:text-white"
          >
            Forget it
          </button>
        )}
      </div>

      <label className="mt-3 block text-xs text-sea-200">
        Model
        <input
          type="text"
          value={models[provider]}
          onChange={(e) => onModel(provider, e.target.value)}
          spellCheck={false}
          autoComplete="off"
          list={`models-${provider}`}
          placeholder={info.model}
          className="mt-1 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2
                     font-mono text-sm text-sea-100 placeholder:text-sea-200/40"
        />
        <datalist id={`models-${provider}`}>
          {info.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <p className="mt-2 text-xs text-sea-200/70">
        {info.note} Reads use{' '}
        <code className="rounded bg-white/10 px-1 py-0.5">
          {effectiveModel(provider, models[provider])}
        </code>
        .
      </p>

      <p className="mt-2 text-xs text-sea-200/70">
        Anyone with access to this browser profile can read a key stored this way. Use a key
        scoped to this purpose, and revoke it from the{' '}
        <a
          href={info.console}
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-white"
        >
          {info.consoleLabel}
        </a>{' '}
        if in doubt.
      </p>
    </details>
  )
}
